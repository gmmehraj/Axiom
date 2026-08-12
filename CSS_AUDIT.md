# AXIOM — CSS Audit
**Block 1 · Step 2 — Remove Dead CSS**
Scope: cleanup only. No layout, color, spacing, JS, or Design Token changes.

## Method

This audit was done with tooling, not eyeballing, because the codebase is too large (29
CSS files / 12,549 lines, 154 JS files, 16 top-level HTML pages) to safely hand-review.

1. Parsed every non-archived `.css` file with a real CSS parser (`tinycss2`) into
   individual selector rules — 2,189 selector-rules total.
2. Built a full usage corpus from every non-archived `.html`, `.js`, and `.json` file.
3. For every class/id token in every selector, checked whether that exact token
   (word-boundary-safe, so `btn` doesn't falsely match inside `btn-ghost`) appears
   anywhere in the corpus — as a `class="..."` attribute, a `classList.add(...)`
   call, a template-literal fragment, an `id="..."` attribute, or a
   `getElementById(...)` call.
4. Cross-checked JS for **dynamically constructed** class names (e.g.
   `'state-' + activity`, `'ax-flow-' + node.type`, `'mood-' + state`) so none of
   those prefixes were mistaken for dead code.
5. Every candidate that came back with zero references was then **individually
   re-verified by hand** with targeted greps against the live HTML/JS, specifically
   checking:
   - Is the "unused" name actually a legacy alias for a class that now lives under a
     different name? (This codebase mixes both conventions — some components keep
     `.ax-foo, .foo { … }` as a single rule so both spellings work; other components
     were fully renamed and only the old spelling was left behind. Both patterns
     exist, and it is **not** safe to assume "the `ax-`-prefixed one is always the
     live one" — I initially made that assumption and it was wrong for the button
     family, where the bare `.btn-ghost` / `.btn-lg` are the ones actually used in
     markup and the `ax-`-prefixed siblings were dead. Every case below was checked
     individually rather than by that shortcut.)
   - Is the class a false positive caused by a generic English word (`down`, `switch`,
     `field`, `tag`) coincidentally appearing elsewhere in an unrelated class name or
     JS comment? Several candidates were reclassified because of this.

## What was removed

Only removed where there was **positive evidence of supersession** — i.e. the same
component now exists, working, under a different class name — not merely "currently
zero matches." Where a selector was simply unused with no evidence of a live
replacement doing its job, it was **left in place and flagged below** per the brief's
"prefer safety over aggressive cleanup" instruction.

### `styles/app.css` (402 → 288 lines)
An entire pre-rebrand component library was left behind when the UI was rebuilt with
`ax-`-prefixed classes. Evidence: the *singular/item* classes from this old system
(`.dash-stat`, `.recent-card`, `.quick-tile`, `.plan-card`) are still live and are even
referenced by name in `js/core/os-interface.js`'s sheen/parallax observer list — but
the *container/wrapper* classes around them, and several full pre-rename components,
were never called by the redesigned markup:

- `.app-nav`, `.app-nav-label`, `.app-topbar-spacer` — legacy sidebar/topbar wrappers
- `.dash-stats` grid, `.dash-stat-top/-icon/-delta/-num/-label` (incl. `.dash-stat-delta.down`)
- `.recent-grid`, `.recent-thumb`, `.recent-meta`, `.recent-meta p`
- `.quick-grid`
- `.pg-layout`
- Entire legacy chat template: `.chat-window`, `.chat-msg` (+ `.user`/`.assistant`
  variants), `.chat-avatar`, `.chat-bubble`, `.chat-typing` (+ its `@keyframes
  typingDot`) — superseded by `ax-chat.css`'s `.ax-message` system
- `.prompt-bar` + `.prompt-bar textarea` rules — superseded by `.ax-prompt-bar`
  (the live `.pg-voice-row` / `.pg-attached-file` / `#pgVoiceHint` rules that share
  this section were kept, they're still used)
- `#jvVoiceHint` — removed from a grouped rule that also contained the live
  `#pgVoiceHint`; only the dead id was dropped
- `.gen-controls`, `.field-inline` (+ `label`) — the descendant rule
  `.gen-controls textarea` was kept since `.select-native` shares it and is live
- `.gen-output-grid`, `.credit-meter` wrapper (children `.gen-output`, `.credit-bar`,
  `.credit-bar-fill` are live and were left untouched)
- `.plan-card-name`, `.plan-card-price`
- `.usage-bar`, `.usage-bar-fill`, `table.invoice-table` (+ `th`/`td`/`tr:last-child`)
  — superseded by `.ax-page-progress` and `.ax-table`
- `.settings-tabs` (the singular `.settings-tab` it shared a heading with is live and
  was kept)
- `.form-grid` (the `.form-grid .field.full` descendant rule was kept — `.field` is a
  live, generic class used elsewhere, so removing that specific rule wasn't provably safe)
- `.toggle-row`, `.toggle-row-copy strong/span`, and the **entire legacy
  `.switch`/`.switch-track` toggle-switch implementation** — superseded by
  `.ax-switch`/`.ax-switch-track`, confirmed via `settings.html`
- `.avatar-upload` (+ `.app-avatar` override inside it)
- `.btn-danger` — superseded by `.ax-btn-danger` (this file's own copy; see below)
- 4 `@media` blocks (1100px / 900px / 640px / 420px breakpoints) that only contained
  responsive overrides for the now-removed grid containers above; one block
  (`max-width:1100px`) was removed in full, the others had only their dead lines
  trimmed, live rules in the same blocks were untouched

### `styles/ax-redesign.css` (1,178 → 1,151 lines)
This file deliberately keeps some components under two class names at once
(`.ax-foo, .foo { … }`) so both the redesign and any older references still resolve.
Where one side of that pairing turned out to be genuinely dead, only that side was
removed, the working sibling was kept, verbatim, in the same rule:

- `.metric-card`, `.core-stage-panel` — dropped from the shared card-surface rule
  group (real markup uses `.ax-metric-card`, defined separately in `ax-pages.css`)
- `.ax-btn-ghost` (+ `:hover`) — the **`ax`-prefixed** side was dead here; the bare
  `.btn-ghost` alias is what's actually used in markup (e.g. `memory.html`), so that
  side was kept
- `.ax-btn-lg` — same pattern, bare `.btn-lg` is live and was kept
- `.btn-danger` (+ `:hover`) — here it's the reverse: `.ax-btn-danger` is the live one
  (`settings.html`), the bare alias was dead and removed
- `.switch-track` (+ `::before`), `.switch input`, `.switch input:checked +
  .switch-track` (+ `::before`) — bare `.switch` is never used as a class anywhere;
  the scoped `.ax-switch …` versions are live and were kept
- `.settings-tabs` — dropped from the `.ax-tabs, .settings-tabs` container rule
  (`.ax-tabs` is used directly, and the `.ax-tab, .settings-tab` *item* rule right
  below it was left alone since `.settings-tab` singular is live)
- `.ax-progress`, `.usage-bar` (+ `-fill` variants) — dropped from a 3-way shared
  rule; real progress bars use `.ax-page-progress` (billing.html), the live
  `.credit-bar`/`.credit-bar-fill` sibling was kept
- `.invoice-table` (+ `th`/`td`) — redundant twice over: the bare `table`/`table
  th`/`table td` tag selectors already style every table on the page (including
  `billing.html`'s `.ax-table`), so `.invoice-table` added nothing even before being
  confirmed unused
- `.preview-modal`, `.preview-panel`, `.preview-head`, `.preview-body` — dropped from
  4 shared modal rules; the live modal system already exists under two other names
  in the same rules (`.ax-modal-*` used by `components/ax-dialogs.js`, and
  `.agent-modal-*` used by `agent-library.html`) — three names for one component was
  the giveaway this one was dead, not reserved

### `styles/ax-chat.css` (1,003 → 1,001 lines)
- An entirely empty `:root {}` block (zero properties) — leftover from a token
  migration, safe to delete outright regardless of usage.

### `styles/rtl.css` (77 → 74 lines)
Not caught by the main automated pass — found via a final defensive check (grepping
every already-confirmed-dead class name against every CSS file, not just the ones the
tool flagged). The reason it was missed initially: this file's rules combine
`body.rtl` — a real, always-live class — with a second, target class in a compound
selector (`body.rtl .app-topbar-spacer { … }`). The automated check used "any class
in the selector is referenced somewhere" logic, so `body.rtl` being live caused the
*entire* compound selector to register as "used," masking that the second class was
dead. This is the mirror image of the `.dash-stat-delta.down` false positive noted
below — same root cause (compound selectors get evaluated as a whole rather than
per-class), opposite direction of error.
- `body.rtl .app-topbar-spacer { order: 0; }` — removed (target class no longer exists)
- `body.rtl .dash-stat-num`, `body.rtl .invoice-table td:nth-child(3)` — dropped from
  a shared LTR-isolation rule; `body.rtl code` / `body.rtl pre` in the same rule are
  live and were kept

**This is flagged as a methodology gap**, not just a one-off fix: any other compound
selector pairing a dead class with a generic-but-live ancestor/companion class
(`.active`, `.open`, `.selected`, language/theme body classes, etc.) across the
codebase could have the same blind spot and would not have been caught by this pass's
automated tooling. A future pass should evaluate every class *within* a compound
selector independently, not the selector as a whole, before trusting "used" status.



These came back with **zero references anywhere** in HTML/JS, but unlike everything
above, there's no evidence any of them were renamed or replaced by something else —
they're either self-contained, cost-free CSS (no JS wiring needed to activate) or
look like intentionally pre-built infrastructure. Per "prefer safety over aggressive
cleanup" and "if uncertain, keep," none of these were touched. Flagging them here so
a future step (with product context this audit doesn't have) can make the call.

| File | Selectors | Why it's ambiguous |
|---|---|---|
| `ax-design-system.css` | Entire utility layer: `.ax-glass-1/2/3`, `.ax-elevation-1..5`, `.ax-r-xs..full`, `.ax-h1..h4`, `.ax-body*`, `.ax-caption`, `.ax-meta`, `.ax-label-caps`, `.ax-icon-sm..xl`, `.ax-gap-1..4`, `.ax-reflection-sweep` | Reads as a reserved design-system utility layer, same spirit as the Step 1 Design Token System — not currently adopted by any page, but zero-cost to keep |
| `ax-premium-polish.css` | `.ax-spring-*`, `.ax-float-*`, `.ax-reflection`, `.ax-shadow-elevated/float/deep`, `.ax-palette`, `.ax-browser-layout`, `.ws-layout`, `.ws-toolbar`, `.studio-nav-grid`, `.studio-tools-grid`, `.agent-grid`, `.ax-premium-text`, `.ax-mono-nums`, `.ax-gpu`, `.ax-contain*`, `.ax-composite`, `.ax-border-sweep` | Same as above — a self-contained effects/utility layer, not wired into current markup anywhere |
| `os-shell.css` | `.ax-glass-panel`, `.ax-widget-grid`, `.ax-widget-badge`, `.ax-widget-row`, `.ax-timeline-content`, `.ax-timeline-time` | Fully-built OS-shell widget/timeline components with no current caller — could be pending a widget feature |
| `ax-workspace.css` | `.ax-research-panel`, `.ax-research-card` (+ children) | Fully-formed research-panel component, no current caller |
| `ax-chat.css` | `.ax-streaming-cursor`, `.ax-chat-empty` (+ `svg`/`h3`/`p`) | Empty-state / streaming-cursor treatments with no current caller |
| `ax-pages.css` | `.ax-page-empty` (+ `svg`/`h3`/`p`) | Generic empty-state pattern, plausibly reserved for pages that don't have data yet |
| `accessibility.css` | `.sr-only-focusable:focus`/`:focus-within` | Skip-link focus helper; no `<a class="sr-only-focusable">` exists yet, but this is standard a11y boilerplate worth keeping ready |
| `window-manager.css` | `.ax-wm-snap-indicator` | No caller found; window-snap UI may not be wired up yet |
| `wallpaper-engine.css` | `.ax-wp-thumb-aurora-flow/particles/gradient-mesh/time-of-day` | Wallpaper picker thumbnail variants with no current caller |
| `brain.css` | `.viz-node-label` | No caller found |
| `vision-glass-theme.css` | `.text-muted` | No caller found; generic name, low removal value even if genuinely dead |

## Duplicate/conflicting rules — not merged

- **`.toast` is defined twice in `ax-redesign.css`** (once grouped with
  `.core-stage-panel`/`.api-key-banner`, once standalone later in the file) with
  **different, only partially-overlapping properties** (e.g. `transition` and
  `overflow` only exist in the first block; `padding` and `animation` only in the
  second). Because both blocks currently contribute properties to the final computed
  style, this is a genuine cascade conflict, not a simple redundant duplicate —
  merging or deleting either block could change the toast's actual rendered
  appearance. Flagged as technical debt for design review rather than merged.
- **`@keyframes axNotifPulse` is defined identically in both `os-shell.css` and
  `ax-topbar.css`.** Both are genuinely needed as-is: `os-shell.css` is only loaded
  by `os-shell.html`, `ax-topbar.css` is loaded by the other pages, so consolidating
  this into one shared file would mean changing which stylesheets are linked from
  which HTML pages — an architecture change outside a cleanup-only pass.
- Several apparent "duplicates" flagged by the automated pass turned out to be a
  normal, correct CSS pattern (a shared base rule + individual per-variant overrides,
  e.g. `.ax-glass-1, .ax-glass-2, .ax-glass-3 { shared }` followed by
  `.ax-glass-1 { specific }`), not redundant code. These were left alone.

## False positives worth noting for future audits
The word-boundary token search occasionally matched a generic English word used in an
unrelated context (`down`, `switch`, `tag`, `field`) and reported a dead selector as
"used." These were caught by hand during verification (see `.dash-stat-delta.down`,
which was removed despite this, since its parent class `.dash-stat-delta` never
appears at all) but a future pass should account for this class of false positive
directly in tooling.

## Estimated reduction
- `app.css`: 402 → 288 lines (‑28%), 21.5KB → 14.6KB
- `ax-redesign.css`: 1,178 → 1,151 lines (‑2.3%), 30.9KB → 30.4KB
- `ax-chat.css`: 1,003 → 1,001 lines (empty rule only)
- `rtl.css`: 77 → 74 lines
- Total non-archived CSS: 12,549 → 12,403 lines (‑1.2%), 376.6KB → ~369KB

The reduction is modest relative to the codebase's total size on purpose — the large
"retained" list above represents CSS this pass could not *prove* dead with the
available evidence, and the brief explicitly asked to optimize for maintainability
and safety over raw file-size reduction.
