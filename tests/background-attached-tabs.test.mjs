import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const backgroundSource = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

function event() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    emit(...args) {
      return listeners.map((listener) => listener(...args));
    },
  };
}

function createHarness({ storage: initialStorage = {}, windowGetGate = Promise.resolve(), allowTabCreate = false, tabs: seededTabs = null, incognitoAccess = true } = {}) {
  const storage = structuredClone(initialStorage);
  const tabs = new Map((seededTabs ?? [
    {
      id: 42,
      windowId: 7,
      url: 'https://example.test/already-open',
      title: 'Already open',
      active: true,
      pinned: false,
      incognito: false,
    },
  ]).map((tab) => [tab.id, { ...tab }]));
  const calls = { tabsCreated: 0, windowsCreated: 0, contentActions: [], tabCreateOptions: [], tabUpdates: [], captures: { tab: [], visible: [] } };
  let resolveWindowGetStarted;
  const windowGetStarted = new Promise((resolve) => { resolveWindowGetStarted = resolve; });
  const nativeMessages = event();
  const nativeDisconnects = event();
  const runtimeMessages = event();
  const tabsRemoved = event();
  const tabsUpdated = event();
  const tabsActivated = event();
  const windowsRemoved = event();
  const responses = new Map();

  const port = {
    onMessage: nativeMessages,
    onDisconnect: nativeDisconnects,
    postMessage(message) {
      const resolve = responses.get(message.id);
      if (resolve && Object.hasOwn(message, 'success')) {
        responses.delete(message.id);
        resolve(message);
      }
    },
  };

  const browser = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') return { [key]: storage[key] };
          return structuredClone(storage);
        },
        async set(values) {
          Object.assign(storage, structuredClone(values));
        },
      },
    },
    runtime: {
      connectNative() {
        return port;
      },
      getManifest() {
        return { version: 'test' };
      },
      onMessage: runtimeMessages,
      getURL(path) {
        return `moz-extension://test/${path}`;
      },
    },
    extension: {
      async isAllowedIncognitoAccess() {
        return incognitoAccess;
      },
    },
    webRequest: {
      onBeforeRequest: event(),
      onCompleted: event(),
      onErrorOccurred: event(),
    },
    windows: {
      onRemoved: windowsRemoved,
      async get(windowId, options = {}) {
        resolveWindowGetStarted();
        await windowGetGate;
        if (windowId !== 7) throw new Error('window not found');
        return {
          id: 7,
          incognito: false,
          tabs: options.populate ? [...tabs.values()] : undefined,
        };
      },
      async getLastFocused() {
        return { id: 7, incognito: false, tabs: [...tabs.values()] };
      },
      async create() {
        calls.windowsCreated += 1;
        throw new Error('test forbids creating windows');
      },
      async update() {
        return { id: 7, width: 1280, height: 800 };
      },
      async remove() {},
    },
    tabs: {
      onRemoved: tabsRemoved,
      onUpdated: tabsUpdated,
      onActivated: tabsActivated,
      async get(tabId) {
        const tab = tabs.get(Number(tabId));
        if (!tab) throw new Error('tab not found');
        return { ...tab };
      },
      async query(query = {}) {
        return [...tabs.values()]
          .filter((tab) => query.windowId === undefined || tab.windowId === query.windowId)
          .filter((tab) => !query.active || tab.active)
          .map((tab) => ({ ...tab }));
      },
      async create(options = {}) {
        calls.tabsCreated += 1;
        if (!allowTabCreate) throw new Error('test forbids creating tabs');
        calls.tabCreateOptions.push(structuredClone(options));
        const id = 100 + calls.tabsCreated;
        const tab = {
          id,
          windowId: options.windowId,
          url: options.url,
          title: '',
          active: options.active !== false,
          pinned: false,
          incognito: false,
        };
        if (tab.active) {
          for (const other of tabs.values()) {
            if (other.windowId === tab.windowId) other.active = false;
          }
        }
        tabs.set(id, tab);
        return { ...tab };
      },
      async update(tabId, changes) {
        const tab = tabs.get(Number(tabId));
        if (!tab) throw new Error('tab not found');
        calls.tabUpdates.push({ tabId: Number(tabId), changes: structuredClone(changes) });
        Object.assign(tab, changes);
        return { ...tab };
      },
      async remove(tabId) {
        tabs.delete(Number(tabId));
      },
      async sendMessage(tabId, message) {
        if (!tabs.has(Number(tabId))) throw new Error('tab not found');
        calls.contentActions.push(message.action);
        return { success: true, result: { action: message.action, dataUrl: 'data:image/png;base64,resized' } };
      },
      async captureTab(tabId) {
        if (!tabs.has(Number(tabId))) throw new Error('tab not found');
        calls.captures.tab.push(Number(tabId));
        return 'data:image/png;base64,captured';
      },
      async captureVisibleTab(windowId) {
        calls.captures.visible.push(windowId === undefined ? null : windowId);
        return 'data:image/png;base64,visible';
      },
    },
    tabGroups: {
      async query() {
        return [];
      },
      async update() {},
    },
    browserAction: {
      async openPopup() {},
    },
  };

  const context = vm.createContext({
    browser,
    console: { log() {}, error() {} },
    crypto: { randomUUID },
    navigator: { userAgent: 'test' },
    URL,
    setTimeout,
    clearTimeout,
    structuredClone,
  });
  vm.runInContext(backgroundSource, context, { filename: 'extension/background.js' });

  let sequence = 0;
  async function command(commandName, params = {}) {
    const id = `test-${sequence += 1}`;
    const response = new Promise((resolve) => responses.set(id, resolve));
    nativeMessages.emit({ id, type: 'command', command: commandName, params });
    return response;
  }

  return { browser, calls, command, storage, tabsRemoved, windowGetStarted };
}

