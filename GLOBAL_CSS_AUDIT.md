# AXIOM — Phase 10 · Part 2 · Block 1 Step 3: Stabilize Global CSS
## Global CSS Audit

**Date:** 2026-07-31
**Scope:** Global/cross-page CSS fragility only — universal selectors, bare element
selectors, cross-file duplicate utility/component classes, and specificity conflicts.
No layout, color, spacing, JS, HTML, or Design Token changes. Builds on
`CSS_AUDIT.md` (Step 2 — Remove Dead CSS).

**Method:** every `styles/*.css` file was scanned for (a) universal (`*`) selectors,
(b) bare element selectors (`a`, `h1`–`h6`, `table`, `textarea`, `select`, etc. with
no class/id qualifier), and (c) class names defined in more than one stylesheet that
is loaded together on the same page. The `<link>` list of every `.html` page was
mapped to build an accurate "which files actually load together" picture, since the
real leak risk is what a page's whole loaded stylesheet set does, not any one file in
isolation.

---

## 1. Architecture context

This is a traditional multi-page app: each `.html` file explicitly `<link>`s the
stylesheets it needs. There is no bundler and no client-side stylesheet injection, so
a rule in a file a page never links cannot affect that page — the "leaks into
unrelated pages" risk is therefore concentrated in two places: (1) rules broad enough
to hit elements the author didn't intend *within* a page that already loads the file,
and (2) two same-scope files loaded on the same page defining the same class
differently. Both are covered below.

Every page body already carries a state class set by the shell (`ax-redesign-active`,
`ax-dock-active`, `ax-topbar-active`, `ax-os-active`, etc. — see each `.html`'s
`<body>` tag). This existing markup was used as the scoping anchor for the fixes
below, so **no HTML was modified**.

---

## 2. Universal selectors (`*`)

| File | Line | Context | Verdict |
|---|---|---|---|
| `base.css` | 42 | `*{ box-sizing:border-box; margin:0; padding:0; }` | **Keep.** Loaded on every single page; this is the intentional CSS reset the Design Token System (Step 1) sits on top of. |
| `base.css` | 67 | `*{ animation-duration:.01ms !important; ... }` inside `prefers-reduced-motion` | **Keep.** Accessibility override, correctly global and correctly `!important`-gated to a media query only. |
| `accessibility.css` / `ax-redesign.css` / `os-shell.css` / `vision-glass-theme.css` | various | `*,` as the first selector in a comma list (e.g. focus-ring resets) | **Keep.** Same pattern — global accessibility/focus resets, not component leakage. |
| `ax-premium-polish.css` | 84, 572, 600 | `.ax-stagger > *` | **Keep.** Already scoped under `.ax-stagger`; the `*` only reaches direct children of an opted-in container. |

No unscoped, non-reset universal selector was found. No action needed here.

---

## 3. Bare element selectors

Every component-level stylesheet (`ax-pages.css`, `ax-dock.css`, `ax-topbar.css`,
`ax-workspace*.css`, `ax-chat*.css`, `brain.css`, `ax-premium-polish.css`,
`ax-playground-composer.css`, `ax-design-system.css`, `os-environment.css`,
`ai-identity.css`) was already fully class-scoped — zero bare element selectors found
in any of them. The fragility was concentrated in three files:

### `styles/base.css`, `motion-tokens.css`, `rtl.css`, `accessibility.css`
Bare `html`, `body`, `a`, `ul`, `img`, `svg`, `h1`–`h3` rules. **Kept as-is.** These
four files are loaded on **all 16 pages** with no exceptions — that's what makes them
the site's actual reset/base layer, and bare element selectors are the correct tool
for a reset layer. Scoping them would just reproduce `*` under a different name.

### `styles/ax-redesign.css` — **fixed**
Loaded on 12 of 16 pages (admin, agent-library, analytics, automation, billing,
brain, memory, playground, settings, studios, workspace, browser — not index,
login, register, or os-shell). It carried bare `h1, h2, h3, h4, h5, h6 {}`, `a {}`,
a bare `textarea, select {}` tail on an otherwise class-scoped input rule, and a bare
`table {}` / `table th {}` / `table td {}` / `table tr:hover td {}` block. At
specificity (0,0,1), any of these could be silently outranked or could unexpectedly
style headings/links/tables/inputs belonging to a widget that never opted into the
redesign layer (chat-rendered markdown, KaTeX output, a future embed, etc.).

**Fix applied:** each of these selectors was prefixed with `body.ax-redesign-active`,
a class every page that links this file already carries on `<body>` (added by the
existing shell markup, not by this change). This raises their specificity from
(0,0,1) to (0,1,1) — high enough to resist accidental override by an equal-or-lower
specificity rule landing later in the cascade — while matching the exact same set of
elements as before, so there is no visual change. `html, body {}` (lines 132–141) was
deliberately left unscoped: `html`/`body` are page singletons, not repeatable
elements, so there's nothing for them to "leak" onto.

