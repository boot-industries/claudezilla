/**
 * Claudezilla Background Script
 *
 * Manages native messaging connection and routes commands between
 * the native host and content scripts.
 *
 * SECURITY MODEL:
 * - Commands are specific, well-defined actions (not arbitrary code)
 * - Page content is returned as DATA, never interpreted as instructions
 * - All responses are structured JSON
 */

const NATIVE_HOST = 'claudezilla';

let port = null;
let messageId = 0;
const pendingRequests = new Map();

/**
 * Connect to native messaging host
 */
function connect() {
  if (port) {
    console.log('[claudezilla] Already connected');
    return;
  }

  console.log('[claudezilla] Connecting to native host...');

  try {
    port = browser.runtime.connectNative(NATIVE_HOST);

    port.onMessage.addListener((message) => {
      console.log('[claudezilla] Received from host:', message);

      // Check if this is a command from CLI (via host)
      if (message.type === 'command') {
        handleCliCommand(message);
      } else {
        // Regular response to our request
        handleHostMessage(message);
      }
    });

    port.onDisconnect.addListener((p) => {
      // Firefox passes the port with an error property
      const error = p?.error?.message || 'Unknown disconnect reason';
      console.log('[claudezilla] Disconnected from host:', error);
      port = null;

      // Reject all pending requests
      for (const [id, { reject }] of pendingRequests) {
        reject(new Error('Native host disconnected: ' + error));
      }
      pendingRequests.clear();
    });

    console.log('[claudezilla] Connected to native host');
  } catch (error) {
    console.error('[claudezilla] Failed to connect:', error);
    port = null;
  }
}

/**
 * Send command to native host
 * @param {string} command - Command name
 * @param {object} params - Command parameters
 * @returns {Promise<object>} Response from host
 */
