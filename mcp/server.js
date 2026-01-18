#!/usr/bin/env node

/**
 * Claudezilla MCP Server
 *
 * Exposes Firefox browser automation as MCP tools for Claude.
 * Connects to the Claudezilla native host via Unix socket.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { connect } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { readFileSync, existsSync } from 'fs';

// SECURITY: Use validated temp directory (same logic as host)
const SAFE_TMPDIR = (() => {
  const tmp = tmpdir();
  const xdgRuntime = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntime && existsSync(xdgRuntime)) {
    return xdgRuntime;
  }
  return tmp;
})();

const SOCKET_PATH = join(SAFE_TMPDIR, 'claudezilla.sock');
const AUTH_TOKEN_FILE = join(SAFE_TMPDIR, 'claudezilla-auth.token');

/**
 * Load auth token from file (written by host on startup)
 * Returns null if file doesn't exist (host not running)
 */
function loadAuthToken() {
  try {
    if (existsSync(AUTH_TOKEN_FILE)) {
      return readFileSync(AUTH_TOKEN_FILE, 'utf8').trim();
    }
  } catch (e) {
    console.error('Warning: Could not read auth token:', e.message);
  }
  return null;
}

// SECURITY: Unique agent ID with 128-bit entropy (16 bytes = 32 hex chars)
// Used for tab ownership tracking - only the agent that created a tab can close it
// Previous: 4 bytes (32 bits) was too weak and predictable
const AGENT_ID = `agent_${randomBytes(16).toString('hex')}_${process.pid}`;

// Agent heartbeat tracking for orphaned tab cleanup
const agentHeartbeats = new Map(); // agentId -> lastSeenTimestamp
const AGENT_TIMEOUT_MS = 120000; // 2 minutes - agent is considered dead after this
const CLEANUP_INTERVAL_MS = 60000; // 1 minute - check for orphaned agents every minute

/**
 * Update agent heartbeat - called on every command that includes agentId
 */
function updateAgentHeartbeat(agentId) {
  if (!agentId || agentId === 'unknown') return;
  agentHeartbeats.set(agentId, Date.now());
}

/**
 * Check for orphaned agents and trigger tab cleanup
 * An agent is orphaned if it hasn't been seen in AGENT_TIMEOUT_MS
 */
async function cleanupOrphanedAgents() {
  const now = Date.now();
  const orphanedAgents = [];

  // Find agents that haven't been seen in AGENT_TIMEOUT_MS
  for (const [agentId, lastSeen] of agentHeartbeats.entries()) {
    if (now - lastSeen > AGENT_TIMEOUT_MS) {
      orphanedAgents.push(agentId);
    }
  }

  // Cleanup tabs for each orphaned agent
  for (const agentId of orphanedAgents) {
    try {
      console.error(`[claudezilla] Cleaning up orphaned agent: ${agentId} (last seen ${Math.round((now - agentHeartbeats.get(agentId)) / 1000)}s ago)`);

      // Send cleanup command to extension
      const response = await sendCommand('cleanupOrphanedTabs', { agentId });

      if (response.success && response.result?.tabsClosed > 0) {
        console.error(`[claudezilla] Closed ${response.result.tabsClosed} orphaned tab(s) from ${agentId}`);
      }

      // Remove from heartbeat tracking
      agentHeartbeats.delete(agentId);
    } catch (error) {
      console.error(`[claudezilla] Error cleaning up orphaned agent ${agentId}:`, error.message);
    }
  }
}

// Start periodic orphaned agent cleanup
setInterval(cleanupOrphanedAgents, CLEANUP_INTERVAL_MS);

// Retry configuration for transient connection failures
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 1000,
  // Only retry these error codes (transient failures)
  retryableCodes: ['ENOENT', 'ECONNREFUSED', 'ECONNRESET'],
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Build actionable error message based on error code
 */
