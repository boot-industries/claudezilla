import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isWindows } from '../host/ipc.js';

function parseResponses(stdout) {
  return stdout.split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

// Sends initialize + tools/list, then `requests`. Resolves as soon as the last
// request is answered, or after `waitMs` at the latest.
function runServerRpc(args = [], env = {}, { requests = [], waitMs = 400 } = {}) {
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

    const allRequests = [initReq, listReq, ...requests];
    const lastId = allRequests[allRequests.length - 1].id;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      resolve({ stdout, stderr });
    };
    const timer = setTimeout(finish, waitMs);
    child.stdout.on('data', () => {
      if (parseResponses(stdout).some(r => r.id === lastId)) finish();
    });

    for (const req of allRequests) {
      child.stdin.write(JSON.stringify(req) + '\n');
    }
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

// POSIX only: the socket location is driven by CLAUDEZILLA_IPC_DIR, which
// Windows ignores (fixed named pipe).
describe('mcp server autostart and tool discovery', { skip: isWindows() }, () => {
  // A fresh, empty IPC dir: no host socket, no auth token. The start command
  // writes a marker file, so "did the browser get started" is a file check.
  function autostartEnv() {
    const ipcDir = mkdtempSync(join(tmpdir(), 'cz-discovery-'));
    const marker = join(ipcDir, 'started');
    const env = {
      CLAUDEZILLA_TOOL_MODE: 'all',
      CLAUDEZILLA_IPC_DIR: ipcDir,
      CLAUDEZILLA_AUTOSTART_CMD: JSON.stringify([
        process.execPath, '-e', "require('fs').writeFileSync(process.argv[1], 'started')", marker,
      ]),
      CLAUDEZILLA_AUTOSTART_WAIT_MS: '200',
      CLAUDEZILLA_AUTOSTART_RETRY_COOLDOWN_MS: '0',
    };
    return { env, marker, cleanup: () => rmSync(ipcDir, { recursive: true, force: true }) };
  }

  it('tools/list never starts the browser and keeps firefox_navigate (fail open)', async () => {
    const { env, marker, cleanup } = autostartEnv();
    try {
      const { stdout } = await runServerRpc([], env, { waitMs: 5000 });
      const listResp = parseResponses(stdout).find(l => l.id === 2);
      assert.ok(listResp, 'Did not receive response for tools/list');
      const toolNames = listResp.result.tools.map(t => t.name);
      assert.ok(toolNames.includes('firefox_navigate'), 'firefox_navigate must stay listed when the host is down');
      assert.equal(existsSync(marker), false, 'tools/list must not run CLAUDEZILLA_AUTOSTART_CMD');
    } finally {
      cleanup();
    }
  });

  it('the first tool call starts the browser', async () => {
    const { env, marker, cleanup } = autostartEnv();
    try {
      const callReq = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'firefox_get_tabs', arguments: {} },
      };
      const { stdout } = await runServerRpc([], env, { requests: [callReq], waitMs: 5000 });
      const callResp = parseResponses(stdout).find(l => l.id === 3);
      assert.ok(callResp, 'Did not receive response for tools/call');
      // No host comes up, so the call itself fails; the start command still ran.
      assert.equal(existsSync(marker), true, 'tools/call must run CLAUDEZILLA_AUTOSTART_CMD');
    } finally {
      cleanup();
    }
  });
});
