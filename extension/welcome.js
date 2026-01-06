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

// Check permission status
checkPermissionStatus();

// Recheck every 2 seconds in case user enables permission
setInterval(checkPermissionStatus, 2000);

/**
 * Support button - open support page in new tab
 */
const supportBtn = document.getElementById('supportBtn');
if (supportBtn) {
  supportBtn.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('support.html') });
  });
}

/**
 * Check for Stripe checkout success redirect
 * Stripe redirects to: /extension/welcome.html?session_id=cs_...
 */
function checkForPaymentSuccess() {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session_id');

  if (sessionId) {
    showThankYouModal();
    // Clear session_id from URL
    const newUrl = window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);
  }
}

/**
 * Display thank you modal after successful payment
 */
function showThankYouModal() {
  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'thank-you-overlay';
  overlay.innerHTML = `
    <div class="thank-you-modal">
      <div class="checkmark">✓</div>
      <h2>Thank You!</h2>
      <p>Your support keeps Claudezilla free and open source.</p>
      <p class="receipt-note">You'll receive a receipt via email shortly.</p>
    </div>
  `;
  document.body.appendChild(overlay);

  // Auto-close after 4 seconds
  setTimeout(() => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
  }, 4000);
}

// Check for payment success on page load
checkForPaymentSuccess();
