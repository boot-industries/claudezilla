#!/usr/bin/env node

/**
 * Claudezilla Native Messaging Host
 *
 * Bridges Firefox extension with Claude Code CLI for browser automation.
 *
 * SECURITY MODEL:
 * - Only whitelisted commands are allowed
 * - Page content is always DATA, never interpreted as instructions
 * - All responses are structured JSON
 * - No arbitrary code execution
 */

import { readMessage, sendMessage } from './protocol.js';
import { appendFileSync, unlinkSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { createServer } from 'net';
import { randomUUID, randomBytes, timingSafeEqual } from 'crypto';
import {
  getSocketPath,
  getAuthTokenPath,
  getDebugLogPath,
  cleanupSocket,
  setSecurePermissions,
  setWindowsFileACL,
  ensureParentDir,
  isWindows,
  commandTimeoutMs,
  socketTimeoutMs
} from './ipc.js';

// Single source of truth for the host version. Reading from package.json at
// module load keeps the `version` response in sync with the npm-tracked
// version without manual edits in two places.
const HOST_VERSION = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
).version;

// Platform-independent paths from ipc.js abstraction layer
const DEBUG_LOG = getDebugLogPath();
const SOCKET_PATH = getSocketPath();
const AUTH_TOKEN_FILE = getAuthTokenPath();

// SECURITY: Max buffer size to prevent memory exhaustion (10MB)
const MAX_BUFFER_SIZE = 10 * 1024 * 1024;

// SECURITY: Loop configuration limits
const MAX_ITERATIONS_LIMIT = 10000;  // Maximum allowed maxIterations value
const MAX_LOOP_DURATION_MS = 60 * 60 * 1000;  // 1 hour wall-clock timeout
const MAX_COMPLETION_PROMISE_LENGTH = 1000;  // Max length for completionPromise string

// SECURITY: Socket authentication token (generated on startup)
const SOCKET_AUTH_TOKEN = randomBytes(32).toString('hex');

// SECURITY: Whitelist of allowed commands
const ALLOWED_COMMANDS = new Set([
  // Core browser control
  'ping',
  'version',
  'canNavigate',
  'navigate',
  'getActiveTab',
  'getContent',
  'click',
  'type',
  'screenshot',
  'getTabs',
  'listAllTabs',
  'attachTab',
  'detachTab',
  'closeTab',
  'createWindow',
  'closeWindow',
  'getWindows',
  'resizeWindow',
  'setViewport',
  // Devtools features
  'getConsoleLogs',
  'getNetworkRequests',
  'scroll',
  'waitFor',
  'evaluate',
  'getElementInfo',
  // Page analysis (fast alternatives to screenshots)
  'getPageState',
  'getAccessibilitySnapshot',
  // Keyboard input
  'pressKey',
  // Loop/concentration feature
  'startLoop',
  'stopLoop',
  'getLoopState',
  'incrementLoopIteration',
  // Tab space coordination (mercy system)
  'requestTabSpace',
  'grantTabSpace',
  'getSlotRequests',
  'cleanupOrphanedTabs',
  // Settings
  'setPrivateMode',
  // Session cleanup
  'goodbye',
  // Consent automation
  'handleConsent',
  // Window mode query
  'getWindowMode',
]);

/**
 * Loop state storage (in-memory), keyed by Claude Code session ID.
 *
 * Claude Code 2.1.132+ exposes CLAUDE_CODE_SESSION_ID to bash subprocesses.
 * The stop hook and the MCP server forward this so concurrent sessions
 * don't collide. Older callers that don't provide a sessionId are bucketed
 * under DEFAULT_SESSION (preserves pre-v0.6.5 behavior).
 *
 * Reset on host restart - by design to prevent orphaned loops.
 */
const DEFAULT_SESSION = '__default__';
const MAX_TRACKED_SESSIONS = 64; // bound memory; oldest evicted on overflow
const loopStates = new Map();

function emptyLoopState() {
  return {
    active: false,
    prompt: '',
    iteration: 0,
    maxIterations: 0,
    completionPromise: null,
    startedAt: null,
  };
}

function normalizeSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) return DEFAULT_SESSION;
  // SECURITY: bound length and reject control chars to prevent log/format injection
  if (sessionId.length > 128) return DEFAULT_SESSION;
  if (!/^[A-Za-z0-9_\-:.]+$/.test(sessionId)) return DEFAULT_SESSION;
  return sessionId;
}

