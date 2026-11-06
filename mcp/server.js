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
import { randomBytes } from 'crypto';
import {
  readFileSync, existsSync, statSync, realpathSync, openSync, writeSync, closeSync,
  mkdirSync, lstatSync, chmodSync, readdirSync, unlinkSync, constants,
} from 'fs';
import { tmpdir } from 'os';
import { resolve as resolvePath, extname, dirname, basename, join, sep } from 'path';
import { getSocketPath, getAuthTokenPath } from '../host/ipc.js';
import { requestOverSocket } from './socket-request.js';
import { createAgentReaper, resolveAgentTimeout } from './agent-reaper.js';
import { createAutostart, withAutostartDetail } from './autostart.js';

// Single source of truth for the MCP server version. Reading from
// package.json at module load keeps the version response in sync with the
// npm-tracked version without manual edits in two places.
const MCP_VERSION = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
).version;

// Platform-independent paths from ipc.js abstraction layer
const SOCKET_PATH = getSocketPath();
const AUTH_TOKEN_FILE = getAuthTokenPath();

// Optional on-demand browser start. Inert unless CLAUDEZILLA_AUTOSTART_CMD is
// set; the command is an argv vector and is never run through a shell.
const autostart = createAutostart({
  socketPath: SOCKET_PATH,
  env: process.env,
});

// Session resolution across coding harnesses (Claude Code, OMP, Pi, Hermes, etc.)
// CLI arguments:
//   --resume <id>      Claude Code 2.1.154+ passes this on session resume
//   --session-id <id>  Generic / multi-harness session identifier
function parseCliArg(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i + 1 >= process.argv.length) return undefined;
  const v = process.argv[i + 1];
  if (typeof v !== 'string' || !v || v.length > 128) return undefined;
  if (!/^[A-Za-z0-9_\-:.]+$/.test(v)) return undefined;
  return v;
}
const CLI_RESUME_ID = parseCliArg('--resume');
const CLI_SESSION_ID = parseCliArg('--session-id');

// Log unhandled rejections without killing the MCP server mid-session.
// A single missed .catch() (e.g. on a fire-and-forget setTimeout) previously
// took down the whole process. Mirrors Node's pre-v15 default behavior.
process.on('unhandledRejection', (reason) => {
  console.error('[claudezilla] Unhandled rejection:', reason);
});

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

/**
 * SECURITY: Truncate agent ID for privacy in logs and error messages
 * Shows enough for debugging without exposing full 128-bit ID
 * @param {string} id - Full agent ID
 * @returns {string} Truncated ID (first 12 chars + ...)
 */
function truncateAgentId(id) {
  if (!id || id === 'unknown') return 'unknown';
  return id.length > 15 ? id.slice(0, 12) + '...' : id;
}

// Per-agent configuration (allowedDomains, handleConsent, etc.)
const agentConfig = new Map(); // agentId -> { allowedDomains: [...], handleConsent: boolean }

/**
 * Resolve the active session ID for loop scoping across multiple harnesses.
 *
 * Lookup order (unambiguous precedence):
 *   1. `--resume <id>` CLI arg (Claude Code resume compatibility)
 *   2. `--session-id <id>` CLI arg (harness-neutral CLI parameter)
 *   3. CLAUDEZILLA_SESSION_ID env var (explicit engine override)
 *   4. OMP_SESSION_ID env var (Oh My Pi)
 *   5. PI_SESSION_ID env var (Pi Agent)
 *   6. HERMES_SESSION_ID env var (Hermes Agent)
 *   7. CLAUDE_CODE_SESSION_ID env var (Claude Code)
 *   8. undefined → host buckets under DEFAULT_SESSION (__default__)
 *
 * @returns {string|undefined} session ID, or undefined when unavailable
 */
function getSessionId() {
  if (CLI_RESUME_ID) return CLI_RESUME_ID;
  if (CLI_SESSION_ID) return CLI_SESSION_ID;
  const candidates = [
    process.env.CLAUDEZILLA_SESSION_ID,
    process.env.OMP_SESSION_ID,
    process.env.PI_SESSION_ID,
    process.env.HERMES_SESSION_ID,
    process.env.CLAUDE_CODE_SESSION_ID,
  ];
  for (const v of candidates) {
    if (typeof v === 'string' && v && v.length <= 128 && /^[A-Za-z0-9_\-:.]+$/.test(v)) {
      return v;
    }
  }
  return undefined;
}
const getClaudeCodeSessionId = getSessionId; // Backward-compatible alias

/**
 * Check if a URL is allowed for the given agent based on their allowedDomains config
 * Returns null if allowed, error string if blocked
 */
function checkDomainAllowed(agentId, url) {
  const config = agentConfig.get(agentId);
  if (!config || !config.allowedDomains || config.allowedDomains.length === 0) return null;
  
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null; // Let invalid URLs fail normally
  }
  
  // about: URLs always allowed
  if (url.startsWith('about:')) return null;
  
  const VALID_DOMAIN_PATTERN = /^[a-zA-Z0-9*.\-]+$/;
  for (const pattern of config.allowedDomains) {
    if (pattern.length > 255 || !VALID_DOMAIN_PATTERN.test(pattern)) {
      return `DOMAIN_BLOCKED: Invalid domain pattern "${pattern}"`;
    }
  }

  const allowed = config.allowedDomains.some(pattern => {
    if (pattern.startsWith('*.')) {
      const base = pattern.slice(2).replace(/\./g, '\\.');
      return new RegExp(`^[^.]+\\.${base}$`).test(hostname) || hostname === pattern.slice(2);
    }
    return hostname === pattern;
  });
  
  if (!allowed) {
    return `DOMAIN_BLOCKED: Navigation to "${hostname}" not allowed. Allowed: [${config.allowedDomains.map(d => `"${d}"`).join(', ')}]`;
  }
  return null;
}

/**
 * Diff two getPageState snapshots
 */
function diffPageState(before, after) {
  const diff = { added: {}, removed: {}, changed: {} };
  const keys = ['headings', 'links', 'buttons', 'inputs'];

  for (const key of keys) {
    const bItems = before[key] || [];
    const aItems = after[key] || [];

    const bTexts = new Set(bItems.map(i => JSON.stringify(i)));
    const aTexts = new Set(aItems.map(i => JSON.stringify(i)));

    const added = aItems.filter(i => !bTexts.has(JSON.stringify(i)));
    const removed = bItems.filter(i => !aTexts.has(JSON.stringify(i)));

    if (added.length) diff.added[key] = added;
    if (removed.length) diff.removed[key] = removed;
  }

  return diff;
}