function buildErrorMessage(errCode, socketPath, authTokenFile) {
  const socketExists = existsSync(socketPath);
  const authTokenExists = existsSync(authTokenFile);

  // Diagnostic info for troubleshooting
  const diagnostics = `[Socket: ${socketExists ? 'exists' : 'missing'}, Auth: ${authTokenExists ? 'exists' : 'missing'}]`;

  switch (errCode) {
    case 'NO_AUTH_TOKEN':
      return `Claudezilla extension not connected. ${diagnostics}\n\n` +
        `To fix: Click the Claudezilla extension icon in Firefox to reconnect.\n` +
        `If not visible: Firefox menu → Add-ons → Extensions → Enable Claudezilla`;

    case 'ENOENT':
      return `Claudezilla socket not found. ${diagnostics}\n\n` +
        `To fix: Click the Claudezilla extension icon in Firefox to reconnect.\n` +
        `If Firefox isn't running: Open Firefox first, then click the extension icon.`;

    case 'ECONNREFUSED':
      return `Claudezilla connection refused. ${diagnostics}\n\n` +
        `The socket exists but the host isn't accepting connections.\n` +
        `To fix: Reload the Claudezilla extension (about:addons → Claudezilla → Reload)`;

    case 'ECONNRESET':
      return `Claudezilla connection reset. ${diagnostics}\n\n` +
        `The host disconnected unexpectedly.\n` +
        `To fix: Click the Claudezilla extension icon in Firefox to reconnect.`;

    default:
      return `Claudezilla error: ${errCode}. ${diagnostics}`;
  }
}

/**
 * Send command to Claudezilla via Unix socket (single attempt)
 * SECURITY: Includes auth token read from host-created file
 */
function sendCommandOnce(command, params = {}) {
  return new Promise((resolve, reject) => {
    // SECURITY: Load auth token on each command (handles host restarts)
    const authToken = loadAuthToken();
    if (!authToken) {
      const err = new Error(buildErrorMessage('NO_AUTH_TOKEN', SOCKET_PATH, AUTH_TOKEN_FILE));
      err.code = 'NO_AUTH_TOKEN';
      reject(err);
      return;
    }

    const socket = connect(SOCKET_PATH);
    let buffer = '';
    let resolved = false;

    socket.on('connect', () => {
      const message = JSON.stringify({ command, params, authToken }) + '\n';
      socket.write(message);
    });

    socket.on('data', (data) => {
      buffer += data.toString();

      // Check if we have a complete JSON response (newline-delimited)
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex !== -1 && !resolved) {
        const jsonStr = buffer.slice(0, newlineIndex);
        try {
          const response = JSON.parse(jsonStr);
          resolved = true;
          socket.end();
          resolve(response);
        } catch (e) {
          reject(new Error('Invalid response from Claudezilla host: ' + e.message));
        }
      }
    });

    socket.on('error', (err) => {
      if (resolved) return;
      // Preserve the error code for retry logic
      const wrappedErr = new Error(buildErrorMessage(err.code, SOCKET_PATH, AUTH_TOKEN_FILE));
      wrappedErr.code = err.code;
      reject(wrappedErr);
    });

    socket.on('close', () => {
      // If socket closes before we got a response, try parsing buffer
      if (!resolved && buffer) {
        try {
          const response = JSON.parse(buffer.trim());
          resolved = true;
          resolve(response);
        } catch (e) {
          // Ignore - may have already resolved
        }
      }
    });

    socket.on('timeout', () => {
      socket.end();
      if (!resolved) {
        reject(new Error('Connection timed out'));
      }
    });

    socket.setTimeout(30000);
  });
}

/**
 * Send command to Claudezilla with automatic retry for transient failures
 * Retries with exponential backoff for ENOENT, ECONNREFUSED, ECONNRESET
 */
async function sendCommand(command, params = {}) {
  let lastError;
  let delay = RETRY_CONFIG.initialDelayMs;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await sendCommandOnce(command, params);
    } catch (err) {
      lastError = err;

      // Only retry for transient connection errors
      const isRetryable = RETRY_CONFIG.retryableCodes.includes(err.code);
      const hasRetriesLeft = attempt < RETRY_CONFIG.maxRetries;

      if (isRetryable && hasRetriesLeft) {
        console.error(`[claudezilla] Connection failed (${err.code}), retrying in ${delay}ms... (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries})`);
        await sleep(delay);
        delay = Math.min(delay * 2, RETRY_CONFIG.maxDelayMs);
        continue;
      }

      // No more retries or non-retryable error
      break;
    }
  }

  throw lastError;
}

/**
 * Check if navigate command is available
 * Returns false if extension is in Private Windows mode
 */
