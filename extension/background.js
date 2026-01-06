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

// Session tracking - single window, max 10 tabs
const MAX_TABS = 10;
let claudezillaWindow = null; // { windowId, tabs: [{tabId, ownerId}, ...], createdAt, groupId }
let activeTabId = null; // Currently active tab in the Claudezilla window

// Screenshot mutex - serialize all screenshot requests to prevent collisions
// (captureVisibleTab only works on visible tab, so we must switch tabs sequentially)
let screenshotLock = Promise.resolve();
let screenshotMutexHolder = null;    // { agentId, acquiredAt, operation }
const MUTEX_BUSY_THRESHOLD_MS = 5000; // Return MUTEX_BUSY if held longer than this

// Tab pool coordination - pending slot requests from agents
const pendingSlotRequests = [];  // [{ agentId, requestedAt }]

// Tab group colors (Firefox 138+)
const SESSION_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'cyan', 'orange', 'grey'];

// Legacy session map for backward compatibility
const sessions = new Map();

// Network request monitoring
const networkRequests = [];
const MAX_NETWORK_ENTRIES = 200;

// SECURITY: Allowed URL schemes for navigation
const ALLOWED_URL_SCHEMES = ['http:', 'https:', 'about:'];

// SECURITY: Sensitive query parameter patterns to redact
const SENSITIVE_PARAMS = ['password', 'passwd', 'pwd', 'token', 'api_key', 'apikey', 'secret', 'auth', 'key', 'credential'];

/**
 * SECURITY: Redact sensitive query parameters from URLs
 * Prevents leaking passwords, tokens, API keys in logs/captures
 */
function redactSensitiveUrl(url) {
  try {
    const parsed = new URL(url);
    let redacted = false;
    for (const [key] of parsed.searchParams) {
      if (SENSITIVE_PARAMS.some(p => key.toLowerCase().includes(p))) {
        parsed.searchParams.set(key, '[REDACTED]');
        redacted = true;
      }
    }
    return redacted ? parsed.toString() : url;
  } catch (e) {
    return url; // Return as-is if not parseable
  }
}

/**
 * SECURITY: Validate URL scheme before navigation
 * Prevents javascript:, data:, file:// injection attacks
 */
function validateUrlScheme(url) {
  if (!url || url === 'about:blank') return true;
  try {
    const parsed = new URL(url);
    if (!ALLOWED_URL_SCHEMES.includes(parsed.protocol)) {
      throw new Error(`URL scheme not allowed: ${parsed.protocol}. Allowed: ${ALLOWED_URL_SCHEMES.join(', ')}`);
    }
    return true;
  } catch (e) {
    if (e.message.includes('URL scheme not allowed')) throw e;
    throw new Error(`Invalid URL: ${e.message}`);
  }
}

/**
 * SECURITY: Verify agent owns the target tab before operations
 * Prevents cross-agent tab interference
 */
function verifyTabOwnership(tabId, agentId, operation) {
  if (!claudezillaWindow) {
    throw new Error('No Claudezilla window active');
  }
  const tabEntry = claudezillaWindow.tabs.find(t => t.tabId === tabId);
  if (!tabEntry) {
    throw new Error(`Tab ${tabId} not found in Claudezilla window`);
  }
  // Allow operations on tabs with 'unknown' owner (legacy compatibility)
  // But if both have IDs and they don't match, deny
  if (tabEntry.ownerId !== 'unknown' && agentId && tabEntry.ownerId !== agentId) {
    throw new Error(`OWNERSHIP: Cannot ${operation} tab ${tabId} (owned by ${tabEntry.ownerId}, you are ${agentId})`);
  }
  return tabEntry;
}

/**
 * Monitor network requests using webRequest API
 */
