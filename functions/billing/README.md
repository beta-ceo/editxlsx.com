# Billing Functions (Appwrite + Stripe)

Deploy these three Functions in the editxlsx Appwrite project. They write
Account prefs (`planId`, `quotaBytes`, `stripeCustomerId`,
`stripeSubscriptionId`, `periodEnd`) that the browser reads via
`lib/billing/entitlement.ts`.

## Functions

| Folder | Role |
|--------|------|
| `create-checkout-session` | Authenticated Checkout (annual subscription) |
| `create-portal-session` | Authenticated Customer Portal |
| `stripe-webhook` | Stripe → prefs (no user JWT; signature only) |

## Required secrets (Function env)

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET` (webhook function only)
- `STRIPE_PRICE_GB1` / `STRIPE_PRICE_GB10`
- `APPWRITE_ENDPOINT` / `APPWRITE_PROJECT_ID` / `APPWRITE_API_KEY`

## Client env (Vite)

See `.env.example`: `VITE_STRIPE_PRICE_GB*` and `VITE_BILLING_*_FUNCTION_ID`.

Copy `shared/plans.cjs` beside each Function when packaging, or set the
Function root so `require('../shared/plans.cjs')` resolves.
