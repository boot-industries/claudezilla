/**
 * Tests for mcp/socket-request.js — the MCP -> host command exchange
 * Run with: node --test tests/
 *
 * Every case drives the real transport against a fake host on a throwaway
 * socket (Unix) or named pipe (Windows). No dependencies required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requestOverSocket } from '../mcp/socket-request.js';
import { isWindows } from '../host/ipc.js';

function ipcPath() {
  return isWindows()
    ? `\\\\.\\pipe\\claudezilla-test-${randomUUID()}`
    : join(tmpdir(), `claudezilla-test-${randomUUID()}.sock`);
}

/**
 * Fake host. `onRequest(request, socket)` is called once the newline-delimited
 * command has been read, and decides what — if anything — comes back.
 */
async function startFakeHost(onRequest) {
  const path = ipcPath();
  const sockets = new Set();

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {}); // client destroys its end; not a test failure

    let buffer = '';
    socket.on('data', (data) => {
      buffer += data.toString();
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const request = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      onRequest(request, socket);
    });
  });

  await new Promise((resolve) => server.listen(path, resolve));

  return {
    path,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

describe('requestOverSocket', () => {
  it('forwards command, params and auth token, and resolves with the response', async () => {
    let seen;
    const host = await startFakeHost((request, socket) => {
      seen = request;
      socket.write(JSON.stringify({ success: true, result: { pong: true } }) + '\n');
    });

    try {
      const response = await requestOverSocket({
        command: 'ping',
        params: { _timeout: 10000 },
        authToken: 'token-abc',
        socketPath: host.path,
      });

      assert.deepEqual(seen, {
        command: 'ping',
        params: { _timeout: 10000 },
        authToken: 'token-abc',
      });
      assert.deepEqual(response, { success: true, result: { pong: true } });
    } finally {
      await host.close();
    }
  });

  // Regression: a command the extension never answers had its socket closed by
  // the host's idle timeout. 'timeout' does not fire on a closed socket and the
  // close handler only settled when it had buffered data, so the caller hung —
  // observed at 8+ minutes on a click that had already committed server-side.
  // The generous `timeout` here is the point: a hang must fail, not stall CI.
  it('rejects with HOST_CLOSED when the host closes without responding', { timeout: 5000 }, async () => {
    const host = await startFakeHost((_request, socket) => {
      socket.end();
    });

    try {
      // No timeoutMs: the default is 155s, so only the close handler can settle
      // this in time. Racing a short timer rather than leaning on the test
      // runner's timeout keeps a regression a clean failure instead of a hang.
      const request = requestOverSocket({
        command: 'click',
        params: {},
        authToken: 'token-abc',
        socketPath: host.path,
      });
      const settled = await Promise.race([
        request.then(() => 'resolved', (err) => err),
        new Promise((resolve) => setTimeout(() => resolve('hung'), 2000).unref()),
      ]);

      assert.notEqual(settled, 'hung', 'the request never settled after the host closed the socket');
      assert.notEqual(settled, 'resolved', 'an empty close must not look like a successful response');
      assert.equal(settled.code, 'HOST_CLOSED');
      assert.match(settled.message, /closed the connection without responding \(command: click\)/);
    } finally {
      await host.close();
    }
  });

  it('still resolves a response flushed only when the socket closes', { timeout: 5000 }, async () => {
    const host = await startFakeHost((_request, socket) => {
      socket.end(JSON.stringify({ success: true, result: 'no trailing newline' }));
    });

    try {
      const response = await requestOverSocket({
        command: 'version',
        authToken: 'token-abc',
        socketPath: host.path,
      });
      assert.deepEqual(response, { success: true, result: 'no trailing newline' });
    } finally {
      await host.close();
    }
  });

  it('rejects with the connection error code, described by the caller', { timeout: 5000 }, async () => {
    await assert.rejects(
      requestOverSocket({
        command: 'ping',
        authToken: 'token-abc',
        socketPath: ipcPath(), // nothing is listening
        describeError: (errCode) => `described: ${errCode}`,
      }),
      (err) => {
        assert.ok(typeof err.code === 'string' && err.code.length > 0);
        assert.equal(err.message, `described: ${err.code}`);
        return true;
      },
    );
  });

  it('rejects on idle timeout when the host answers nothing and holds the socket open', { timeout: 5000 }, async () => {
    const host = await startFakeHost(() => {
      // Hold the connection open and say nothing.
    });

    try {
      await assert.rejects(
        requestOverSocket({
          command: 'screenshot',
          authToken: 'token-abc',
          socketPath: host.path,
          timeoutMs: 100,
        }),
        /Connection timed out after 100ms \(command: screenshot\)/,
      );
    } finally {
      await host.close();
    }
  });
});
