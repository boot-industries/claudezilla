/**
 * Claudezilla Support Page Logic
 *
 * Handles amount selection, frequency toggling, and Stripe checkout creation.
 * Adapted from extension/support.js for website use.
 */

// Cloudflare Worker endpoint for Stripe checkout
const WORKER_URL = 'https://api.claudezilla.com';

let selectedAmount = 2000; // $20 default (in cents)
let selectedFrequency = 'one-time';

// Amount pill selection
document.querySelectorAll('.amount-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.amount-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    selectedAmount = parseInt(pill.dataset.amount);
    document.getElementById('customAmount').value = '';
    updateSubmitButton();
  });
});

// Custom amount input
const customAmountInput = document.getElementById('customAmount');
customAmountInput.addEventListener('input', (e) => {
  const dollars = parseFloat(e.target.value);
  if (dollars && dollars >= 3) {
    selectedAmount = Math.round(dollars * 100);
    document.querySelectorAll('.amount-pill').forEach(p => p.classList.remove('active'));
    updateSubmitButton();
  }
});

// Frequency toggle
document.querySelectorAll('.frequency-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.frequency-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedFrequency = btn.dataset.frequency;
    updateSubmitButton();
  });
});

// Update submit button text
function updateSubmitButton() {
  const dollars = (selectedAmount / 100).toFixed(0);
  const suffix = selectedFrequency === 'monthly' ? ' /MONTH' : '';
  document.getElementById('submitBtn').textContent = `CONTRIBUTE $${dollars}${suffix}`;
}

// Submit handler
document.getElementById('submitBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('errorMessage');
  const loadingEl = document.getElementById('loadingOverlay');

  // Validation
  if (selectedAmount < 300) {
    errorEl.textContent = 'Minimum amount is $3';
    errorEl.style.display = 'block';
    return;
  }

  try {
    errorEl.style.display = 'none';
    loadingEl.style.display = 'flex';

    const response = await fetch(`${WORKER_URL}/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: selectedAmount,
        frequency: selectedFrequency
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create checkout session');
    }

    const { url } = await response.json();

    // Redirect to Stripe Checkout
    window.location.href = url;

  } catch (error) {
    console.error('Checkout error:', error);
    errorEl.textContent = error.message;
    errorEl.style.display = 'block';
    loadingEl.style.display = 'none';
  }
});
