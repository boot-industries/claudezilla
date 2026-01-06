/**
 * Claudezilla Popup Script
 * v0.4.2 - Visual effects settings
 */

// Elements
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const infoDiv = document.getElementById('info');
const errorDiv = document.getElementById('error');
const pingBtn = document.getElementById('pingBtn');
const showWatermarkCheckbox = document.getElementById('showWatermark');
const showFocusglowCheckbox = document.getElementById('showFocusglow');
const compressImagesCheckbox = document.getElementById('compressImages');

// Default settings
const DEFAULT_SETTINGS = {
  showWatermark: true,
  showFocusglow: true,
  compressImages: true,
};

/**
 * Load settings from storage
 */
async function loadSettings() {
  try {
    const stored = await browser.storage.local.get('claudezilla');
    const settings = { ...DEFAULT_SETTINGS, ...stored.claudezilla };
    showWatermarkCheckbox.checked = settings.showWatermark;
    showFocusglowCheckbox.checked = settings.showFocusglow;
    compressImagesCheckbox.checked = settings.compressImages;
  } catch (e) {
    console.log('[claudezilla] Could not load settings:', e.message);
  }
}

/**
 * Save settings to storage
 */
async function saveSettings() {
  try {
    const settings = {
      showWatermark: showWatermarkCheckbox.checked,
      showFocusglow: showFocusglowCheckbox.checked,
      compressImages: compressImagesCheckbox.checked,
    };
    await browser.storage.local.set({ claudezilla: settings });
  } catch (e) {
    console.log('[claudezilla] Could not save settings:', e.message);
  }
}

function setStatus(connected, text) {
  if (connected) {
    statusIndicator.classList.add('connected');
  } else {
    statusIndicator.classList.remove('connected');
  }
  statusText.textContent = text;
}

function setInfo(info) {
  infoDiv.innerHTML = '';
  infoDiv.style.display = 'block';
  Object.entries(info).forEach(([key, value]) => {
    const div = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = key + ':';
    div.appendChild(strong);
    div.appendChild(document.createTextNode(' ' + value));
    infoDiv.appendChild(div);
  });
}

function showError(message) {
  errorDiv.textContent = message;
  errorDiv.classList.add('visible');
}

function hideError() {
  errorDiv.classList.remove('visible');
}

async function sendMessage(action, params = {}) {
  try {
    const response = await browser.runtime.sendMessage({ action, params });
    if (!response) {
      throw new Error('No response from background script');
    }
    if (!response.success) {
      throw new Error(response.error || 'Unknown error');
    }
    return response.result;
  } catch (error) {
    throw new Error(error.message || 'Failed to send message');
  }
}

async function testConnection() {
  hideError();
  setStatus(false, 'Testing...');

  try {
    const result = await sendMessage('ping');
    setStatus(true, 'Connected');
    setInfo({
      'Host Response': result.pong ? 'OK' : 'Unknown',
      'Timestamp': new Date(result.timestamp).toLocaleTimeString(),
    });

    // Get version info
    const version = await sendMessage('version');
    setInfo({
      'Host Version': version.host,
      'Node.js': version.node,
      'Platform': version.platform,
    });
  } catch (error) {
    setStatus(false, 'Disconnected');
    showError(error.message);
  }
}

// Check permission status
async function checkPermissionStatus() {
  const permissionStateEl = document.getElementById('permissionState');
  try {
    const hasPermission = await browser.extension.isAllowedIncognitoAccess();
    if (hasPermission) {
      permissionStateEl.textContent = 'Enabled';
      permissionStateEl.style.color = '#22C55E';
    } else {
      permissionStateEl.textContent = 'Not Enabled';
      permissionStateEl.style.color = '#EF4444';
    }
  } catch (e) {
    permissionStateEl.textContent = 'Unknown';
    permissionStateEl.style.color = '#888';
  }
}

// Check if this is first run and show welcome page
async function checkFirstRun() {
  try {
    const stored = await browser.storage.local.get('welcomePageSeen');
    const hasPermission = await browser.extension.isAllowedIncognitoAccess();

    // Show welcome page if not seen AND permission not enabled
    if (!stored.welcomePageSeen && !hasPermission) {
      browser.tabs.create({ url: browser.runtime.getURL('welcome.html') });
    }
  } catch (e) {
    console.log('[claudezilla] Could not check first run:', e);
  }
}

// Initialize
async function init() {
  // Check for first run
  await checkFirstRun();

  // Load settings
  await loadSettings();

  // Add setting change listeners
  showWatermarkCheckbox.addEventListener('change', saveSettings);
  showFocusglowCheckbox.addEventListener('change', saveSettings);
  compressImagesCheckbox.addEventListener('change', saveSettings);

  // Check permission status
  await checkPermissionStatus();

  // Test connection on popup open
  testConnection();

  // Manual test button
  pingBtn.addEventListener('click', testConnection);

  // Support link - open support page in new tab
  const supportLink = document.getElementById('supportLink');
  if (supportLink) {
    supportLink.addEventListener('click', (e) => {
      e.preventDefault();
      browser.tabs.create({ url: browser.runtime.getURL('support.html') });
      window.close(); // Close popup after opening
    });
  }
}

init();
