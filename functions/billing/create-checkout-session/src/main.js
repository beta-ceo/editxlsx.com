/**
 * Appwrite Function: create-checkout-session
 *
 * POST body JSON: { planId, priceId, successUrl, cancelUrl }
 * Requires an Appwrite user JWT (session). Creates a Stripe Checkout session
 * in subscription mode and returns { url }.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_PRICE_GB1|GB10 (optional validation)
 */
const Stripe = require('stripe');
const { Client, Users } = require('node-appwrite');
const { planFromId } = require('../../shared/plans.cjs');

module.exports = async ({ req, res, log, error }) => {
  try {
    if (req.method !== 'POST') {
      return res.json({ error: 'Method not allowed' }, 405);
    }

    const jwt = req.headers['x-appwrite-user-jwt'] || req.headers['X-Appwrite-User-Jwt'];
    const userId = req.headers['x-appwrite-user-id'] || req.headers['X-Appwrite-User-Id'];
    if (!userId) {
      return res.json({ error: 'Sign in required' }, 401);
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const plan = planFromId(body.planId);
    if (!plan) return res.json({ error: 'Unknown plan' }, 400);
    if (!body.priceId || !body.successUrl || !body.cancelUrl) {
      return res.json({ error: 'priceId, successUrl, and cancelUrl are required' }, 400);
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    let customerId;
    if (jwt && process.env.APPWRITE_ENDPOINT && process.env.APPWRITE_PROJECT_ID && process.env.APPWRITE_API_KEY) {
      const client = new Client()
        .setEndpoint(process.env.APPWRITE_ENDPOINT)
        .setProject(process.env.APPWRITE_PROJECT_ID)
        .setKey(process.env.APPWRITE_API_KEY);
      const users = new Users(client);
      const user = await users.get(userId);
      customerId = user.prefs?.stripeCustomerId || undefined;
      if (!customerId && user.email) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { appwriteUserId: userId },
        });
        customerId = customer.id;
        await users.updatePrefs(userId, {
          ...(user.prefs || {}),
          stripeCustomerId: customerId,
        });
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: body.priceId, quantity: 1 }],
      success_url: body.successUrl,
      cancel_url: body.cancelUrl,
      client_reference_id: userId,
      metadata: { appwriteUserId: userId, planId: plan.id },
      subscription_data: {
        metadata: { appwriteUserId: userId, planId: plan.id },
      },
    });

    log(`checkout session ${session.id} for user ${userId} plan ${plan.id}`);
    return res.json({ url: session.url });
  } catch (err) {
    error(String(err));
    return res.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
};