// Idle-agent reaper: closes the tabs of agents that have gone silent.
// CLAUDEZILLA_AGENT_TIMEOUT_MS sets the timeout in milliseconds; 0 disables
// the reaper entirely, for setups where a person works inside a tab while
// the agent stays idle, which otherwise looks identical to a crashed agent.
const { disabled: AGENT_TIMEOUT_DISABLED, timeoutMs: AGENT_TIMEOUT_MS } = resolveAgentTimeout();
const agentReaper = createAgentReaper({
  timeoutMs: AGENT_TIMEOUT_MS,
  disabled: AGENT_TIMEOUT_DISABLED,
  onCleanup: async (agentId, idleMs) => {
    console.error(`[claudezilla] Cleaning up orphaned agent: ${truncateAgentId(agentId)} (last seen ${Math.round(idleMs / 1000)}s ago)`);

    // Send cleanup command to extension
    const response = await sendCommand('cleanupOrphanedTabs', { agentId });

    if (response.success && response.result?.tabsClosed > 0) {
      console.error(`[claudezilla] Closed ${response.result.tabsClosed} orphaned tab(s) from ${truncateAgentId(agentId)}`);
    }
  },
});

/**
 * Update agent heartbeat - called on every command that includes agentId
 */
function updateAgentHeartbeat(agentId) {
  agentReaper.touch(agentId);
}

// Start periodic orphaned agent cleanup. A disabled reaper never schedules a
// sweep, so no agent's tabs are closed.
agentReaper.start();

// Pending fire-and-forget consent setTimeout handles. Tracked so handleShutdown
// can cancel them and avoid racing against goodbye/exit.
const pendingConsentTimers = new Set();

// This agent's most recently used tab (null until a call returns a tabId).
// Per MCP-server process, i.e. per agent, unlike the extension's global active tab.
let currentTabId = null;
// Errors that mean the injected tab no longer exists. "Element not found" is
// deliberately not matched: a selector miss says nothing about the tab.
const STALE_TAB_ERROR = /TAB_UNAVAILABLE|Tab \d+ not found|Invalid tab ID/i;

/**
 * Update currentTabId from a successful tool result.
 * @param {string} toolName
 * @param {object|undefined} toolArgs - Arguments the agent passed
 * @param {object|undefined} result - Extension result
 */
function trackCurrentTab(toolName, toolArgs, result) {
  if (toolName === 'firefox_close_window') {
    currentTabId = null;
    return;
  }
  if (toolName === 'firefox_close_tab' || toolName === 'firefox_detach_tab') {
    if (toolArgs?.tabId === currentTabId) currentTabId = null;
    return;
  }
  if (typeof result?.tabId === 'number') currentTabId = result.tabId;
}

/**
 * Run diagnostics on Claudezilla connection
 * Checks socket, auth token, permissions, and connectivity
 */
async function runDiagnostics() {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    socketPath: SOCKET_PATH,
    authTokenPath: AUTH_TOKEN_FILE,
    checks: [],
    summary: 'unknown',
    recommendation: null,
  };

  // Check 1: Socket file exists
  const socketExists = existsSync(SOCKET_PATH);
  let socketPermissions = null;
  if (socketExists) {
    try {
      const stats = statSync(SOCKET_PATH);
      socketPermissions = (stats.mode & 0o777).toString(8);
    } catch (e) {
      socketPermissions = 'error: ' + e.message;
    }
  }
  diagnostics.checks.push({
    name: 'socket_file',
    status: socketExists ? 'ok' : 'missing',
    path: SOCKET_PATH,
    permissions: socketPermissions,
  });

  // Check 2: Auth token file exists
  const authTokenExists = existsSync(AUTH_TOKEN_FILE);
  let authTokenLength = null;
  if (authTokenExists) {
    try {
      const token = readFileSync(AUTH_TOKEN_FILE, 'utf8').trim();
      authTokenLength = token.length;
    } catch (e) {
      authTokenLength = 'error: ' + e.message;
    }
  }
  diagnostics.checks.push({
    name: 'auth_token',
    status: authTokenExists ? 'ok' : 'missing',
    path: AUTH_TOKEN_FILE,
    tokenLength: authTokenLength,
  });

  // Check 3: Connection test (only if socket and auth exist)
  if (socketExists && authTokenExists) {
    try {
      const pingStart = Date.now();
      const pingResult = await sendCommandOnce('ping', {});
      const pingLatency = Date.now() - pingStart;
      diagnostics.checks.push({
        name: 'connection_ping',
        status: pingResult.success ? 'ok' : 'failed',
        latencyMs: pingLatency,
        result: pingResult.result,
      });
    } catch (e) {
      diagnostics.checks.push({
        name: 'connection_ping',
        status: 'failed',
        error: e.message,
      });
    }
  } else {
    diagnostics.checks.push({
      name: 'connection_ping',
      status: 'skipped',
      reason: !socketExists ? 'socket missing' : 'auth token missing',
    });
  }

  // Check 4: Extension version (only if connected)
  const pingCheck = diagnostics.checks.find(c => c.name === 'connection_ping');
  if (pingCheck?.status === 'ok') {
    try {
      const versionResult = await sendCommandOnce('version', {});
      diagnostics.checks.push({
        name: 'extension_version',
        status: 'ok',
        version: versionResult.result,
      });
    } catch (e) {
      diagnostics.checks.push({
        name: 'extension_version',
        status: 'failed',
        error: e.message,
      });
    }

    // Check 5: Tab pool status
    try {
      const tabsResult = await sendCommandOnce('getTabs', {});
      diagnostics.checks.push({
        name: 'tab_pool',
        status: 'ok',
        tabCount: tabsResult.result?.tabCount || 0,
        maxTabs: tabsResult.result?.maxTabs || 12,
      });
    } catch (e) {
      diagnostics.checks.push({
        name: 'tab_pool',
        status: 'failed',
        error: e.message,
      });
    }
  }

  // Generate summary and recommendation
  const failedChecks = diagnostics.checks.filter(c => c.status === 'failed' || c.status === 'missing');
  if (failedChecks.length === 0) {
    diagnostics.summary = 'healthy';
    diagnostics.recommendation = 'Claudezilla is connected and working properly.';
  } else if (!socketExists && !authTokenExists) {
    diagnostics.summary = 'disconnected';
    diagnostics.recommendation = 'Claudezilla host not running. Click the Claudezilla extension icon in Firefox to reconnect.';
  } else if (!socketExists) {
    diagnostics.summary = 'partial';
    diagnostics.recommendation = 'Socket missing but auth token exists. The host may have crashed. Reload the Claudezilla extension.';
  } else if (!authTokenExists) {
    diagnostics.summary = 'partial';
    diagnostics.recommendation = 'Auth token missing. The host may not have started correctly. Reload the Claudezilla extension.';
  } else {
    diagnostics.summary = 'error';
    diagnostics.recommendation = `Connection issues detected: ${failedChecks.map(c => c.name).join(', ')}. Try reloading the Claudezilla extension.`;
  }

  return diagnostics;
}

// Retry configuration for transient connection failures
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 1000,
  // Only retry these error codes (transient failures)
  retryableCodes: ['ENOENT', 'ECONNREFUSED', 'ECONNRESET'],
};

/**
 * Directories a screenshot may be written to: the OS temp dir, /tmp (POSIX)
 * and the working directory, as real paths so symlinks cannot widen them.
 */
