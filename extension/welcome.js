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
 * SECURITY: Uses safe DOM methods instead of innerHTML to prevent XSS
 */
function showThankYouModal() {
  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'thank-you-overlay';

  // SECURITY: Build modal using safe DOM methods (no innerHTML)
  const modal = document.createElement('div');
  modal.className = 'thank-you-modal';

  const checkmark = document.createElement('div');
  checkmark.className = 'checkmark';
  checkmark.textContent = '✓';

  const heading = document.createElement('h2');
  heading.textContent = 'Thank You!';

  const message = document.createElement('p');
  message.textContent = 'Your support keeps Claudezilla free and open source.';

  const receiptNote = document.createElement('p');
  receiptNote.className = 'receipt-note';
  receiptNote.textContent = "You'll receive a receipt via email shortly.";

  modal.appendChild(checkmark);
  modal.appendChild(heading);
  modal.appendChild(message);
  modal.appendChild(receiptNote);
  overlay.appendChild(modal);

  document.body.appendChild(overlay);

  // Auto-close after 4 seconds
  setTimeout(() => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
  }, 4000);
}

// Check for payment success on page load
checkForPaymentSuccess();
