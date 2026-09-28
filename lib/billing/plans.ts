/**
 * Cloud storage plan catalog — single source of truth for marketing, Checkout,
 * and client-side quota checks. Stripe Price IDs come from env; dollar amounts
 * and byte quotas live here so copy and gates cannot drift.
 */

export const GiB = 1024 * 1024 * 1024;

/** Plans offered on /pricing and in Checkout. */
export type CloudPlanId = 'gb1' | 'gb10';

export type CloudPlan = {
  id: CloudPlanId;
  /** Display price in USD per year. */
  dollarsPerYear: number;
  quotaBytes: number;
};

export const CLOUD_PLANS: Record<CloudPlanId, CloudPlan> = {
  gb1: { id: 'gb1', dollarsPerYear: 5, quotaBytes: 1 * GiB },
  gb10: { id: 'gb10', dollarsPerYear: 10, quotaBytes: 10 * GiB },
};

export const CLOUD_PLAN_LIST: readonly CloudPlan[] = [CLOUD_PLANS.gb1, CLOUD_PLANS.gb10];

export function isCloudPlanId(value: string): value is CloudPlanId {
  return value === 'gb1' || value === 'gb10';
}

export function planById(id: string | undefined | null): CloudPlan | null {
  if (!id || !isCloudPlanId(id)) return null;
  return CLOUD_PLANS[id];
}

/** Human label used in UI ("1 GB", "10 GB", …). */
export function formatPlanQuota(plan: CloudPlan): string {
  const gb = plan.quotaBytes / GiB;
  return `${gb} GB`;
}
