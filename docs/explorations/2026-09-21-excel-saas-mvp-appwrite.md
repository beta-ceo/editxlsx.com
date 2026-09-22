# 2026-09-21 — Excel SaaS MVP (OnlyOffice + Appwrite)

## What shipped

Client-side Excel SaaS on top of the existing OnlyOffice editor:

- Appwrite Auth (email/password) at `/login`
- Workbook library at `/workspace` against the existing `editxlsx` database /
  `workbooks` collection / `workbooks` Storage bucket
- `/editor?workbook=<id>` downloads the `.xlsx`, binds Save / Ctrl+S and a
  cloud autosave metronome to Appwrite (delete + recreate same file id)
- Homepage CTA pivots to Sign in / My workbooks; local open still available

Stripe / `subscriptions` left untouched.

## Reverse checks

- Unit: `writeCloudWorkbook` is a no-op without a binding (no Storage calls)
- Unit: save path is delete-then-create under the same file id
- E2E (CI): anonymous `/workspace` redirects to `/login`; login form renders

## Not in this drop

- Billing UI
- Sharing / real-time coauthoring
- FortuneSheet swap
- Full SEO rewrite of every privacy-oriented landing page
