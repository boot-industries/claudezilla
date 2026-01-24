#!/opt/homebrew/bin/node

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
import { appendFileSync, unlinkSync, existsSync, chmodSync, writeFileSync } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID, randomBytes } from 'crypto';

// SECURITY: Use validated temp directory
// Prevents TMPDIR hijacking by validating the path
const SAFE_TMPDIR = (() => {
  const tmp = tmpdir();
  // On macOS/Linux, prefer XDG_RUNTIME_DIR if available (per-user, secure)
  const xdgRuntime = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntime && existsSync(xdgRuntime)) {
    return xdgRuntime;
  }
  return tmp;
})();

const DEBUG_LOG = join(SAFE_TMPDIR, 'claudezilla-debug.log');
const SOCKET_PATH = join(SAFE_TMPDIR, 'claudezilla.sock');
const AUTH_TOKEN_FILE = join(SAFE_TMPDIR, 'claudezilla-auth.token');

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
]);

/**
 * Loop state storage (in-memory)
 * Reset on host restart - by design to prevent orphaned loops
 */
let loopState = {
  active: false,
  prompt: '',
  iteration: 0,
  maxIterations: 0,
  completionPromise: null,
  startedAt: null,
};

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

/**
 * Check if loop has exceeded wall-clock timeout
 * @returns {boolean} true if loop should be auto-stopped
 */
function isLoopTimedOut() {
  if (!loopState.active || !loopState.startedAt) return false;
  const elapsed = Date.now() - new Date(loopState.startedAt).getTime();
  return elapsed > MAX_LOOP_DURATION_MS;
}

/**
 * Handle loop commands directly in host (not forwarded to extension)
 * SECURITY: Validates all inputs, prevents overlapping loops, enforces timeouts
 */
function handleLoopCommand(command, params, callback) {
  // Check for wall-clock timeout on any loop command
  if (loopState.active && isLoopTimedOut()) {
    log(`Loop auto-stopped: exceeded ${MAX_LOOP_DURATION_MS / 1000 / 60} minute timeout`);
    loopState = {
      active: false,
      prompt: '',
      iteration: 0,
      maxIterations: 0,
      completionPromise: null,
      startedAt: null,
    };
  }

  switch (command) {
    case 'startLoop': {
      const { prompt, maxIterations = 0, completionPromise = null } = params;

      // SECURITY: Prevent overlapping loops
      if (loopState.active) {
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

      loopState = {
        active: true,
        prompt,
        iteration: 0,
        maxIterations: maxIter,
        completionPromise: completionPromise || null,
        startedAt: new Date().toISOString(),
      };
      log(`Loop started: "${prompt.slice(0, 50)}..." max=${maxIter}`);
      callback({ success: true, result: { ...loopState } });
      break;
    }

    case 'stopLoop': {
      const wasActive = loopState.active;
      loopState = {
        active: false,
        prompt: '',
        iteration: 0,
        maxIterations: 0,
        completionPromise: null,
        startedAt: null,
      };
      log('Loop stopped');
      callback({ success: true, result: { stopped: wasActive } });
      break;
    }

    case 'getLoopState': {
      // Include timeout status in response
      const timedOut = isLoopTimedOut();
      callback({ success: true, result: { ...loopState, timedOut } });
      break;
    }

    case 'incrementLoopIteration': {
      if (loopState.active) {
        loopState.iteration += 1;
        log(`Loop iteration: ${loopState.iteration}`);
      }
      callback({ success: true, result: { iteration: loopState.iteration } });
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
function handleCliCommand(command, params, authToken, callback) {
  // SECURITY: Validate auth token
  if (authToken !== SOCKET_AUTH_TOKEN) {
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

  // Set timeout to prevent hanging
  setTimeout(() => {
    if (pendingCliRequests.has(id)) {
      pendingCliRequests.delete(id);
      callback({ success: false, error: 'Request timed out' });
    }
  }, 30000);

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
        host: '0.5.4',
        node: process.version,
        platform: process.platform,
        features: ['security-hardened', 'focus-loop', 'auto-retry', 'task-detection', 'expression-validation'],
      },
    });
  }
}

/**
 * Start Unix socket server for CLI commands
 */
function startSocketServer() {
  // Clean up old socket
  if (existsSync(SOCKET_PATH)) {
    try {
      unlinkSync(SOCKET_PATH);
    } catch (e) {
      log('Warning: Could not remove old socket:', e.message);
    }
  }

  const server = createServer((socket) => {
    log('CLI client connected');

    let buffer = '';

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
          const { command, params = {}, authToken } = JSON.parse(line);

          log(`CLI command: ${command}`);

          handleCliCommand(command, params, authToken, (response) => {
            socket.write(JSON.stringify(response) + '\n');
          });
        } catch (e) {
          log('Invalid CLI message:', e.message);
          socket.write(JSON.stringify({ success: false, error: 'Invalid JSON' }) + '\n');
        }
      }
    });

    socket.on('close', () => {
      log('CLI client disconnected');
    });

    socket.on('error', (err) => {
      log('Socket error:', err.message);
    });
  });

  server.listen(SOCKET_PATH, () => {
    log(`Socket server listening on ${SOCKET_PATH}`);
    // SECURITY: Set socket permissions to user-only (0600)
    try {
      chmodSync(SOCKET_PATH, 0o600);
      log('Socket permissions set to 0600 (user only)');
    } catch (e) {
      log('Warning: Could not set socket permissions:', e.message);
    }

    // SECURITY: Write auth token to file for MCP server to read
    try {
      writeFileSync(AUTH_TOKEN_FILE, SOCKET_AUTH_TOKEN, { mode: 0o600 });
      log(`Auth token written to ${AUTH_TOKEN_FILE}`);
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
  process.exit(1);
});
