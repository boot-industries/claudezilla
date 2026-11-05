import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVER_JS = new URL('../mcp/server.js', import.meta.url).pathname;

// Fake host: records every command's params and answers from `replies`
// (command name -> function(params) returning the response body).
function startFakeHost(replies) {
  const dir = mkdtempSync(join(tmpdir(), 'clz-tab-'));
  writeFileSync(join(dir, 'claudezilla-auth.token'), 'x'.repeat(64), { mode: 0o600 });
  const received = [];
  const server = createServer((socket) => {
    let buffer = '';
    socket.on('data', (data) => {
      buffer += data;
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) return;
      const message = JSON.parse(buffer.slice(0, newlineIndex));
      received.push({ command: message.command, params: message.params });
      const body = replies[message.command]?.(message.params) ?? { success: true, result: {} };
      socket.end(JSON.stringify(body) + '\n');
    });
  });
  return new Promise((resolve) => {
    server.listen(join(dir, 'claudezilla.sock'), () => resolve({ dir, server, received }));
  });
}

// Minimal sequential MCP client over stdio.
function startClient(env) {
  const child = spawn(process.execPath, [SERVER_JS], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const waiting = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    }
  });
  let nextId = 1;
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`no response to ${method}`)), 5000);
    waiting.set(id, (message) => { clearTimeout(timer); resolve(message); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return {
    child,
    request,
    async init() {
      await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0' },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    },
    call: (name, args = {}) => request('tools/call', { name, arguments: args }),
    close: () => child.kill(),
  };
}

const tabIdsFor = (host, command) => host.received.filter((r) => r.command === command).map((r) => r.params.tabId);

describe('MCP current tab per agent', { skip: process.platform === 'win32' }, () => {
  async function withHost(replies, fn) {
    const host = await startFakeHost(replies);
    const client = startClient({ CLAUDEZILLA_IPC_DIR: host.dir });
    try {
      await client.init();
      await fn(host, client);
    } finally {
      client.close();
      host.server.close();
      rmSync(host.dir, { recursive: true, force: true });
    }
  }

  it('targets the tab this agent opened when tabId is omitted, and not after closing it', async () => {
    await withHost({
      createWindow: () => ({ success: true, result: { tabId: 5 } }),
      closeTab: () => ({ success: true, result: { closed: true } }),
    }, async (host, client) => {
      await client.call('firefox_create_window', { url: 'https://example.test/' });
      await client.call('firefox_get_content', {});
      await client.call('firefox_get_content', { tabId: 9 });
      await client.call('firefox_close_tab', { tabId: 5 });
      await client.call('firefox_get_content', {});

      assert.deepEqual(tabIdsFor(host, 'getContent'), [5, 9, undefined]);
    });
  });

  it('follows the tab returned by the latest call', async () => {
    await withHost({
      createWindow: () => ({ success: true, result: { tabId: 5 } }),
      attachTab: (params) => ({ success: true, result: { attached: true, tabId: params.tabId } }),
    }, async (host, client) => {
      await client.call('firefox_create_window', { url: 'https://example.test/' });
      await client.call('firefox_attach_tab', { tabId: 42 });
      await client.call('firefox_click', { selector: '#go' });

      assert.deepEqual(tabIdsFor(host, 'click'), [42]);
    });
  });

  it('explains a vanished current tab, forgets it, and ignores a selector miss', async () => {
    let miss = true;
    await withHost({
      createWindow: () => ({ success: true, result: { tabId: 5 } }),
      click: () => (miss
        ? { success: false, error: 'Element not found: #nope' }
        : { success: false, error: 'TAB_UNAVAILABLE: Could not retrieve active tab.' }),
    }, async (host, client) => {
      await client.call('firefox_create_window', { url: 'https://example.test/' });

      const selectorMiss = await client.call('firefox_click', { selector: '#nope' });
      assert.equal(selectorMiss.result.isError, true);
      assert.doesNotMatch(selectorMiss.result.content[0].text, /your current tab/);

      miss = false;
      const gone = await client.call('firefox_click', { selector: '#go' });
      assert.match(gone.result.content[0].text, /your current tab 5 is gone: call firefox_get_tabs or firefox_create_window/);

      await client.call('firefox_click', { selector: '#go' });
      assert.deepEqual(tabIdsFor(host, 'click'), [5, 5, undefined]);
    });
  });
});
