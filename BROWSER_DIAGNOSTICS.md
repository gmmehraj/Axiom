# Browser Diagnostics API Reference — Block 2 · Step 5 · Part 6A

**Role:** Senior Browser Platform Engineer
**Scope:** Diagnostics surface added to `BrowserManager` (`os/core/browser-manager.js`) for production health checks, performance monitoring, and runtime introspection.

---

## 1. Overview

- **Module:** `window.AxiomBrowserManager` (also `window.BrowserManager`)
- **API Version:** `1.1.0` (was `1.0.0` — additive only, no breaking changes)

Four new read-only methods were added. None of them mutate browser state, none of them are called on a timer — each computes its answer on demand from existing in-memory state (the same counters `getMetrics()` already used, plus a small amount of new, bounded instrumentation described in §3).

```js
AxiomBrowserManager.health()
AxiomBrowserManager.diagnostics()
AxiomBrowserManager.getPerformance()
AxiomBrowserManager.getRuntimeInfo()
```

---

## 2. `health()`

Quick pass/fail check of BrowserManager's dependencies.

**Returns:**
```json
{
  "status": "healthy",
  "checks": {
    "engine": true,
    "sandbox": true,
    "brainBridge": false,
    "memoryBridge": false
  },
  "timestamp": 1785572187541
}
```

- `status`:
  - `"unavailable"` — `AxiomBrowserEngine` is not loaded. This is the only hard dependency; without it `BrowserManager` cannot function at all.
  - `"degraded"` — Engine is present but `AxiomBrowserSandbox` is not (navigation runs without the sandbox's URL/permission checks — see `BROWSER_PUBLIC_APIS.md` §2).
  - `"healthy"` — Engine and Sandbox both present.
- `checks.brainBridge` / `checks.memoryBridge` reflect whether `AxiomBrain` / `AxiomMemoryEngine` are loaded, for context — they are not required for `BrowserManager` to be healthy, since Brain/Memory integration is optional (see `os/core/browser-brain-bridge.js` / `browser-memory-bridge.js`).

---

## 3. `diagnostics()`

A consolidated snapshot for troubleshooting — everything you'd otherwise have to call four or five separate methods to assemble.

**Returns:**
```json
{
  "health": { "status": "healthy", "checks": { "...": "..." }, "timestamp": 0 },
  "activeSessions": 1,
  "activeTabs": 3,
  "totalTabsAcrossSessions": 5,
  "eventListenerCount": 2,
  "inFlightNavigations": 0,
  "metrics": { "...": "see getMetrics()" },
  "performance": { "...": "see getPerformance()" },
  "engineStats": { "sessionCount": 2, "tabCount": 5, "bookmarkCount": 4, "historyCount": 12, "downloadCount": 0 },
  "timestamp": 1785572187541
}
```

- `activeSessions` — count of all engine sessions (visible + background/agent sessions).
- `activeTabs` — tab count for the **currently active** session only. Fixed in this pass to read the engine's real session shape (`tabIds`) instead of a field that never existed on it — see `PERFORMANCE_AUDIT.md` §4.2.
- `totalTabsAcrossSessions` — tab count summed across every session, active or not.
- `eventListenerCount` — number of listeners currently subscribed via `BrowserManager.on()`/`.events.on()`. Useful for catching a listener leak: this number should return to its baseline after a component that subscribed unsubscribes (via the function `on()` returns), not grow unbounded over the app's lifetime.
- `inFlightNavigations` — number of tab navigations that have started but not yet settled (completed/failed/cancelled). Should be `0` at rest; a persistently nonzero value with no active loading UI would indicate a navigation that never got a matching `reportLoaded`/`reportError`/`reportBlocked` call.

---

## 4. `getPerformance()`

Navigation timing and interaction-frequency stats.

**Returns:**
```json
{
  "navigation": {
    "sampleCount": 12,
    "lastMs": 340,
    "avgMs": 285,
    "minMs": 90,
    "maxMs": 610
  },
  "tabSwitchCount": 7,
  "sessionSwitchCount": 1,
  "totalNavigations": 15,
  "successRate": 93.3
}
```

- `navigation.sampleCount` — how many completed navigations have timing data, capped at the most recent **50** (a fixed-size ring buffer — this number never grows past 50, by design, so `getPerformance()` stays cheap to call for the lifetime of a long session).
- `navigation.lastMs` / `avgMs` / `minMs` / `maxMs` — wall-clock time in milliseconds from `navigation:started` to `navigation:completed`, i.e. from the moment `BrowserManager`/the engine begins a navigation to the moment the renderer reports the page actually loaded (`engine.reportLoaded()`). This is real elapsed time from the browser's own event stream, not a synthetic estimate.
- `tabSwitchCount` / `sessionSwitchCount` — running totals since `BrowserManager` was loaded (not persisted across page reloads).
- `successRate` — `successfulNavigations / totalNavigations`, as a percentage rounded to one decimal place; `null` if no navigations have occurred yet.

**How timing samples are collected:** `BrowserManager` already subscribes to the engine's `onChange` dispatcher to re-emit normalized events (this is not new). This pass added timing capture directly into that existing subscription — on `navigation:started` it records a start timestamp keyed by `tabId`; on `navigation:completed` it computes the elapsed time and pushes it into the ring buffer; on `navigation:failed`/`navigation:cancelled` it discards the start timestamp without recording a sample (a failed navigation has no meaningful "load time"). If a tab is closed while a navigation is still in flight, its start timestamp is deleted immediately on `tab:closed` — so `inFlightNavigations` (see §3) can never accumulate a stale entry for a tab that no longer exists.

---

## 5. `getRuntimeInfo()`

Static-ish runtime identity — what version is running, whether its dependencies loaded, how long it's been up.

**Returns:**
```json
{
  "apiVersion": "1.1.0",
  "engineLoaded": true,
  "sandboxLoaded": true,
  "uptimeMs": 452301,
  "startedAt": 1785571735240,
  "userAgent": "Mozilla/5.0 ...",
  "activeSessionId": "sess_msa3ktjj_a1b364"
}
```

- `apiVersion` — mirrors `BrowserManager.API_VERSION`.
- `uptimeMs` / `startedAt` — measured from when the `browser-manager.js` module executed (i.e. page/workspace load), not from `AxiomBrowserEngine.init()`.
- `userAgent` — `navigator.userAgent`, or `null` in a non-browser context (e.g. the Node-based regression suites).

---

## 6. Usage notes

- All four methods are synchronous and side-effect-free — safe to call from a health-check dashboard, a support/debug panel, or an automated smoke test on any cadence.
- None of them require a session or tab to exist; called before `AxiomBrowserEngine.init()`, `health()` correctly reports `"unavailable"` and the others return zeroed/`null` fields rather than throwing.
- These are additive to the existing `getMetrics()`/`getStats()`/`getSnapshot()` methods, which are unchanged in shape (aside from the `activeTabs` bug fix noted in §3) and remain the right choice for lightweight, high-frequency polling; the new diagnostics methods are intended for occasional/on-demand introspection.