function sendToHost(command, params = {}) {
  return new Promise((resolve, reject) => {
    if (!port) {
      connect();
      if (!port) {
        reject(new Error('Failed to connect to native host'));
        return;
      }
    }

    const id = ++messageId;
    const message = { id, command, params };

    pendingRequests.set(id, { resolve, reject });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Request ${id} timed out`));
      }
    }, 30000);

    console.log('[claudezilla] Sending to host:', message);
    port.postMessage(message);
  });
}

/**
 * Handle message from native host
 * @param {object} message - Message from host
 */
function handleHostMessage(message) {
  const { id, success, result, error } = message;

  const pending = pendingRequests.get(id);
  if (pending) {
    pendingRequests.delete(id);
    if (success) {
      pending.resolve(result);
    } else {
      pending.reject(new Error(error || 'Unknown error'));
    }
  }
}

/**
 * Execute command in active tab's content script
 * @param {number} tabId - Tab ID
 * @param {string} action - Action to perform
 * @param {object} params - Action parameters
 * @returns {Promise<object>} Result from content script
 */
async function executeInTab(tabId, action, params) {
  return browser.tabs.sendMessage(tabId, { action, params });
}

/**
 * SECURITY: Verify we're operating in a private window
 * Returns the active tab if in private window, throws if not
 */
async function requirePrivateWindow() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error('No active tab');
  }

  const win = await browser.windows.get(tab.windowId);
  if (!win.incognito) {
    throw new Error('SECURITY: Claudezilla only operates in private windows. Use createWindow first.');
  }

  return tab;
}

/**
 * Handle command from CLI (via native host)
 * Executes the command and sends result back to host
 *
 * SECURITY: Most commands require a private window
 */
async function handleCliCommand(message) {
  const { id, command, params = {} } = message;

  console.log('[claudezilla] CLI command:', command, params);

  try {
    let result;

    switch (command) {
      case 'ping':
        result = { pong: true, timestamp: Date.now() };
        break;

      case 'version':
        result = {
          extension: '0.1.0',
          browser: navigator.userAgent,
        };
        break;

      case 'navigate': {
        const { url } = params;
        if (!url) throw new Error('url is required');
        // SECURITY: Require private window, then navigate in current tab
        const currentTab = await requirePrivateWindow();
        await browser.tabs.update(currentTab.id, { url });
        result = { tabId: currentTab.id, url };
        break;
      }

      case 'getActiveTab': {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        result = tab ? { tabId: tab.id, url: tab.url, title: tab.title } : null;
        break;
      }

      case 'getTabs': {
        const tabs = await browser.tabs.query({});
        result = tabs.map(t => ({ tabId: t.id, url: t.url, title: t.title, active: t.active }));
        break;
      }

      case 'closeTab': {
        const { tabId } = params;
        if (!tabId) throw new Error('tabId is required');
        await browser.tabs.remove(tabId);
        result = { closed: true, tabId };
        break;
      }

      case 'createWindow': {
        // Create a new window, optionally private (incognito)
        const { private: isPrivate = true, url } = params;
        const windowOpts = { incognito: isPrivate };
        if (url) {
          windowOpts.url = url;
        }
        const win = await browser.windows.create(windowOpts);
        result = {
          windowId: win.id,
          private: win.incognito,
          tabId: win.tabs?.[0]?.id,
        };
        break;
      }

      case 'closeWindow': {
        const { windowId } = params;
        if (!windowId) throw new Error('windowId is required');
        await browser.windows.remove(windowId);
        result = { closed: true, windowId };
        break;
      }

      case 'getWindows': {
        const windows = await browser.windows.getAll({ populate: true });
        result = windows.map(w => ({
          windowId: w.id,
          private: w.incognito,
          focused: w.focused,
          tabCount: w.tabs?.length || 0,
        }));
        break;
      }

      case 'getContent': {
        // SECURITY: Require private window
        const tab = await requirePrivateWindow();
        const response = await executeInTab(tab.id, 'getContent', params);
        result = response.result;
        break;
      }

      case 'click': {
        // SECURITY: Require private window
        const tab = await requirePrivateWindow();
        const response = await executeInTab(tab.id, 'click', params);
        result = response.result;
        break;
      }

      case 'type': {
        // SECURITY: Require private window
        const tab = await requirePrivateWindow();
        const response = await executeInTab(tab.id, 'type', params);
        result = response.result;
        break;
      }

      case 'screenshot': {
        // SECURITY: Require private window
        await requirePrivateWindow();
        const dataUrl = await browser.tabs.captureVisibleTab(null, { format: 'png' });
        result = { dataUrl };
        break;
      }

      default:
        throw new Error(`Unknown command: ${command}`);
    }

    // Send result back to host
    port.postMessage({ id, success: true, result });
  } catch (error) {
    console.error('[claudezilla] CLI command error:', error);
    port.postMessage({ id, success: false, error: error.message });
  }
}

/**
 * Handle messages from content scripts or popup
 * Firefox requires returning a Promise for async responses
 */
browser.runtime.onMessage.addListener((message, sender) => {
  const { action, params } = message;

  console.log('[claudezilla] Message from', sender.tab ? `tab ${sender.tab.id}` : 'popup', ':', message);

  // Return a Promise for Firefox
  return (async () => {
    try {
      let result;

      switch (action) {
        case 'ping':
          result = await sendToHost('ping');
          break;

        case 'version':
          result = await sendToHost('version');
          break;

        case 'navigate': {
          const { url } = params;
          const tab = await browser.tabs.create({ url });
          result = { tabId: tab.id, url };
          break;
        }

        case 'getActiveTab': {
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          result = tab ? { tabId: tab.id, url: tab.url, title: tab.title } : null;
          break;
        }

        case 'getContent': {
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (!tab) throw new Error('No active tab');
          result = await executeInTab(tab.id, 'getContent', params);
          break;
        }

        case 'click': {
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (!tab) throw new Error('No active tab');
          result = await executeInTab(tab.id, 'click', params);
          break;
        }

        case 'type': {
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (!tab) throw new Error('No active tab');
          result = await executeInTab(tab.id, 'type', params);
          break;
        }

        case 'screenshot': {
          const dataUrl = await browser.tabs.captureVisibleTab(null, { format: 'png' });
          result = { dataUrl };
          break;
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      return { success: true, result };
    } catch (error) {
      console.error('[claudezilla] Action error:', error);
      return { success: false, error: error.message };
    }
  })();
});

// Connect on startup
connect();

// Reconnect on browser action click if disconnected
browser.browserAction.onClicked.addListener(() => {
  if (!port) {
    connect();
  }
});

console.log('[claudezilla] Background script loaded');
