import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

function runServerRpc(args = [], env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['mcp/server.js', ...args], {
      cwd: new URL('../', import.meta.url).pathname,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    // Send initialize request followed by tools/list
    const initReq = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0' },
      },
    };
    const listReq = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    };

    child.stdin.write(JSON.stringify(initReq) + '\n');
    child.stdin.write(JSON.stringify(listReq) + '\n');

    setTimeout(() => {
      child.stdin.end();
      child.kill();
      resolve({ stdout, stderr });
    }, 400);
  });
}

describe('mcp server tool discovery policy', () => {
  it('exposes only firefox_activate in default lazy mode', async () => {
    const { stdout } = await runServerRpc([], { CLAUDEZILLA_TOOL_MODE: 'lazy' });
    const lines = stdout.split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    const listResp = lines.find(l => l.id === 2);
    assert.ok(listResp, 'Did not receive response for tools/list');
    const toolNames = listResp.result.tools.map(t => t.name);
    assert.deepEqual(toolNames, ['firefox_activate']);
  });

  it('exposes all tools when --all-tools flag is passed', async () => {
    const { stdout } = await runServerRpc(['--all-tools']);
    const lines = stdout.split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    const listResp = lines.find(l => l.id === 2);
    assert.ok(listResp, 'Did not receive response for tools/list');
    const toolNames = listResp.result.tools.map(t => t.name);
    assert.ok(toolNames.includes('firefox_activate'));
    assert.ok(toolNames.includes('firefox_create_window'));
    assert.ok(toolNames.includes('firefox_screenshot'));
    assert.ok(toolNames.includes('firefox_get_page_state'));
    assert.ok(toolNames.length > 20, `Expected >20 tools but got ${toolNames.length}`);
  });

  it('exposes all tools when CLAUDEZILLA_TOOL_MODE=all is set in environment', async () => {
    const { stdout } = await runServerRpc([], { CLAUDEZILLA_TOOL_MODE: 'all' });
    const lines = stdout.split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    const listResp = lines.find(l => l.id === 2);
    assert.ok(listResp);
    const toolNames = listResp.result.tools.map(t => t.name);
    assert.ok(toolNames.includes('firefox_screenshot'));
    assert.ok(toolNames.length > 20);
  });
});