function getLoopStateFor(sessionId) {
  const key = normalizeSessionId(sessionId);
  let state = loopStates.get(key);
  if (!state) {
    state = emptyLoopState();
    loopStates.set(key, state);
    // Evict oldest entry if we exceed the cap (Map preserves insertion order)
    if (loopStates.size > MAX_TRACKED_SESSIONS) {
      const oldest = loopStates.keys().next().value;
      if (oldest && oldest !== key) loopStates.delete(oldest);
    }
  }
  return state;
}

function setLoopStateFor(sessionId, state) {
  const key = normalizeSessionId(sessionId);
  loopStates.set(key, state);
}

// SECURITY: Log to stderr and debug file with restricted permissions
function log(...args) {
  const msg = `[${new Date().toISOString()}] [claudezilla-host] ${args.join(' ')}\n`;
  console.error('[claudezilla-host]', ...args);
  try {
    // Create log file with restricted permissions if it doesn't exist
    if (!existsSync(DEBUG_LOG)) {
      writeFileSync(DEBUG_LOG, '', { mode: 0o600 });
    }
    appendFileSync(DEBUG_LOG, msg);
  } catch (e) {
    // ignore
  }
}

log('Script starting, cwd:', process.cwd());

// Track pending requests from CLI
const pendingCliRequests = new Map();
// Parallel map keyed by id, holding each request's timeout handle so we can
// clear it on response/close instead of letting the closure live for the
// full 150 s default per request.
const pendingRequestTimers = new Map();

/**
 * Check if a given loop state has exceeded wall-clock timeout
 * @param {object} state - the loop state to check
 * @returns {boolean} true if loop should be auto-stopped
 */
function isLoopTimedOut(state) {
  if (!state || !state.active || !state.startedAt) return false;
  const elapsed = Date.now() - new Date(state.startedAt).getTime();
  return elapsed > MAX_LOOP_DURATION_MS;
}

/**
 * Handle loop commands directly in host (not forwarded to extension).
 * Loop state is keyed by Claude Code session ID so concurrent sessions
 * on the same machine don't collide. Falls back to DEFAULT_SESSION
 * when no sessionId is provided (older Claude Code, raw CLI tests).
 *
 * SECURITY: Validates all inputs, prevents overlapping loops per session,
 * enforces timeouts, bounds tracked sessions.
 */
function handleLoopCommand(command, params, callback) {
  const sessionId = normalizeSessionId(params?.sessionId);
  let state = getLoopStateFor(sessionId);

  // Check for wall-clock timeout on any loop command
  if (state.active && isLoopTimedOut(state)) {
    log(`Loop auto-stopped (session=${sessionId}): exceeded ${MAX_LOOP_DURATION_MS / 1000 / 60} minute timeout`);
    state = emptyLoopState();
    setLoopStateFor(sessionId, state);
  }

  switch (command) {
    case 'startLoop': {
      const { prompt, maxIterations = 0, completionPromise = null } = params;

      // SECURITY: Prevent overlapping loops within the same session
      if (state.active) {
        callback({ success: false, error: 'Loop already active. Stop current loop first.' });
        return;
      }

      // Validation: prompt is required
      if (!prompt || typeof prompt !== 'string') {
        callback({ success: false, error: 'Prompt is required and must be a string' });
        return;
      }

      // SECURITY: Validate maxIterations bounds
      const maxIter = Number(maxIterations) || 0;
      if (maxIter < 0 || maxIter > MAX_ITERATIONS_LIMIT) {
        callback({ success: false, error: `maxIterations must be 0-${MAX_ITERATIONS_LIMIT}` });
        return;
      }

      // SECURITY: Validate completionPromise length
      if (completionPromise !== null) {
        if (typeof completionPromise !== 'string') {
          callback({ success: false, error: 'completionPromise must be a string or null' });
          return;
        }
        if (completionPromise.length > MAX_COMPLETION_PROMISE_LENGTH) {
          callback({ success: false, error: `completionPromise exceeds ${MAX_COMPLETION_PROMISE_LENGTH} character limit` });
          return;
        }
      }

      const next = {
        active: true,
        prompt,
        iteration: 0,
        maxIterations: maxIter,
        completionPromise: completionPromise || null,
        startedAt: new Date().toISOString(),
      };
      setLoopStateFor(sessionId, next);
      log(`Loop started (session=${sessionId}): "${prompt.slice(0, 50)}..." max=${maxIter}`);
      callback({ success: true, result: { ...next, sessionId } });
      break;
    }

    case 'stopLoop': {
      const wasActive = state.active;
      setLoopStateFor(sessionId, emptyLoopState());
      log(`Loop stopped (session=${sessionId})`);
      callback({ success: true, result: { stopped: wasActive, sessionId } });
      break;
    }

    case 'getLoopState': {
      // Include timeout status and session ID in response
      const timedOut = isLoopTimedOut(state);
      callback({ success: true, result: { ...state, timedOut, sessionId } });
      break;
    }

    case 'incrementLoopIteration': {
      if (state.active) {
        state.iteration += 1;
        log(`Loop iteration (session=${sessionId}): ${state.iteration}`);
      }
      callback({ success: true, result: { iteration: state.iteration, sessionId } });
      break;
    }

    default:
      callback({ success: false, error: `Unknown loop command: ${command}` });
  }
}

