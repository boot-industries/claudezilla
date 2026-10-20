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

function createHarness({ storage: initialStorage = {}, windowGetGate = Promise.resolve(), allowTabCreate = false, allowWindowCreate = false, tabs: seededTabs = null, contextualIdentities = [] } = {}) {
  const storage = structuredClone(initialStorage);
  const windows = new Map([[7, { id: 7, incognito: false }]]);
  let nextTabId = 100;
  const tabs = new Map((seededTabs ?? [
    {
      id: 42,
      windowId: 7,
      url: 'https://example.test/already-open',
      title: 'Already open',
      active: true,
      pinned: false,
      incognito: false,
      cookieStoreId: 'firefox-default',
    },
  ]).map((tab) => [tab.id, { ...tab }]));
  const calls = { tabsCreated: 0, windowsCreated: 0, windowsRemoved: [], contentActions: [], tabCreateOptions: [], windowCreateOptions: [], captures: { tab: [], visible: [] } };
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
        const win = [...windows.values()].at(-1);
        return { ...win, tabs: [...tabs.values()].filter((tab) => tab.windowId === win.id) };
      },
      async create(options = {}) {
        calls.windowsCreated += 1;
        if (!allowWindowCreate) throw new Error('test forbids creating windows');
        calls.windowCreateOptions.push(structuredClone(options));
        const win = { id: 7 + calls.windowsCreated, incognito: options.incognito === true };
        windows.set(win.id, win);
        const tab = {
          id: nextTabId += 1,
          windowId: win.id,
          url: options.url ?? 'about:blank',
          title: '',
          active: true,
          pinned: false,
          incognito: win.incognito,
          cookieStoreId: 'firefox-default',
        };
        tabs.set(tab.id, tab);
        return { ...win, tabs: [{ ...tab }] };
      },
      async update() {
        return { id: 7, width: 1280, height: 800 };
      },
      async remove(windowId) {
        calls.windowsRemoved.push(windowId);
        windows.delete(windowId);
        for (const tab of [...tabs.values()]) {
          if (tab.windowId === windowId) tabs.delete(tab.id);
        }
      },
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
        const id = nextTabId += 1;
        const tab = {
          id,
          windowId: options.windowId,
          url: options.url,
          title: '',
          active: options.active !== false,
          pinned: false,
          incognito: false,
          cookieStoreId: options.cookieStoreId ?? 'firefox-default',
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
    contextualIdentities: contextualIdentities === null ? undefined : {
      async query() {
        return contextualIdentities.map((identity) => ({ ...identity }));
      },
      async get(cookieStoreId) {
        const identity = contextualIdentities.find((candidate) => candidate.cookieStoreId === cookieStoreId);
        if (!identity) throw new Error(`Invalid contextual identity: ${cookieStoreId}`);
        return { ...identity };
      },
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
      cookieStoreId: 'firefox-default',
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

describe('container tabs', () => {
  const WORK = { name: 'Work', cookieStoreId: 'firefox-container-1', color: 'blue', icon: 'briefcase' };
  const BANKING = { name: 'Banking', cookieStoreId: 'firefox-container-2', color: 'green', icon: 'dollar' };
  const adoptedWindowState = {
    windowId: 7,
    tabs: [{ tabId: 42, ownerId: 'agent-a' }],
    createdAt: 1,
    groupId: null,
    isPrivate: false,
    adopted: true,
  };

  function containerHarness(options = {}) {
    return createHarness({
      allowTabCreate: true,
      contextualIdentities: [WORK, BANKING],
      storage: { claudezillaWindowState: adoptedWindowState },
      ...options,
    });
  }

  it('opens the tab in the named container of an adopted window without taking the user\'s selection', async () => {
    const harness = containerHarness();

    const created = await harness.command('createWindow', {
      url: 'https://example.test/agent',
      agentId: 'agent-b',
      container: 'Work',
    });

    assert.equal(created.success, true, created.error);
    assert.deepEqual(harness.calls.tabCreateOptions, [{
      windowId: 7,
      url: 'https://example.test/agent',
      active: false,
      cookieStoreId: 'firefox-container-1',
    }]);
    assert.equal(created.result.container, 'Work');
    assert.equal(created.result.cookieStoreId, 'firefox-container-1');
    assert.equal(created.result.isPrivate, false);
    assert.equal(harness.calls.windowsCreated, 0);
    assert.equal((await harness.browser.tabs.get(42)).active, true);
  });

  it('matches a container name case-insensitively', async () => {
    const harness = containerHarness();

    const created = await harness.command('createWindow', { url: 'https://example.test/agent', agentId: 'agent-b', container: 'banking' });

    assert.equal(created.success, true, created.error);
    assert.equal(harness.calls.tabCreateOptions[0].cookieStoreId, 'firefox-container-2');
    assert.equal(created.result.cookieStoreId, 'firefox-container-2');
  });

  it('prefers an exact-case match and rejects a name that stays ambiguous', async () => {
    const lowercaseWork = { name: 'work', cookieStoreId: 'firefox-container-3', color: 'red', icon: 'fence' };
    const harness = containerHarness({ contextualIdentities: [WORK, lowercaseWork] });

    const exact = await harness.command('createWindow', { url: 'https://example.test/agent', agentId: 'agent-b', container: 'Work' });
    const ambiguous = await harness.command('createWindow', { url: 'https://example.test/agent', agentId: 'agent-b', container: 'WORK' });

    assert.equal(exact.success, true, exact.error);
    assert.equal(exact.result.cookieStoreId, 'firefox-container-1');
    assert.equal(ambiguous.success, false);
    assert.match(ambiguous.error, /ambiguous: "Work" \(firefox-container-1\), "work" \(firefox-container-3\)/);
    assert.equal(harness.calls.tabsCreated, 1);
  });

  it('rejects an unknown container name and lists the available ones', async () => {
    const harness = containerHarness();

    const created = await harness.command('createWindow', { url: 'https://example.test/agent', agentId: 'agent-b', container: 'Shopping' });

    assert.equal(created.success, false);
    assert.equal(created.error, 'Container not found: "Shopping". Available containers: Work, Banking');
    assert.equal(harness.calls.tabsCreated, 0);
  });

  it('verifies a raw cookieStoreId against the profile\'s containers', async () => {
    const harness = containerHarness();

    const known = await harness.command('createWindow', { url: 'https://example.test/agent', agentId: 'agent-b', container: 'firefox-container-2' });
    const unknown = await harness.command('createWindow', { url: 'https://example.test/agent', agentId: 'agent-b', container: 'firefox-container-9' });

    assert.equal(known.success, true, known.error);
    assert.equal(harness.calls.tabCreateOptions[0].cookieStoreId, 'firefox-container-2');
    assert.equal(unknown.success, false);
    assert.equal(unknown.error, 'Container not found: "firefox-container-9". Available containers: Work, Banking');
    assert.equal(harness.calls.tabsCreated, 1);
  });

  it('treats "firefox-default" as the default cookie jar', async () => {
    const harness = containerHarness();

    const created = await harness.command('createWindow', { url: 'https://example.test/agent', agentId: 'agent-b', container: 'firefox-default' });

    assert.equal(created.success, true, created.error);
    assert.equal(Object.hasOwn(harness.calls.tabCreateOptions[0], 'cookieStoreId'), false);
    assert.equal(created.result.cookieStoreId, undefined);
    assert.equal((await harness.browser.tabs.get(created.result.tabId)).cookieStoreId, 'firefox-default');
  });

  it('rejects "firefox-private" and points at the private parameter', async () => {
    const harness = containerHarness();

    const created = await harness.command('createWindow', { url: 'https://example.test/agent', agentId: 'agent-b', container: 'firefox-private' });

    assert.equal(created.success, false);
    assert.match(created.error, /"firefox-private" is the private cookie jar, not a container/);
    assert.match(created.error, /private: true/);
    assert.equal(harness.calls.tabsCreated, 0);
  });

  it('spawns a dedicated window blank, opens the contained tab in it, and drops the placeholder', async () => {
    const harness = createHarness({
      allowTabCreate: true,
      allowWindowCreate: true,
      contextualIdentities: [WORK],
      storage: { adoptCurrentWindow: false, claudezilla: { privateMode: true } },
    });

    const created = await harness.command('createWindow', { url: 'https://example.test/agent', agentId: 'agent-b', container: 'Work' });

    assert.equal(created.success, true, created.error);
    // Private mode is on, yet the container forces a non-private window.
    assert.deepEqual(harness.calls.windowCreateOptions, [{ incognito: false, focused: false, url: 'about:blank' }]);
    assert.deepEqual(harness.calls.tabCreateOptions, [{
      windowId: 8,
      url: 'https://example.test/agent',
      active: true,
      cookieStoreId: 'firefox-container-1',
    }]);
    assert.equal(created.result.windowId, 8);
    assert.equal(created.result.tabId, 102);
    assert.equal(created.result.isNewWindow, true);
    assert.equal(created.result.isPrivate, false);
    assert.equal(created.result.cookieStoreId, 'firefox-container-1');
    // The blank placeholder the window opened with is gone; only the contained tab remains.
    const remaining = await harness.browser.tabs.query({ windowId: 8 });
    assert.deepEqual(remaining.map((tab) => [tab.id, tab.cookieStoreId]), [[102, 'firefox-container-1']]);
  });

  it('closes the blank window again when the contained tab cannot be created', async () => {
    const harness = createHarness({
      allowTabCreate: true,
      allowWindowCreate: true,
      contextualIdentities: [WORK],
      storage: { adoptCurrentWindow: false },
    });
    harness.browser.tabs.create = async () => {
      throw new Error('No permission for cookieStoreId: firefox-container-1');
    };

    const created = await harness.command('createWindow', { url: 'https://example.test/agent', agentId: 'agent-b', container: 'Work' });

    assert.equal(created.success, false);
    assert.match(created.error, /No permission for cookieStoreId/);
    assert.equal(harness.calls.windowsCreated, 1);
    assert.deepEqual(harness.calls.windowsRemoved, [8]);
    await assert.rejects(harness.browser.windows.get(8), /window not found/);
    assert.equal(harness.storage.claudezillaWindowState, null);
  });

  it('refuses a container together with private: true', async () => {
    const harness = containerHarness();

    const created = await harness.command('createWindow', { url: 'https://example.test/agent', agentId: 'agent-b', container: 'Work', private: true });

    assert.equal(created.success, false);
    assert.equal(created.details.code, 'CONTAINER_PRIVATE_CONFLICT');
    assert.equal(harness.calls.tabsCreated, 0);
    assert.equal(harness.calls.windowsCreated, 0);
  });

  it('refuses to move a tab into another container on navigate with a tabId', async () => {
    const harness = containerHarness();
    const created = await harness.command('createWindow', { url: 'https://example.test/agent', agentId: 'agent-b', container: 'Work' });
    const tabId = created.result.tabId;

    const same = await harness.command('navigate', { tabId, agentId: 'agent-b', url: 'https://example.test/next', container: 'Work' });
    const other = await harness.command('navigate', { tabId, agentId: 'agent-b', url: 'https://example.test/elsewhere', container: 'Banking' });

    assert.equal(same.success, true, same.error);
    assert.equal(same.result.url, 'https://example.test/next');
    assert.equal(other.success, false);
    assert.equal(other.details.code, 'CONTAINER_IMMUTABLE');
    assert.match(other.error, /Tab 101 is in "firefox-container-1"/);
    assert.equal((await harness.browser.tabs.get(tabId)).url, 'https://example.test/next');
  });

  it('refuses to move the active tab into another container on navigate without a tabId', async () => {
    const harness = containerHarness();
    const created = await harness.command('createWindow', { url: 'https://example.test/agent', agentId: 'agent-b' });
    // The no-tabId path is only open while the extension is kept out of private windows.
    harness.browser.extension.isAllowedIncognitoAccess = async () => false;

    const other = await harness.command('navigate', { agentId: 'agent-b', url: 'https://example.test/elsewhere', container: 'Work' });
    const same = await harness.command('navigate', { agentId: 'agent-b', url: 'https://example.test/next' });

    assert.equal(other.success, false);
    assert.equal(other.details.code, 'CONTAINER_IMMUTABLE');
    assert.match(other.error, /Tab 101 is in "firefox-default"/);
    assert.equal(same.success, true, same.error);
    assert.deepEqual(structuredClone(same.result), { tabId: created.result.tabId, url: 'https://example.test/next' });
    assert.equal((await harness.browser.tabs.get(created.result.tabId)).url, 'https://example.test/next');
  });

  it('lists containers with the WebExtension field names', async () => {
    const harness = containerHarness();

    const listed = await harness.command('listContainers');

    assert.equal(listed.success, true, listed.error);
    assert.deepEqual(structuredClone(listed.result), {
      containers: [
        { name: 'Work', cookieStoreId: 'firefox-container-1', color: 'blue', icon: 'briefcase' },
        { name: 'Banking', cookieStoreId: 'firefox-container-2', color: 'green', icon: 'dollar' },
      ],
      available: true,
      count: 2,
    });
  });

  it('reports containers as unavailable when the API is absent', async () => {
    const harness = containerHarness({ contextualIdentities: null });

    const listed = await harness.command('listContainers');
    const created = await harness.command('createWindow', { url: 'https://example.test/agent', agentId: 'agent-b', container: 'Work' });

    assert.equal(listed.success, true, listed.error);
    assert.equal(listed.result.available, false);
    assert.deepEqual(structuredClone(listed.result.containers), []);
    assert.equal(created.success, false);
    assert.match(created.error, /Containers unavailable/);
    assert.equal(harness.calls.tabsCreated, 0);
  });

  it('adopts the replacement when another extension reassigns a fresh tab to its container', async () => {
    const harness = containerHarness({
      storage: { claudezilla: { privateMode: false } },
      tabs: [
        { id: 42, windowId: 7, url: 'https://example.test/already-open', title: 'Already open', active: true, pinned: false, incognito: false, cookieStoreId: 'firefox-default' },
        // The user's own, older copy of the page must never be adopted.
        { id: 90, windowId: 7, url: 'https://example.test/agent', title: 'User copy', active: false, pinned: false, incognito: false, cookieStoreId: 'firefox-default' },
      ],
    });
    const created = await harness.command('createWindow', { url: 'https://example.test/agent?step=1', agentId: 'agent-b' });
    const original = created.result.tabId;
    // Re-opened by the other extension: same page, different query, its container.
    const replacement = await harness.browser.tabs.create({ windowId: 7, url: 'https://example.test/agent?step=2', active: false, cookieStoreId: 'firefox-container-1' });
    await harness.browser.tabs.remove(original);
    harness.tabsRemoved.emit(original, { windowId: 7, isWindowClosing: false });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const listed = await harness.command('getTabs');
    const content = await harness.command('getContent', { agentId: 'agent-b' });

    assert.equal(original, 101);
    assert.equal(replacement.id, 102);
    assert.deepEqual(structuredClone(listed.result.tabs).map((tab) => [tab.tabId, tab.ownerId, tab.cookieStoreId]), [[102, 'agent-b', 'firefox-container-1']]);
    assert.equal(content.result.tabId, 102);
    assert.deepEqual(harness.storage.claudezillaWindowState.tabs.map((tab) => tab.tabId), [102]);
  });

  it('leaves a closed tab closed when it was not created moments ago', async () => {
    const harness = containerHarness({
      storage: {
        claudezillaWindowState: {
          ...adoptedWindowState,
          tabs: [{ tabId: 42, ownerId: 'agent-a', url: 'https://example.test/already-open', createdAt: 1 }],
        },
      },
      tabs: [
        { id: 42, windowId: 7, url: 'https://example.test/already-open', title: 'Already open', active: true, pinned: false, incognito: false, cookieStoreId: 'firefox-default' },
        { id: 50, windowId: 7, url: 'https://example.test/already-open', title: 'Same page again', active: false, pinned: false, incognito: false, cookieStoreId: 'firefox-container-1' },
      ],
    });
    assert.equal((await harness.command('getTabs')).result.tabCount, 1);

    await harness.browser.tabs.remove(42);
    harness.tabsRemoved.emit(42, { windowId: 7, isWindowClosing: false });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const listed = await harness.command('getTabs');
    assert.deepEqual(structuredClone(listed.result.tabs), []);
    assert.deepEqual(harness.storage.claudezillaWindowState.tabs, []);
  });

  it('reports each pool tab\'s cookieStoreId in getTabs', async () => {
    const harness = containerHarness({ storage: {} });
    await harness.command('createWindow', { url: 'https://example.test/work', agentId: 'agent-b', container: 'Work' });
    await harness.command('createWindow', { url: 'https://example.test/plain', agentId: 'agent-b' });

    const listed = await harness.command('getTabs');

    assert.deepEqual(structuredClone(listed.result.tabs).map((tab) => [tab.tabId, tab.cookieStoreId]), [[101, 'firefox-container-1'], [102, 'firefox-default']]);
  });
});
