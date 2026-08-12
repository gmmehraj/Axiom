# AXIOM — Design Token Audit

**Phase:** 10 · Part 2 · Block 1 Step 1 — Lock the Design Token System
**Date:** 2026-07-30

This is a snapshot of the token architecture as it actually behaves in the
browser today, not just as written. Where a claim below depends on cascade
order, it was checked against each page's actual `<link>`/`@import` chain,
not assumed.

## 1. Final token hierarchy

```
styles/design-tokens.css   ← canonical. 177 custom properties. §1–§12
  (colors, spacing, radius, typography, iconography, elevation, glass,
   motion, gradients, ambient/"live" state, legacy alias bridge, AI
   identity accent)
  │
  ├─ @import'ed by styles/base.css               (16 pages, all of them)
  ├─ @import'ed by styles/ax-redesign.css          (12 app pages)
  ├─ @import'ed by styles/ax-design-system.css     (os-shell.html)
  ├─ @import'ed by styles/os-shell.css             (os-shell.html)
  └─ @import'ed by styles/vision-glass-theme.css   (index/login/register)

Every one of the 16 HTML pages loads the canonical file, directly or
transitively, through the existing CSS architecture — no page was missing
it, so no new `<link>` tags were needed.
```

### Files with their own `:root` block (9 total)

| File | Status | Notes |
|---|---|---|
| `styles/design-tokens.css` | **Canonical** | Single `:root`, 177 properties |
| `styles/motion-tokens.css` | Clean, single source | 2nd `:root` is a legitimate `prefers-reduced-motion` override, not a duplicate |
| `styles/base.css` | Intentional override (kept) | Real, currently-rendering source for `--text-hi`/`--text-lo`/`--a-coral`/`--a-gold`/`--a-teal`/`--font`/`--font-mono` on all 16 pages |
| `styles/ax-redesign.css` | Intentional override (kept) | V8 radius/shadow/glass/type scale + accent-family override, loaded last on 12 app pages |
| `styles/vision-glass-theme.css` | Intentional override (kept) | Vision-page (index/login/register) accent-family + scale override |
| `styles/ax-design-system.css` | V11 base scale | Only `@import`s the canonical file; loaded on os-shell.html |
| `styles/os-shell.css` | Intentional override (kept) | os-shell.html-only overrides for surface/radius/glass/shadow |
| `styles/ai-identity.css` | **De-duplicated this pass** | `--ax-ai-accent*` block removed (now inherited); `--ax-ai-state-*` per-state tokens remain (unique, not in canonical file) |
| `styles/os-environment.css` | Orphaned, unresolved | Not linked by any HTML/CSS; referenced only in a JS comment as an unfinished feature. Left in place, flagged, not archived |

### Archived this pass

- `styles/premium-os.css` → `_archive/unused-legacy/styles/premium-os.css`. Confirmed zero HTML, CSS, or JS references before moving.

## 2. Pages using the token system

All 16 HTML pages inherit the canonical token file. They fall into three families by which override layer loads last:

| Page family | Pages | Last-loaded override |
|---|---|---|
| App pages (V8) | admin, agent-library, analytics, automation, billing, brain, browser, memory, playground, settings, studios, workspace | `ax-redesign.css` |
| Vision pages | index, login, register | `vision-glass-theme.css` |
| OS Shell (V11) | os-shell | `os-shell.css` |

## 3. Remaining page-specific overrides, with justification

These are tokens that exist in `design-tokens.css` but are **intentionally**
re-defined with a different value further down a page's cascade. Each was
left untouched because collapsing it onto the canonical value would change
what's currently on screen — a regression this step's brief explicitly
rules out.

| Token(s) | Canonical value | Overridden by | Rendered value | Why kept separate |
|---|---|---|---|---|
| `--ax-radius-sm/md/lg/xl/2xl` | 10/14/18/24/32px (V11 scale) | `ax-redesign.css` | 12/18/24/28/34px (V8 scale) | Documented, unresolved V8-vs-V11 scale divergence — genuinely different sizes, not a renamed duplicate |
| `--ax-font-size-*` / `--ax-font-weight*` / `--ax-letter-spacing` | V11 11-stop `--ax-text-*` scale | `ax-redesign.css` | V8's own rem values | Same divergence — a real type-scale difference |
| `--ax-shadow-xs/sm/md/lg/xl`, `--ax-glass-bg/border/blur/blur-sm` | V11 elevation/glass tiers | `ax-redesign.css` | V8's flat shadow/glass values | Same divergence — approximate, not identical, per design-tokens.css's own note |
| `--ax-surface`, `--ax-surface-3`, `--ax-radius-sm/xs`, `--ax-glass`, `--ax-shadow` | Canonical V8-defaulted values | `os-shell.css` | os-shell.html's own V11 spec values | os-shell.html is the one page actually built to the V11 spec |
| `--text-hi`, `--text-lo`, `--a-coral`, `--a-gold`, `--a-teal`, `--font`, `--font-mono` | Corrected this pass to match `base.css` | `base.css` (all pages) | `base.css`'s literal values | `base.css` is the true, uncontested source on every page — canonical file's alias updated to match, not the other way around |
| `--a-violet`, `--a-violet-2`, `--a-cyan`, `--a-cyan-2`, `--a-pink` | A status/monochrome hybrid (§11) | `ax-redesign.css` (app pages) *and separately* `vision-glass-theme.css` (vision pages) | Two different monochrome-white families, one per page family | Two independently-intentional per-family designs; unifying either direction changes one family's screen colors |
| `--a-coral`, `--a-gold`, `--a-teal` | `var(--ax-error/warning/success)` (§11) | `vision-glass-theme.css` only (not `ax-redesign.css`) | Status colors on vision pages; plain white-opacity on app pages (from `base.css`, unshadowed there) | Same as above — two intentional families |

## 4. Intentionally duplicated tokens with justification

- **`--ax-ai-accent*` family**: was duplicated between `design-tokens.css` §12 and `ai-identity.css` for a historical reason (the canonical file wasn't linked anywhere yet at the time). That reason no longer applies — **removed this pass**, no longer duplicated.
- **All rows in section 3 above**: duplicated on purpose, current cascade winner documented, canonical file cross-referenced from each overriding file via a comment added this pass.
- **`@import url("design-tokens.css")`** appears at the top of 5 different files rather than one central point. Functionally harmless (browsers dedupe identical-URL imports), left as-is — see CHANGELOG.md for why this wasn't consolidated.

## 5. Not done in this pass (see CHANGELOG.md "Remaining design-token work")

1. Resolving the V8/V11 radius, elevation, glass, and type-scale divergence — a design decision, not a mechanical fix.
2. Resolving the app-page vs. vision-page accent-family divergence.
3. Deciding the fate of `styles/os-environment.css`.
4. Optional: consolidating the 5 redundant `@import` lines into one.