function allowedSaveRoots() {
  const candidates = [tmpdir(), process.cwd()];
  if (process.platform !== 'win32') candidates.push('/tmp');
  const roots = new Set();
  for (const dir of candidates) {
    try {
      roots.add(realpathSync(dir));
    } catch {
      // Directory missing on this platform: not a root.
    }
  }
  return [...roots];
}

/**
 * Write base64 image bytes to a file created 0600 that refuses to follow a
 * symlink at the final path component.
 */
function writePrivateFile(path, base64Data) {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);
  const fd = openSync(path, flags, 0o600);
  try {
    const bytes = Buffer.from(base64Data, 'base64');
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
  } finally {
    closeSync(fd);
  }
}

/**
 * Write a screenshot to disk.
 * SECURITY: savePath is chosen by the agent, so it is confined to
 * allowedSaveRoots(), must carry an extension matching the image format, and
 * is opened with O_NOFOLLOW and mode 0600 so it cannot clobber a symlink
 * target or leak the image to other local users.
 *
 * @param {string} base64Data - Image bytes, base64-encoded
 * @param {string} savePath - Requested destination
 * @param {'jpeg'|'png'} format - Image format of base64Data
 * @returns {string} Absolute path written
 */
function saveScreenshotToDisk(base64Data, savePath, format) {
  if (!savePath || typeof savePath !== 'string') throw new Error('savePath must be a non-empty string');
  if (savePath.includes('\0')) throw new Error('savePath contains null byte');
  if (savePath.includes('..')) throw new Error('savePath contains path traversal');

  const absPath = resolvePath(savePath);
  const ext = extname(absPath).toLowerCase();
  const validExts = format === 'jpeg' ? ['.jpg', '.jpeg'] : ['.png'];
  if (!validExts.includes(ext)) {
    throw new Error('savePath must end in .jpg/.jpeg for JPEG or .png for PNG');
  }

  const roots = allowedSaveRoots();
  let parent;
  try {
    parent = realpathSync(dirname(absPath));
  } catch {
    throw new Error(`savePath directory does not exist: ${dirname(absPath)}`);
  }
  const inside = roots.some((root) => parent === root || parent.startsWith(root.endsWith(sep) ? root : root + sep));
  if (!inside) throw new Error(`savePath must be inside one of: ${roots.join(', ')}`);

  writePrivateFile(join(parent, basename(absPath)), base64Data);
  return absPath;
}

// CLAUDEZILLA_SCREENSHOT_FILES=1: for harnesses that cannot show inline MCP
// images (omp renders "[Image: mime]"), also write every screenshot to a
// private directory and report the path so the agent can open it as a file.
const SCREENSHOT_FILES = process.env.CLAUDEZILLA_SCREENSHOT_FILES === '1';
const SCREENSHOT_DIR = join(tmpdir(), 'claudezilla-screenshots');
const SCREENSHOT_KEEP = 50;

/**
 * Write a screenshot into SCREENSHOT_DIR and prune it to the newest
 * SCREENSHOT_KEEP files.
 * SECURITY: the directory is created 0700 and must be a real directory owned
 * by this user: tmpdir() can be shared (/tmp), so a pre-created symlink or a
 * directory owned by someone else is refused.
 *
 * @param {string} base64Data - Image bytes, base64-encoded
 * @param {'jpeg'|'png'} format
 * @returns {string} Path written
 */
function writeScreenshotFile(base64Data, format) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true, mode: 0o700 });
  const info = lstatSync(SCREENSHOT_DIR);
  if (!info.isDirectory() || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
    throw new Error(`Refusing to use ${SCREENSHOT_DIR}: not a directory owned by this user`);
  }
  chmodSync(SCREENSHOT_DIR, 0o700);

  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const file = join(SCREENSHOT_DIR, `${Date.now()}-${AGENT_ID.slice(6, 14)}.${ext}`);
  writePrivateFile(file, base64Data);

  // Names start with a millisecond timestamp, so lexical order is age order.
  const stale = readdirSync(SCREENSHOT_DIR).sort().slice(0, -SCREENSHOT_KEEP);
  for (const name of stale) {
    try {
      unlinkSync(join(SCREENSHOT_DIR, name));
    } catch {
      // Already gone (another agent pruned it).
    }
  }
  return file;
}

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
 *
 * @param {object} [options]
 * @param {boolean} [options.autostart=true] - false skips the on-demand
 *   browser start: a call that must not start the browser (goodbye on
 *   shutdown) still reaches a running host but never launches one.
 * @param {number} [options.timeoutMs] - socket idle timeout override; defaults
 *   to the command's own timeout plus the shared grace period.
 */
async function sendCommandOnce(command, params = {}, options = {}) {
  // Optional on-demand browser start. When the host is not reachable and
  // CLAUDEZILLA_AUTOSTART_CMD is set, the browser is started and this call
  // waits for its socket. A failed start is reported alongside the original
  // connection error.
  let startError = null;
  if (options.autostart !== false) {
    try {
      const start = await autostart.ensureStarted();
      if (start.reason === 'launch-failed') {
        startError = start.error ?? new Error('Autostart failed');
      } else if (start.reason === 'cooldown') {
        startError = new Error('Autostart skipped: the previous start failed and the retry cooldown has not elapsed.');
      }
    } catch (e) {
      startError = e;
    }
  }

  // SECURITY: Load auth token on each command (handles host restarts)
  const authToken = loadAuthToken();
  if (!authToken) {
    const err = new Error(buildErrorMessage('NO_AUTH_TOKEN', SOCKET_PATH, AUTH_TOKEN_FILE));
    err.code = 'NO_AUTH_TOKEN';
    throw withAutostartDetail(err, startError);
  }

  try {
    return await requestOverSocket({
      command,
      params,
      authToken,
      socketPath: SOCKET_PATH,
      timeoutMs: options.timeoutMs,
      describeError: (errCode) => buildErrorMessage(errCode, SOCKET_PATH, AUTH_TOKEN_FILE),
    });
  } catch (err) {
    // A connection error means the host is gone: let the autostart re-probe
    // (and re-launch) on the next command instead of assuming it is up.
    if (RETRY_CONFIG.retryableCodes.includes(err.code)) {
      autostart.markHostDown();
    }
    throw withAutostartDetail(err, startError);
  }
}

/**
 * Send command to Claudezilla with automatic retry for transient failures
 * Retries with exponential backoff for ENOENT, ECONNREFUSED, ECONNRESET
 */
