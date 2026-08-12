# Browser Engine — Error Recovery Report
## Block 2 · Step 5 · Part 6B

**Date:** 2026-08-01
**Method:** Read every function in the call path from `BrowserToolRegistry` → `BrowserSandbox` → `BrowserManager` → `AxiomBrowserEngine`, then verified behavior — not just reviewed code by eye — by running the real, unmodified source against a hand-written hostile fake Engine (every method throws) inside `test-evidence/block2-step5-part6b-error-recovery-regression-suite.js`. Where a claim below says "verified," it means an assertion in that suite exercises it; where it says "reviewed," it means read but not exercised by an automated test this pass.

---

## 1. Failure scenarios in the execution order, and what actually happens today

| Scenario | Where it's handled | Result before this pass | Result after this pass |
|---|---|---|---|
| Failed navigation (Engine returns a failure result) | `browser-engine.js` `navigate()` already returns `null` cleanly; `BrowserManager.navigate()` maps it to `{ ok:false, reason }` | Already handled | Unchanged, verified |
| Invalid URL | `BrowserSandbox.validateUrl()` + `Engine.validateUrl()` | Already handled — fails closed with a reason string | Unchanged, verified |
| Missing session (`sessionId` doesn't exist) | `resolveSessionId()` | **Not handled** — `Engine.getActiveSessionId()` call was unguarded, an Engine exception here propagated out of BrowserManager | **Fixed** — wrapped in `safeCall`, falls back to `'default'` |
| Missing tab (`tabId` doesn't exist or Engine can't resolve one) | `resolveTabId()`, `TabAPI.*` | **Not handled** for the resolver (same bug as above); handled for `TabAPI.*` themselves (already returned `false`/`null` on missing Engine methods, just not on Engine exceptions) | **Fixed** — resolver wrapped; every `TabAPI` method now also survives an Engine exception, not just a missing Engine method |
| Browser timeouts (navigation that never settles) | Diagnostics (`inFlightNavigations`) | **Not handled** — a navigation that never received a `navigation:completed`/`failed`/`cancelled` event stayed "in-flight" in `navStartTimes` forever | **Fixed** — `NAV_TIMEOUT_MS` (30s) + `sweepStaleNavigations()`, invoked on every `diagnostics()` call |
| Interrupted navigation (e.g. tab closed mid-navigation) | `Engine.onChange` handler in `browser-manager.js` | Already handled — `tab:closed` clears the matching `navStartTimes` entry | Unchanged, verified by the pre-existing Part 6A suite |
| Session restore failures (corrupt/malformed snapshot) | `SessionAPI.restoreSession()` | **Not handled** — `Engine.restoreSession()` throws `Invalid session snapshot.` on a malformed snapshot, and that throw was unguarded in `BrowserManager` | **Fixed** — type-checked before calling the Engine, and the Engine call itself is wrapped; fails safe to `null` |
| Browser restart scenarios | `SessionAPI.restoreSession()` (the only restart-recovery entry point that exists) | Same defect as above | Same fix as above |

---

## 2. Standardized error envelope

Before this pass, failure returns were inconsistent: some `BrowserManager` methods returned `{ ok:false, reason }`, some returned bare `false`/`null`, and `executeBrowserOp()`/`executeTool()` threw or rejected. That inconsistency is real and only partially resolved:

- **`executeBrowserOp()`** (the Automation/Agent-facing execution helper) now *always* resolves. On any internal exception it resolves `{ ok:false, code:'op_exception', reason, op }` via the new `errEnvelope()` helper. Verified for every registered op plus an unknown op.
- **`executeTool()`** (the Agent-facing tool pipeline) now *always* resolves a `{ ok:false, code, reason, tool }` envelope on failure — `tool_not_found`, `manager_unavailable`, `sandbox_exception`, `sandbox_rejected`, `permission_exception`, `permission_denied`, `handler_exception`, `handler_rejected`, or `unhandled_exception`. Verified for four of those eight codes directly (`tool_not_found`, `handler_exception`, `handler_rejected`, and the pass-through case where the handler itself already fails safe); the remaining codes (`manager_unavailable`, `sandbox_exception`, `sandbox_rejected`, `permission_exception`, `permission_denied`) are reviewed but not individually exercised by a new assertion this pass — they follow the same guarded pattern as the ones that are tested.
- **The individual `NavigationAPI`/`SessionAPI`/`HistoryAPI`/`TabAPI` methods were deliberately *not* changed to a uniform envelope shape.** They keep their pre-existing return types (`boolean`, `null`, or their existing object shapes) so that every other file calling `BrowserManager` directly (`browser-bridge.js`, `browser-agent.js`, any future caller) keeps working without changes. What changed is that an *Engine exception* inside any of them now degrades to the same safe fallback the method already returned for the "Engine method doesn't exist" case, rather than throwing. This is documented as a known inconsistency below, not swept under the rug.

---

## 3. Runtime resilience (Part B) — module synchronization after a failure

Checked whether `BrowserManager`, `BrowserSandbox`, `BrowserToolRegistry`, `BrowserBridge`, and `BrowserAgent` can end up disagreeing about state after a failure:

- **Event isolation already exists at the source.** `AxiomBrowserEngine.emit()` wraps every listener call in its own try/catch (`os/core/browser-engine.js`), so a bug in `browser-brain-bridge.js` or `browser-memory-bridge.js`'s event handler cannot stop `BrowserManager`'s own `Engine.onChange` handler from running, and vice versa. This was reviewed, not newly built — it predates this pass.
- **`BrowserManager`'s own listener bus (`emit()`/`on()`/`off()`) has the same isolation** (`try { fn(...) } catch (e) { log(...) }`), confirmed by reading the code; this also predates this pass.
- **No new cross-module desync was introduced.** The `safeCall()` wrapping only changes what a single method returns on exception — it does not change what gets written to `Engine` state, so there's no new path where `BrowserManager`'s metrics/diagnostics could drift out of sync with the Engine's own tab/session maps.
- **Not independently re-verified this pass:** whether `BrowserSandbox`'s permission store and `BrowserToolRegistry`'s tool registry can themselves get into a bad state under concurrent/re-entrant calls. Both are simple synchronous `Map`-backed stores with no async state machine, so the risk surface looked low on review, but this was not stress-tested.

---

## 4. State recovery (Part C)

| State | Recovery behavior |
|---|---|
| Navigation state | `resolveTabId()`/`resolveSessionId()` now fail safe; a navigation against a missing tab returns `{ ok:false, reason:'no_active_tab' }` instead of silently calling the Engine with a `null` tab id (this was a secondary fix alongside the resolver hardening — previously `navigate()` would pass a `null` tid straight to the Engine call). |
| Active session / active tab | `getActiveSession()`/`tabs.getActive()` fail safe to a default object / `null` respectively. |
| History state | `readHistory()`/`clearHistory()` fail safe to `{ history:[], total:0 }` / `false`. |
| Browser metrics | `getMetrics()` already tolerated a missing/malformed active session (`activeTabCount()` helper, from Part 6A); unaffected by this pass. |
| Diagnostics state | `diagnostics()` now also sweeps stale in-flight navigations before reporting, and guards its own `Engine.listSessions()`/`Engine.getStats()` calls with `safeCall()` so a throwing Engine can't break the diagnostics endpoint itself — the one thing you need working *especially* when something else is broken. |

Recovery preserves state where the Engine itself has it (e.g. `restoreSession()` still restores every tab it can parse from a snapshot, it only fails the *whole* session if the snapshot shape is fundamentally wrong) — that partial-recovery behavior is the Engine's own design (`os/core/browser-engine.js`) and was not changed.

---

## 5. What this pass did **not** cover (see also `BROWSER_CERTIFICATION.md` § Known Limitations)

- `os/core/browser-engine.js` itself (790 lines) was reviewed for its two throw points relevant to `BrowserManager` (`createTab()` on an unknown session, `restoreSession()` on a malformed snapshot) and its `StorageAdapter`, but not audited line-by-line the way `browser-manager.js` was. Its other ~35 functions were spot-read, not individually hardened or tested against a hostile-input suite.
- `os/core/browser-memory-bridge.js` and `os/core/browser-brain-bridge.js` were reviewed for the event-isolation guarantee above, but their own public methods (`listVisits`, `getSessionRecord`, etc.) were not individually stress-tested against malformed input.
- `os/workspaces/browser.js` and `js/pages/browser-live.js`/`browser-studio-ultimate.js` (the DOM/iframe renderer layer) were out of scope for this pass — Part 6A's audit already covered `browser-live.js` rendering performance, and this pass is scoped to error recovery in the manager/registry gateway layer per the execution order's explicit "no new features, no UI redesign" instruction.
- No fuzz testing or property-based testing was run — the hostile-Engine suite covers "every method throws" and "navigation never settles," not the full space of malformed-but-not-throwing return values (e.g. an Engine that returns a session object missing expected fields).