async function canNavigate() {
  try {
    const response = await sendCommand('canNavigate');
    return response.result?.canNavigate ?? true;
  } catch (error) {
    // If we can't check, assume navigate is available (fail open)
    return true;
  }
}

// Tool definitions
const TOOLS = [
  // ===== CORE BROWSER CONTROL =====
  {
    name: 'firefox_create_window',
    description: 'Open a URL in the shared Claudezilla browser. SHARED POOL: One private window with MAX 10 TABS shared across all Claude agents. Each call creates a new tab. When limit reached, oldest tab auto-closed. OWNERSHIP: Each tab tracks its creator - only you can close tabs you created. Returns: windowId, tabId, ownerId, tabCount, maxTabs.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to open in new tab (default: about:blank)',
        },
      },
    },
  },
  {
    name: 'firefox_navigate',
    description: 'Navigate to a URL. If tabId provided, navigates that tab (requires ownership). Without tabId, navigates active tab (may be restricted in private window mode).',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to',
        },
        tabId: {
          type: 'number',
          description: 'Target tab ID. If provided, navigates this tab (ownership enforced). Without tabId, navigates active tab.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'firefox_get_content',
    description: 'Get the text content of a page or element. Works on background tabs. Returns url, title, text. HTML excluded by default (use includeHtml=true if needed). Text truncated at 50K chars by default.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Target tab ID. Default: active tab. Works on background tabs.',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector to get content from a specific element',
        },
        includeHtml: {
          type: 'boolean',
          description: 'Include raw HTML in response (default: false). Warning: can be very large.',
        },
        maxLength: {
          type: 'number',
          description: 'Max text length before truncation (default: 50000). Use selector for focused extraction.',
        },
      },
    },
  },
  {
    name: 'firefox_click',
    description: 'Click an element by CSS selector. Works on background tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Target tab ID. Default: active tab. Works on background tabs.',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the element to click (e.g., "button.submit", "#login-btn")',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'firefox_type',
    description: 'Type text into an input field. Works on background tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Target tab ID. Default: active tab. Works on background tabs.',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the input element',
        },
        text: {
          type: 'string',
          description: 'Text to type into the input',
        },
        clear: {
          type: 'boolean',
          description: 'Whether to clear existing text first (default: true)',
        },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'firefox_press_key',
    description: 'Send a keyboard event. Use for Enter, Tab, Escape, arrow keys, or shortcuts (Ctrl+A, etc.). More reliable than clicking for form submission and navigation. Works on background tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Target tab ID. Default: active tab. Works on background tabs.',
        },
        key: {
          type: 'string',
          description: 'Key to press: Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, PageUp/Down, or single characters (a-z, 0-9)',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector for target element (default: currently focused element)',
        },
        ctrlKey: {
          type: 'boolean',
          description: 'Hold Ctrl key (for shortcuts like Ctrl+A)',
        },
        shiftKey: {
          type: 'boolean',
          description: 'Hold Shift key',
        },
        altKey: {
          type: 'boolean',
          description: 'Hold Alt key',
        },
        metaKey: {
          type: 'boolean',
          description: 'Hold Meta/Cmd key (Mac)',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'firefox_screenshot',
    description: 'Capture a screenshot with dynamic page readiness detection. Automatically waits for network idle (XHR, scripts) and render settlement before capture. Returns timing data showing what signals were detected. SERIALIZED: Requests queued to prevent collisions. Default: JPEG 60% quality, 50% scale.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Specific tab to capture (will switch to it). Default: current active tab.',
        },
        quality: {
          type: 'number',
          description: 'JPEG quality 1-100 (default: 60). Lower = smaller file.',
        },
        scale: {
          type: 'number',
          description: 'Resolution scale 0.25-1.0 (default: 0.5). 0.5 = half resolution.',
        },
        format: {
          type: 'string',
          enum: ['jpeg', 'png'],
          description: 'Image format (default: jpeg). JPEG is much smaller.',
        },
        maxWait: {
          type: 'number',
          description: 'Maximum ms to wait for page ready (default: 10000). Captures after this even if not idle.',
        },
        waitForImages: {
          type: 'boolean',
          description: 'Wait for images/fonts to load (default: true). Set false for faster capture of text-heavy pages.',
        },
        skipReadiness: {
          type: 'boolean',
          description: 'Skip all readiness detection (instant capture). Use when page is known to be ready.',
        },
      },
    },
  },
  {
    name: 'firefox_get_tabs',
    description: 'List all Claudezilla tabs with URLs, titles, tabIds, and ownerId. Shows which agent owns each tab. Use to see shared 10-tab pool status.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'firefox_close_tab',
    description: 'Close a specific tab by ID. OWNERSHIP ENFORCED: You can only close tabs you created. Other agents cannot close your tabs. Use firefox_get_tabs to see ownership.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Tab ID to close (required). Must be a tab you own.',
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'firefox_close_window',
    description: 'Close the entire Claudezilla window and all tabs. WARNING: This affects all Claude agents sharing the window. Use firefox_close_tab to close individual tabs instead.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'firefox_request_tab_space',
    description: 'Request tab space when blocked by POOL_FULL. Queues your request and notifies agents with >4 tabs. They can grant space using firefox_grant_tab_space. Use this when you cannot create tabs because other agents have filled the pool.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'firefox_grant_tab_space',
    description: 'Voluntarily release your oldest tab to help a waiting agent. Only works if you have >2 tabs and there are pending slot requests. Good citizenship for multi-agent cooperation.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'firefox_get_slot_requests',
    description: 'Check if other agents are waiting for tab space. Shows pending requests and whether you should grant space (if you have >4 tabs).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'firefox_resize_window',
    description: 'Resize and/or reposition a browser window.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'number',
          description: 'Window ID to resize (uses current window if not specified)',
        },
        width: {
          type: 'number',
          description: 'New window width in pixels',
        },
        height: {
          type: 'number',
          description: 'New window height in pixels',
        },
        left: {
          type: 'number',
          description: 'Window X position from left edge of screen',
        },
        top: {
          type: 'number',
          description: 'Window Y position from top edge of screen',
        },
      },
    },
  },
  {
    name: 'firefox_set_viewport',
    description: 'Set browser viewport to a device preset for responsive testing. Presets: iphone-se, iphone-14, iphone-14-pro-max, pixel-7, galaxy-s23, ipad-mini, ipad-pro-11, ipad-pro-12, laptop, desktop',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'number',
          description: 'Target window ID (from firefox_create_window). Optional if only one window.',
        },
        device: {
          type: 'string',
          description: 'Device preset name (e.g., "iphone-14", "ipad-pro-11", "pixel-7")',
          enum: ['iphone-se', 'iphone-14', 'iphone-14-pro-max', 'pixel-7', 'galaxy-s23', 'ipad-mini', 'ipad-pro-11', 'ipad-pro-12', 'laptop', 'desktop'],
        },
        width: {
          type: 'number',
          description: 'Custom viewport width (use instead of device preset)',
        },
        height: {
          type: 'number',
          description: 'Custom viewport height (use instead of device preset)',
        },
      },
    },
  },

  // ===== DEVTOOLS FEATURES =====
  {
    name: 'firefox_get_console',
    description: 'Get captured console logs from the page. Captures console.log, console.warn, console.error, and uncaught exceptions. Works on background tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Target tab ID. Default: active tab. Works on background tabs.',
        },
        level: {
          type: 'string',
          description: 'Filter by log level: log, warn, error, info, debug',
          enum: ['log', 'warn', 'error', 'info', 'debug'],
        },
        clear: {
          type: 'boolean',
          description: 'Clear logs after returning (default: false)',
        },
        limit: {
          type: 'number',
          description: 'Maximum logs to return (default: 100)',
        },
      },
    },
  },
  {
    name: 'firefox_get_network',
    description: 'Get captured network requests. Shows XHR, fetch, script, image, and other resource requests with status codes and timing. Works on background tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Target tab ID. Default: active tab. Works on background tabs.',
        },
        type: {
          type: 'string',
          description: 'Filter by request type: xmlhttprequest, script, stylesheet, image, font, etc.',
        },
        status: {
          type: 'string',
          description: 'Filter by status: pending, completed, error',
          enum: ['pending', 'completed', 'error'],
        },
        clear: {
          type: 'boolean',
          description: 'Clear requests after returning (default: false)',
        },
        limit: {
          type: 'number',
          description: 'Maximum requests to return (default: 50)',
        },
      },
    },
  },
  {
    name: 'firefox_evaluate',
    description: 'Execute JavaScript in the page context and return the result. Useful for extracting data, checking state, or debugging. Works on background tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Target tab ID. Default: active tab. Works on background tabs.',
        },
        expression: {
          type: 'string',
          description: 'JavaScript expression to evaluate (e.g., "document.title", "window.localStorage.getItem(\'key\')")',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'firefox_wait_for',
    description: 'Wait for an element to appear on the page. Useful for SPAs and dynamic content. Works on background tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Target tab ID. Default: active tab. Works on background tabs.',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to wait for',
        },
        timeout: {
          type: 'number',
          description: 'Maximum time to wait in milliseconds (default: 10000)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'firefox_scroll',
    description: 'Scroll to an element or position on the page. Works on background tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Target tab ID. Default: active tab. Works on background tabs.',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to scroll to',
        },
        x: {
          type: 'number',
          description: 'X coordinate to scroll to',
        },
        y: {
          type: 'number',
          description: 'Y coordinate to scroll to',
        },
        behavior: {
          type: 'string',
          description: 'Scroll behavior: smooth or instant (default: smooth)',
          enum: ['smooth', 'instant'],
        },
      },
    },
  },
  {
    name: 'firefox_get_element',
    description: 'Get detailed information about an element including attributes, styles, visibility, and position. Works on background tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Target tab ID. Default: active tab. Works on background tabs.',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the element',
        },
      },
      required: ['selector'],
    },
  },
  // ===== PAGE ANALYSIS (FAST ALTERNATIVES TO SCREENSHOTS) =====
  {
    name: 'firefox_get_page_state',
    description: 'Get structured page state as JSON. Much faster than screenshots for understanding page content. Returns: URL, title, viewport, errors, headings, links, buttons, inputs, images, landmarks with counts. Works on background tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Target tab ID. Default: active tab. Works on background tabs.',
        },
        maxHeadings: {
          type: 'number',
          description: 'Max headings to return (default: 30)',
        },
        maxLinks: {
          type: 'number',
          description: 'Max links to return (default: 50)',
        },
        maxButtons: {
          type: 'number',
          description: 'Max buttons to return (default: 30)',
        },
        maxInputs: {
          type: 'number',
          description: 'Max inputs to return (default: 30)',
        },
        maxImages: {
          type: 'number',
          description: 'Max images to return (default: 20)',
        },
      },
    },
  },
  {
    name: 'firefox_get_accessibility_snapshot',
    description: 'Get accessibility tree snapshot. Returns semantic structure with roles, names, states. Capped at 200 nodes by default to prevent overflow. Works on background tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Target tab ID. Default: active tab. Works on background tabs.',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum tree depth to traverse (default: 5)',
        },
        maxNodes: {
          type: 'number',
          description: 'Maximum nodes to include (default: 200). Lower = faster, less detail.',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for root element (default: body)',
        },
      },
    },
  },

  // ===== LOOP/FOCUS FEATURE =====
  {
    name: 'firefox_start_loop',
    description: 'Start a focus loop. Claude will automatically continue working on the prompt until max iterations reached or completion promise detected. Uses Stop hook enforcement - Claude cannot skip the loop.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The task prompt to work on iteratively',
        },
        maxIterations: {
          type: 'number',
          description: 'Maximum iterations before stopping (default: 0 = unlimited, use with caution)',
        },
        completionPromise: {
          type: 'string',
          description: 'Text to signal completion. When Claude outputs <promise>THIS_TEXT</promise>, the loop ends.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'firefox_stop_loop',
    description: 'Stop the active focus loop. The current iteration will complete, then Claude will be allowed to exit.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'firefox_loop_status',
    description: 'Get the current focus loop status. Returns: active, iteration, maxIterations, prompt, completionPromise, startedAt.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Map MCP tool names to Claudezilla commands
const TOOL_TO_COMMAND = {
  // Core browser control
  firefox_create_window: 'createWindow',
  firefox_navigate: 'navigate',
  firefox_get_content: 'getContent',
  firefox_click: 'click',
  firefox_type: 'type',
  firefox_screenshot: 'screenshot',
  firefox_get_tabs: 'getTabs',
  firefox_close_tab: 'closeTab',
  firefox_close_window: 'closeWindow',
  firefox_resize_window: 'resizeWindow',
  firefox_set_viewport: 'setViewport',
  // Devtools features
  firefox_get_console: 'getConsoleLogs',
  firefox_get_network: 'getNetworkRequests',
  firefox_evaluate: 'evaluate',
  firefox_wait_for: 'waitFor',
  firefox_scroll: 'scroll',
  firefox_get_element: 'getElementInfo',
  // Page analysis
  firefox_get_page_state: 'getPageState',
  firefox_get_accessibility_snapshot: 'getAccessibilitySnapshot',
  // Keyboard input
  firefox_press_key: 'pressKey',
  // Loop/focus
  firefox_start_loop: 'startLoop',
  firefox_stop_loop: 'stopLoop',
  firefox_loop_status: 'getLoopState',
  // Tab space coordination (mercy system)
  firefox_request_tab_space: 'requestTabSpace',
  firefox_grant_tab_space: 'grantTabSpace',
  firefox_get_slot_requests: 'getSlotRequests',
};

// Create MCP server
const server = new Server(
  {
    name: 'claudezilla',
    version: '0.5.2',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Dynamically filter tools based on extension permission state
  const navigateAllowed = await canNavigate();

  let availableTools = TOOLS;
  if (!navigateAllowed) {
    // Filter out firefox_navigate if permission is enabled (private windows mode)
    availableTools = TOOLS.filter(tool => tool.name !== 'firefox_navigate');
  }

  return { tools: availableTools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const command = TOOL_TO_COMMAND[name];
  if (!command) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    // SECURITY: Inject agent ID for tab ownership tracking
    // All tab-targeting commands now require ownership verification
    const commandParams = { ...(args || {}) };
    const OWNERSHIP_COMMANDS = [
      'firefox_create_window',
      'firefox_close_tab',
      'firefox_close_window',
      'firefox_navigate',
      'firefox_get_content',
      'firefox_click',
      'firefox_type',
      'firefox_scroll',
      'firefox_evaluate',
      'firefox_get_element',
      'firefox_get_console',
      'firefox_get_network',
      'firefox_wait_for',
      'firefox_get_page_state',
      'firefox_get_accessibility_snapshot',
      'firefox_press_key',
      'firefox_screenshot',
      'firefox_request_tab_space',
      'firefox_grant_tab_space',
      'firefox_get_slot_requests',
    ];
    if (OWNERSHIP_COMMANDS.includes(name)) {
      commandParams.agentId = AGENT_ID;
      // Update heartbeat for this agent
      updateAgentHeartbeat(AGENT_ID);
    }

    const response = await sendCommand(command, commandParams);

    if (response.success) {
      // Special handling for screenshots - return as image
      if (name === 'firefox_screenshot' && response.result?.dataUrl) {
        // Detect format from data URL
        const isJpeg = response.result.dataUrl.startsWith('data:image/jpeg');
        const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
        const base64Data = response.result.dataUrl.replace(/^data:image\/(jpeg|png);base64,/, '');
        return {
          content: [
            {
              type: 'image',
              data: base64Data,
              mimeType,
            },
          ],
        };
      }

      // Handle undefined/null results - ensure text is always a string
      const resultText = response.result !== undefined
        ? JSON.stringify(response.result, null, 2)
        : '{ "success": true }';

      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    } else {
      // Format structured errors (like MUTEX_BUSY) with full details
      let errorText = `Error: ${response.error || 'Unknown error'}`;
      if (response.details?.code === 'MUTEX_BUSY') {
        errorText = `MUTEX_BUSY: Screenshot mutex held by another agent.\n` +
          `  Holder: ${response.details.holder}\n` +
          `  Held for: ${response.details.heldForMs}ms\n` +
          `  Tab pool: ${response.details.tabPool || 'unknown'}\n` +
          `  Retry after: ${response.details.retryAfterMs}ms\n` +
          `  Hint: ${response.details.hint}`;
      } else if (response.details?.code === 'POOL_FULL') {
        errorText = `POOL_FULL: Tab pool is full and you have no tabs to evict.\n` +
          `  Tab pool: ${response.details.tabPool}\n` +
          `  Owner breakdown: ${response.details.ownerBreakdown}\n` +
          `  Hint: ${response.details.hint}`;
      }
      return {
        content: [{ type: 'text', text: errorText }],
        isError: true,
      };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Claudezilla MCP server running');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
