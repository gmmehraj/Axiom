# AXIOM — Deployment Guide

**For:** Phase 10 Part 2 release candidate
**Project type:** Static site (no build step) with Supabase as backend-as-a-service

## 1. What this project is

AXIOM is a static, multi-page site — 16 HTML pages, plain JS modules
(no bundler, no framework build step), styled with plain CSS. There is
no `npm run build`; `package.json` only declares two runtime
dependencies (`@vercel/analytics`, `@vercel/speed-insights`) and a
`serve` script for local preview:

```json
"scripts": { "serve": "npx serve ai" }
```

Note the `serve` script's target path (`ai`) doesn't match this
project's actual root — that script predates the current layout and
should be updated to `npx serve .` (or removed) before relying on it;
it's a stale convenience script, not something referenced by any page.

## 2. Hosting

Any static host works (Vercel, Netlify, Cloudflare Pages, S3+CDN,
GitHub Pages, etc.) — there's no server-side rendering. Point the host
at the project root; `index.html` is the entry point.

## 3. Backend dependencies

The app talks to three external services, all configured client-side:

| Service | Config file | What it's used for |
|---|---|---|
| Supabase | `js/core/supabase-config.js` | Auth, database (Row Level Security-protected tables), Edge Functions |
| Razorpay | `js/core/razorpay-config.js` | Billing/checkout |
| OpenRouter (proxied) | `js/core/openrouter-config.js` | AI chat/model calls — routed through Supabase Edge Functions so the real OpenRouter key never reaches the browser |

### Supabase

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are hardcoded in
`supabase-config.js`. The anon key is meant to be public (it's
restricted entirely by Row Level Security policies — see `db/` for
schema), so this is not a secret leak. Before going live, confirm:
- RLS policies are actually enabled on every table (check `db/`
  migration/schema files against the live project).
- The Supabase project's Edge Functions (`openrouter-chat`,
  `openrouter-models`, `analyze-file`) are deployed, and their
  `OPENROUTER_API_KEY` server-side secret is set in the Supabase
  dashboard, not in this repo.

### Razorpay

`RAZORPAY_KEY_ID` in `razorpay-config.js` is currently a **test** key
(`rzp_test_...`). The file itself documents the swap: replace it with
the `rzp_live_...` Key ID by hand only when cutting the actual
production deploy (there's no env-var injection step in this static
setup), and keep a separate staging checkout with the test key. The
matching `RAZORPAY_KEY_SECRET` must only ever live server-side, in the
Edge Functions' environment secrets — never in this repo.

### OpenRouter

No key lives in this repo at all; `openrouter-config.js` only points
at the Supabase Edge Function endpoints. Confirm the Edge Functions
have their own `OPENROUTER_API_KEY` set before launch.

## 4. Pre-launch checklist

This list separates what's already verified (see
`FINAL_AUDIT_REPORT.md`) from what still needs a real browser/staging
pass — do not skip the second half:

**Already verified (static/mechanical):**
- [x] All JS/JSON/HTML parse without error
- [x] No broken internal file references (HTML or JS-level)
- [x] i18n complete across all 9 non-English locales
- [x] No hardcoded live secrets in client code
- [x] No stray debug code in shipped pages

**Needs a real browser / staging environment before public launch:**
- [ ] Click through every page and confirm it renders as designed
- [ ] Exercise the AI chat flow against the real OpenRouter proxy
- [ ] Exercise the Razorpay checkout flow against Razorpay's test mode
- [ ] Confirm Supabase auth (login/register/session) end-to-end
- [ ] Swap `RAZORPAY_KEY_ID` to the live key immediately before the
      production deploy, not before
- [ ] Cross-browser/cross-device visual pass (the 79 `@media`
      breakpoints and viewport meta tags are in place, but haven't
      been visually confirmed on real devices in this environment)
- [ ] Update or remove the stale `serve` script in `package.json`

## 5. Rollback

Since this is a static site with no build step, rollback is just
re-deploying the previous commit/asset bundle — no migration or
build-artifact concerns on the frontend. Any Supabase schema or Edge
Function changes should be versioned and rolled back separately
through Supabase's own migration history.
