/**
 * Appwrite Function: stripe-webhook
 *
 * Verifies Stripe signatures and writes Account prefs:
 * planId, quotaBytes, stripeCustomerId, stripeSubscriptionId, periodEnd.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, APPWRITE_ENDPOINT,
 * APPWRITE_PROJECT_ID, APPWRITE_API_KEY, STRIPE_PRICE_GB1|GB10
 * (STRIPE_PRICE_GB20 still recognized for legacy subscriptions)
 */
const Stripe = require('stripe');
const { Client, Users } = require('node-appwrite');
const { planFromPriceId, planFromId } = require('../../shared/plans.cjs');

async function writePrefs(users, userId, patch) {
  const user = await users.get(userId);
  await users.updatePrefs(userId, { ...(user.prefs || {}), ...patch });
}

module.exports = async ({ req, res, log, error }) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const signature = req.headers['stripe-signature'];
  let event;
  try {
    const raw = req.bodyBinary || req.bodyText || req.body || '';
    event = stripe.webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    error(`webhook signature: ${err}`);
    return res.json({ error: 'Invalid signature' }, 400);
  }

  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
  const users = new Users(client);

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.client_reference_id || session.metadata?.appwriteUserId;
      if (!userId) {
        log('checkout.session.completed without appwrite user id');
        return res.json({ ok: true });
      }
      const planId = session.metadata?.planId;
      let plan = planFromId(planId);
      if (!plan && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        const priceId = sub.items?.data?.[0]?.price?.id;
        plan = planFromPriceId(priceId, process.env);
      }
      await writePrefs(users, userId, {
        planId: plan?.id || planId || '',
        quotaBytes: plan?.quotaBytes || 0,
        stripeCustomerId: session.customer || '',
        stripeSubscriptionId: session.subscription || '',
        periodEnd: '',
      });
      log(`activated plan for ${userId}`);
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const userId = sub.metadata?.appwriteUserId;
      if (!userId) {
        log(`${event.type} without appwrite user id`);
        return res.json({ ok: true });
      }
      if (event.type === 'customer.subscription.deleted' || sub.status === 'canceled') {
        await writePrefs(users, userId, {
          planId: '',
          quotaBytes: 0,
          stripeSubscriptionId: '',
          periodEnd: '',
        });
        log(`cleared plan for ${userId}`);
      } else {
        const priceId = sub.items?.data?.[0]?.price?.id;
        const plan = planFromPriceId(priceId, process.env) || planFromId(sub.metadata?.planId);
        await writePrefs(users, userId, {
          planId: plan?.id || '',
          quotaBytes: plan?.quotaBytes || 0,
          stripeCustomerId: sub.customer || '',
          stripeSubscriptionId: sub.id,
          periodEnd: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : '',
        });
        log(`updated plan for ${userId}`);
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    error(String(err));
    return res.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
};