// SECURITY: Do NOT capture requestBody - it may contain passwords, tokens, credit cards
// Only capture metadata (URL, method, type) for debugging purposes
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const entry = {
      requestId: details.requestId,
      // SECURITY: Redact query params that may contain sensitive data
      url: redactSensitiveUrl(details.url),
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
  { urls: ['<all_urls>'] }
  // SECURITY: Removed 'requestBody' - prevents capturing sensitive POST data
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
 * Get network status for a specific tab (for screenshot timing)
 * @param {number} tabId - Tab to check
 * @returns {object} Network status with pending counts by type
 */
function getTabNetworkStatus(tabId) {
  const now = Date.now();
  const recentWindow = 2000; // Only consider requests from last 2s

  const tabRequests = networkRequests.filter(r =>
    r.tabId === tabId && (now - r.timestamp) < recentWindow
  );

  const pending = tabRequests.filter(r => r.status === 'pending');
  const pendingByType = {};
  pending.forEach(r => {
    pendingByType[r.type] = (pendingByType[r.type] || 0) + 1;
  });

  // Critical = blocks rendering (scripts, stylesheets, xhr/fetch)
  const criticalTypes = ['script', 'stylesheet', 'xmlhttprequest', 'fetch', 'main_frame', 'sub_frame'];
  const criticalPending = pending.filter(r => criticalTypes.includes(r.type)).length;

  // Visual = affects appearance (images, fonts)
  const visualTypes = ['image', 'font', 'media'];
  const visualPending = pending.filter(r => visualTypes.includes(r.type)).length;

  return {
    pending: pending.length,
    pendingByType,
    criticalPending,
    visualPending,
    lastActivity: tabRequests.length > 0 ? Math.max(...tabRequests.map(r => r.timestamp)) : 0,
    isIdle: pending.length === 0,
    isCriticalIdle: criticalPending === 0
  };
}

/**
 * Wait for page to be ready for screenshot (dynamic detection)
 * @param {number} tabId - Tab to wait for
 * @param {object} options - Wait options
 * @returns {Promise<object>} Readiness result with timeline
 */
async function waitForPageReady(tabId, options = {}) {
  const {
    maxWait = 10000,          // Absolute maximum wait
    idleThreshold = 150,      // ms of no activity to consider "settled"
    requireVisualIdle = true, // Wait for images too?
  } = options;

  const startTime = Date.now();
  const timeline = [];
  let lastActivityTime = startTime;

  const log = (event, data = {}) => timeline.push({
    t: Date.now() - startTime,
    event,
    ...data
  });

  log('start', { maxWait, idleThreshold, requireVisualIdle });

  // Fast path: check if already idle
  const initialStatus = getTabNetworkStatus(tabId);
  if (initialStatus.isIdle) {
    log('already_idle');
    // Still do render check for paint settlement
    try {
      const readiness = await executeInTab(tabId, 'checkPageReadiness', {});
      log('render_settled', readiness);
    } catch (e) {
      log('render_check_failed', { error: e.message });
    }
    const totalWait = Date.now() - startTime;
    log('complete', { totalWait });
    return { totalWaitMs: totalWait, timeline, timedOut: false };
  }

  // Phase 1: Wait for critical resources (scripts, XHR, stylesheets)
  while (Date.now() - startTime < maxWait) {
    const status = getTabNetworkStatus(tabId);

    if (status.isCriticalIdle) {
      log('critical_idle', { pending: status.pending, visualPending: status.visualPending });
      break;
    }

    if (status.criticalPending > 0) {
      lastActivityTime = Date.now();
    }

    // Check if we've been waiting too long with no progress
    if (Date.now() - lastActivityTime > idleThreshold * 3) {
      log('critical_timeout', { pending: status.criticalPending });
      break;
    }

    await new Promise(r => setTimeout(r, 25)); // Tight polling for responsiveness
  }

  // Phase 2: Optional visual idle (images, fonts) - capped at 3s
  if (requireVisualIdle) {
    const visualStart = Date.now();
    const visualMaxWait = Math.min(3000, maxWait - (Date.now() - startTime));

    while (Date.now() - visualStart < visualMaxWait) {
      const status = getTabNetworkStatus(tabId);

      if (status.isIdle) {
        log('visual_idle');
        break;
      }

      await new Promise(r => setTimeout(r, 25));
    }

    if (Date.now() - visualStart >= visualMaxWait) {
      const status = getTabNetworkStatus(tabId);
      log('visual_timeout', { visualPending: status.visualPending });
    }
  }

  // Phase 3: Render frame settlement (via content script)
  try {
    const readiness = await executeInTab(tabId, 'checkPageReadiness', {});
    log('render_settled', readiness);
  } catch (e) {
    log('render_check_failed', { error: e.message });
  }

  const totalWait = Date.now() - startTime;
  log('complete', { totalWait });

  return {
    totalWaitMs: totalWait,
    timeline,
    timedOut: totalWait >= maxWait
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
 * Get Claudezilla session (single window, active tab)
 * @param {number} windowId - Optional (ignored, we only have one window)
 * @returns {Promise<{windowId, tabId, tab}>} Session info with tab object
 */
async function getSession(windowId) {
  if (!claudezillaWindow) {
    throw new Error('No active Claudezilla window. Call firefox_create_window first.');
  }

  // Verify window still exists
  try {
    const win = await browser.windows.get(claudezillaWindow.windowId);
    if (!win.incognito) {
      claudezillaWindow = null;
      activeTabId = null;
      throw new Error('Claudezilla window is not private.');
    }

    // Get active tab
    const tabIds = claudezillaWindow.tabs.map(t => t.tabId);
    if (!activeTabId || !tabIds.includes(activeTabId)) {
      const lastTab = claudezillaWindow.tabs[claudezillaWindow.tabs.length - 1];
      activeTabId = lastTab?.tabId;
    }

    const tab = await browser.tabs.get(activeTabId);
    return { windowId: claudezillaWindow.windowId, tabId: activeTabId, tab };
  } catch (e) {
    claudezillaWindow = null;
    activeTabId = null;
    throw new Error('Claudezilla window expired. Call firefox_create_window.');
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
          extension: '0.5.0',
          browser: navigator.userAgent,
          features: ['devtools', 'network', 'console', 'evaluate', 'focusglow', 'tabgroups', 'security-hardened', 'orphan-cleanup'],
        };
        break;

      case 'canNavigate': {
        // Check if navigate command is available (disabled if in private windows mode)
        const allowed = await canRunInPrivateWindows();
        result = { canNavigate: !allowed };
        break;
      }

      case 'navigate': {
        const { url, tabId: targetTabId, agentId } = params;
        if (!url) throw new Error('url is required');

        // SECURITY: Validate URL scheme (blocks javascript:, data:, file://)
        validateUrlScheme(url);

        // If tabId provided, navigate that specific Claudezilla tab (with ownership check)
        if (targetTabId) {
          // Verify the tab is in our pool and agent owns it
          if (agentId) {
            verifyTabOwnership(targetTabId, agentId, 'navigate');
          }
          await browser.tabs.update(targetTabId, { url });
          const tab = await browser.tabs.get(targetTabId);
          result = { tabId: targetTabId, url: tab.url, title: tab.title, navigated: true };
          break;
        }

        // No tabId: navigate active tab (original behavior with restrictions)
        // SECURITY: Disable when extension is allowed in private windows
        // to prevent agents from creating non-private windows
        if (await canRunInPrivateWindows()) {
          throw new Error('SECURITY: firefox_navigate is disabled when extension runs in Private Windows. This prevents creating non-private windows. Use firefox_create_window or provide a tabId to navigate an existing tab.');
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
        // Return Claudezilla tabs with ownership info
        if (!claudezillaWindow) {
          result = { tabs: [], message: 'No Claudezilla window active' };
          break;
        }
        const tabsInfo = await Promise.all(
          claudezillaWindow.tabs.map(async (entry) => {
            try {
              const tab = await browser.tabs.get(entry.tabId);
              return {
                tabId: entry.tabId,
                url: tab.url,
                title: tab.title,
                active: tab.active,
                ownerId: entry.ownerId
              };
            } catch (e) {
              return { tabId: entry.tabId, ownerId: entry.ownerId, error: 'Tab not found' };
            }
          })
        );
        result = {
          windowId: claudezillaWindow.windowId,
          tabs: tabsInfo,
          tabCount: claudezillaWindow.tabs.length,
          maxTabs: MAX_TABS
        };
        break;
      }

      case 'createWindow': {
        // Single window mode: reuse existing window or create new one
        // Max 10 tabs - oldest tab closed when limit reached
        // Tab ownership: each tab tracks its creator agent for close permission
        const { url, agentId } = params;
        const ownerId = agentId || 'unknown';

        // SECURITY: Validate URL scheme (blocks javascript:, data:, file://)
        if (url) {
          validateUrlScheme(url);
        }
        let tabId;
        let isNewWindow = false;
        let closedTabId = null;

        if (claudezillaWindow) {
          // Window exists - verify it's still valid
          try {
            await browser.windows.get(claudezillaWindow.windowId);
          } catch (e) {
            // Window was closed - reset
            claudezillaWindow = null;
          }
        }

        if (claudezillaWindow) {
          // Reuse existing window - create new tab
          // If at max tabs, try to evict ONLY OWN tabs first
          if (claudezillaWindow.tabs.length >= MAX_TABS) {
            // Find tabs owned by this agent
            const ownTabs = claudezillaWindow.tabs.filter(t => t.ownerId === ownerId);

            if (ownTabs.length > 0) {
              // Evict oldest of OUR OWN tabs only
              const oldestOwn = ownTabs[0]; // First = oldest
              const tabIndex = claudezillaWindow.tabs.findIndex(t => t.tabId === oldestOwn.tabId);
              if (tabIndex !== -1) {
                claudezillaWindow.tabs.splice(tabIndex, 1);
              }
              closedTabId = oldestOwn.tabId;
              try {
                await browser.tabs.remove(closedTabId);
                console.log(`[claudezilla] Evicted own tab ${closedTabId} (max ${MAX_TABS} tabs)`);
              } catch (e) {
                console.log('[claudezilla] Could not close own tab:', e.message);
              }
            } else {
              // Agent has NO tabs in pool - cannot evict others' tabs
              // Build owner breakdown for error message
              const ownerCounts = {};
              for (const t of claudezillaWindow.tabs) {
                const shortId = t.ownerId ? t.ownerId.slice(0, 12) + '...' : 'unknown';
                ownerCounts[shortId] = (ownerCounts[shortId] || 0) + 1;
              }
              const breakdown = Object.entries(ownerCounts)
                .map(([id, count]) => `${id}: ${count}`)
                .join(', ');

              throw {
                code: 'POOL_FULL',
                message: `Tab pool full (${MAX_TABS}/${MAX_TABS}). You have no tabs to evict.`,
                tabPool: `${claudezillaWindow.tabs.length}/${MAX_TABS}`,
                ownerBreakdown: breakdown,
                hint: 'Use firefox_request_tab_space to queue a slot request. Agents with >4 tabs will be notified.'
              };
            }
          }

          // Create new tab in existing window
          const newTab = await browser.tabs.create({
            windowId: claudezillaWindow.windowId,
            url: url || 'about:blank',
            active: true
          });
          tabId = newTab.id;
          claudezillaWindow.tabs.push({ tabId, ownerId });
          activeTabId = tabId;

        } else {
          // No window - create new private window
          isNewWindow = true;
          const win = await browser.windows.create({
            incognito: true,
            focused: false,
            url: url || 'about:blank'
          });
          tabId = win.tabs?.[0]?.id;

          // Create tab group for visual distinction (Firefox 138+)
          let groupId = null;
          try {
            if (browser.tabs.group && tabId) {
              groupId = await browser.tabs.group({
                tabIds: [tabId],
                createProperties: { windowId: win.id }
              });
              if (browser.tabGroups?.update && groupId) {
                await browser.tabGroups.update(groupId, {
                  title: 'Claudezilla',
                  color: 'orange'
                });
              }
            }
          } catch (e) {
            console.log('[claudezilla] Tab groups not available:', e.message);
          }

          // Initialize window tracking with ownership
          claudezillaWindow = {
            windowId: win.id,
            tabs: [{ tabId, ownerId }],
            createdAt: Date.now(),
            groupId
          };
          activeTabId = tabId;

          // Legacy session map for backward compat
          sessions.set(win.id, { windowId: win.id, tabId });
        }

        // Enable Claudezilla visuals on this tab
        if (tabId) {
          setTimeout(() => {
            browser.tabs.sendMessage(tabId, { action: 'enableClaudezillaVisuals' }).catch(() => {});
          }, 500);
        }

        result = {
          windowId: claudezillaWindow.windowId,
          tabId,
          ownerId,
          tabCount: claudezillaWindow.tabs.length,
          maxTabs: MAX_TABS,
          isNewWindow,
          closedOldestTab: closedTabId,
          message: `Tab ${claudezillaWindow.tabs.length}/${MAX_TABS}${closedTabId ? ' (closed oldest)' : ''}`
        };
        break;
      }

      case 'closeTab': {
        // Close a specific tab - use this to free up slots in the shared 10-tab pool
        // OWNERSHIP: Only the agent that created the tab can close it
        const { tabId: closeTabId, agentId } = params;

        if (!closeTabId) {
          throw new Error('tabId is required');
        }

        // SECURITY: Require agentId for ownership verification
        if (!agentId) {
          throw new Error('agentId is required for tab close operations');
        }

        if (!claudezillaWindow) {
          throw new Error('No Claudezilla window active');
        }

        const tabEntry = claudezillaWindow.tabs.find(t => t.tabId === closeTabId);
        if (!tabEntry) {
          const availableTabs = claudezillaWindow.tabs.map(t => t.tabId).join(', ');
          throw new Error(`Tab ${closeTabId} not found in Claudezilla window. Available tabs: ${availableTabs}`);
        }

        // SECURITY: Ownership check - agents can only close their own tabs
        // Note: 'unknown' ownership allows any agent to close (legacy tabs created without agentId)
        // This is intentional for backward compatibility, but new tabs always have agentId
        if (tabEntry.ownerId !== 'unknown' && tabEntry.ownerId !== agentId) {
          throw new Error(`OWNERSHIP: Tab ${closeTabId} was created by ${tabEntry.ownerId}. You (${agentId}) cannot close another agent's tab.`);
        }

        // Remove from tracking
        const tabIndex = claudezillaWindow.tabs.indexOf(tabEntry);
        claudezillaWindow.tabs.splice(tabIndex, 1);
        await browser.tabs.remove(closeTabId);

        // Update active tab if we closed it
        if (activeTabId === closeTabId) {
          const lastTab = claudezillaWindow.tabs[claudezillaWindow.tabs.length - 1];
          activeTabId = lastTab?.tabId || null;
        }

        // Check if any pending slot requests can now be fulfilled
        const fulfilledRequest = pendingSlotRequests.shift();

        result = {
          closed: true,
          tabId: closeTabId,
          tabCount: claudezillaWindow.tabs.length,
          maxTabs: MAX_TABS,
          message: `Tab closed. ${claudezillaWindow.tabs.length}/${MAX_TABS} tabs remaining.`,
          slotFreed: fulfilledRequest ? fulfilledRequest.agentId : null
        };
        break;
      }

      case 'requestTabSpace': {
        // Blocked agent requests tab space from agents with >4 tabs
        const { agentId } = params;

        if (!agentId) {
          throw new Error('agentId is required');
        }

        // Check if agent already has a pending request
        const existingRequest = pendingSlotRequests.find(r => r.agentId === agentId);
        if (existingRequest) {
          result = {
            queued: true,
            position: pendingSlotRequests.indexOf(existingRequest) + 1,
            message: 'Already in queue for tab space'
          };
          break;
        }

        // Find agents with >4 tabs who could grant space
        const ownerCounts = {};
        if (claudezillaWindow) {
          for (const t of claudezillaWindow.tabs) {
            const owner = t.ownerId || 'unknown';
            ownerCounts[owner] = (ownerCounts[owner] || 0) + 1;
          }
        }
        const tabHeavyAgents = Object.entries(ownerCounts)
          .filter(([_, count]) => count > 4)
          .map(([id, count]) => ({ agentId: id.slice(0, 20) + '...', tabCount: count }));

        // Add to pending queue
        pendingSlotRequests.push({ agentId, requestedAt: Date.now() });

        result = {
          queued: true,
          position: pendingSlotRequests.length,
          tabHeavyAgents,
          message: tabHeavyAgents.length > 0
            ? `Request queued. ${tabHeavyAgents.length} agent(s) with >4 tabs notified.`
            : 'Request queued. No tab-heavy agents currently.'
        };
        break;
      }

      case 'grantTabSpace': {
        // Agent voluntarily releases their oldest tab to help a waiting agent
        const { agentId } = params;

        if (!agentId) {
          throw new Error('agentId is required');
        }

        if (!claudezillaWindow) {
          throw new Error('No Claudezilla window active');
        }

        // Find this agent's tabs
        const ownTabs = claudezillaWindow.tabs.filter(t => t.ownerId === agentId);

        if (ownTabs.length === 0) {
          throw new Error('You have no tabs to release');
        }

        if (ownTabs.length <= 2) {
          throw new Error(`You only have ${ownTabs.length} tab(s). Keep at least 2 before granting space to others.`);
        }

        // Check if anyone is waiting
        if (pendingSlotRequests.length === 0) {
          result = {
            granted: false,
            message: 'No agents waiting for tab space. Your tabs are safe.'
          };
          break;
        }

        // Release oldest tab
        const oldestOwn = ownTabs[0];
        const tabIndex = claudezillaWindow.tabs.findIndex(t => t.tabId === oldestOwn.tabId);
        if (tabIndex !== -1) {
          claudezillaWindow.tabs.splice(tabIndex, 1);
        }

        try {
          await browser.tabs.remove(oldestOwn.tabId);
        } catch (e) {
          console.log('[claudezilla] Could not close tab:', e.message);
        }

        // Notify waiting agent
        const grantedTo = pendingSlotRequests.shift();

        result = {
          granted: true,
          closedTabId: oldestOwn.tabId,
          grantedTo: grantedTo.agentId.slice(0, 20) + '...',
          tabCount: claudezillaWindow.tabs.length,
          maxTabs: MAX_TABS,
          pendingRequests: pendingSlotRequests.length,
          message: `Released tab ${oldestOwn.tabId}. Slot granted to waiting agent.`
        };
        break;
      }

      case 'getSlotRequests': {
        // Check pending slot requests and your tab count
        const { agentId } = params;

        const ownTabCount = claudezillaWindow
          ? claudezillaWindow.tabs.filter(t => t.ownerId === agentId).length
          : 0;

        result = {
          pendingRequests: pendingSlotRequests.map(r => ({
            agentId: r.agentId.slice(0, 20) + '...',
            waitingMs: Date.now() - r.requestedAt
          })),
          yourTabCount: ownTabCount,
          shouldGrant: ownTabCount > 4 && pendingSlotRequests.length > 0,
          hint: ownTabCount > 4 && pendingSlotRequests.length > 0
            ? 'You have >4 tabs and agents are waiting. Consider using grantTabSpace.'
            : null
        };
        break;
      }

      case 'cleanupOrphanedTabs': {
        // Close all tabs owned by a specific agent (for orphaned agent cleanup)
        // Called by MCP server when an agent hasn't been seen in >2 minutes
        const { agentId } = params;

        if (!agentId) {
          throw new Error('agentId is required');
        }

        if (!claudezillaWindow) {
          result = { tabsClosed: 0, message: 'No Claudezilla window active' };
          break;
        }

        // Find all tabs owned by this agent
        const orphanedTabs = claudezillaWindow.tabs.filter(t => t.ownerId === agentId);

        if (orphanedTabs.length === 0) {
          result = { tabsClosed: 0, message: `No tabs found for agent ${agentId}` };
          break;
        }

        // Close all tabs owned by this agent
        const closedTabIds = [];
        for (const tabEntry of orphanedTabs) {
          try {
            await browser.tabs.remove(tabEntry.tabId);
            closedTabIds.push(tabEntry.tabId);

            // Remove from tracking
            const tabIndex = claudezillaWindow.tabs.indexOf(tabEntry);
            if (tabIndex !== -1) {
              claudezillaWindow.tabs.splice(tabIndex, 1);
            }

            console.log(`[claudezilla] Closed orphaned tab ${tabEntry.tabId} from agent ${agentId}`);
          } catch (e) {
            console.log(`[claudezilla] Could not close orphaned tab ${tabEntry.tabId}:`, e.message);
          }
        }

        // Update active tab if we closed it
        if (closedTabIds.includes(activeTabId)) {
          const lastTab = claudezillaWindow.tabs[claudezillaWindow.tabs.length - 1];
          activeTabId = lastTab?.tabId || null;
        }

        result = {
          tabsClosed: closedTabIds.length,
          closedTabIds,
          agentId: agentId.slice(0, 20) + '...',
          tabCount: claudezillaWindow.tabs.length,
          maxTabs: MAX_TABS,
          message: `Cleaned up ${closedTabIds.length} orphaned tab(s) from agent ${agentId.slice(0, 20)}...`
        };
        break;
      }

      case 'closeWindow': {
        // Close the entire Claudezilla window - WARNING: affects all agents
        const { agentId } = params;

        if (!claudezillaWindow) {
          throw new Error('No Claudezilla window to close');
        }

        // SECURITY: Check if agent owns all tabs or if there are no other owners
        const tabOwners = new Set(claudezillaWindow.tabs.map(t => t.ownerId).filter(o => o !== 'unknown'));
        const hasMultipleOwners = tabOwners.size > 1;
        const isOnlyOwner = tabOwners.size === 0 || (tabOwners.size === 1 && tabOwners.has(agentId));

        if (hasMultipleOwners && !isOnlyOwner && agentId) {
          const otherOwners = [...tabOwners].filter(o => o !== agentId);
          throw new Error(`OWNERSHIP: Cannot close window - other agents have tabs open: ${otherOwners.join(', ')}. Use firefox_close_tab to close your own tabs.`);
        }

        const winId = claudezillaWindow.windowId;
        const tabCount = claudezillaWindow.tabs.length;
        sessions.delete(winId);
        claudezillaWindow = null;
        activeTabId = null;
        await browser.windows.remove(winId);
        result = { closed: true, windowId: winId, tabsClosed: tabCount };
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
        const { windowId, tabId: targetTab, agentId, ...contentParams } = params;
        const session = await getSession(windowId);
        const tabId = targetTab || session.tabId;
        // SECURITY: Verify agent owns the target tab (if specific tab requested)
        if (targetTab && agentId) {
          verifyTabOwnership(targetTab, agentId, 'read content from');
        }
        const response = await executeInTab(tabId, 'getContent', contentParams);
        result = { tabId, ...response.result };
        break;
      }

      case 'click': {
        const { windowId, tabId: targetTab, agentId, ...clickParams } = params;
        const session = await getSession(windowId);
        const tabId = targetTab || session.tabId;
        // SECURITY: Verify agent owns the target tab
        if (targetTab && agentId) {
          verifyTabOwnership(targetTab, agentId, 'click in');
        }
        const response = await executeInTab(tabId, 'click', clickParams);
        result = { tabId, ...response.result };
        break;
      }

      case 'type': {
        const { windowId, tabId: targetTab, agentId, ...typeParams } = params;
        const session = await getSession(windowId);
        const tabId = targetTab || session.tabId;
        // SECURITY: Verify agent owns the target tab
        if (targetTab && agentId) {
          verifyTabOwnership(targetTab, agentId, 'type in');
        }
        const response = await executeInTab(tabId, 'type', typeParams);
        result = { tabId, ...response.result };
        break;
      }

      case 'screenshot': {
        // MUTEX: Serialize all screenshot requests to prevent tab-switching collisions
        // (captureVisibleTab only works on visible tab)
        // Get user's compression preference
        const stored = await browser.storage.local.get('claudezilla');
        const settings = { compressImages: true, ...(stored.claudezilla || {}) };
        const defaultFormat = settings.compressImages ? 'jpeg' : 'png';

        const {
          windowId,
          tabId: requestedTabId,
          agentId,
          quality = 60,
          scale = 0.5,
          format = defaultFormat,
          // NEW: Page readiness options
          maxWait = 10000,
          waitForImages = true,
          skipReadiness = false
        } = params;

        // SECURITY: Verify agent owns the target tab before queuing screenshot
        if (requestedTabId && agentId) {
          verifyTabOwnership(requestedTabId, agentId, 'screenshot');
        }

        // Generate unique request ID for this screenshot to track through mutex
        const screenshotRequestId = `ss_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        // MUTEX_BUSY check: If another agent has held the mutex too long, return busy
        if (screenshotMutexHolder && screenshotMutexHolder.agentId !== agentId) {
          const heldFor = Date.now() - screenshotMutexHolder.acquiredAt;
          if (heldFor > MUTEX_BUSY_THRESHOLD_MS) {
            const tabCount = claudezillaWindow?.tabs?.length || 0;
            throw {
              code: 'MUTEX_BUSY',
              message: `Screenshot mutex held by another agent`,
              holder: screenshotMutexHolder.agentId.slice(0, 20) + '...', // Truncate for privacy
              heldForMs: heldFor,
              retryAfterMs: 2000,
              tabPool: `${tabCount}/${MAX_TABS}`,
              hint: 'Another agent is capturing. Use getPageState (no mutex) or retry after delay.'
            };
          }
        }

        const screenshotPromise = screenshotLock.then(async () => {
          // Acquire mutex - track holder
          screenshotMutexHolder = { agentId, acquiredAt: Date.now(), requestId: screenshotRequestId };

          try {
          const session = await getSession(windowId);
          let screenshotReadiness = null;

          // Determine which tab to capture
          const tabIds = claudezillaWindow?.tabs.map(t => t.tabId) || [];
          let targetTabId = requestedTabId || activeTabId;
          if (requestedTabId && claudezillaWindow && !tabIds.includes(requestedTabId)) {
            throw new Error(`Tab ${requestedTabId} not found in Claudezilla window. Available tabs: ${tabIds.join(', ')}`);
          }

          // If specific tab requested and it's not visible, switch to it first
          if (targetTabId && targetTabId !== activeTabId) {
            await browser.tabs.update(targetTabId, { active: true });
            activeTabId = targetTabId;

            // Dynamic page readiness detection (replaces hardcoded 150ms)
            if (!skipReadiness) {
              screenshotReadiness = await waitForPageReady(targetTabId, {
                maxWait,
                requireVisualIdle: waitForImages
              });
            }

            // Verify the tab is still active after wait (prevents race)
            const [currentActive] = await browser.tabs.query({ active: true, windowId: session.windowId });
            if (currentActive?.id !== targetTabId) {
              throw new Error(`Screenshot race: tab ${targetTabId} was switched away during capture`);
            }
          } else if (!skipReadiness) {
            // Even without tab switch, do quick render check for current tab
            screenshotReadiness = await waitForPageReady(targetTabId, {
              maxWait: Math.min(maxWait, 2000), // Shorter wait for already-visible tab
              requireVisualIdle: waitForImages
            });
          }

          // Capture with JPEG compression (much smaller than PNG)
          const captureFormat = format === 'png' ? 'png' : 'jpeg';
          const captureOpts = { format: captureFormat };
          if (captureFormat === 'jpeg') {
            captureOpts.quality = Math.min(100, Math.max(1, quality));
          }
          const rawDataUrl = await browser.tabs.captureVisibleTab(session.windowId, captureOpts);

          // Build base response with readiness data
          const baseResponse = {
            tabId: targetTabId,
            format: captureFormat,
            quality,
            readiness: screenshotReadiness ? {
              waitMs: screenshotReadiness.totalWaitMs,
              timedOut: screenshotReadiness.timedOut,
              timeline: screenshotReadiness.timeline
            } : { waitMs: 0, timedOut: false, timeline: [] }
          };

          // If scale < 1, resize via content script
          if (scale < 1) {
            const response = await executeInTab(targetTabId, 'resizeImage', {
              dataUrl: rawDataUrl,
              scale,
              quality,
              format: captureFormat,
            });
            return {
              ...baseResponse,
              dataUrl: response.result.dataUrl,
              originalSize: response.result.originalSize,
              scaledSize: response.result.scaledSize,
              scale,
            };
          } else {
            return { ...baseResponse, dataUrl: rawDataUrl, scale: 1 };
          }
          } finally {
            // Release mutex
            screenshotMutexHolder = null;
          }
        });

        // Chain this request to the lock (error handling keeps chain alive)
        screenshotLock = screenshotPromise.catch(() => {});
        result = await screenshotPromise;
        break;
      }

      // ===== DEVTOOLS COMMANDS =====
      // All commands accept optional tabId to target specific tabs (background tabs work fine)

      case 'getConsoleLogs': {
        const { windowId, tabId: targetTab, agentId, ...consoleParams } = params;
        const session = await getSession(windowId);
        const tabId = targetTab || session.tabId;
        // SECURITY: Verify agent owns the target tab
        if (targetTab && agentId) {
          verifyTabOwnership(targetTab, agentId, 'read console from');
        }
        const response = await executeInTab(tabId, 'getConsoleLogs', consoleParams);
        result = { tabId, ...response.result };
        break;
      }

      case 'getNetworkRequests': {
        const { windowId, tabId: targetTab, agentId, ...networkParams } = params;
        const session = await getSession(windowId);
        const tabId = targetTab || session.tabId;
        // SECURITY: Verify agent owns the target tab
        if (targetTab && agentId) {
          verifyTabOwnership(targetTab, agentId, 'read network from');
        }
        result = { tabId, ...getNetworkRequests({ ...networkParams, tabId }) };
        break;
      }

      case 'scroll': {
        const { windowId, tabId: targetTab, agentId, ...scrollParams } = params;
        const session = await getSession(windowId);
        const tabId = targetTab || session.tabId;
        // SECURITY: Verify agent owns the target tab
        if (targetTab && agentId) {
          verifyTabOwnership(targetTab, agentId, 'scroll in');
        }
        const response = await executeInTab(tabId, 'scroll', scrollParams);
        result = { tabId, ...response.result };
        break;
      }

      case 'waitFor': {
        const { windowId, tabId: targetTab, agentId, ...waitParams } = params;
        const session = await getSession(windowId);
        const tabId = targetTab || session.tabId;
        // SECURITY: Verify agent owns the target tab
        if (targetTab && agentId) {
          verifyTabOwnership(targetTab, agentId, 'wait in');
        }
        const response = await executeInTab(tabId, 'waitFor', waitParams);
        result = { tabId, ...response.result };
        break;
      }

      case 'evaluate': {
        const { windowId, tabId: targetTab, agentId, ...evalParams } = params;
        const session = await getSession(windowId);
        const tabId = targetTab || session.tabId;
        // SECURITY: Verify agent owns the target tab (evaluate is high-privilege)
        if (targetTab && agentId) {
          verifyTabOwnership(targetTab, agentId, 'evaluate in');
        }
        const response = await executeInTab(tabId, 'evaluate', evalParams);
        result = { tabId, ...response.result };
        break;
      }

      case 'getElementInfo': {
        const { windowId, tabId: targetTab, agentId, ...elementParams } = params;
        const session = await getSession(windowId);
        const tabId = targetTab || session.tabId;
        // SECURITY: Verify agent owns the target tab
        if (targetTab && agentId) {
          verifyTabOwnership(targetTab, agentId, 'inspect element in');
        }
        const response = await executeInTab(tabId, 'getElementInfo', elementParams);
        result = { tabId, ...response.result };
        break;
      }

      case 'getPageState': {
        const { windowId, tabId: targetTab, agentId } = params;
        const session = await getSession(windowId);
        const tabId = targetTab || session.tabId;
        // SECURITY: Verify agent owns the target tab
        if (targetTab && agentId) {
          verifyTabOwnership(targetTab, agentId, 'read page state from');
        }
        const response = await executeInTab(tabId, 'getPageState', {});
        result = { tabId, ...response.result };
        break;
      }

      case 'getAccessibilitySnapshot': {
        const { windowId, tabId: targetTab, agentId, ...a11yParams } = params;
        const session = await getSession(windowId);
        const tabId = targetTab || session.tabId;
        // SECURITY: Verify agent owns the target tab
        if (targetTab && agentId) {
          verifyTabOwnership(targetTab, agentId, 'read accessibility from');
        }
        const response = await executeInTab(tabId, 'getAccessibilitySnapshot', a11yParams);
        result = { tabId, ...response.result };
        break;
      }

      case 'pressKey': {
        const { windowId, tabId: targetTab, agentId, ...keyParams } = params;
        const session = await getSession(windowId);
        const tabId = targetTab || session.tabId;
        // SECURITY: Verify agent owns the target tab
        if (targetTab && agentId) {
          verifyTabOwnership(targetTab, agentId, 'send keys to');
        }
        const response = await executeInTab(tabId, 'pressKey', keyParams);
        result = { tabId, ...response.result };
        break;
      }

      default:
        throw new Error(`Unknown command: ${command}`);
    }

    // Send result back to host
    port.postMessage({ id, success: true, result });
  } catch (error) {
    console.error('[claudezilla] CLI command error:', error);
    // Structured errors (like MUTEX_BUSY) pass through with full details
    if (error && error.code) {
      port.postMessage({ id, success: false, error: error.message, details: error });
    } else {
      port.postMessage({ id, success: false, error: error.message || String(error) });
    }
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

        // Loop/concentration commands - forward to native host
        case 'getLoopState':
          result = await sendToHost('getLoopState');
          break;

        case 'stopLoop':
          result = await sendToHost('stopLoop');
          break;

        case 'startLoop':
          result = await sendToHost('startLoop', params);
          break;

        case 'openPopup':
          // Open extension popup when watermark is clicked
          // Firefox 57+ supports browserAction.openPopup()
          try {
            await browser.browserAction.openPopup();
            result = { opened: true };
          } catch (e) {
            // Fallback: just acknowledge - popup can only be opened by user click on toolbar icon
            console.log('[claudezilla] openPopup not available:', e.message);
            result = { opened: false, reason: 'openPopup not supported in this context' };
          }
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

// Clean up when Claudezilla window is closed
browser.windows.onRemoved.addListener((windowId) => {
  if (claudezillaWindow && claudezillaWindow.windowId === windowId) {
    console.log('[claudezilla] Window closed');
    sessions.delete(windowId);
    claudezillaWindow = null;
    activeTabId = null;
  }
});

// Track when tabs are closed (keep tabs array in sync)
browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (claudezillaWindow) {
    const tabIndex = claudezillaWindow.tabs.findIndex(t => t.tabId === tabId);
    if (tabIndex > -1) {
      claudezillaWindow.tabs.splice(tabIndex, 1);
      console.log(`[claudezilla] Tab ${tabId} closed. ${claudezillaWindow.tabs.length}/${MAX_TABS} tabs remaining.`);
    }
    if (activeTabId === tabId) {
      const lastTab = claudezillaWindow.tabs[claudezillaWindow.tabs.length - 1];
      activeTabId = lastTab?.tabId || null;
    }
  }
});

// Re-enable visuals when a Claudezilla tab navigates to a new page
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only act when page has finished loading
  if (changeInfo.status !== 'complete') return;

  // Check if this tab belongs to Claudezilla
  if (claudezillaWindow && claudezillaWindow.tabs.some(t => t.tabId === tabId)) {
    // Re-enable visuals on this tab (content script was re-injected)
    setTimeout(() => {
      browser.tabs.sendMessage(tabId, { action: 'enableClaudezillaVisuals' }).catch(() => {});
    }, 100);
  }
});

// Track active tab changes within Claudezilla window
browser.tabs.onActivated.addListener((activeInfo) => {
  if (claudezillaWindow && activeInfo.windowId === claudezillaWindow.windowId) {
    if (claudezillaWindow.tabs.some(t => t.tabId === activeInfo.tabId)) {
      activeTabId = activeInfo.tabId;
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