describe('attached user tabs', () => {
  it('attaches and lists an already-open tab without creating a tab or window', async () => {
    const harness = createHarness();

    const attached = await harness.command('attachTab', { tabId: 42, agentId: 'agent-a' });
    const listed = await harness.command('listAllTabs');

    assert.equal(attached.success, true);
    assert.deepEqual(structuredClone(attached.result), {
      attached: true,
      tabId: 42,
      windowId: 7,
      url: 'https://example.test/already-open',
      title: 'Already open',
    });
    assert.equal(listed.success, true);
    assert.deepEqual(structuredClone(listed.result.tabs), [{
      tabId: 42,
      windowId: 7,
      url: 'https://example.test/already-open',
      title: 'Already open',
      active: true,
      pinned: false,
      private: false,
      pool: false,
      attached: true,
    }]);
    assert.equal(harness.calls.tabsCreated, 0);
    assert.equal(harness.calls.windowsCreated, 0);
  });

  it('shares the attached tab across agents for every tab-targeting command', async () => {
    const harness = createHarness();
    assert.equal((await harness.command('attachTab', { tabId: 42, agentId: 'agent-a' })).success, true);

    const commands = [
      ['getContent', {}],
      ['click', { selector: '#submit' }],
      ['type', { selector: '#name', text: 'Robert' }],
      ['getConsoleLogs', {}],
      ['getNetworkRequests', {}],
      ['scroll', { y: 100 }],
      ['waitFor', { selector: 'main' }],
      ['evaluate', { expression: 'document.title' }],
      ['getElementInfo', { selector: 'main' }],
      ['getPageState', {}],
      ['getAccessibilitySnapshot', {}],
      ['pressKey', { key: 'Enter' }],
      ['handleConsent', {}],
    ];

    for (const [name, params] of commands) {
      const response = await harness.command(name, { ...params, tabId: 42, agentId: 'agent-b' });
      assert.equal(response.success, true, `${name}: ${response.error || 'failed'}`);
      assert.equal(response.result.tabId, 42, name);
    }

    const navigated = await harness.command('navigate', {
      tabId: 42,
      agentId: 'agent-b',
      url: 'https://example.test/next',
    });
    assert.equal(navigated.success, true);
    assert.equal(navigated.result.tabId, 42);

    const screenshot = await harness.command('screenshot', {
      tabId: 42,
      agentId: 'agent-b',
      skipReadiness: true,
      format: 'png',
      scale: 1,
    });
    assert.equal(screenshot.success, true, screenshot.error);
    assert.equal(screenshot.result.tabId, 42);
    assert.equal(screenshot.result.dataUrl, 'data:image/png;base64,captured');
    assert.deepEqual(harness.calls.captures.tab, [42]);
    assert.deepEqual(harness.calls.captures.visible, []);
    assert.equal(harness.calls.tabsCreated, 0);
    assert.equal(harness.calls.windowsCreated, 0);
  });

  it('restores live attachments, removes closed tabs, and detaches without closing them', async () => {
    const first = createHarness();
    assert.equal((await first.command('attachTab', { tabId: 42, agentId: 'agent-a' })).success, true);

    const restored = createHarness({ storage: first.storage });
    const listed = await restored.command('listAllTabs');
    assert.equal(listed.result.tabs[0].attached, true);

    const detached = await restored.command('detachTab', { tabId: 42 });
    assert.deepEqual(structuredClone(detached.result), { detached: true, tabId: 42 });
    assert.equal(await restored.browser.tabs.get(42).then(() => true), true);

    await restored.command('attachTab', { tabId: 42, agentId: 'agent-a' });
    restored.tabsRemoved.emit(42, { windowId: 7 });
    const afterClose = createHarness({ storage: restored.storage });
    const afterCloseList = await afterClose.command('listAllTabs');
    assert.equal(afterCloseList.result.tabs[0].attached, false);
  });

  it('does not reclassify a managed-pool tab as a shared attachment', async () => {
    const harness = createHarness({
      storage: {
        claudezillaWindowState: {
          windowId: 7,
          tabs: [{ tabId: 42, ownerId: 'agent-a' }],
          createdAt: 1,
          groupId: null,
          isPrivate: false,
          adopted: true,
        },
      },
    });

    const response = await harness.command('attachTab', { tabId: 42, agentId: 'agent-b' });

    assert.equal(response.success, false);
    assert.match(response.error, /managed Claudezilla pool/);
  });

  it('drops persisted attachments that collide with managed-pool tabs', async () => {
    const harness = createHarness({
      storage: {
        claudezillaWindowState: {
          windowId: 7,
          tabs: [{ tabId: 42, ownerId: 'agent-a' }],
          createdAt: 1,
          groupId: null,
          isPrivate: false,
          adopted: true,
        },
        claudezillaAttachedTabs: [[42, { ownerId: 'agent-b', attachedAt: 1 }]],
      },
    });

    const listed = await harness.command('listAllTabs');
    const access = await harness.command('getContent', { tabId: 42, agentId: 'agent-b' });

    assert.equal(listed.result.tabs[0].pool, true);
    assert.equal(listed.result.tabs[0].attached, false);
    assert.equal(access.success, false);
    assert.match(access.error, /OWNERSHIP/);
  });

  it('waits for an in-flight managed-window restore before attaching', async () => {
    let releaseWindowGet;
    const windowGetGate = new Promise((resolve) => { releaseWindowGet = resolve; });
    const harness = createHarness({
      windowGetGate,
      storage: {
        claudezillaWindowState: {
          windowId: 7,
          tabs: [{ tabId: 42, ownerId: 'agent-a' }],
          createdAt: 1,
          groupId: null,
          isPrivate: false,
          adopted: true,
        },
      },
    });
    await harness.windowGetStarted;

    const responsePromise = harness.command('attachTab', { tabId: 42, agentId: 'agent-b' });
    await Promise.resolve();
    releaseWindowGet();
    const response = await responsePromise;

    assert.equal(response.success, false);
    assert.match(response.error, /managed Claudezilla pool/);
  });
});

