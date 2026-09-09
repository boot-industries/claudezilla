/**
 * Claudezilla MCP -> host socket transport
 *
 * The request/response state machine for a single command, extracted from
 * server.js so it can be exercised against a fake host in `node --test tests/`.
 * Deliberately free of MCP SDK imports and of any module-level side effects:
 * importing this file must not start a server or open a socket.
 */

import { connect } from 'net';
import { socketTimeoutMs } from '../host/ipc.js';

/**
 * Send one command over the host socket and settle on the first outcome
 * (response, socket error, close, or idle timeout).
 *
 * SECURITY: The auth token is supplied by the caller, which reads it from the
 * host-created file on every command so host restarts are picked up.
 *
 * @param {Object} options
 * @param {string} options.command - Command name
 * @param {Object} [options.params] - Command params (may carry `_timeout`)
 * @param {string} options.authToken - Token read from the host's token file
 * @param {string} options.socketPath - Unix socket path or Windows named pipe
 * @param {number} [options.timeoutMs] - Socket idle timeout; defaults to the
 *   command's own timeout plus the shared grace period
 * @param {(errCode: string) => string} [options.describeError] - Maps a socket
 *   error code to a user-facing message
 * @returns {Promise<Object>} Parsed host response
 */
export function requestOverSocket({
  command,
  params = {},
  authToken,
  socketPath,
  timeoutMs,
  describeError = (errCode) => `Claudezilla error: ${errCode}`,
}) {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = '';
    let resolved = false;

    // Per-operation timeout support (default: 150s + grace)
    const idleTimeoutMs = timeoutMs ?? socketTimeoutMs(params);
    socket.setTimeout(idleTimeoutMs);

    function cleanup() {
      socket.removeAllListeners();
      socket.destroy();
    }

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
          cleanup();
          resolve(response);
        } catch (e) {
          resolved = true;
          cleanup();
          reject(new Error('Invalid response from Claudezilla host: ' + e.message));
        }
      }
    });

    socket.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      // Preserve the error code for retry logic
      const wrappedErr = new Error(describeError(err.code));
      wrappedErr.code = err.code;
      cleanup();
      reject(wrappedErr);
    });

    socket.on('close', () => {
      // If socket closes before we got a response, try parsing buffer
      if (!resolved && buffer) {
        try {
          const response = JSON.parse(buffer.trim());
          resolved = true;
          resolve(response);
          return;
        } catch (e) {
          console.error('Parse error in close handler:', e.message);
        }
      }

      // Socket closed with no usable response — e.g. the host's own idle
      // timeout fired while the command was still in flight with the
      // extension. Settle here or the caller waits forever: 'timeout' never
      // fires on a closed socket, so this is the last chance to reject.
      if (!resolved) {
        resolved = true;
        const err = new Error(
          `Claudezilla host closed the connection without responding (command: ${command}). ` +
          `The extension may never have answered — check the host debug log.`
        );
        err.code = 'HOST_CLOSED';
        cleanup();
        reject(err);
      }
    });

    socket.on('timeout', () => {
      if (!resolved) {
        resolved = true;
        const err = new Error(`Connection timed out after ${idleTimeoutMs}ms (command: ${command})`);
        cleanup();
        reject(err);
      }
    });
  });
}
