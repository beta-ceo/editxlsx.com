/**
 * Shared plan map for Appwrite billing Functions (CommonJS-friendly).
 * Keep dollar amounts and quotas in sync with lib/billing/plans.ts.
 *
 * Legacy STRIPE_PRICE_GB20 may still appear on old subscriptions; map it to
 * the 10 GB plan quota for entitlement until those customers change plans.
 */
const GiB = 1024 * 1024 * 1024;

const CLOUD_PLANS = {
  gb1: { id: 'gb1', dollarsPerYear: 5, quotaBytes: 1 * GiB },
  gb10: { id: 'gb10', dollarsPerYear: 10, quotaBytes: 10 * GiB },
};

function planFromPriceId(priceId, env) {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PRICE_GB1) return CLOUD_PLANS.gb1;
  if (priceId === env.STRIPE_PRICE_GB10) return CLOUD_PLANS.gb10;
  // Retired 20 GB price → treat as 10 GB entitlement for remaining subscribers.
  if (priceId === env.STRIPE_PRICE_GB20) return CLOUD_PLANS.gb10;
  return null;
}

function planFromId(planId) {
  if (planId && CLOUD_PLANS[planId]) return CLOUD_PLANS[planId];
  return null;
}

module.exports = { CLOUD_PLANS, GiB, planFromPriceId, planFromId };