async function sendCommand(command, params = {}, options = {}) {
  let lastError;
  let delay = RETRY_CONFIG.initialDelayMs;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await sendCommandOnce(command, params, options);
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

// Tool definitions
const TOOLS = [
  // ===== CORE BROWSER CONTROL =====
  {
    name: 'firefox_create_window',
    description: 'Open a URL in the shared Claudezilla browser. SHARED POOL: One window with MAX 12 TABS shared across all Claude agents. Each call creates a new tab. When limit reached, oldest tab auto-closed. OWNERSHIP: Each tab tracks its creator - only you can close tabs you created. Auto-fallback: if private mode fails (permission not granted), automatically falls back to non-private with a warning. Returns: windowId, tabId, ownerId, tabCount, maxTabs, isPrivate.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to open in new tab (default: about:blank)',
        },
        private: {
          type: 'boolean',
          description: 'Request private (incognito) or non-private window. Only applies when creating a NEW window. If existing window mode conflicts, returns MODE_MISMATCH error. Omit to use default.',
        },
        container: {
          type: 'string',
          description: 'Open the tab in a Firefox container (contextual identity), e.g. "Work" or "Banking". Accepts a container name (case-insensitive) or a raw cookieStoreId ("firefox-container-3"). The tab uses that container\'s cookie jar, so logins already established in it apply. Forces non-private mode (containers require persistent cookies). Use firefox_list_containers to see available names.',
        },
      },
    },
  },
  {
    name: 'firefox_list_containers',
    description: 'List the Firefox containers (contextual identities) available in this profile, with their names and cookieStoreIds. Use before firefox_create_window to pick the container holding the logged-in session a site needs.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'firefox_navigate',
    description: 'Navigate an existing tab to a URL. tabId defaults to your current tab; ownership is enforced. Never creates a window: call firefox_create_window first.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to',
        },
        tabId: {
          type: 'number',
          description: 'Tab ID (default: your current tab)',
        },
        container: {
          type: 'string',
          description: 'Assert the tab is in this container. A tab\'s container is fixed at creation, so this cannot move it - a mismatch returns CONTAINER_IMMUTABLE. To open a URL in a container, use firefox_create_window.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'firefox_get_content',
    description: 'Read the visible text of the page or of one element (ref or selector), returned as plain text after a one-line JSON header. Default 20,000 chars; when truncated, the header carries nextOffset for the next page. HTML only with includeHtml=true.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Tab ID (default: your current tab)',
        },
        ref: {
          type: 'string',
          description: 'Element ref from a snapshot or firefox_find, e.g. "ref_a1b2_12" (preferred over selector)',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector to get content from a specific element',
        },
        includeHtml: {
          type: 'boolean',
          description: 'Include raw HTML in response (default: false). Warning: can be very large.',
        },
        offset: {
          type: 'number',
          description: 'Character offset to start from (use nextOffset from a truncated result)',
        },
        maxLength: {
          type: 'number',
          description: 'Max characters to return (default: 20000)',
        },
      },
    },
  },
  {
    name: 'firefox_click',
    description: 'Click an element by CSS selector. Dispatches the full pointer/mouse sequence (pointerdown, mousedown, pointerup, mouseup, click) at the element centre. Events are synthetic (isTrusted=false): pages that check isTrusted will ignore them. Result reports obscuredBy when another element covers the click point. Works on background tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Tab ID (default: your current tab)',
        },
        ref: {
          type: 'string',
          description: 'Element ref from a snapshot or firefox_find, e.g. "ref_a1b2_12" (preferred over selector)',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the element to click (e.g., "button.submit", "#login-btn")',
        },
      },
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
          description: 'Tab ID (default: your current tab)',
        },
        ref: {
          type: 'string',
          description: 'Element ref from a snapshot or firefox_find, e.g. "ref_a1b2_12" (preferred over selector)',
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
      required: ['text'],
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
          description: 'Tab ID (default: your current tab)',
        },
        key: {
          type: 'string',
          description: 'Key to press: Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, PageUp/Down, or single characters (a-z, 0-9)',
        },
        ref: {
          type: 'string',
          description: 'Element ref from a snapshot or firefox_find, e.g. "ref_a1b2_12" (preferred over selector)',
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
    description: 'Capture the viewport (or a region) as an image sized for vision models: long edge capped at maxEdge (default 1568 px). A text block before the image reports width, height and cssScale (CSS px = image px / cssScale). Waits for network idle and render settlement unless skipReadiness. Prefer firefox_get_accessibility_snapshot for reading; use screenshots for layout and visuals.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Tab ID (default: your current tab)',
        },
        maxEdge: {
          type: 'number',
          description: 'Longest image side in px (default 1568; 800 for a quick layout check; up to 2576 for small text on high-resolution models)',
        },
        region: {
          type: 'object',
          description: 'Zoom: capture only this viewport rectangle in CSS px',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
          required: ['x', 'y', 'width', 'height'],
        },
        quality: {
          type: 'number',
          description: 'JPEG quality 1-100 (default: 60)',
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
        annotate: {
          type: 'boolean',
          description: 'Overlay numbered badges on visible interactive elements (buttons, links, inputs) before capture. Returns labels map {index: {ref, role, text}}; pass a ref to click/type. Useful for vision models to identify elements.',
        },
        savePath: {
          type: 'string',
          description: 'Optional file path to also save the image (e.g. /tmp/shot.jpg). Must be inside the temp or current working directory and end in .jpg/.jpeg (JPEG) or .png (PNG). The path is returned in the text block.',
        },
      },
    },
  },
  {
    name: 'firefox_get_tabs',
    description: 'List all Claudezilla tabs with URLs, titles, tabIds, and ownerId. Shows which agent owns each tab. Use to see shared 12-tab pool status.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'firefox_list_all_tabs',
    description: 'List every open Firefox tab across all windows, including tabs outside the managed Claudezilla pool. Returns tabId, windowId, URL, title, active/pinned/private flags, and pool/attached markers. Use firefox_attach_tab with a returned tabId to drive an existing user tab in place.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'firefox_attach_tab',
    description: 'Attach an already-open user tab for in-place automation. This does not create, move, navigate, activate, or close the tab. After attaching, pass its tabId to the normal content, interaction, devtools, navigation, or screenshot tools. Use firefox_list_all_tabs to find tab IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Existing tab ID returned by firefox_list_all_tabs',
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'firefox_detach_tab',
    description: 'Release an attached user tab without closing, moving, navigating, or otherwise changing it.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Attached tab ID to release',
        },
      },
      required: ['tabId'],
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
    description: 'Request tab space when blocked by POOL_FULL. Queues your request. When another agent closes a tab or grants space, you receive a 30-second slot reservation. Call firefox_get_slot_requests to check if you have a reservation, then createWindow to claim it.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'firefox_grant_tab_space',
    description: 'Voluntarily release your oldest tab to help a waiting agent. Creates a 30-second reservation for the waiting agent so they can claim the freed slot. Only works if you have >2 tabs and there are pending slot requests.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'firefox_get_slot_requests',
    description: 'Check pending requests, active reservations, and your tab count. Shows if you have a reserved slot (youHaveReservation) and how long until it expires. If you have a reservation, call createWindow immediately to claim it.',
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
          description: 'Tab ID (default: your current tab)',
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
          description: 'Tab ID (default: your current tab)',
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
        includeHeaders: {
          type: 'boolean',
          description: 'Include response headers in output (default: false — headers are stripped to reduce payload size)',
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
          description: 'Tab ID (default: your current tab)',
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
    description: 'Wait for a condition on the page. Supports: selector (CSS element), text (body text contains string), or url (location matches glob). Useful for SPAs, redirects, and dynamic content.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Tab ID (default: your current tab)',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to wait for (mutually exclusive with text/url)',
        },
        text: {
          type: 'string',
          description: 'Wait until document.body.innerText includes this string (mutually exclusive with selector/url)',
        },
        url: {
          type: 'string',
          description: 'Wait until window.location.href matches this glob pattern, e.g. "**/dashboard" (mutually exclusive with selector/text)',
        },
        timeout: {
          type: 'number',
          description: 'Maximum time to wait in milliseconds (default: 10000)',
        },
      },
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
          description: 'Tab ID (default: your current tab)',
        },
        ref: {
          type: 'string',
          description: 'Element ref from a snapshot or firefox_find, e.g. "ref_a1b2_12" (preferred over selector)',
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
          description: 'Scroll behavior: instant or smooth (default: instant). Smooth waits up to 1 s for the scroll to finish before reporting positions.',
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
          description: 'Tab ID (default: your current tab)',
        },
        ref: {
          type: 'string',
          description: 'Element ref from a snapshot or firefox_find, e.g. "ref_a1b2_12" (preferred over selector)',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the element',
        },
      },
    },
  },
  // ===== PAGE ANALYSIS (FAST ALTERNATIVES TO SCREENSHOTS) =====
  {
    name: 'firefox_get_page_state',
    description: 'Get structured page state as JSON: URL, title, viewport, errors, headings, links, buttons, inputs, images, landmarks with counts. Headings, links, buttons and inputs carry a `ref` you can pass to firefox_click / firefox_type / firefox_scroll / firefox_press_key. Default item caps: headings 30, links 50, buttons 30, inputs 30, images 20 (raise with the max* params). Long strings are shortened with `truncated: true` and `rawLength` metadata. Password fields are masked ("***"). Cheaper than screenshots.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Tab ID (default: your current tab)',
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
    description: 'Primary way to read a page: compact accessibility tree, one line per element with [ref_N] handles you can pass as ref to click/type/scroll/press_key. filter=interactive lists only actionable elements. Cheaper than screenshots. Refs stay valid until navigation.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Tab ID (default: your current tab)',
        },
        format: {
          type: 'string',
          enum: ['text', 'json'],
          description: 'text (default): one line per element; json: nested tree with ref on every node',
        },
        filter: {
          type: 'string',
          enum: ['all', 'interactive'],
          description: 'all (default): full tree; interactive: flat list of visible actionable elements',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum tree depth to traverse (default: 15)',
        },
        maxNodes: {
          type: 'number',
          description: 'Maximum nodes to include (default: 200, max 2000)',
        },
        ref: {
          type: 'string',
          description: 'Element ref from a snapshot or firefox_find, e.g. "ref_a1b2_12" (preferred over selector)',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for root element (default: body)',
        },
      },
    },
  },
  {
    name: 'firefox_find',
    description: 'Find elements by visible text or accessible name (substring, or regex=true). Returns up to maxResults (default 20) matches as [ref_N] lines with their landmark/heading context; pass a ref to click/type/scroll. Cheaper than a full snapshot on large pages.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Tab ID (default: your current tab)',
        },
        query: {
          type: 'string',
          description: 'Text to search for (case-insensitive substring, max 200 chars)',
        },
        regex: {
          type: 'boolean',
          description: 'Treat query as a case-insensitive regular expression (default: false)',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum matches to return (default: 20)',
        },
      },
      required: ['query'],
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

  // ===== CONSENT =====
  {
    name: 'firefox_handle_consent',
    description: 'Explicit consent dismissal tool. Dismisses common cookie/consent dialogs and modals.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout: {
          type: 'number',
          description: 'Request timeout in ms (5000-300000, default 150000)',
        },
        scanTimeout: {
          type: 'number',
          description: 'How long to scan for consent elements in milliseconds (default: 3000, range: 1000-10000)',
        },
      },
    },
  },

  // ===== CONFIG =====
  {
    name: 'firefox_set_config',
    description: 'Set per-session configuration for this agent. Currently supports allowedDomains to restrict navigation to specific domains (security sandboxing).',
    inputSchema: {
      type: 'object',
      properties: {
        allowedDomains: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of allowed domains for navigation. Supports wildcards: "*.example.com". When set, firefox_navigate and firefox_create_window will block requests to unlisted domains. Pass empty array to clear restriction.',
        },
        handleConsent: {
          type: 'boolean',
          description: 'Enable automatic consent handling after navigation (fire-and-forget, 800ms delay)',
        },
      },
    },
  },

  // ===== PAGE STATE DIFF =====
  {
    name: 'firefox_diff_page_state',
    description: 'Diff two getPageState snapshots to see what changed: added/removed/changed headings, links, buttons, inputs. Useful for verifying form submissions, navigation effects, and regression detection.',
    inputSchema: {
      type: 'object',
      properties: {
        before: {
          type: 'object',
          description: 'First getPageState snapshot (the "before" state)',
        },
        after: {
          type: 'object',
          description: 'Second getPageState snapshot (the "after" state)',
        },
      },
      required: ['before', 'after'],
    },
  },

  // ===== SETTINGS =====
  {
    name: 'firefox_set_private_mode',
    description: 'Enable or disable private (incognito) browsing mode. When disabled, new windows use regular browsing with persistent cookies — useful for sites requiring login (e.g., X.com). Default: enabled (private).',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'true = private/incognito windows (default), false = regular windows with persistent cookies',
        },
      },
      required: ['enabled'],
    },
  },

  // ===== DIAGNOSTICS =====
  {
    name: 'firefox_diagnose',
    description: 'Diagnose Claudezilla connection health. Checks socket file, auth token, connection status, and extension version. Use when troubleshooting connection issues.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Add optional 'timeout' parameter to all tool schemas (except diagnose which runs locally)
for (const tool of TOOLS) {
  // Tools that already define their own `timeout` (firefox_wait_for) keep it.
  if (tool.name !== 'firefox_diagnose' && !tool.inputSchema.properties.timeout) {
    tool.inputSchema.properties.timeout = {
      type: 'number',
      description: 'Request timeout in ms (5000-300000, default 150000)',
    };
  }
}

// Tools whose tabId is optional default to this agent's current tab. Tools
// that create, attach, detach or close a specific tab are excluded: their
// tabId (or lack of one) is the point of the call.
const TAB_DEFAULT_EXCLUDED = new Set(['firefox_close_tab', 'firefox_attach_tab', 'firefox_detach_tab', 'firefox_create_window']);
const TAB_DEFAULT_TOOLS = new Set(
  TOOLS
    .filter((tool) => tool.inputSchema.properties.tabId && !(tool.inputSchema.required ?? []).includes('tabId'))
    .map((tool) => tool.name)
    .filter((toolName) => !TAB_DEFAULT_EXCLUDED.has(toolName)),
);

// Assign categories to tools for lazy loading
const TOOL_CATEGORIES = {
  firefox_create_window: 'core',
  firefox_navigate: 'core',
  firefox_click: 'core',
  firefox_type: 'core',
  firefox_press_key: 'core',
  firefox_scroll: 'core',
  firefox_screenshot: 'core',
  firefox_get_page_state: 'core',
  firefox_get_tabs: 'core',
  firefox_list_all_tabs: 'core',
  firefox_attach_tab: 'core',
  firefox_detach_tab: 'core',
  firefox_close_tab: 'core',
  firefox_list_containers: 'core',
  firefox_get_content: 'inspection',
  firefox_get_element: 'inspection',
  firefox_wait_for: 'inspection',
  firefox_diff_page_state: 'inspection',
  firefox_get_console: 'devtools',
  firefox_get_network: 'devtools',
  firefox_evaluate: 'devtools',
  firefox_get_accessibility_snapshot: 'core',
  firefox_find: 'core',
  firefox_request_tab_space: 'multiagent',
  firefox_grant_tab_space: 'multiagent',
  firefox_get_slot_requests: 'multiagent',
  firefox_start_loop: 'loop',
  firefox_stop_loop: 'loop',
  firefox_loop_status: 'loop',
  firefox_set_config: 'config',
  firefox_set_viewport: 'config',
  firefox_set_private_mode: 'config',
  firefox_handle_consent: 'config',
  firefox_close_window: 'config',
  firefox_resize_window: 'config',
  firefox_diagnose: 'diagnose',
};
for (const tool of TOOLS) {
  tool.category = TOOL_CATEGORIES[tool.name] || 'core';
}

// Category groups — 'all' expands to every category
const CATEGORY_GROUPS = {
  core: ['core'],
  devtools: ['core', 'devtools'],
  inspection: ['core', 'inspection'],
  multiagent: ['core', 'multiagent'],
  loop: ['core', 'loop'],
  config: ['core', 'config'],
  diagnose: ['diagnose'],
  all: ['core', 'inspection', 'devtools', 'multiagent', 'loop', 'config', 'diagnose'],
};

// Tool discovery policy: the full catalog ('all') by default; 'lazy' is opt-in and
// exposes only the firefox_activate gateway until a category is activated.
// Precedence: CLI argument (--tools lazy|all) > Env var (CLAUDEZILLA_TOOL_MODE=lazy) > default 'all'
const TOOL_MODE = (() => {
  const toolsArgIdx = process.argv.indexOf('--tools');
  const toolsArg = toolsArgIdx !== -1 ? process.argv[toolsArgIdx + 1] : undefined;
  if (toolsArg === 'lazy' || toolsArg === 'all') return toolsArg;
  if (process.env.CLAUDEZILLA_TOOL_MODE?.toLowerCase() === 'lazy') return 'lazy';
  return 'all';
})();

let activatedCategories = new Set();
let isActivated = false;

if (TOOL_MODE === 'all') {
  for (const cat of Object.keys(CATEGORY_GROUPS)) {
    for (const c of CATEGORY_GROUPS[cat]) activatedCategories.add(c);
  }
  isActivated = true;
}

// Gateway tool — the only tool exposed before activation
const GATEWAY_TOOLS = [
  {
    name: 'firefox_activate',
    description: 'Activate Claudezilla browser tools. Call this before using any firefox_* tools. Optional: specify a category to load only what you need. Categories: "core" (navigate/click/type/screenshot — default), "devtools" (console/network/evaluate), "inspection" (content/element/wait), "multiagent" (tab space management), "loop" (iterative dev), "config" (viewport/privacy/consent), "diagnose" (health check), "all" (everything). Returns list of activated tools.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Tool category to activate (default: "core")',
          enum: ['core', 'devtools', 'inspection', 'multiagent', 'loop', 'config', 'diagnose', 'all'],
        },
      },
    },
  },
];

