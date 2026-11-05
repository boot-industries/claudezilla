import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendDebugLog } from '../host/debug-log.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'clz-debuglog-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('host debug log', () => {
  it('creates the log with owner-only permissions', { skip: process.platform === 'win32' }, () => {
    withTempDir((dir) => {
      const path = join(dir, 'debug.log');
      appendDebugLog(path, 'first\n', 1024);

      assert.equal(readFileSync(path, 'utf8'), 'first\n');
      assert.equal(statSync(path).mode & 0o777, 0o600);
    });
  });

  it('rotates to .1 once the cap would be exceeded', () => {
    withTempDir((dir) => {
      const path = join(dir, 'debug.log');
      const line = 'x'.repeat(99) + '\n'; // 100 bytes
      for (let i = 0; i < 10; i++) appendDebugLog(path, line, 1000);
      assert.equal(existsSync(`${path}.1`), false, 'exactly at the cap: no rotation yet');

      appendDebugLog(path, 'next\n', 1000);

      assert.equal(readFileSync(`${path}.1`, 'utf8'), line.repeat(10));
      assert.equal(readFileSync(path, 'utf8'), 'next\n');
    });
  });

  it('keeps disk use bounded under a flood of writes', () => {
    withTempDir((dir) => {
      const path = join(dir, 'debug.log');
      const line = 'y'.repeat(49) + '\n'; // 50 bytes
      for (let i = 0; i < 5000; i++) appendDebugLog(path, line, 1000);

      assert.ok(statSync(path).size <= 1000);
      assert.ok(statSync(`${path}.1`).size <= 1000);
    });
  });
});
