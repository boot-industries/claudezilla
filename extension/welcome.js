/**
 * Claudezilla Welcome Page
 * First-run onboarding experience
 */

// Check permission status on load
async function checkPermissionStatus() {
  const permissionBadge = document.getElementById('permissionStatus');

  try {
    const hasPermission = await browser.extension.isAllowedIncognitoAccess();

    if (hasPermission) {
      permissionBadge.classList.remove('disabled');
      permissionBadge.classList.add('enabled');
      permissionBadge.innerHTML = '<span class="dot"></span>Private Windows: Enabled ✓';
    }
  } catch (e) {
    console.log('[claudezilla] Could not check permission status:', e);
  }
}

// Open extension settings
document.getElementById('openSettings').addEventListener('click', () => {
  // Open about:addons page
  browser.tabs.create({ url: 'about:addons' });
});

// Close tab
document.getElementById('closeTab').addEventListener('click', () => {
  // Mark as seen so we don't show again
  browser.storage.local.set({ welcomePageSeen: true });
  window.close();
});

// Check permission status
checkPermissionStatus();

// Recheck every 2 seconds in case user enables permission
setInterval(checkPermissionStatus, 2000);
