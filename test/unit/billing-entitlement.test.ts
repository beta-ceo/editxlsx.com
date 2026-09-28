import { describe, expect, it } from 'vitest';
import {
  assertWithinQuota,
  EMPTY_ENTITLEMENT,
  entitlementFromUser,
  fitsQuota,
  remainingBytes,
} from '../../lib/billing/entitlement';
import { CLOUD_PLANS, GiB } from '../../lib/billing/plans';

describe('billing entitlement', () => {
  it('treats missing prefs as unpaid zero quota', () => {
    expect(entitlementFromUser(null)).toEqual(EMPTY_ENTITLEMENT);
    expect(entitlementFromUser({ prefs: {} }).quotaBytes).toBe(0);
    expect(entitlementFromUser({ prefs: {} }).isPaid).toBe(false);
  });

  it('reads planId and quotaBytes from prefs', () => {
    const ent = entitlementFromUser({
      prefs: {
        planId: 'gb10',
        quotaBytes: CLOUD_PLANS.gb10.quotaBytes,
        stripeCustomerId: 'cus_x',
        periodEnd: '2027-01-01T00:00:00.000Z',
      },
    });
    expect(ent.isPaid).toBe(true);
    expect(ent.planId).toBe('gb10');
    expect(ent.quotaBytes).toBe(10 * GiB);
    expect(ent.stripeCustomerId).toBe('cus_x');
  });

  it('gates writes against the quota', () => {
    expect(fitsQuota(0, 100, 0)).toBe(false);
    expect(fitsQuota(900, 100, 1000)).toBe(true);
    expect(fitsQuota(901, 100, 1000)).toBe(false);
    expect(remainingBytes(250, 1000)).toBe(750);
    expect(() => assertWithinQuota(0, 1, 0)).toThrow(/active plan/i);
    expect(() => assertWithinQuota(1000, 1, 1000)).toThrow(/quota exceeded/i);
  });
});
