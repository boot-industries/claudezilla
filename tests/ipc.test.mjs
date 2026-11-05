/**
 * Tests for host/ipc.js path validation
 * Run with: node --test tests/
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validatePath,
  isWindows,
  commandTimeoutMs,
  socketTimeoutMs,
  DEFAULT_COMMAND_TIMEOUT_MS,
  SOCKET_TIMEOUT_GRACE_MS,
  getSafeTempDir,
  getSocketPath,
  getAuthTokenPath,
  getDebugLogPath,
  quitBrowserAllowed,
} from '../host/ipc.js';

describe('validatePath', () => {
  it('accepts a plain absolute Unix path', () => {
    assert.equal(validatePath('/tmp/claudezilla.sock'), true);
  });

  it('rejects empty string', () => {
    assert.throws(() => validatePath(''), /empty or invalid/);
  });

  it('rejects null and undefined', () => {
    assert.throws(() => validatePath(null), /empty or invalid/);
    assert.throws(() => validatePath(undefined), /empty or invalid/);
  });

  it('rejects non-string types', () => {
    assert.throws(() => validatePath(42), /empty or invalid/);
    assert.throws(() => validatePath({}), /empty or invalid/);
  });

  it('rejects null-byte injection', () => {
    assert.throws(() => validatePath('/tmp/foo\0bar'), /null byte/);
  });

  it('rejects path traversal sequences', () => {
    assert.throws(() => validatePath('/tmp/../etc/passwd'), /path traversal/);
    assert.throws(() => validatePath('..'), /path traversal/);
  });

  it('includes the context string in error messages', () => {
    assert.throws(
      () => validatePath('/foo\0', 'auth token'),
      /auth token contains null byte/,
    );
  });

  if (!isWindows()) {
    it('accepts double-slash prefixes on Unix (only blocked on Windows)', () => {
      assert.equal(validatePath('//tmp/sock'), true);
    });
  }
});

describe('command timeout policy', () => {
  it('honours a _timeout inside the documented 5s-300s range', () => {
    assert.equal(commandTimeoutMs({ _timeout: 30000 }), 30000);
    assert.equal(commandTimeoutMs({ _timeout: 5000 }), 5000);
    assert.equal(commandTimeoutMs({ _timeout: 300000 }), 300000);
  });

  it('falls back to the default outside that range', () => {
    assert.equal(commandTimeoutMs({ _timeout: 4999 }), DEFAULT_COMMAND_TIMEOUT_MS);
    assert.equal(commandTimeoutMs({ _timeout: 300001 }), DEFAULT_COMMAND_TIMEOUT_MS);
    assert.equal(commandTimeoutMs({ _timeout: 0 }), DEFAULT_COMMAND_TIMEOUT_MS);
    assert.equal(commandTimeoutMs({ _timeout: 'soon' }), DEFAULT_COMMAND_TIMEOUT_MS);
  });

  it('tolerates missing, empty and null params', () => {
    assert.equal(commandTimeoutMs(), DEFAULT_COMMAND_TIMEOUT_MS);
    assert.equal(commandTimeoutMs({}), DEFAULT_COMMAND_TIMEOUT_MS);
    assert.equal(commandTimeoutMs(null), DEFAULT_COMMAND_TIMEOUT_MS);
  });

  it('gives the socket a grace period above the command it carries', () => {
    // The per-request timer must be able to fire and report first; the socket
    // idle timeout is only a backstop behind it.
    assert.equal(socketTimeoutMs({ _timeout: 30000 }), 30000 + SOCKET_TIMEOUT_GRACE_MS);
    assert.equal(socketTimeoutMs(), DEFAULT_COMMAND_TIMEOUT_MS + SOCKET_TIMEOUT_GRACE_MS);
    assert.ok(socketTimeoutMs({ _timeout: 30000 }) > commandTimeoutMs({ _timeout: 30000 }));
  });
});

describe('quitBrowserAllowed', () => {
  it('allows the quit only when CLAUDEZILLA_ALLOW_QUIT is 1 or true, in any case', () => {
    assert.equal(quitBrowserAllowed({ CLAUDEZILLA_ALLOW_QUIT: '1' }), true);
    assert.equal(quitBrowserAllowed({ CLAUDEZILLA_ALLOW_QUIT: 'true' }), true);
    assert.equal(quitBrowserAllowed({ CLAUDEZILLA_ALLOW_QUIT: 'TRUE' }), true);
  });

  it('refuses when the variable is unset or carries any other value', () => {
    assert.equal(quitBrowserAllowed({}), false);
    assert.equal(quitBrowserAllowed({ CLAUDEZILLA_ALLOW_QUIT: '0' }), false);
    assert.equal(quitBrowserAllowed({ CLAUDEZILLA_ALLOW_QUIT: 'yes' }), false);
  });

  it('reads the host process environment by default', () => {
    const saved = process.env.CLAUDEZILLA_ALLOW_QUIT;
    try {
      delete process.env.CLAUDEZILLA_ALLOW_QUIT;
      assert.equal(quitBrowserAllowed(), false);
      process.env.CLAUDEZILLA_ALLOW_QUIT = '1';
      assert.equal(quitBrowserAllowed(), true);
    } finally {
      if (saved === undefined) delete process.env.CLAUDEZILLA_ALLOW_QUIT;
      else process.env.CLAUDEZILLA_ALLOW_QUIT = saved;
    }
  });
});

describe('CLAUDEZILLA_IPC_DIR', { skip: isWindows() }, () => {
  function withOverride(value, fn) {
    const saved = process.env.CLAUDEZILLA_IPC_DIR;
    process.env.CLAUDEZILLA_IPC_DIR = value;
    try {
      fn();
    } finally {
      if (saved === undefined) delete process.env.CLAUDEZILLA_IPC_DIR;
      else process.env.CLAUDEZILLA_IPC_DIR = saved;
    }
  }

  it('puts the socket, token and debug log in the override directory, creating it', () => {
    const base = mkdtempSync(join(tmpdir(), 'cz-ipc-'));
    const dir = join(base, 'second-browser');
    try {
      withOverride(dir, () => {
        assert.equal(getSocketPath(), join(dir, 'claudezilla.sock'));
        assert.equal(getAuthTokenPath(), join(dir, 'claudezilla-auth.token'));
        assert.equal(getDebugLogPath(), join(dir, 'claudezilla-debug.log'));
        assert.equal(statSync(dir).mode & 0o777, 0o700);
      });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('chmods an existing override directory to 0700', () => {
    const base = mkdtempSync(join(tmpdir(), 'cz-ipc-'));
    const dir = join(base, 'existing');
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);
    try {
      withOverride(dir, () => {
        assert.equal(getSocketPath(), join(dir, 'claudezilla.sock'));
      });
      assert.equal(statSync(dir).mode & 0o777, 0o700);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('falls back to the default location when the override is invalid', () => {
    withOverride('/tmp/../etc', () => {
      assert.notEqual(getSocketPath(), '/tmp/../etc/claudezilla.sock');
      assert.equal(getSocketPath(), join(getSafeTempDir(), 'claudezilla.sock'));
    });
  });
});