// Server-level guidance sent once in the initialize response. Keep it under
// 1,500 characters: it is read by every agent on every session.
const SERVER_INSTRUCTIONS = `Claudezilla drives the user's real Firefox: open tabs, navigate, read pages, click, type and take screenshots (firefox_* tools).
Workflow: firefox_create_window opens your tab; later calls without tabId target your most recent tab. Read before you look: firefox_get_accessibility_snapshot returns a compact text tree with [ref_N] handles, and firefox_find locates elements by text. Act with firefox_click / firefox_type / firefox_scroll / firefox_press_key by passing ref (preferred) or a CSS selector. Refs stay valid until the page navigates; after a stale-ref error, read the page again. Use firefox_get_content for long text (paginate with offset) and firefox_screenshot only when layout or visuals matter (default long edge 1568 px; region zooms; maxEdge 2576 for small text). Screenshot coordinates: CSS px = image px / cssScale.
Etiquette: tabs you create are yours; never close or navigate other agents' tabs. The pool holds 12 tabs; close tabs you no longer need. Attach to the user's own tabs only when asked (firefox_list_all_tabs, firefox_attach_tab). firefox_evaluate stays disabled unless the user enables it in the add-on popup.
On connection errors run firefox_diagnose.`;

// Tool annotations (MCP spec): hints that let clients auto-approve reads and
// prompt before destructive or open-world actions. firefox_screenshot is not
// read-only: savePath and CLAUDEZILLA_SCREENSHOT_FILES write files to disk.
const READ_ONLY_TOOLS = new Set([
  'firefox_get_tabs', 'firefox_list_all_tabs', 'firefox_get_content', 'firefox_get_element',
  'firefox_wait_for', 'firefox_get_page_state', 'firefox_get_accessibility_snapshot', 'firefox_find',
  'firefox_diff_page_state', 'firefox_get_slot_requests', 'firefox_loop_status',
  'firefox_diagnose', 'firefox_list_containers',
]);
const DESTRUCTIVE_TOOLS = new Set([
  'firefox_close_tab', 'firefox_close_window', 'firefox_grant_tab_space', 'firefox_evaluate',
]);
const OPEN_WORLD_TOOLS = new Set(['firefox_create_window', 'firefox_navigate']);

