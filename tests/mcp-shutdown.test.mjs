import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVER_JS = new URL('../mcp/server.js', import.meta.url).pathname;

// Fake host on a private CLAUDEZILLA_IPC_DIR that answers every command and
// counts goodbyes.
function startFakeHost() {
  const dir = mkdtempSync(join(tmpdir(), 'clz-shutdown-'));
  writeFileSync(join(dir, 'claudezilla-auth.token'), 'x'.repeat(64), { mode: 0o600 });
  const counts = { goodbye: 0 };
  const server = createServer((socket) => {
    let buffer = '';
    socket.on('data', (data) => {
      buffer += data;
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) return;
      const message = JSON.parse(buffer.slice(0, newlineIndex));
      if (message.command === 'goodbye') counts.goodbye++;
      socket.end(JSON.stringify({ success: true, result: { tabsClosed: 0 } }) + '\n');
    });
  });
  return new Promise((resolve) => {
    server.listen(join(dir, 'claudezilla.sock'), () => resolve({ dir, server, counts }));
  });
}

describe('MCP server shutdown', { skip: process.platform === 'win32' }, () => {
  it('exits after a single goodbye when the client closes stdin', async () => {
    const host = await startFakeHost();
    try {
      const child = spawn(process.execPath, [SERVER_JS], {
        env: { ...process.env, CLAUDEZILLA_IPC_DIR: host.dir },
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));

      await new Promise((resolve) => setTimeout(resolve, 500));
      child.stdin.end();

      const code = await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 3000)),
      ]);
      if (code === 'timeout') child.kill('SIGKILL');

      assert.equal(code, 0, 'the server exits on its own once the client is gone');
      assert.equal(host.counts.goodbye, 1, 'goodbye is sent exactly once, not in a loop');
    } finally {
      host.server.close();
      rmSync(host.dir, { recursive: true, force: true });
    }
  });
});