describe('adopted window tab selection', () => {
  it('does not switch the user\'s selected tab when adding an agent tab to an adopted window', async () => {
    const harness = createHarness({
      allowTabCreate: true,
      storage: {
        claudezillaWindowState: {
          windowId: 7,
          tabs: [{ tabId: 42, ownerId: 'agent-a' }],
          createdAt: 1,
          groupId: null,
          isPrivate: false,
          adopted: true,
        },
      },
    });

    const created = await harness.command('createWindow', {
      url: 'https://example.test/agent',
      agentId: 'agent-b',
    });

    assert.equal(created.success, true, created.error);
    assert.equal(harness.calls.tabCreateOptions.length, 1);
    assert.equal(harness.calls.tabCreateOptions[0].active, false);
    assert.equal((await harness.browser.tabs.get(42)).active, true);
  });

  it('in an adopted window, firefox_screenshot captures the agent tab, not the user\'s visible tab', async () => {
    const harness = createHarness({
      tabs: [
        { id: 42, windowId: 7, url: 'https://example.test/user', title: 'User page', active: true, pinned: false, incognito: false },
        { id: 100, windowId: 7, url: 'https://example.test/agent', title: 'Agent page', active: false, pinned: false, incognito: false },
      ],
      storage: {
        claudezillaWindowState: {
          windowId: 7,
          tabs: [{ tabId: 100, ownerId: 'agent-a' }],
          createdAt: 1,
          groupId: null,
          isPrivate: false,
          adopted: true,
        },
      },
    });
    await harness.windowGetStarted;
    await new Promise((resolve) => setTimeout(resolve, 10));

    const screenshot = await harness.command('screenshot', {
      agentId: 'agent-a',
      skipReadiness: true,
      format: 'png',
      scale: 1,
    });

    assert.equal(screenshot.success, true, screenshot.error);
    assert.equal(screenshot.result.tabId, 100);
    assert.equal(screenshot.result.dataUrl, 'data:image/png;base64,captured');
    // The agent's tab was captured directly; the user's visible tab was not.
    assert.deepEqual(harness.calls.captures.tab, [100]);
    assert.deepEqual(harness.calls.captures.visible, []);
    // The user's selection was never taken over.
    assert.equal((await harness.browser.tabs.get(42)).active, true);
  });

  it('in a dedicated window, firefox_screenshot still uses captureVisibleTab for the selected tab', async () => {
    const harness = createHarness({
      tabs: [
        { id: 100, windowId: 7, url: 'https://example.test/agent', title: 'Agent page', active: true, pinned: false, incognito: false },
      ],
      storage: {
        claudezillaWindowState: {
          windowId: 7,
          tabs: [{ tabId: 100, ownerId: 'agent-a' }],
          createdAt: 1,
          groupId: null,
          isPrivate: false,
          adopted: false,
        },
      },
    });
    await harness.windowGetStarted;
    await new Promise((resolve) => setTimeout(resolve, 10));

    const screenshot = await harness.command('screenshot', {
      agentId: 'agent-a',
      skipReadiness: true,
      format: 'png',
      scale: 1,
    });

    assert.equal(screenshot.success, true, screenshot.error);
    assert.equal(screenshot.result.tabId, 100);
    assert.equal(screenshot.result.dataUrl, 'data:image/png;base64,visible');
    assert.deepEqual(harness.calls.captures.visible, [7]);
    assert.deepEqual(harness.calls.captures.tab, []);
  });
});