// Tools Claude Code should load up front rather than defer behind tool search.
const ALWAYS_LOAD = new Set([
  'firefox_create_window', 'firefox_navigate', 'firefox_get_accessibility_snapshot',
  'firefox_find', 'firefox_click', 'firefox_type', 'firefox_screenshot',
]);

/**
 * Shape a tool definition for tools/list: spec fields only (no internal
 * `category`), a human title and annotations.
 */
function toWireTool(tool) {
  const title = tool.name
    .replace(/^firefox_/, '')
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  const wire = {
    name: tool.name,
    title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      title,
      readOnlyHint: READ_ONLY_TOOLS.has(tool.name),
      destructiveHint: DESTRUCTIVE_TOOLS.has(tool.name),
      openWorldHint: OPEN_WORLD_TOOLS.has(tool.name),
    },
  };
  if (ALWAYS_LOAD.has(tool.name)) wire._meta = { 'anthropic/alwaysLoad': true };
  return wire;
}

// Tools whose result has a `text` body: sent as a one-line JSON header followed
// by the text itself, so newlines and quotes are not re-escaped into JSON.
const TEXT_BODY_TOOLS = new Set(['firefox_get_content', 'firefox_get_accessibility_snapshot', 'firefox_find']);

/**
 * Serialize a command result for the tool response.
 */
