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
 *
 * DEVTOOLS FEATURES:
 * - Network request monitoring
 * - Console log capture (via content script)
 * - JavaScript evaluation
 * - Element inspection
 */

const NATIVE_HOST = 'claudezilla';

let port = null;
let messageId = 0;
const pendingRequests = new Map();

// Session tracking for multi-window support
const sessions = new Map(); // windowId -> { windowId, tabId, createdAt }
let lastActiveWindowId = null; // Track most recent for fallback

// Network request monitoring
const networkRequests = [];
const MAX_NETWORK_ENTRIES = 200;

/**
 * Monitor network requests using webRequest API
 */
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const entry = {
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      type: details.type,
      tabId: details.tabId,
      timestamp: details.timeStamp,
      status: 'pending',
    };
    networkRequests.push(entry);
    if (networkRequests.length > MAX_NETWORK_ENTRIES) {
      networkRequests.shift();
    }
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

browser.webRequest.onCompleted.addListener(
  (details) => {
    const entry = networkRequests.find(r => r.requestId === details.requestId);
    if (entry) {
      entry.status = 'completed';
      entry.statusCode = details.statusCode;
      entry.responseHeaders = details.responseHeaders;
      entry.duration = details.timeStamp - entry.timestamp;
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

browser.webRequest.onErrorOccurred.addListener(
  (details) => {
    const entry = networkRequests.find(r => r.requestId === details.requestId);
    if (entry) {
      entry.status = 'error';
      entry.error = details.error;
      entry.duration = details.timeStamp - entry.timestamp;
    }
  },
  { urls: ['<all_urls>'] }
);

/**
 * Get captured network requests
 * @param {object} params - Parameters
 * @param {number} params.tabId - Filter by tab ID
 * @param {string} params.type - Filter by type (xhr, script, stylesheet, image, etc.)
 * @param {string} params.status - Filter by status (pending, completed, error)
 * @param {boolean} params.clear - Clear logs after returning
 * @param {number} params.limit - Max entries to return
 * @returns {object} Network requests
 */
function getNetworkRequests(params = {}) {
  const { tabId, type, status, clear = false, limit = 50 } = params;

  let requests = [...networkRequests];

  if (tabId !== undefined) {
    requests = requests.filter(r => r.tabId === tabId);
  }
  if (type) {
    requests = requests.filter(r => r.type === type);
  }
  if (status) {
    requests = requests.filter(r => r.status === status);
  }

  requests = requests.slice(-limit);

  if (clear) {
    networkRequests.length = 0;
  }

  return {
    requests,
    total: networkRequests.length,
    filtered: requests.length,
  };
}

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
 * Check if extension is allowed to run in Private Windows
 * @returns {Promise<boolean>} True if user has enabled the permission
 */
async function canRunInPrivateWindows() {
  return await browser.extension.isAllowedIncognitoAccess();
}

/**
 * Get session by windowId, or fall back to last active / only session.
 * Replaces requirePrivateWindow() for multi-window support.
 * @param {number} windowId - Optional explicit window ID
 * @returns {Promise<{windowId, tabId, tab}>} Session info with tab object
 */
async function getSession(windowId) {
  let targetWindowId = windowId;

  // If no windowId specified, try fallback strategies
  if (!targetWindowId) {
    if (sessions.size === 0) {
      throw new Error('No active sessions. Call firefox_create_window first.');
    }
    if (sessions.size === 1) {
      // Only one session - use it
      targetWindowId = sessions.keys().next().value;
    } else if (lastActiveWindowId && sessions.has(lastActiveWindowId)) {
      // Use most recently created/used window
      targetWindowId = lastActiveWindowId;
    } else {
      // Multiple sessions, none specified - list them
      const sessionList = [...sessions.values()]
        .map(s => `windowId: ${s.windowId}`)
        .join(', ');
      throw new Error(`Multiple sessions active (${sessionList}). Specify windowId parameter.`);
    }
  }

  const session = sessions.get(targetWindowId);
  if (!session) {
    throw new Error(`No session for windowId ${targetWindowId}. Call firefox_create_window first.`);
  }

  // Verify window still exists and is private
  try {
    const win = await browser.windows.get(session.windowId);
    if (!win.incognito) {
      sessions.delete(targetWindowId);
      throw new Error('Session window is not private.');
    }
    const tab = await browser.tabs.get(session.tabId);
    lastActiveWindowId = targetWindowId; // Update last active
    return { ...session, tab };
  } catch (e) {
    sessions.delete(targetWindowId);
    throw new Error(`Session ${targetWindowId} expired. Call firefox_create_window.`);
  }
}

/**
 * SECURITY: Verify we're operating in a private window
 * @deprecated Use getSession() instead for multi-window support
 */
async function requirePrivateWindow() {
  // Delegate to getSession for backward compatibility
  const session = await getSession();
  return session.tab;
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
          extension: '0.4.0',
          browser: navigator.userAgent,
          features: ['devtools', 'network', 'console', 'evaluate'],
        };
        break;

      case 'canNavigate': {
        // Check if navigate command is available (disabled if in private windows mode)
        const allowed = await canRunInPrivateWindows();
        result = { canNavigate: !allowed };
        break;
      }

      case 'navigate': {
        const { url } = params;
        if (!url) throw new Error('url is required');

        // SECURITY: Disable navigate when extension is allowed in private windows
        // to prevent agents from creating non-private windows
        if (await canRunInPrivateWindows()) {
          throw new Error('SECURITY: firefox_navigate is disabled when extension runs in Private Windows. This prevents creating non-private windows. Use other commands to interact with the current tab.');
        }

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
        const tabId = win.tabs?.[0]?.id;

        // Store session for multi-window support
        sessions.set(win.id, { windowId: win.id, tabId, createdAt: Date.now() });
        lastActiveWindowId = win.id;

        result = {
          windowId: win.id,
          private: win.incognito,
          tabId,
        };
        break;
      }

      case 'closeWindow': {
        const { windowId } = params;
        if (!windowId) throw new Error('windowId is required');

        // Clean up session before removing window
        sessions.delete(windowId);
        if (lastActiveWindowId === windowId) {
          lastActiveWindowId = sessions.size > 0
            ? sessions.keys().next().value
            : null;
        }

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

      case 'resizeWindow': {
        const { windowId, width, height, left, top } = params;
        // Get current window if no windowId specified
        let targetWindowId = windowId;
        if (!targetWindowId) {
          const tab = await requirePrivateWindow();
          targetWindowId = tab.windowId;
        }
        const updateInfo = {};
        if (width !== undefined) updateInfo.width = width;
        if (height !== undefined) updateInfo.height = height;
        if (left !== undefined) updateInfo.left = left;
        if (top !== undefined) updateInfo.top = top;
        const win = await browser.windows.update(targetWindowId, updateInfo);
        result = {
          windowId: win.id,
          width: win.width,
          height: win.height,
          left: win.left,
          top: win.top,
        };
        break;
      }

      case 'setViewport': {
        // Device viewport presets (content area, not window chrome)
        const DEVICES = {
          // Phones
          'iphone-se': { width: 375, height: 667, ua: 'mobile' },
          'iphone-14': { width: 390, height: 844, ua: 'mobile' },
          'iphone-14-pro-max': { width: 430, height: 932, ua: 'mobile' },
          'pixel-7': { width: 412, height: 915, ua: 'mobile' },
          'galaxy-s23': { width: 360, height: 780, ua: 'mobile' },
          // Tablets
          'ipad-mini': { width: 768, height: 1024, ua: 'tablet' },
          'ipad-pro-11': { width: 834, height: 1194, ua: 'tablet' },
          'ipad-pro-12': { width: 1024, height: 1366, ua: 'tablet' },
          // Desktop
          'laptop': { width: 1366, height: 768, ua: 'desktop' },
          'desktop': { width: 1920, height: 1080, ua: 'desktop' },
        };

        const { windowId, device, width, height } = params;
        const session = await getSession(windowId);

        let viewportWidth, viewportHeight, deviceType;

        if (device && DEVICES[device]) {
          viewportWidth = DEVICES[device].width;
          viewportHeight = DEVICES[device].height;
          deviceType = DEVICES[device].ua;
        } else if (width && height) {
          viewportWidth = width;
          viewportHeight = height;
          deviceType = width < 768 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop';
        } else {
          throw new Error(`Specify device preset or width/height. Available: ${Object.keys(DEVICES).join(', ')}`);
        }

        // Add ~80px for browser chrome (toolbar, etc)
        const chromeHeight = 80;
        const win = await browser.windows.update(session.windowId, {
          width: viewportWidth,
          height: viewportHeight + chromeHeight,
        });

        result = {
          device: device || 'custom',
          viewport: { width: viewportWidth, height: viewportHeight },
          window: { width: win.width, height: win.height },
          type: deviceType,
          availableDevices: Object.keys(DEVICES),
        };
        break;
      }

      case 'getContent': {
        const { windowId, ...contentParams } = params;
        const session = await getSession(windowId);
        const response = await executeInTab(session.tabId, 'getContent', contentParams);
        result = response.result;
        break;
      }

      case 'click': {
        const { windowId, ...clickParams } = params;
        const session = await getSession(windowId);
        const response = await executeInTab(session.tabId, 'click', clickParams);
        result = response.result;
        break;
      }

      case 'type': {
        const { windowId, ...typeParams } = params;
        const session = await getSession(windowId);
        const response = await executeInTab(session.tabId, 'type', typeParams);
        result = response.result;
        break;
      }

      case 'screenshot': {
        const { windowId } = params;
        const session = await getSession(windowId);
        // Focus the window before capturing to ensure correct viewport
        await browser.windows.update(session.windowId, { focused: true });
        const dataUrl = await browser.tabs.captureVisibleTab(session.windowId, { format: 'png' });
        result = { dataUrl };
        break;
      }

      // ===== DEVTOOLS COMMANDS =====

      case 'getConsoleLogs': {
        const { windowId, ...consoleParams } = params;
        const session = await getSession(windowId);
        const response = await executeInTab(session.tabId, 'getConsoleLogs', consoleParams);
        result = response.result;
        break;
      }

      case 'getNetworkRequests': {
        const { windowId, ...networkParams } = params;
        const session = await getSession(windowId);
        result = getNetworkRequests({ ...networkParams, tabId: session.tabId });
        break;
      }

      case 'scroll': {
        const { windowId, ...scrollParams } = params;
        const session = await getSession(windowId);
        const response = await executeInTab(session.tabId, 'scroll', scrollParams);
        result = response.result;
        break;
      }

      case 'waitFor': {
        const { windowId, ...waitParams } = params;
        const session = await getSession(windowId);
        const response = await executeInTab(session.tabId, 'waitFor', waitParams);
        result = response.result;
        break;
      }

      case 'evaluate': {
        const { windowId, ...evalParams } = params;
        const session = await getSession(windowId);
        const response = await executeInTab(session.tabId, 'evaluate', evalParams);
        result = response.result;
        break;
      }

      case 'getElementInfo': {
        const { windowId, ...elementParams } = params;
        const session = await getSession(windowId);
        const response = await executeInTab(session.tabId, 'getElementInfo', elementParams);
        result = response.result;
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

// Clean up session when window is closed
browser.windows.onRemoved.addListener((windowId) => {
  if (sessions.has(windowId)) {
    console.log(`[claudezilla] Session ${windowId} closed`);
    sessions.delete(windowId);
    if (lastActiveWindowId === windowId) {
      lastActiveWindowId = sessions.size > 0
        ? sessions.keys().next().value
        : null;
    }
  }
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
