import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const contentSource = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');

function createContentScriptHarness({ storageDelayMs = 20, initialAllowEvaluate = true } = {}) {
  let runtimeListener = null;

  const storageListeners = [];
  const storageArea = {
    async get(key) {
      if (storageDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, storageDelayMs));
      }
      if (key === 'claudezilla') {
        return {
          claudezilla: {
            allowEvaluate: initialAllowEvaluate,
            showWatermark: false,
            showFocusglow: false,
          },
        };
      }
      return {};
    },
  };

  const browser = {
    runtime: {
      onMessage: {
        addListener(listener) {
          runtimeListener = listener;
        },
      },
    },
    storage: {
      local: storageArea,
      onChanged: {
        addListener(cb) {
          storageListeners.push(cb);
        },
      },
    },
  };

  const mockDocument = {
    title: 'Test Page',
    readyState: 'complete',
    head: { appendChild() {}, querySelector() { return null; } },
    body: { appendChild() {}, removeChild() {} },
    importNode(node) {
      return node;
    },
    createElement() {
      const elem = {
        style: {},
        dataset: {},
        setAttribute() {},
        getAttribute() { return null; },
        appendChild() {},
        removeChild() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {},
        removeEventListener() {},
        getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0 }; },
        attachShadow() {
          return {
            appendChild() {},
            querySelector() { return null; },
            querySelectorAll() { return []; },
          };
        },
      };
      return elem;
    },
  };
  const windowObj = {
    location: { href: 'https://example.com' },
    innerWidth: 1024,
    innerHeight: 768,
    scrollX: 0,
    scrollY: 0,
    addEventListener() {},
    removeEventListener() {},
  };
  windowObj.window = windowObj;
  windowObj.top = windowObj;

  const context = vm.createContext({
    browser,
    window: windowObj,
    document: mockDocument,
    console: {
      log() {},
      warn() {},
      error() {},
      info() {},
      debug() {},
    },
    setInterval,
    clearInterval,
    DOMParser: class {
      parseFromString() {
        return {
          documentElement: {
            querySelector() { return null; },
            querySelectorAll() { return []; },
          },
        };
      }
    },
  });

  vm.runInContext(contentSource, context);

  return {
    sendMessage(message) {
      assert.ok(runtimeListener, 'Runtime message listener was not registered');
      return new Promise((resolve) => {
        const sendResponse = (val) => {
          resolve(val);
        };
        runtimeListener(message, {}, sendResponse);
      });
    },
  };
}

describe('content.js evaluate settings race', () => {
  it('awaits storage settings before checking evaluate gate on first command', async () => {
    // With 30ms artificial storage read delay, sending evaluate immediately should still succeed
    const harness = createContentScriptHarness({ storageDelayMs: 30, initialAllowEvaluate: true });

    // Enable Claudezilla visuals first (which triggers initVisuals / ensureSettingsLoaded)
    await harness.sendMessage({ action: 'enableClaudezillaVisuals' });

    // Immediately dispatch evaluate command without waiting for storage to resolve
    const res = await harness.sendMessage({
      action: 'evaluate',
      params: { expression: '2 + 3' },
    });

    assert.ok(res, 'Should receive a response from evaluate');
    assert.equal(res.success, true, `Expected success but got error: ${res.error}`);
    assert.equal(res.result.result, 5);
  });

  it('rejects evaluate if allowEvaluate is disabled in storage', async () => {
    const harness = createContentScriptHarness({ storageDelayMs: 10, initialAllowEvaluate: false });
    await harness.sendMessage({ action: 'enableClaudezillaVisuals' });

    const res = await harness.sendMessage({
      action: 'evaluate',
      params: { expression: '2 + 3' },
    });
    assert.equal(res.success, false);
    assert.match(res.error, /firefox_evaluate is disabled/);
  });
});
