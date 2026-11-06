// Setup page behaviour (platform tabs, manual-config collapsible, Stripe thank-you).
// Loaded from extension.html: the site CSP (script-src 'self') blocks inline scripts and handlers.
// The ?session_id= thank-you only runs if this page is opened with that parameter; the worker's
// Stripe success_url points at /extension/welcome.html?session_id=, which website/ does not serve.

// Platform tab switching
document.querySelectorAll('.platform-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const platform = tab.dataset.platform;

    // Update tabs
    document.querySelectorAll('.platform-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Update content
    document.querySelectorAll('.platform-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.platform-content[data-platform="${platform}"]`).classList.add('active');
  });
});

// Collapsible toggle
document.querySelectorAll('.collapsible-trigger').forEach(trigger => {
  trigger.addEventListener('click', () => {
    trigger.classList.toggle('open');
    trigger.nextElementSibling.classList.toggle('open');
  });
});

// Check for Stripe checkout success redirect
(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session_id');

  if (sessionId) {
    showThankYouModal();
    const newUrl = window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);
  }

  function showThankYouModal() {
    const overlay = document.createElement('div');
    overlay.className = 'thank-you-overlay';

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

    setTimeout(() => {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
    }, 4000);
  }
})();
