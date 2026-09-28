/**
 * Client helpers to start Stripe Checkout / Customer Portal via Appwrite
 * Functions. Secrets never touch the browser — only function IDs and the
 * publishable key (unused for redirect Checkout) live in Vite env.
 */
import type { ExecutionMethod } from 'appwrite';
import { getClient } from '../appwrite/client';
import type { CloudPlanId } from './plans';

function functionId(kind: 'checkout' | 'portal'): string {
  const env = import.meta.env as Record<string, string | undefined>;
  if (kind === 'checkout') {
    return env.VITE_BILLING_CHECKOUT_FUNCTION_ID || 'create-checkout-session';
  }
  return env.VITE_BILLING_PORTAL_FUNCTION_ID || 'create-portal-session';
}

function priceIdForPlan(planId: CloudPlanId): string {
  const env = import.meta.env as Record<string, string | undefined>;
  const map: Record<CloudPlanId, string | undefined> = {
    gb1: env.VITE_STRIPE_PRICE_GB1,
    gb10: env.VITE_STRIPE_PRICE_GB10,
  };
  return map[planId] || '';
}

type FunctionJson = { url?: string; error?: string };

async function executeJson(functionIdValue: string, body: Record<string, unknown>): Promise<FunctionJson> {
  const client = getClient();
  const { Functions } = await import('appwrite');
  const functions = new Functions(client);
  const execution = await functions.createExecution({
    functionId: functionIdValue,
    body: JSON.stringify(body),
    async: false,
    method: 'POST' as ExecutionMethod,
    headers: { 'Content-Type': 'application/json' },
  });
  const raw = execution.responseBody || '{}';
  let parsed: FunctionJson;
  try {
    parsed = JSON.parse(raw) as FunctionJson;
  } catch {
    throw new Error(raw || 'Billing function returned invalid JSON');
  }
  if (execution.status === 'failed' || parsed.error) {
    throw new Error(parsed.error || `Billing function failed (${execution.status})`);
  }
  return parsed;
}

/** Redirect the browser to Stripe Checkout for an annual plan. */
export async function startCheckout(planId: CloudPlanId, successUrl: string, cancelUrl: string): Promise<void> {
  const priceId = priceIdForPlan(planId);
  if (!priceId) {
    throw new Error('Stripe price id is not configured for this plan');
  }
  const result = await executeJson(functionId('checkout'), {
    planId,
    priceId,
    successUrl,
    cancelUrl,
  });
  if (!result.url) throw new Error('Checkout session did not return a URL');
  window.location.assign(result.url);
}

/** Open the Stripe Customer Portal for the signed-in subscriber. */
export async function startCustomerPortal(returnUrl: string): Promise<void> {
  const result = await executeJson(functionId('portal'), { returnUrl });
  if (!result.url) throw new Error('Portal session did not return a URL');
  window.location.assign(result.url);
}

export function isBillingConfigured(): boolean {
  const env = import.meta.env as Record<string, string | undefined>;
  return Boolean(env.VITE_STRIPE_PRICE_GB1 && env.VITE_STRIPE_PRICE_GB10);
}
