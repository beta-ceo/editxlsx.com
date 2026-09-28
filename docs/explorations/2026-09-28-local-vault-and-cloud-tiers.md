# Local durable vault + tiered cloud billing (2026-09-28)

Product reposition: free durable library in the browser; paid Appwrite cloud
storage in three annual tiers.

## Model

| Path | Price | Persistence |
|------|-------|-------------|
| Local library (`/workspace` → This device) | Free | IndexedDB `editxlsx-local-vault` |
| Cloud vault (`/workspace` → Cloud) | $5/yr 1GB · $10/yr 10GB | Appwrite Auth + Databases + Storage |
| AutoRecover (`/history`) | Free | `document-history`, 7-day TTL — crash recovery only |

Login alone does not unlock cloud bytes (`quotaBytes = 0` until Stripe
activates a plan). Existing unpaid cloud files stay readable / downloadable /
deletable; create and size-increasing saves are blocked.

## Local vault

- New IDB, not an extension of AutoRecover (privacy TTL and multi-rev trim stay).
- Identity: `?local=<id>` (cloud stays `?workbook=`; recovery stays `?saved=`).
- Save priority: cloud binding → local-vault binding → disk FSA / download.
- Bound local opens skip AutoRecover (`skipHistory: true`), same as cloud.

## Billing

- Catalog: `lib/billing/plans.ts`.
- Entitlement prefs (webhook-only write): `planId`, `quotaBytes`,
  `stripeCustomerId`, `stripeSubscriptionId`, `periodEnd`.
- Appwrite Functions under `functions/billing/`: Checkout, Customer Portal,
  Stripe webhook.
- Client quota gate in `lib/appwrite/workbooks.ts` (no Storage proxy in v1).

## Marketing

Flat “$5/year” copy becomes free local library + three cloud tiers. Primary
homepage CTA → `/workspace` (local). Cloud upsell → `/pricing`.
