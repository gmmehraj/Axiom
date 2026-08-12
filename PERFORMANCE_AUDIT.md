# Browser Engine — Production Audit & Performance Optimization

**Block 2 · Step 5 · Part 6A**
**Role:** Senior Browser Platform Engineer
**Date:** 2026-08-01
**Scope:** `BrowserManager`, `BrowserSandbox`, `BrowserToolRegistry`, `BrowserBridge`, `BrowserAgent`, Navigation Manager, Session Manager, Tab Manager, History Manager, Metrics API. No new features, no UI redesign, no changes to Brain, Memory, Automation, Analytics, AI Core, or OpenRouter.

---

## 1. Method

Every file under the audit scope was read in full against the four-part checklist in the execution order (Architecture / Performance / Memory & Resource / Diagnostics). Findings were validated against real code, not inspection alone:

- The existing engine-only regression suites (`block2-step5-part1-browser-foundation-regression-suite.js`, `block2-step5-part2-navigation-session-regression-suite.js`) were re-run unmodified against this pass — **21/21** and **21/21** passing, confirming no regression to `browser-engine.js` (which was not touched).
- A new suite, `block2-step5-part6a-browser-audit-regression-suite.js`, was written to exercise `browser-manager.js` directly for the first time (previous suites only drove the engine) — **7/7** passing, and it is what caught both bugs below before they shipped.

---

## 2. Part A — Architecture Audit

| Check | Result |
|---|---|
| No duplicate browser logic | **Pass.** Exactly one `tabs` Map, one `sessions` Map, one `history` array, one event bus — all owned by `browser-engine.js`. `BrowserManager`, `BrowserBridge`, and `BrowserAgent` are thin wrappers with no parallel state. |
| `BrowserManager` remains the single public browser gateway | **Pass.** Every caller reviewed (`BrowserBridge`, `BrowserAgent`'s tool handlers, `BrowserToolRegistry` schemas) routes through `BrowserManager` or, for the live iframe renderer specifically, through the engine directly by design (`browser-live.js` is the one place allowed to own the real `<iframe>`). |
| Public APIs remain consistent | **Fixed during this pass** — see §4. Two inconsistencies were found between what `BrowserManager`'s public surface claimed to return and what it actually computed/called; both are corrected below. |

No structural changes were made to the module boundaries. The existing convention (flat top-level methods + namespaced sub-APIs, both backed by the same internal state) is sound and was preserved exactly.

---

## 3. Part B — Performance Optimization

### 3.1 Tab-strip re-render cost (fixed)

**Before:** `renderTabs()` in `js/pages/browser-live.js` rebuilt every tab's DOM node via `innerHTML` and attached two fresh `click` listeners per tab, on every call. A single navigation's lifecycle (`tab:navigated` at start → `tab:status` at completion) triggered this **twice**, and the cost scaled linearly with the total number of open tabs even though at most one tab's state had actually changed.

**After:**
- One delegated `click` listener on the tab-strip container, wired once in `init()`. Re-rendering the strip no longer creates or discards any listeners — listener count is now `O(1)` in the number of renders, not `O(renders × tabs)`.
- `scheduleRenderTabs()`, an `requestAnimationFrame`-coalesced scheduler: any number of `renderTabs()` triggers within the same frame collapse into one repaint. A full navigation lifecycle now repaints the strip once instead of twice.
- The one-time initial render on page load remains a direct, synchronous `renderTabs()` call — first paint is not delayed by the new scheduling.

This is the one functional-adjacent change in the pass; it changes *when* and *how often* the DOM is touched, not what it ends up showing. Verified against the existing tab lifecycle tests (create/close/switch/duplicate/reorder) — all pass unchanged.

### 3.2 Navigation, session switching, event dispatch, runtime updates, metrics collection

All other reviewed hot paths were already efficient and were left as-is rather than "optimized" for its own sake:

- **Navigation / session / tab lookups** in the engine are all `Map.get()` — O(1). `resolveSessionId`/`resolveTabId` in `BrowserManager` add no extra scans.
- **Event dispatch**: `emit()` in both the engine and `BrowserManager` iterates a `Set` of listeners directly — no unnecessary array copies, no filtering per emit.
- **Status/phase transitions** (`setStatus`/`setPhase` in the engine) already guard on `tab.status === status` / `tab.phase === phase` before emitting, so redundant state-machine transitions are already no-ops today — this is why `reportLoading()` from the renderer, called right after `beginNavigation()` already set the same status/phase, doesn't double-emit.
- **Metrics collection** (`getMetrics()`, `getStats()`) is computed on demand from existing in-memory counters, not polled or recomputed on a timer — no background cost when nobody is asking for metrics.
- **`BrowserBridge`'s frame-discovery poll** (`setInterval`, 100ms, only while waiting for a workspace iframe to open) is bounded by `OPEN_WAIT_MS` (4s) and self-clears on both success and timeout — acceptable as-is; it only runs during the brief window between requesting a workspace open and the iframe existing.

No changes were made to `browser-engine.js` in this pass — its hot paths were already good, and per the execution order's backward-compatibility requirements, changing it without a functional need was avoided.

---

## 4. Correctness issues found (blocking accurate performance/diagnostics data)

Two defects were found that predate this pass and were not caused by it — both are fixed here because they directly undermine the Part D diagnostics this pass was asked to deliver, and because "public APIs remain consistent" (Part A) requires it.

### 4.1 `NavigationAPI.navigate()` — wrong argument order (real functional bug)

`os/core/browser-manager.js` called:
```js
Engine.navigation.navigate(url, sid, tid)
```
but `NavigationManager.navigate()` in `os/core/browser-engine.js` has the signature `(sessionId, tabId, input)`. Every call that took this branch silently returned `{ ok: false, reason: 'navigation-failed' }` — **every navigation issued through `BrowserManager.navigate()` while `Engine.navigation` was present was broken.** This was never caught because the existing regression suites test `browser-engine.js` directly and never drove a navigation through `BrowserManager` itself.

**Fix:** corrected to `Engine.navigation.navigate(sid, tid, url)`. Covered by the new regression suite's `navigate()`/`back()`/`getMetrics()` end-to-end test.

### 4.2 `getMetrics()` / new `diagnostics()` — active-tab count always read as 0

Both functions derived active-tab count from `activeSession.tabs`. The real session record returned by `Engine.getSession()` stores its tab ids under `tabIds` — `.tabs` only exists on the no-session fallback object `SessionAPI.getActiveSession()` returns when there's no engine session at all. Against any real session, `activeSession.tabs` was `undefined`, so **`getMetrics().activeTabs` silently reported `0` regardless of how many tabs were actually open.**

**Fix:** added `activeTabCount(session)`, which checks `tabIds` first (the real shape) and falls back to `tabs` (the fallback-object shape). Used consistently by both `getMetrics()` and `diagnostics()`.

---

## 5. Impact summary

| Area | Before | After |
|---|---|---|
| Tab-strip DOM rebuilds per navigation | 2 full rebuilds, `2n` listeners attached/discarded each | 1 rAF-coalesced rebuild, 0 listeners attached/discarded per rebuild |
| `BrowserManager.navigate()` (namespaced Engine path) | Always failed | Works correctly |
| `getMetrics().activeTabs` / `diagnostics().activeTabs` | Always `0` | Accurate |
| Regression coverage of `browser-manager.js` | None | 7 new tests, all passing |

No visual regressions: `browser.html`'s markup, CSS, and observable tab-strip behavior (active-tab highlighting, close button, click-to-switch) are unchanged — only the render trigger cadence and listener wiring strategy changed.