describe('navigate gate', () => {
  it('with privateMode: false and private-window access allowed, canNavigate is true and navigate without a tabId drives the session tab', async () => {
    const harness = createHarness({ allowTabCreate: true, storage: { claudezilla: { privateMode: false } } });

    const probe = await harness.command('canNavigate');
    assert.equal(probe.success, true, probe.error);
    assert.equal(probe.result.canNavigate, true);

    const created = await harness.command('createWindow', { url: 'https://example.test/agent', agentId: 'agent-a' });
    assert.equal(created.success, true, created.error);
    const poolTabId = created.result.tabId;

    const navigated = await harness.command('navigate', { url: 'https://example.test/next' });
    assert.equal(navigated.success, true, navigated.error);
    assert.equal(navigated.result.tabId, poolTabId);
    assert.equal(navigated.result.url, 'https://example.test/next');
    assert.deepEqual(harness.calls.tabUpdates, [{ tabId: poolTabId, changes: { url: 'https://example.test/next' } }]);
    assert.equal((await harness.browser.tabs.get(poolTabId)).url, 'https://example.test/next');
    // The user's own tab in the adopted window was left alone.
    assert.equal((await harness.browser.tabs.get(42)).url, 'https://example.test/already-open');
  });

  it('with privateMode: false and private-window access denied, canNavigate is true', async () => {
    const harness = createHarness({ incognitoAccess: false, storage: { claudezilla: { privateMode: false } } });

    const probe = await harness.command('canNavigate');

    assert.equal(probe.success, true, probe.error);
    assert.equal(probe.result.canNavigate, true);
  });

  it('with private mode required and private-window access allowed, canNavigate is true but navigate without a tabId is refused', async () => {
    const harness = createHarness();

    const probe = await harness.command('canNavigate');
    const navigated = await harness.command('navigate', { url: 'https://example.test/next' });

    assert.equal(probe.result.canNavigate, true);
    assert.equal(navigated.success, false);
    assert.match(navigated.error, /^SECURITY: firefox_navigate is disabled/);
    assert.deepEqual(harness.calls.tabUpdates, []);
  });

  it('with private mode required and private-window access denied, canNavigate is false', async () => {
    const harness = createHarness({ incognitoAccess: false });

    const probe = await harness.command('canNavigate');

    assert.equal(probe.success, true, probe.error);
    assert.equal(probe.result.canNavigate, false);
  });
});
