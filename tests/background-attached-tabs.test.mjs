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

function createHarness({ storage: initialStorage = {}, windowGetGate = Promise.resolve(), allowTabCreate = false, allowWindowCreate = false, tabs: seededTabs = null } = {}) {
  const storage = structuredClone(initialStorage);
  const windows = new Map([[7, { id: 7, incognito: false }]]);
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
  const calls = { tabsCreated: 0, windowsCreated: 0, contentActions: [], contentTargets: [], tabCreateOptions: [], tabUpdates: [], captures: { tab: [], visible: [] } };
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
        return true;
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
        const win = windows.get(windowId);
        if (!win) throw new Error('window not found');
        return {
          ...win,
          tabs: options.populate ? [...tabs.values()].filter((tab) => tab.windowId === windowId) : undefined,
        };
      },
      async getLastFocused() {
        return { id: 7, incognito: false, tabs: [...tabs.values()] };
      },
      async create(options = {}) {
        calls.windowsCreated += 1;
        if (!allowWindowCreate) throw new Error('test forbids creating windows');
        const id = 7 + calls.windowsCreated;
        const tab = {
          id: id * 10,
          windowId: id,
          url: options.url ?? 'about:blank',
          title: '',
          active: true,
          pinned: false,
          incognito: !!options.incognito,
        };
        tabs.set(tab.id, tab);
        windows.set(id, { id, incognito: !!options.incognito });
        return { ...windows.get(id), tabs: [{ ...tab }] };
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
        calls.tabUpdates.push({ tabId: tab.id, changes: structuredClone(changes) });
        if (changes.active) {
          for (const other of tabs.values()) {
            if (other.windowId === tab.windowId) other.active = false;
          }
        }
        Object.assign(tab, changes);
        return { ...tab };
      },
      async remove(tabId) {
        tabs.delete(Number(tabId));
      },
      async sendMessage(tabId, message) {
        const tab = tabs.get(Number(tabId));
        if (!tab) throw new Error('tab not found');
        calls.contentActions.push(message.action);
        calls.contentTargets.push({ tabId: tab.id, action: message.action, active: tab.active });
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

describe('dedicated window keeps the driven tab selected', () => {
  // A dedicated window: non-private with "Reuse current window" switched off,
  // so the extension creates its own window. Two createWindow calls give two
  // pool tabs; the second is created active, so the first is not selected.
  async function createDedicatedWindow() {
    const harness = createHarness({
      allowTabCreate: true,
      allowWindowCreate: true,
      storage: { adoptCurrentWindow: false, claudezilla: { privateMode: false } },
    });
    const first = await harness.command('createWindow', { url: 'https://example.test/first', agentId: 'agent-a' });
    const second = await harness.command('createWindow', { url: 'https://example.test/second', agentId: 'agent-a' });
    assert.equal(first.success, true, first.error);
    assert.equal(second.success, true, second.error);
    assert.equal(first.result.isNewWindow, true);
    assert.equal(harness.calls.windowsCreated, 1);
    assert.equal((await harness.browser.tabs.get(first.result.tabId)).active, false);
    assert.equal((await harness.browser.tabs.get(second.result.tabId)).active, true);
    return { harness, windowId: first.result.windowId, backgroundTabId: first.result.tabId, selectedTabId: second.result.tabId };
  }

  it('selects a non-selected pool tab before the content action runs', async () => {
    const { harness, backgroundTabId, selectedTabId } = await createDedicatedWindow();

    const response = await harness.command('getContent', { tabId: backgroundTabId, agentId: 'agent-a' });

    assert.equal(response.success, true, response.error);
    assert.equal(response.result.tabId, backgroundTabId);
    assert.deepEqual(harness.calls.tabUpdates, [{ tabId: backgroundTabId, changes: { active: true } }]);
    assert.deepEqual(
      harness.calls.contentTargets.filter((entry) => entry.action === 'getContent'),
      [{ tabId: backgroundTabId, action: 'getContent', active: true }],
    );
    assert.equal((await harness.browser.tabs.get(selectedTabId)).active, false);
  });

  it('in an adopted window, never changes the user\'s selected tab', async () => {
    const harness = createHarness({ allowTabCreate: true });
    const created = await harness.command('createWindow', { url: 'https://example.test/agent', agentId: 'agent-a', private: false });
    assert.equal(created.success, true, created.error);
    assert.equal(created.result.isNewWindow, false);
    assert.equal(harness.calls.windowsCreated, 0);
    const agentTabId = created.result.tabId;

    const explicit = await harness.command('getContent', { tabId: agentTabId, agentId: 'agent-a' });
    const implicit = await harness.command('getContent', { agentId: 'agent-a' });

    assert.equal(explicit.success, true, explicit.error);
    assert.equal(implicit.success, true, implicit.error);
    assert.equal(explicit.result.tabId, agentTabId);
    assert.equal(implicit.result.tabId, agentTabId);
    assert.deepEqual(harness.calls.tabUpdates, []);
    assert.equal((await harness.browser.tabs.get(42)).active, true);
    assert.deepEqual(
      harness.calls.contentTargets.filter((entry) => entry.action === 'getContent'),
      [
        { tabId: agentTabId, action: 'getContent', active: false },
        { tabId: agentTabId, action: 'getContent', active: false },
      ],
    );
  });

  it('records no tab update when the driven tab is already selected', async () => {
    const { harness, selectedTabId } = await createDedicatedWindow();

    const explicit = await harness.command('getContent', { tabId: selectedTabId, agentId: 'agent-a' });
    const implicit = await harness.command('getContent', { agentId: 'agent-a' });

    assert.equal(explicit.success, true, explicit.error);
    assert.equal(implicit.success, true, implicit.error);
    assert.equal(explicit.result.tabId, selectedTabId);
    assert.equal(implicit.result.tabId, selectedTabId);
    assert.deepEqual(harness.calls.tabUpdates, []);
    assert.equal((await harness.browser.tabs.get(selectedTabId)).active, true);
  });

  it('after a background restart, a command without tabId selects the pool\'s current tab', async () => {
    const harness = createHarness({
      tabs: [
        { id: 100, windowId: 7, url: 'https://example.test/first', title: 'First', active: true, pinned: false, incognito: false },
        { id: 101, windowId: 7, url: 'https://example.test/second', title: 'Second', active: false, pinned: false, incognito: false },
      ],
      storage: {
        claudezillaWindowState: {
          windowId: 7,
          tabs: [{ tabId: 100, ownerId: 'agent-a' }, { tabId: 101, ownerId: 'agent-a' }],
          createdAt: 1,
          groupId: null,
          isPrivate: false,
          adopted: false,
        },
      },
    });

    const response = await harness.command('getContent', { agentId: 'agent-a' });

    assert.equal(response.success, true, response.error);
    assert.equal(response.result.tabId, 101);
    assert.deepEqual(harness.calls.tabUpdates, [{ tabId: 101, changes: { active: true } }]);
    assert.deepEqual(
      harness.calls.contentTargets.filter((entry) => entry.action === 'getContent'),
      [{ tabId: 101, action: 'getContent', active: true }],
    );
    assert.equal((await harness.browser.tabs.get(100)).active, false);
  });

  it('firefox_screenshot of a non-selected pool tab selects it and captures the visible tab', async () => {
    const { harness, windowId, backgroundTabId } = await createDedicatedWindow();

    const screenshot = await harness.command('screenshot', {
      tabId: backgroundTabId,
      agentId: 'agent-a',
      skipReadiness: true,
      format: 'png',
      scale: 1,
    });

    assert.equal(screenshot.success, true, screenshot.error);
    assert.equal(screenshot.result.tabId, backgroundTabId);
    assert.equal(screenshot.result.dataUrl, 'data:image/png;base64,visible');
    assert.deepEqual(harness.calls.tabUpdates, [{ tabId: backgroundTabId, changes: { active: true } }]);
    assert.deepEqual(harness.calls.captures.visible, [windowId]);
    assert.deepEqual(harness.calls.captures.tab, []);
  });
});