/**
 * Handle command from CLI (via socket)
 * SECURITY: Validates auth token and command against whitelist
 */
function handleCliCommand(command, params, authToken, callback, socketRequests) {
  // SECURITY: Validate auth token
  if (!authToken || typeof authToken !== 'string' || authToken.length !== SOCKET_AUTH_TOKEN.length ||
      !timingSafeEqual(Buffer.from(authToken), Buffer.from(SOCKET_AUTH_TOKEN))) {
    callback({ success: false, error: 'Invalid or missing auth token' });
    return;
  }

  // SECURITY: Reject non-whitelisted commands
  if (!ALLOWED_COMMANDS.has(command)) {
    callback({ success: false, error: `Command not allowed: ${command}` });
    return;
  }

  // Handle loop commands directly in host (no extension needed)
  const LOOP_COMMANDS = ['startLoop', 'stopLoop', 'getLoopState', 'incrementLoopIteration'];
  if (LOOP_COMMANDS.includes(command)) {
    handleLoopCommand(command, params, callback);
    return;
  }

  // SECURITY: Use UUID for request IDs to prevent overflow/collision
  const id = randomUUID();

  // Store callback for when extension responds
  pendingCliRequests.set(id, callback);
  if (socketRequests) socketRequests.add(id);

  // Per-operation timeout support (default: 150s, range: 5s-300s)
  const timeoutMs = commandTimeoutMs(params);
  const timer = setTimeout(() => {
    pendingRequestTimers.delete(id);
    if (pendingCliRequests.has(id)) {
      pendingCliRequests.delete(id);
      if (socketRequests) socketRequests.delete(id);
      callback({ success: false, error: `Request timed out after ${timeoutMs}ms (command: ${command})`, command, timeoutMs });
    }
  }, timeoutMs);
  pendingRequestTimers.set(id, timer);

  // Send command to extension via native messaging
  log(`Forwarding CLI command to extension: ${command}`);
  sendMessage({ id, type: 'command', command, params });
}

/**
 * Handle message from extension (via native messaging stdin)
 */
function handleExtensionMessage(message) {
  const { id, command, success, result, error } = message;

  log('Received from extension:', JSON.stringify(message).slice(0, 200));

  // If this is a response to a CLI request (has success field), route it back
  if (id && pendingCliRequests.has(id) && success !== undefined) {
    const callback = pendingCliRequests.get(id);
    pendingCliRequests.delete(id);
    const timer = pendingRequestTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      pendingRequestTimers.delete(id);
    }
    callback({ success, result, error });
    return;
  }

  // Handle extension-initiated requests (like ping from popup)
  if (command === 'ping') {
    sendMessage({ id, success: true, result: { pong: true, timestamp: Date.now() } });
  } else if (command === 'version') {
    sendMessage({
      id,
      success: true,
      result: {
        host: HOST_VERSION,
        node: process.version,
        platform: process.platform,
        features: ['security-hardened', 'focus-loop', 'auto-retry', 'task-detection', 'expression-validation', 'windows-support', 'autonomous-install', 'session-scoped-loops', 'activation-recovery'],
      },
    });
  }
}

/**
 * Start Unix socket server for CLI commands
 */
