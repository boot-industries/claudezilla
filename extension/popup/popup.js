/**
 * Claudezilla Popup Script
 */

const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const infoDiv = document.getElementById('info');
const errorDiv = document.getElementById('error');
const pingBtn = document.getElementById('pingBtn');

function setStatus(connected, text) {
  if (connected) {
    statusIndicator.classList.add('connected');
  } else {
    statusIndicator.classList.remove('connected');
  }
  statusText.textContent = text;
}

function setInfo(info) {
  infoDiv.innerHTML = Object.entries(info)
    .map(([key, value]) => `<div><strong>${key}:</strong> ${value}</div>`)
    .join('');
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

// Test connection on popup open
testConnection();

// Manual test button
pingBtn.addEventListener('click', testConnection);
