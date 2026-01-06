/**
 * Claudezilla Stripe Checkout Worker
 *
 * Handles payment session creation for Stripe Checkout.
 * Communicates with Stripe API and returns checkout URLs to the extension.
 *
 * SECURITY:
 * - Origin validation against whitelist
 * - Amount bounds checking (min $3, max $999.99)
 * - Redirect URL whitelist
 * - Type validation on all inputs
 */

interface Env {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  FRONTEND_URL?: string;
}

// SECURITY: Allowed origins for CORS and request validation
const ALLOWED_ORIGINS = [
  'https://boot.industries',
  'https://claudezilla.com',
  'https://www.claudezilla.com',
];

// SECURITY: Allowed redirect URL prefixes
const ALLOWED_REDIRECT_PREFIXES = [
  'https://boot.industries',
  'https://claudezilla.com',
];

// SECURITY: Amount limits in cents
const MIN_AMOUNT = 300;      // $3.00
const MAX_AMOUNT = 99999;    // $999.99

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    // SECURITY: Validate origin against whitelist
    // Allow requests with no origin (direct API calls) but validate if present
    const isAllowedOrigin = !origin || ALLOWED_ORIGINS.includes(origin);
    const corsOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    // CORS headers - use specific origin, not wildcard
    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'false',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // /create-checkout endpoint
    if (url.pathname === '/create-checkout' && request.method === 'POST') {
      // SECURITY: Reject requests from non-whitelisted origins
      if (!isAllowedOrigin) {
        return Response.json(
          { error: 'Origin not allowed' },
          { status: 403, headers: corsHeaders }
        );
      }

      try {
        const body = await request.json();
        const { amount, frequency } = body;

        // Validation: amount must be a number
        if (typeof amount !== 'number') {
          return Response.json(
            { error: 'Amount must be a number' },
            { status: 400, headers: corsHeaders }
          );
        }

        // Validation: amount minimum ($3)
        if (amount < MIN_AMOUNT) {
          return Response.json(
            { error: `Amount must be at least $${MIN_AMOUNT / 100} (${MIN_AMOUNT} cents)` },
            { status: 400, headers: corsHeaders }
          );
        }

        // SECURITY: Amount maximum ($999.99) to prevent abuse
        if (amount > MAX_AMOUNT) {
          return Response.json(
            { error: `Amount cannot exceed $${MAX_AMOUNT / 100}` },
            { status: 400, headers: corsHeaders }
          );
        }

        // Validation: frequency must be string and valid value
        if (typeof frequency !== 'string' || !['one-time', 'monthly'].includes(frequency)) {
          return Response.json(
            { error: 'Frequency must be "one-time" or "monthly"' },
            { status: 400, headers: corsHeaders }
          );
        }

        // Get Stripe secret key
        const stripeKey = env.STRIPE_SECRET_KEY;
        if (!stripeKey) {
          return Response.json(
            { error: 'Stripe not configured' },
            { status: 500, headers: corsHeaders }
          );
        }

        // Get frontend URL for redirects
        const frontendUrl = env.FRONTEND_URL || 'https://boot.industries';

        // SECURITY: Validate redirect URL against whitelist
        const isValidRedirect = ALLOWED_REDIRECT_PREFIXES.some(prefix => frontendUrl.startsWith(prefix));
        if (!isValidRedirect) {
          console.error('Invalid FRONTEND_URL configuration:', frontendUrl);
          return Response.json(
            { error: 'Server misconfiguration' },
            { status: 500, headers: corsHeaders }
          );
        }

        // Determine product name and description
        const isMonthly = frequency === 'monthly';
        const productName = isMonthly
          ? 'Claudezilla Monthly Support'
          : 'Claudezilla One-Time Support';
        const productDescription = isMonthly
          ? 'Monthly contribution to keep Claudezilla free and open source'
          : 'One-time contribution to Claudezilla development';

        // Build Stripe Checkout Session request
        const params = new URLSearchParams({
          'mode': isMonthly ? 'subscription' : 'payment',
          'success_url': `${frontendUrl}/extension/welcome.html?session_id={CHECKOUT_SESSION_ID}`,
          'cancel_url': `${frontendUrl}/extension/support.html`,
          'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][product_data][name]': productName,
          'line_items[0][price_data][product_data][description]': productDescription,
          'line_items[0][price_data][unit_amount]': amount.toString(),
          'line_items[0][quantity]': '1',
        });

        // Add recurring pricing for monthly subscriptions
        if (isMonthly) {
          params.append('line_items[0][price_data][recurring][interval]', 'month');
        }

        // Call Stripe API
        const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        // Handle Stripe API errors
        if (!stripeResponse.ok) {
          const errorText = await stripeResponse.text();
          console.error('Stripe API error:', stripeResponse.status, errorText);
          return Response.json(
            { error: 'Failed to create checkout session' },
            { status: 500, headers: corsHeaders }
          );
        }

        // Parse Stripe response
        const session = await stripeResponse.json();

        // Return checkout URL
        return Response.json(
          { url: session.url },
          { status: 200, headers: corsHeaders }
        );

      } catch (error) {
        console.error('Checkout error:', error);
        const message = error instanceof Error ? error.message : 'Internal server error';
        return Response.json(
          { error: message },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Health check endpoint
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ status: 'ok' }, { headers: corsHeaders });
    }

    // 404
    return Response.json(
      { error: 'Not found' },
      { status: 404, headers: corsHeaders }
    );
  },
};
