/**
 * Appwrite Function: create-portal-session
 *
 * POST body JSON: { returnUrl }
 * Opens the Stripe Customer Portal for the signed-in user's stripeCustomerId.
 */
const Stripe = require('stripe');
const { Client, Users } = require('node-appwrite');

module.exports = async ({ req, res, log, error }) => {
  try {
    if (req.method !== 'POST') {
      return res.json({ error: 'Method not allowed' }, 405);
    }

    const userId = req.headers['x-appwrite-user-id'] || req.headers['X-Appwrite-User-Id'];
    if (!userId) return res.json({ error: 'Sign in required' }, 401);

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    if (!body.returnUrl) return res.json({ error: 'returnUrl is required' }, 400);

    const client = new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);
    const users = new Users(client);
    const user = await users.get(userId);
    const customerId = user.prefs?.stripeCustomerId;
    if (!customerId) return res.json({ error: 'No Stripe customer on this account' }, 400);

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: body.returnUrl,
    });

    log(`portal session for user ${userId}`);
    return res.json({ url: session.url });
  } catch (err) {
    error(String(err));
    return res.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
};