function formatResult(name, result) {
  if (typeof result?.text === 'string' && TEXT_BODY_TOOLS.has(name)) {
    return JSON.stringify({ ...result, text: undefined }) + '\n\n' + result.text;
  }
  return JSON.stringify(result);
}

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
  firefox_list_all_tabs: 'listAllTabs',
  firefox_attach_tab: 'attachTab',
  firefox_detach_tab: 'detachTab',
  firefox_close_tab: 'closeTab',
  firefox_list_containers: 'listContainers',
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
  firefox_find: 'find',
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
  // Consent
  firefox_handle_consent: 'handleConsent',
  // Settings
  firefox_set_private_mode: 'setPrivateMode',
  // Config (handled locally)
  firefox_set_config: 'setConfig',
  // Diff (handled locally)
  firefox_diff_page_state: 'diffPageState',
};

// Create MCP server
const server = new Server(
  {
    name: 'claudezilla',
    version: MCP_VERSION,
  },
  {
    capabilities: {
      tools: { listChanged: true },
    },
    instructions: TOOL_MODE === 'lazy'
      ? `Call firefox_activate first to load the tools. ${SERVER_INSTRUCTIONS}`
      : SERVER_INSTRUCTIONS,
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Lazy mode before activation: expose only the gateway tool
  if (!isActivated) {
    return { tools: GATEWAY_TOOLS.map(toWireTool) };
  }

  // Filter by activated categories (everything in the default 'all' mode)
  const availableTools = TOOLS.filter(tool => activatedCategories.has(tool.category));
  return { tools: availableTools.map(toWireTool) };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Gateway tool: activate tool categories and emit listChanged notification
  if (name === 'firefox_activate') {
    const category = args?.category || 'core';
    const categoriesToActivate = CATEGORY_GROUPS[category];
    if (!categoriesToActivate) {
      return {
        content: [{ type: 'text', text: `Unknown category: "${category}". Valid: ${Object.keys(CATEGORY_GROUPS).join(', ')}` }],
        isError: true,
      };
    }
    for (const cat of categoriesToActivate) {
      activatedCategories.add(cat);
    }
    isActivated = true;
    // Notify client that tool list has changed
    server.notification({ method: 'notifications/tools/list_changed' }).catch(err => {
      console.error('[claudezilla] listChanged notification failed:', err.message);
    });
    const activatedTools = TOOLS.filter(t => activatedCategories.has(t.category)).map(t => t.name);

    // Query current window mode capabilities (non-fatal)
    let windowMode = null;
    try {
      const modeResponse = await sendCommand('getWindowMode', {});
      if (modeResponse.success) {
        windowMode = modeResponse.result;
      }
    } catch (e) {
      // Non-fatal: extension may not support getWindowMode yet
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          activated: true,
          categories: [...activatedCategories],
          tools: activatedTools,
          count: activatedTools.length,
          privateWindowsAvailable: windowMode?.privateWindowsAvailable ?? null,
          currentWindowMode: windowMode?.currentWindowMode ?? null,
        }),
      }],
    };
  }

  // Activation recovery: when Claude Code drops/reloads the MCP server
  // (e.g. across `/clear` — fixed upstream in 2.1.136 but the transition
  // moment still loses our `activatedCategories` set), an agent's first
  // post-reload call to a known firefox_* tool would previously hard-fail
  // with ACTIVATION_REQUIRED/CATEGORY_REQUIRED. We instead auto-activate
  // the relevant category, emit listChanged, and proceed with the call.
  // This is transparent to the caller and matches the upstream pattern.
  const TOOL_TO_CATEGORY = {};
  for (const tool of TOOLS) {
    if (tool.category) TOOL_TO_CATEGORY[tool.name] = tool.category;
  }
  const toolCategory = TOOL_TO_CATEGORY[name];

  if (name !== 'firefox_diagnose' && !isActivated) {
    if (!toolCategory) {
      // Unknown tool name — surface a discoverable error
      return {
        content: [{ type: 'text', text: 'ACTIVATION_REQUIRED: Call firefox_activate first.' }],
        isError: true,
      };
    }
    const groups = CATEGORY_GROUPS[toolCategory] || [toolCategory];
    for (const cat of groups) activatedCategories.add(cat);
    isActivated = true;
    server.notification({ method: 'notifications/tools/list_changed' }).catch(err => {
      console.error('[claudezilla] listChanged notification failed:', err.message);
    });
    console.error(`[claudezilla] Activation recovery: auto-activated category "${toolCategory}" for tool "${name}"`);
  }

  // SECURITY: Enforce category-scoped activation at call time
  if (toolCategory && !activatedCategories.has(toolCategory)) {
    const groups = CATEGORY_GROUPS[toolCategory] || [toolCategory];
    for (const cat of groups) activatedCategories.add(cat);
    server.notification({ method: 'notifications/tools/list_changed' }).catch(err => {
      console.error('[claudezilla] listChanged notification failed:', err.message);
    });
    console.error(`[claudezilla] Category recovery: auto-activated "${toolCategory}" for tool "${name}"`);
  }

  // Special case: firefox_set_config runs locally (updates in-memory agent config)
  if (name === 'firefox_set_config') {
    try {
      const agentId = AGENT_ID;
      const existing = agentConfig.get(agentId) || {};
      if (args.allowedDomains !== undefined) {
        existing.allowedDomains = args.allowedDomains;
      }
      if (args.handleConsent !== undefined) {
        existing.handleConsent = args.handleConsent;
      }
      agentConfig.set(agentId, existing);
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, config: existing }) }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `Config error: ${error.message}` }], isError: true };
    }
  }

  // Special case: firefox_diff_page_state runs locally (pure JS diff)
  if (name === 'firefox_diff_page_state') {
    try {
      const { before, after } = args || {};
      if (!before || !after) throw new Error('Both "before" and "after" snapshots are required');
      const diff = diffPageState(before, after);
      return {
        content: [{ type: 'text', text: JSON.stringify(diff) }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `Diff error: ${error.message}` }], isError: true };
    }
  }

  // Special case: firefox_diagnose runs locally, not through sendCommand
  if (name === 'firefox_diagnose') {
    try {
      const diagnostics = await runDiagnostics();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(diagnostics),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Diagnostic error: ${error.message}` }],
        isError: true,
      };
    }
  }

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

    // Per-operation timeout: map 'timeout' from tool args to '_timeout' internal param.
    // firefox_wait_for owns a `timeout` (how long the page waits): forward it to
    // the content script and give the socket 5 s of headroom on top of it.
    if (name === 'firefox_wait_for') {
      const waitMs = typeof commandParams.timeout === 'number' ? commandParams.timeout : 10000;
      commandParams._timeout = Math.max(5000, Math.min(300000, waitMs + 5000));
    } else if (commandParams.timeout && typeof commandParams.timeout === 'number') {
      commandParams._timeout = Math.max(5000, Math.min(300000, commandParams.timeout));
      delete commandParams.timeout; // Don't forward the schema param to extension
    }

    // savePath is handled in the MCP layer — don't forward to the extension
    const savePathArg = args?.savePath;
    delete commandParams.savePath;

    const OWNERSHIP_COMMANDS = [
      'firefox_create_window',
      'firefox_attach_tab',
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
      'firefox_find',
      'firefox_press_key',
      'firefox_screenshot',
      'firefox_request_tab_space',
      'firefox_grant_tab_space',
      'firefox_get_slot_requests',
      'firefox_handle_consent',
    ];
    if (OWNERSHIP_COMMANDS.includes(name)) {
      commandParams.agentId = AGENT_ID;
      // Update heartbeat for this agent
      updateAgentHeartbeat(AGENT_ID);
    }

    // Loop commands: forward Claude Code session ID so concurrent sessions
    // don't share loop state. Host falls back to DEFAULT_SESSION when absent.
    const LOOP_TOOLS = ['firefox_start_loop', 'firefox_stop_loop', 'firefox_loop_status'];
    if (LOOP_TOOLS.includes(name)) {
      const sid = getClaudeCodeSessionId();
      if (sid) commandParams.sessionId = sid;
    }

    // Domain allowlist check for navigate/createWindow
    if (name === 'firefox_navigate' || name === 'firefox_create_window') {
      const url = commandParams.url;
      if (url) {
        const blocked = checkDomainAllowed(AGENT_ID, url);
        if (blocked) {
          return { content: [{ type: 'text', text: blocked }], isError: true };
        }
      }
    }

    // Default tab-targeting calls to this agent's own current tab.
    let injectedTabId = null;
    if (currentTabId !== null && commandParams.tabId === undefined && TAB_DEFAULT_TOOLS.has(name)) {
      commandParams.tabId = currentTabId;
      injectedTabId = currentTabId;
    }

    // Bug 3: Refresh heartbeat before the async wait to prevent orphan timeout during long operations
    updateAgentHeartbeat(AGENT_ID);
    const response = await sendCommand(command, commandParams);

    // Auto-trigger handleConsent if configured and navigation succeeded.
    // Track the timer so handleShutdown can cancel any pending fire-and-forget
    // consent calls that would otherwise race against the goodbye/exit sequence.
    if (response.success && (name === 'firefox_navigate' || name === 'firefox_create_window')) {
      const config = agentConfig.get(AGENT_ID);
      if (config?.handleConsent) {
        const navigatedTabId = response.result?.tabId;
        const timer = setTimeout(() => {
          pendingConsentTimers.delete(timer);
          if (isShuttingDown) return;
          sendCommand('handleConsent', { agentId: AGENT_ID, tabId: navigatedTabId }).catch(err => {
            console.error('[claudezilla] Auto-trigger handleConsent failed:', err.message);
          });
        }, 600);
        pendingConsentTimers.add(timer);
      }
    }

    // Track this agent's current tab so later calls without tabId do not fall
    // through to the extension's single global active tab (another agent's).
    let staleTabNote = '';
    if (response.success) {
      trackCurrentTab(name, args, response.result);
    } else if (injectedTabId !== null && STALE_TAB_ERROR.test(String(response.error ?? ''))) {
      currentTabId = null;
      staleTabNote = ` (your current tab ${injectedTabId} is gone: call firefox_get_tabs or firefox_create_window)`;
    }

    if (response.success) {
      // Special handling for screenshots - return as image
      if (name === 'firefox_screenshot' && response.result?.dataUrl) {
        // Detect format from data URL
        const { dataUrl, ...meta } = response.result;
        const isJpeg = dataUrl.startsWith('data:image/jpeg');
        const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
        const format = isJpeg ? 'jpeg' : 'png';
        const base64Data = dataUrl.slice(dataUrl.indexOf(',') + 1);
        // An explicit savePath wins; otherwise CLAUDEZILLA_SCREENSHOT_FILES=1
        // writes a copy for harnesses that cannot display inline images.
        let savedPath;
        if (savePathArg) {
          savedPath = saveScreenshotToDisk(base64Data, savePathArg, format);
        } else if (SCREENSHOT_FILES) {
          savedPath = writeScreenshotFile(base64Data, format);
        }
        // Geometry first (width, height, cssScale, labels, savedPath), then the image.
        return {
          content: [
            { type: 'text', text: JSON.stringify(savedPath ? { ...meta, savedPath } : meta) },
            { type: 'image', data: base64Data, mimeType },
          ],
        };
      }

      // Handle undefined/null results - ensure text is always a string
      const resultText = response.result !== undefined
        ? formatResult(name, response.result)
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
      } else if (response.details?.code === 'MODE_MISMATCH') {
        errorText = `MODE_MISMATCH: ${response.details.message}\n` +
          `  Current: ${response.details.currentMode}\n` +
          `  Requested: ${response.details.requestedMode}\n` +
          `  Hint: ${response.details.hint}`;
      }
      if (staleTabNote) errorText += staleTabNote;
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
/**
 * Send goodbye command to clean up agent's tabs on shutdown
 * Non-blocking - we don't wait for response since we're exiting
 */
async function sendGoodbye() {
  try {
    // Shutting down must never launch Firefox, and must not wait on the
    // ~155 s socket default when the host is unresponsive.
    await sendCommandOnce('goodbye', { agentId: AGENT_ID }, { autostart: false, timeoutMs: 2000 });
    console.error(`[claudezilla] Sent goodbye for ${truncateAgentId(AGENT_ID)}`);
  } catch (e) {
    // Ignore errors on shutdown - extension may already be gone
    console.error(`[claudezilla] Goodbye failed (expected if Firefox closed): ${e.message}`);
  }
}

// Register shutdown hooks to clean up tabs when MCP server exits
let isShuttingDown = false;
function handleShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  agentReaper.stop();
  // Cancel any pending fire-and-forget consent calls before they can race
  // against the goodbye/exit sequence.
  for (const timer of pendingConsentTimers) clearTimeout(timer);
  pendingConsentTimers.clear();
  console.error(`[claudezilla] Received ${signal}, cleaning up...`);
  // Hard backstop: exit even if goodbye hangs on a stuck socket.
  setTimeout(() => process.exit(0), 3000).unref();
  sendGoodbye().finally(() => process.exit(0));
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGHUP', () => handleShutdown('SIGHUP'));

// The MCP client went away (stdin closed). The stdio transport does not
// end the process on its own, so shut down here instead of lingering as an
// orphan.
process.stdin.on('end', () => handleShutdown('stdin end'));

// Also handle unexpected exits. handleShutdown() guards with isShuttingDown
// and exits after the goodbye: sendGoodbye() alone keeps the event loop busy,
// so beforeExit fires again once it settles, and the server would send
// goodbye in a tight loop.
process.on('beforeExit', () => handleShutdown('beforeExit'));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Claudezilla MCP server running (agent: ${truncateAgentId(AGENT_ID)})`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
