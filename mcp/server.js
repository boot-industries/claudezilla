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

const SOCKET_PATH = '/tmp/claudezilla.sock';

/**
 * Send command to Claudezilla via Unix socket
 */
function sendCommand(command, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect(SOCKET_PATH);
    let buffer = '';
    let resolved = false;

    socket.on('connect', () => {
      const message = JSON.stringify({ command, params }) + '\n';
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
      if (err.code === 'ENOENT') {
        reject(new Error('Claudezilla not running. Open Firefox with the Claudezilla extension loaded.'));
      } else if (err.code === 'ECONNREFUSED') {
        reject(new Error('Connection refused. Reload the Claudezilla extension in Firefox.'));
      } else {
        reject(err);
      }
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
    description: 'Create a new private Firefox browser window. Always call this first before other browser commands. Returns windowId for reference.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Optional URL to open in the new window',
        },
      },
    },
  },
  {
    name: 'firefox_navigate',
    description: 'Navigate to a URL in the current Firefox tab. Requires a private window (use firefox_create_window first). Disabled if extension is allowed to run in Private Windows to prevent creating non-private windows.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'firefox_get_content',
    description: 'Get the text content of the current page or a specific element. Returns structured data with url, title, and text content.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'number',
          description: 'Target window ID (from firefox_create_window). Optional if only one window.',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector to get content from a specific element',
        },
      },
    },
  },
  {
    name: 'firefox_click',
    description: 'Click an element on the page by CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'number',
          description: 'Target window ID (from firefox_create_window). Optional if only one window.',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the element to click (e.g., "button.submit", "#login-btn", "a[href*=login]")',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'firefox_type',
    description: 'Type text into an input field.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'number',
          description: 'Target window ID (from firefox_create_window). Optional if only one window.',
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
    name: 'firefox_screenshot',
    description: 'Capture a screenshot of the visible browser viewport. Returns base64-encoded PNG.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'number',
          description: 'Target window ID (from firefox_create_window). Optional if only one window.',
        },
      },
    },
  },
  {
    name: 'firefox_get_tabs',
    description: 'List all open browser tabs with their URLs and titles.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'firefox_close_window',
    description: 'Close a browser window by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'number',
          description: 'The window ID to close',
        },
      },
      required: ['windowId'],
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
    description: 'Get captured console logs from the page. Captures console.log, console.warn, console.error, and uncaught exceptions.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'number',
          description: 'Target window ID (from firefox_create_window). Optional if only one window.',
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
    description: 'Get captured network requests. Shows XHR, fetch, script, image, and other resource requests with status codes and timing.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'number',
          description: 'Target window ID (from firefox_create_window). Optional if only one window.',
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
    description: 'Execute JavaScript in the page context and return the result. Useful for extracting data, checking state, or debugging.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'number',
          description: 'Target window ID (from firefox_create_window). Optional if only one window.',
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
    description: 'Wait for an element to appear on the page. Useful for SPAs and dynamic content.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'number',
          description: 'Target window ID (from firefox_create_window). Optional if only one window.',
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
    description: 'Scroll to an element or position on the page.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'number',
          description: 'Target window ID (from firefox_create_window). Optional if only one window.',
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
    description: 'Get detailed information about an element including attributes, styles, visibility, and position.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'number',
          description: 'Target window ID (from firefox_create_window). Optional if only one window.',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the element',
        },
      },
      required: ['selector'],
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
};

// Create MCP server
const server = new Server(
  {
    name: 'claudezilla',
    version: '0.4.0',
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
    const response = await sendCommand(command, args || {});

    if (response.success) {
      // Special handling for screenshots - return as image
      if (name === 'firefox_screenshot' && response.result?.dataUrl) {
        const base64Data = response.result.dataUrl.replace(/^data:image\/png;base64,/, '');
        return {
          content: [
            {
              type: 'image',
              data: base64Data,
              mimeType: 'image/png',
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
      return {
        content: [{ type: 'text', text: `Error: ${response.error || 'Unknown error'}` }],
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
