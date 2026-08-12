# AXIOM — JavaScript Initialization Audit
### Phase 10 · Part 2 · Block 1 · Step 3 (Part 2)

**Date:** 2026-07-31
**Scope:** Application startup only — every page loading exactly once, with no
duplicate init, no duplicate event registration, no repeated timers/polling, and
no ordering race conditions. CSS and business logic are out of scope (CSS was
covered in the prior Step 3 pass — see `GLOBAL_CSS_AUDIT.md`).

---

## Method

1. Enumerated every startup hook in the project: `DOMContentLoaded` listeners,
   `window.onload`/`addEventListener('load', …)`, and every `setInterval` call.
2. Checked all 16 HTML pages for duplicate `<script src>` includes (a script
   loaded twice is the most direct way to get duplicate init).
3. For the ~40 scripts under `js/core/`, `js/pages/`, `js/bridges/`, and
   `components/` that run together on most authenticated pages, cross-referenced
   `getElementById()` targets to find any DOM element wired up by more than one
   file — the concrete signature of two independent init routines fighting over
   the same widget.
4. For the `os-shell.html` "AI OS" shell (a separate, self-contained script tree
   under `os/`), checked that each manager module (window manager, desktop
   manager, wallpaper engine, snap zones, mission control) has a single `init()`
   entry point behind one readiness check, orchestrated once by
   `os/core/part6-bootstrap.js`.
5. Ran every fix through `node -c` (syntax check) across all 155 `.js` files.

---

## Findings

### Fixed

**`js/pages/settings-i18n.js` — dead nested `DOMContentLoaded` listener**

`renderVoiceSelectors()` contained:
```js
document.addEventListener('DOMContentLoaded', refreshOutputVoices);
```
`renderVoiceSelectors()` is itself only ever called from inside this file's own
top-level `DOMContentLoaded` handler. By the time that call happens, the
`DOMContentLoaded` event has already fired on `document` — a listener registered
for it at that point will never run. It wasn't causing a visible bug (the
function is also called directly right after, and voice-list refresh on async
load is separately handled by `speechSynthesis.onvoiceschanged`), but it's dead
code that misrepresents the actual load-order dependency. Removed, with a comment
explaining why, so it doesn't get reintroduced.

This was the **only** file in the project with more than one `DOMContentLoaded`
registration in the same script.

### Checked and clean

| Area | What was checked | Result |
|---|---|---|
| All 16 HTML pages | Duplicate `<script src="...">` for the same file | None found |
| `components/app-init.js` | Shared bootstrap for clock, search bar, quick command, notifications, dock auto-hide, loaded on every authenticated page | Single IIFE, guards with `document.readyState === 'loading'` before choosing `DOMContentLoaded` vs. immediate call. One entry point, one run. |
| `#particles` background effect | Populated by both `js/core/script.js` and `components/premium-shell.js` on pages that load both | `premium-shell.js`'s `populateParticles()` checks `holder.childElementCount` and no-ops if `script.js` (which always loads earlier) already populated it. No double-render. |
| `os-shell.html` shell modules | `window-manager.js`, `desktop-manager.js`, `wallpaper-engine.js`, `snap-zones.js`, `mission-control.js` | Each exposes one `init()`, sequenced once by `part6-bootstrap.js`. No competing bootstraps. |
| `_archive/unused-legacy/ai-reactor-core.js` | Whether it's linked from any live page | Not referenced by any `.html` file — its `DOMContentLoaded` handler is unreachable dead code, but since nothing loads the file, it poses no live duplicate-init risk. Left as-is (archived, out of scope to touch). |
| Shared IDs across co-loaded core files (`chatInput`, `chatForm`, `authError`) | Whether more than one file wires listeners to the same element | `components/premium-shell.js`'s use of `#chatInput`/`#chatForm` (`restoreDashboardPrompt()`) reads the field and clicks the existing submit button once — it doesn't attach its own `submit` listener. `js/core/app.js` owns the only `submit` handler. Not a collision. |
| All `.js` files | Syntax validity after edits | `node -c` passes on all 155 files |

---

## Out of scope for this pass (flagged, not audited line-by-line)

The `os/runtime/` tree — agent definitions, capability kits, and the
intelligence/automation/scheduler/knowledge subsystem files (~70 files) — was
searched for the same named patterns (extra `DOMContentLoaded` registrations,
uncleared `setInterval` polling loops) and nothing matching those patterns
surfaced. It was **not** given the same full line-by-line collision review as
the page-startup scripts above, because it's internal runtime/state machinery
rather than page-bootstrap code — a different kind of audit than "does the page
initialize exactly once." If you want that subsystem tree reviewed with the same
rigor, it's a reasonable follow-up step.

---

## Validation

- Every page's script list was diffed for duplicate includes — none found, so no
  script runs its top-level code twice.
- The one real defect found (dead listener) has been removed; behavior is
  unchanged since the code path was already unreachable.
- `node -c` syntax check passed on all 155 `.js` files, including the modified
  one.
- No CSS, HTML structure, or business logic was touched, so no navigation or
  page-render behavior changed as a result of this pass. (Live browser
  click-through across all 16 pages wasn't performed in this environment — the
  checks above are static/structural, not a runtime browser test.)
