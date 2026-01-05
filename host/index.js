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
import { appendFileSync, unlinkSync, existsSync } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';

const DEBUG_LOG = join(tmpdir(), 'claudezilla-debug.log');
const SOCKET_PATH = join(tmpdir(), 'claudezilla.sock');

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
]);

// Log to stderr and debug file
function log(...args) {
  const msg = `[${new Date().toISOString()}] [claudezilla-host] ${args.join(' ')}\n`;
  console.error('[claudezilla-host]', ...args);
  try {
    appendFileSync(DEBUG_LOG, msg);
  } catch (e) {
    // ignore
  }
}

log('Script starting, cwd:', process.cwd());

// Track pending requests from CLI
const pendingCliRequests = new Map();
let requestId = 0;

/**
 * Handle command from CLI (via socket)
 * SECURITY: Validates command against whitelist
 */
function handleCliCommand(command, params, callback) {
  // SECURITY: Reject non-whitelisted commands
  if (!ALLOWED_COMMANDS.has(command)) {
    callback({ success: false, error: `Command not allowed: ${command}` });
    return;
  }

  const id = ++requestId;

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
        host: '0.4.0',
        node: process.version,
        platform: process.platform,
        features: ['devtools', 'network', 'console', 'evaluate'],
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

      // Process complete JSON messages (newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const { command, params = {} } = JSON.parse(line);

          log(`CLI command: ${command}`);

          handleCliCommand(command, params, (response) => {
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

  if (existsSync(SOCKET_PATH)) {
    unlinkSync(SOCKET_PATH);
  }

  process.exit(0);
}

// Handle signals gracefully
process.on('SIGTERM', () => {
  log('Received SIGTERM');
  if (existsSync(SOCKET_PATH)) {
    unlinkSync(SOCKET_PATH);
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  log('Received SIGINT');
  if (existsSync(SOCKET_PATH)) {
    unlinkSync(SOCKET_PATH);
  }
  process.exit(0);
});

main().catch((error) => {
  log('Unhandled error:', error);
  process.exit(1);
});
