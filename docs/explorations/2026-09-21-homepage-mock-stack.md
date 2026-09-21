# Homepage mock stack redesign (2026-09-21)

## What changed

The homepage (`content/<locale>/home.json` + `bin/pages/render-home.mjs` +
`public/home.css`) dropped the formats index / pillars / steps / FAQ stack and
adopted the marketing mock layout: centered hero, CSS spreadsheet preview,
capability chips, three feature cards, bento essentials, dark CTA band,
multi-column footer. The four-stat strip was dropped (no counter row on the
homepage).

## Truth constraints

- Brand stays **EditXLSX** (not DocuVault).
- No third-party logo row, no invented testimonials, no fake uptime / “10M+”
  metrics, and no homepage stat counters.
- `#hero-sign-in`, `.recent` / `data-recent-slot`, `#landing-hero`, and
  `#landing-hero .foot .tm` stay for E2E and branding contracts.
- Homepage footer is brand + three link columns + copyright/meta row (matches
  the marketing mock); `.tm` stays under the meta row for AGPL §7(e).
- Homepage JSON-LD still emits a compact `FAQPage` (retention / account /
  formats) for assistants and the landing-pages contract — there is no visible
  FAQ section on the mock stack.

## Reverse verification

- `test/unit/landing-pages.test.ts` homepage slot parity: temporarily remove a
  key from `content/zh-CN/home.json` → blank/slot tests fail.
- `test/unit/branding-notice.test.ts`: remove `#landing-hero .foot .tm` from
  CSS → branding style assertion fails.
- `test/e2e/cloud-auth.spec.ts`: remove `#hero-sign-in` → sign-in visibility
  fails.
