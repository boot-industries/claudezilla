# Claudezilla Stripe Support Setup Guide

This guide explains how to deploy and configure the Stripe support feature for Claudezilla.

## Prerequisites

1. **Cloudflare Account** - For hosting the worker
2. **Stripe Account** - For processing payments
3. **Node.js & npm** - For building and deploying
4. **Wrangler CLI** - Cloudflare's CLI tool

## Setup Steps

### 1. Install Dependencies

```bash
# Install Wrangler CLI globally
npm install -g wrangler

# In the worker directory
cd worker
npm install
```

### 2. Get Your Stripe Secret Key

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/apikeys)
2. Copy your **Secret Key** (starts with `sk_...`)
3. Keep this secure - do NOT commit it to version control

### 3. Deploy the Cloudflare Worker

```bash
cd worker

# Set your Stripe secret key as a Cloudflare secret
wrangler secret put STRIPE_SECRET_KEY
# Paste your Stripe secret key when prompted

# Deploy the worker
wrangler deploy
```

The output will show your Worker URL:
```
https://claudezilla-worker.<YOUR_SUBDOMAIN>.workers.dev
```

### 4. Update the Frontend Code

Edit `extension/support.js` and replace the placeholder:

```javascript
const WORKER_URL = 'https://claudezilla-worker.<YOUR_SUBDOMAIN>.workers.dev';
```

### 5. Configure Success Redirect URL

The Worker uses `FRONTEND_URL` environment variable for post-payment redirects.

**Option A: Local Testing (moz-extension://)**
```toml
# worker/wrangler.toml
[vars]
FRONTEND_URL = "moz-extension://YOUR_EXTENSION_ID"
```
Note: Stripe may not accept `moz-extension://` URLs. You'll need to test with a public URL or use a workaround.

**Option B: Production (Recommended)**
Host the welcome page at a public URL (e.g., boot.industries/claudezilla):
```toml
# worker/wrangler.toml
[vars]
FRONTEND_URL = "https://boot.industries/claudezilla"
```

Then update `wrangler.toml` and redeploy:
```bash
wrangler deploy
```

## Testing the Flow

1. **Open the Welcome Page**
   - Open `extension/welcome.html` in Firefox
   - You should see the "☕ Buy Me a Coffee" button

2. **Click Support Button**
   - Select an amount ($5, $10, $20, $50)
   - Toggle between One-time and Monthly
   - Click "CONTRIBUTE"

3. **Stripe Checkout**
   - You should be redirected to Stripe Checkout
   - Use Stripe's test card: `4242 4242 4242 4242`
   - Enter any future expiry date and any CVC

4. **Success Redirect**
   - After payment, redirected back to welcome page with `?session_id=...`
   - Thank you modal should appear
   - Modal auto-closes after 4 seconds

## Troubleshooting

### "Worker URL not found"
- Verify the URL in `support.js` matches your deployed worker
- Run `wrangler deploy` again in the `worker/` directory

### "STRIPE_SECRET_KEY not configured"
- Check the secret is set: `wrangler secret list`
- Re-run: `wrangler secret put STRIPE_SECRET_KEY`

### "Invalid request" from Stripe
- Verify `FRONTEND_URL` in `wrangler.toml` is correct
- Check amount is >= $3 (300 cents)
- Check frequency is "one-time" or "monthly"

### "CORS error" from extension
- Ensure Worker allows CORS (check `/create-checkout` response headers)
- Verify Worker URL is correct in `support.js`

### Thank You Modal Doesn't Appear
- Check browser console for JavaScript errors
- Verify `session_id` param is in the URL after redirect
- Check that `welcome.js` is loaded and contains `checkForPaymentSuccess()` call

## Security Notes

- **Never commit STRIPE_SECRET_KEY** to version control
- Wrangler stores secrets in Cloudflare Workers environment
- The Worker validates:
  - Minimum amount ($3 / 300 cents)
  - Valid frequency (one-time, monthly)
  - Request origin (CORS enabled for all origins - adjust if needed)

## Webhook Setup (Optional, For Future)

The infrastructure supports webhooks for future features:
```bash
wrangler secret put STRIPE_WEBHOOK_SECRET
```

This would allow tracking payment confirmations server-side instead of relying on redirect parameters.

## Files Modified/Created

- ✅ `worker/src/index.ts` - Stripe checkout endpoint
- ✅ `worker/wrangler.toml` - Worker configuration
- ✅ `worker/package.json` - Dependencies
- ✅ `worker/tsconfig.json` - TypeScript config
- ✅ `extension/support.html` - Support page UI
- ✅ `extension/support.js` - Support page logic
- ✅ `extension/support.css` - Support page styles
- ✅ `extension/welcome.html` - Added support CTA section
- ✅ `extension/welcome.js` - Added session_id detection
- ✅ `extension/popup/popup.html` - Added support footer link
- ✅ `extension/popup/popup.js` - Added support link handler

## Next Steps

1. Deploy the Worker with your Stripe keys
2. Update `support.js` with the Worker URL
3. Test the complete flow with Stripe's test card
4. Update extension version to 0.5.0
5. Commit and merge to main branch