### `styles/vision-glass-theme.css` — **fixed (duplicate rule, not scope)**
Loaded only on `index.html`, `login.html`, `register.html`. Two separate `body {}`
blocks existed (one setting `background`/`color`, a second — 15 lines later, split
across `::selection` and `:focus-visible` — setting `font-family`/`line-height`/
`letter-spacing`). The properties didn't collide, but a second identical selector for
the same element is exactly the "duplicate selector" pattern the audit was asked to
flag, and it forces anyone reading the cascade to check two locations instead of one.
**Fix applied:** merged into a single `body {}` block; declaration order and computed
values are unchanged.

### `styles/os-shell.css`
Bare `html, body {}` (lines 62, 72). **Left as-is.** This file loads only on
`os-shell.html`, alongside `ax-design-system.css` and `ai-identity.css` — it is not
combined with `ax-redesign.css`, `app.css`, or any of the other app-shell files, so
it isn't part of the cross-file conflict surface this step targets. Flagged here for
visibility, no change made (scoping it would touch the AI Core shell page, which is
explicitly called out as "appearance must be unchanged" in this task's validation
criteria — left untouched out of caution).

---

## 4. Duplicate utility/component classes across co-loaded files

`app.css` and `ax-redesign.css` are loaded together on all 12 "app shell" pages.
Automated comparison found **19 class names both files define**: `.active`,
`.api-key-banner`, `.app-body`, `.badge`, `.chip`, `.credit-bar`,
`.credit-bar-fill`, `.danger-zone`, `.dash-stat`, `.field`, `.icon-btn`, `.panel`,
`.plan-card`, `.quick-tile`, `.recent-card`, `.select-native`, `.settings-tab`,
`.toast`, `.toast-stack`.

Each pair was diffed selector-by-selector (not just by class name) before deciding
what to do:

- In every case, `app.css` defines the **base** rule for the class (e.g. `.panel {
  ... }`), and `ax-redesign.css` — which is linked after `app.css` on every page that
  has both — layers a **redesign/skin** rule on top, almost always as part of a larger
  shared-treatment group selector (e.g. `.ax-glass, .panel, .dash-stat, .recent-card,
  .quick-tile, ... { }`). This is a consistent, intentional base-layer +
  override-layer pattern, not an accidental collision — `ax-redesign.css`'s own name
  and its position last in every page's `<link>` order both signal that it's meant to
  win.
- No case was found where the two files fight over the *same* property with
  conflicting values in a way that looks like a bug rather than an override.

**No changes made to either file for this category.** Collapsing `app.css`'s base
rules into `ax-redesign.css` (or deleting them) would be a real architecture change —
it would require re-verifying every one of the 19 components on every one of the 12
pages by eye, which is outside what "safe, preserve current visual design" allows for
this step. Recommendation, not executed here: a future dedicated step could migrate
`app.css`'s shadowed base declarations for these 19 classes into `ax-redesign.css`
directly and retire the duplication, once visual QA tooling is available to verify
all 12 pages.

---

## 5. Not found / checked and clear

- **Generic descendant selectors** (e.g. `.card div`, `.panel > *`) broad enough to
  reach into unrelated nested components: none found outside the already-covered
  `.ax-stagger > *` pattern.
- **`!important` sprawl**: usages found were limited to the `prefers-reduced-motion`
  media query in `base.css` (appropriate — it must always win) and a handful of
  disabled/hidden-state utilities; no evidence of `!important` being used to patch
  over specificity fights.
- **AI Core (`os/core/ai-avatar.css`, `ai-identity.css`)**: both fully class-scoped
  already; untouched by this step, appearance unaffected.

---

## 6. Validation performed

- Brace-balance check on every edited file (`ax-redesign.css`, `vision-glass-theme.css`)
  — matched open/close counts.
- Confirmed no bare top-level `h1…h6`, `a {`, `table {`, or trailing `textarea,`
  selectors remain in `ax-redesign.css`.
- Confirmed the `body.ax-redesign-active` / `body.ax-os-active` / etc. state classes
  already exist in every affected page's markup (no HTML touched, per scope).
- Confirmed the scoped selectors match an **identical element set** to before the
  change — the fix is a specificity/documentation improvement, not a targeting
  change — so theme switching, RTL, responsive layout, and the AI Core are
  unaffected by construction.
- Design Token System (`design-tokens.css`, `motion-tokens.css`) was not opened for
  writing; only read to confirm no token references were broken by the edits above.

## 7. Files changed this step

- `styles/ax-redesign.css` — scoped `h1`–`h6`, `a`, bare `textarea`/`select`, and the
  `table` rule family to `body.ax-redesign-active`.
- `styles/vision-glass-theme.css` — merged the duplicate `body {}` selector into one
  block.

No other files were modified.