function startSocketServer() {
  // Clean up old socket (Unix only - named pipes auto-cleanup on Windows)
  cleanupSocket(SOCKET_PATH);

  const server = createServer((socket) => {
    log('CLI client connected');

    // Baseline idle timeout — close sockets that connect but never send
    // commands. Raised below, once a command arrives, to cover that command.
    socket.setTimeout(60000);
    socket.on('timeout', () => {
      log(`Socket idle timeout (${socket.timeout}ms) — closing`);
      socket.destroy();
    });

    let buffer = '';
    const socketRequests = new Set();

    socket.on('data', (data) => {
      buffer += data.toString();

      // SECURITY: Prevent memory exhaustion from unbounded buffer
      if (buffer.length > MAX_BUFFER_SIZE) {
        log('Buffer overflow attempt - disconnecting client');
        socket.write(JSON.stringify({ success: false, error: 'Message too large' }) + '\n');
        socket.destroy();
        buffer = '';
        return;
      }

      // Process complete JSON messages (newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line);

          // SECURITY: Validate command is a non-empty string before dispatch
          if (!parsed.command || typeof parsed.command !== 'string') {
            socket.write(JSON.stringify({ success: false, error: 'Invalid or missing command' }) + '\n');
            return;
          }

          const { command, params = {}, authToken } = parsed;

          log(`CLI command: ${command}`);

          // Extend the socket's idle timeout to cover this command. The 60s
          // baseline above is only meant for sockets that connect and never
          // send anything; without this, a command the extension is slow to
          // answer (or never answers) has its socket destroyed at 60s BEFORE
          // the per-request timer in handleCliCommand can report the timeout,
          // and the MCP client is left holding a closed socket.
          socket.setTimeout(socketTimeoutMs(params));

          handleCliCommand(command, params, authToken, (response) => {
            socket.write(JSON.stringify(response) + '\n');
          }, socketRequests);
        } catch (e) {
          log('Invalid CLI message:', e.message);
          socket.write(JSON.stringify({ success: false, error: 'Invalid JSON' }) + '\n');
        }
      }
    });

    socket.on('close', () => {
      log('CLI client disconnected');
      // Clean up pending requests for this socket
      for (const reqId of socketRequests) {
        pendingCliRequests.delete(reqId);
        const timer = pendingRequestTimers.get(reqId);
        if (timer) {
          clearTimeout(timer);
          pendingRequestTimers.delete(reqId);
        }
      }
      socketRequests.clear();
    });

    socket.on('error', (err) => {
      log('Socket error:', err.message);
      socket.destroy();
    });
  });

  server.maxConnections = 10;

  server.listen(SOCKET_PATH, async () => {
    log(`Socket server listening on ${SOCKET_PATH}`);

    // SECURITY: Set socket permissions to user-only (0600) - Unix only
    setSecurePermissions(SOCKET_PATH, 0o600);
    log('Socket permissions set to 0600 (user only)');

    // SECURITY: Write auth token to file for MCP server to read
    try {
      // Ensure parent directory exists (required on Windows)
      ensureParentDir(AUTH_TOKEN_FILE);
      writeFileSync(AUTH_TOKEN_FILE, SOCKET_AUTH_TOKEN, { mode: 0o600 });
      log(`Auth token written to ${AUTH_TOKEN_FILE}`);

      // SECURITY: Set Windows ACL on auth token file (Windows only)
      await setWindowsFileACL(AUTH_TOKEN_FILE);
    } catch (e) {
      log('Warning: Could not write auth token file:', e.message);
    }
  });

  server.on('error', (err) => {
    log('Server error:', err.message);
  });

  return server;
}

/**
 * Main message loop for native messaging
 */
async function startNativeMessaging() {
  log('Starting native messaging loop');
  process.stdin.resume();

  while (true) {
    try {
      const message = await readMessage();

      if (message === null) {
        log('Extension disconnected (EOF)');
        break;
      }

      handleExtensionMessage(message);
    } catch (error) {
      log('Native messaging error:', error.message);
      break;
    }
  }
}

/**
 * Main entry point
 */
async function main() {
  log('Host started');

  // Start socket server for CLI commands
  const socketServer = startSocketServer();

  // Start native messaging loop
  await startNativeMessaging();

  // Cleanup
  log('Host exiting');
  socketServer.close();
  cleanup();

  process.exit(0);
}

/**
 * Cleanup function to remove socket and auth token files
 */
function cleanup() {
  if (existsSync(SOCKET_PATH)) {
    unlinkSync(SOCKET_PATH);
  }
  if (existsSync(AUTH_TOKEN_FILE)) {
    unlinkSync(AUTH_TOKEN_FILE);
  }
}

// Handle signals gracefully
process.on('SIGTERM', () => {
  log('Received SIGTERM');
  cleanup();
  process.exit(0);
});

process.on('SIGINT', () => {
  log('Received SIGINT');
  cleanup();
  process.exit(0);
});

main().catch((error) => {
  log('Unhandled error:', error);
  // Run cleanup before exiting so the socket file and auth-token file aren't
  // left behind on crash (SIGTERM/SIGINT already cover the graceful paths).
  try { cleanup(); } catch (e) { log('Cleanup during crash failed:', e); }
  process.exit(1);
});
