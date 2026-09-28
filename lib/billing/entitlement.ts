/**
 * Cloud storage entitlement derived from Appwrite Account prefs.
 *
 * Prefs are written only by the Stripe webhook Function (Admin API). The
 * browser never updates plan fields — it only reads them.
 */
import type { Models } from 'appwrite';
import { CLOUD_PLANS, isCloudPlanId, type CloudPlan, type CloudPlanId } from './plans';

export type BillingPrefs = {
  planId?: string;
  quotaBytes?: number | string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  periodEnd?: string | number;
};

export type CloudEntitlement = {
  planId: CloudPlanId | null;
  plan: CloudPlan | null;
  /** Bytes the account may store. 0 when unsigned-in or unpaid. */
  quotaBytes: number;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  /** ISO date or empty when unknown / unpaid. */
  periodEnd: string;
  /** True when quotaBytes > 0 and a known plan is active. */
  isPaid: boolean;
};

export const EMPTY_ENTITLEMENT: CloudEntitlement = {
  planId: null,
  plan: null,
  quotaBytes: 0,
  stripeCustomerId: '',
  stripeSubscriptionId: '',
  periodEnd: '',
  isPaid: false,
};

function asPrefs(raw: Models.Preferences | Record<string, unknown> | undefined | null): BillingPrefs {
  if (!raw || typeof raw !== 'object') return {};
  return raw as BillingPrefs;
}

function parseQuota(raw: unknown, plan: CloudPlan | null): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return plan?.quotaBytes ?? 0;
}

function parsePeriodEnd(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return new Date(raw * (raw < 1e12 ? 1000 : 1)).toISOString();
  }
  return '';
}

/** Read entitlement from a signed-in Appwrite user (or anonymous → empty). */
export function entitlementFromUser(
  user: { prefs?: Models.Preferences | Record<string, unknown> } | null | undefined,
): CloudEntitlement {
  if (!user) return { ...EMPTY_ENTITLEMENT };
  const prefs = asPrefs(user.prefs);
  const planId = typeof prefs.planId === 'string' && isCloudPlanId(prefs.planId) ? prefs.planId : null;
  const plan = planId ? CLOUD_PLANS[planId] : null;
  const quotaBytes = parseQuota(prefs.quotaBytes, plan);
  return {
    planId,
    plan,
    quotaBytes,
    stripeCustomerId: typeof prefs.stripeCustomerId === 'string' ? prefs.stripeCustomerId : '',
    stripeSubscriptionId: typeof prefs.stripeSubscriptionId === 'string' ? prefs.stripeSubscriptionId : '',
    periodEnd: parsePeriodEnd(prefs.periodEnd),
    isPaid: quotaBytes > 0 && plan !== null,
  };
}

/**
 * Whether adding `nextBytes` on top of `usedBytes` fits the quota.
 * Shrinking saves (nextBytes <= previousSize) should pass `delta` not full size.
 */
export function fitsQuota(usedBytes: number, nextBytes: number, quotaBytes: number): boolean {
  if (quotaBytes <= 0) return false;
  if (nextBytes < 0) return false;
  return usedBytes + nextBytes <= quotaBytes;
}

/** Throw when the write would exceed the account quota. */
export function assertWithinQuota(usedBytes: number, nextBytes: number, quotaBytes: number): void {
  if (fitsQuota(usedBytes, nextBytes, quotaBytes)) return;
  if (quotaBytes <= 0) {
    throw new Error('Cloud storage requires an active plan. See /pricing.');
  }
  throw new Error('Cloud storage quota exceeded. Upgrade at /pricing or delete files.');
}

/** Bytes still available under the entitlement (never negative). */
export function remainingBytes(usedBytes: number, quotaBytes: number): number {
  return Math.max(0, quotaBytes - Math.max(0, usedBytes));
}
