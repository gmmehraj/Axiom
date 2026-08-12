# AXIOM Browser Foundation
### Block 2 / Step 5 / Part 1
Role: Senior Browser Platform Architect
Scope: Browser Engine architecture only — no UI redesign, no OpenRouter
connection, no autonomous/real web automation.

---

## 1. Audit — what was actually there

| Area | Finding |
|---|---|
| Browser page | `browser.html` — real markup (toolbar, tabs strip, url bar, viewport, bookmarks/history panels), not decorative. |
| Browser service / architecture | **None.** All state (`tabs`, `activeTabId`, `bookmarks`, `history`, `downloads`) lived as plain module-closure variables inside `js/pages/browser-live.js`, declared in the same file that manipulates `els.frame.src` directly. No separate service, no headless API. |
| Navigation logic | Real — `normalizeUrl()` correctly turned bare domains into `https://` urls and everything else into a DuckDuckGo search; a genuine per-tab `hist`/`histIndex` stack backed back/forward. All of it lived inline in the DOM file. |
| Session handling | **None.** There was exactly one implicit "session" — whatever was in the module closure — with no concept of more than one, and nothing a second consumer (e.g. an isolated agent browsing session) could hook into. |
| Tab handling | Real (create/switch/close, auto-reopen a blank tab when the last one closes) but tightly coupled to `renderTabs()`'s DOM output — no way to list/inspect tabs without `browser.html`'s exact markup being present. |
| Placeholder behavior | None found — the "blocked embed" timeout/fallback and the cross-origin `try/catch` guards around `readingMode`/`extractLinks`/`extractImages` are real, honest handling of real browser security boundaries, not placeholders. |
| Mock data | None found in `browser-live.js` itself. |
| Existing browser APIs | `os/runtime/capabilities/browser-bridge.js` (Milestone 5) already exposes a clean `window.AxiomBrowserBridge` command surface for the Browser Agent, and already assumes a stable `window.AxiomBrowserLive` (same-window) or `postMessage` (cross-window iframe) backend exists. It was built as a bridge to *something* — but that something was three closures in a DOM file, not an architecture. |

**The core gap:** `os/runtime/capabilities/browser-bridge.js` is loaded on
every major page (`brain.html`, `automation.html`, `memory.html`,
`os-shell.html`, etc.) so the Browser Agent can be invoked from any of
them — but it only ever actually reaches real state on `browser.html`
itself (same-window) or through an embedded `browser.html` iframe
(`postMessage`). There was no headless browser service Brain, Automation,
or Memory's own runtime code (`research-toolkit.js`, `planner-store.js`,
`job-manager.js`, `browser-intelligence.js`) could call directly without
a live `browser.html` DOM present. That's the exact gap this pass closes.

## 2. What was built

A new module, **`os/core/browser-engine.js`**, exposing
`window.AxiomBrowserEngine`. It follows the same architectural convention
already established by `os/core/memory-engine.js` and
`os/core/automation-engine.js` in this codebase: a narrow, well-documented
public API; internal state; a pub/sub layer for consumers; localStorage
as the persistence backend for the parts that were already persisted,
namespaced and schema-versioned so the backend can be swapped later
without callers changing.

### Browser lifecycle
`init()` is idempotent — a second call returns the same default session
rather than creating a duplicate, mirroring the Memory/Automation
engines. It loads persisted bookmarks/history/downloads, runs a one-time
migration of the three legacy localStorage keys `browser-live.js` used to
write directly, and creates the always-on default (user-visible) session.

### Session model
A session is `{ id, background, label, tabIds, activeTabId, createdAt,
lastActiveAt }`. `init()` creates exactly one non-background session — the
visible Browser workspace. `createSession({ background: true })` creates
an **isolated** session with its own tab set, entirely independent of the
default session's tabs and active tab. This is the integration point a
future autonomous browsing agent (explicitly out of scope for this pass)
will use: it can open, navigate, and close its own tabs in its own
session without ever touching — or being visible in — the tabs a person
has open. `endSession(id)` closes every tab in a session and removes it.

### Tab model
A tab is `{ id, sessionId, title, url, favicon, hist, histIndex, status,
errorMessage, createdAt, updatedAt }` — the exact same `hist`/`histIndex`
navigation-stack shape `browser-live.js` always used, just owned by the
engine instead of a closure array. `createTab`/`closeTab`/`switchTab`
preserve the exact prior behavior: closing the last tab in a session
reopens a fresh blank one rather than leaving the workspace empty;
closing a non-active tab never disturbs the active one; `switchTab`
rejects a tab id that belongs to a different session (verified in the
regression suite — this matters once background/agent sessions exist).

### Navigation
`navigate`/`goBack`/`goForward`/`refresh` and the `normalizeUrl` helper
are moved here **verbatim** from `browser-live.js` — same regex rules
(bare domain → `https://…`, anything else → a DuckDuckGo search). Every
navigation truncates the forward stack exactly as before, so
back-then-navigate correctly discards the old forward history.

### Browser state (loading / blocked / error)
A small, explicit status enum per tab: `empty` → `loading` → one of
`loaded` / `blocked` / `error`. `navigate()`/`goBack()`/`goForward()`/
`refresh()` set `loading` immediately; the actual `loaded`/`blocked`/
`error` outcome is only ever set by `reportLoaded()`/`reportBlocked()`/
`reportError()`, which the DOM renderer calls **after the real `<iframe>`
actually settles** (its `onload`, its `onerror`, or the existing 7-second
blocked-embed timeout). The engine itself never assumes a navigation
succeeded — it has no way to reach the network on its own, by design.

### History / bookmarks / downloads
Moved here verbatim from `browser-live.js` (same record shapes: `{ url,
title, time }` for history, `{ url, title }` for bookmarks, `{ id, url,
filename, source, time }` for downloads), now behind a single
`StorageAdapter` and namespaced under `axiom:browser:v1:*` instead of
three separate ad-hoc `localStorage.getItem/setItem` calls scattered
through the DOM file. A one-time migration copies over anything already
stored under the old keys (`axiom-browser-bookmarks`, `axiom-browser-
history`, `axiom-browser-downloads`) so upgrading never silently discards
a person's saved data, and does not re-run or re-populate from the
legacy keys on a later reload (verified in the regression suite by
removing a migrated bookmark and confirming a fresh engine instance
doesn't resurrect it).

### Browser state management (pub/sub)
`onChange(fn)` (returns an unsubscribe function) emits on every mutation:
`engine:initialized`, `session:started`/`ended`, `tab:created`/
`switched`/`closed`/`navigated`/`status`, `bookmark:added`/`removed`,
`history:recorded`/`cleared`, `download:recorded`/`downloads:cleared`.
Listeners are isolated in a `try/catch` — one throwing listener cannot
break another or crash the engine (verified in the regression suite).

## 3. Integration — browser.html / browser-live.js

- `browser.html` now loads `os/core/browser-engine.js` immediately before
  `js/pages/browser-live.js`.
- `browser-live.js` no longer holds any browser state itself. It is now a
  **DOM renderer** over the engine: every function that used to read or
  mutate the local `tabs`/`activeTabId`/`bookmarks`/`history`/`downloads`
  arrays now calls the matching `AxiomBrowserEngine` method instead, and a
  single `onEngineChange` subscription drives the existing tab-strip /
  bookmarks-panel / history-panel rendering and the real `<iframe>` load.
- **The public surfaces are unchanged.** `window.AxiomBrowserLive` still
  exposes the exact same method names and signatures it always did
  (`navigate`, `goBack`, `goForward`, `refresh`, `newTab`, `switchTab`,
  `closeTab`, `search`, `toggleBookmark`, `getSnapshot`, `bookmarksList`,
  `historyList`, `historyClear`, `recordDownload`, `listDownloads`,
  `clearDownloads`, `readingMode`, `summarizePage`, `extractLinks`,
  `extractImages`, `isBlocked`), and the `postMessage` command handler
  (`axiom-browser-command` → `axiom-browser-ack`) has the exact same ops
  and payload shapes as before. **No changes were needed** in
  `os/runtime/capabilities/browser-bridge.js` or
  `os/runtime/agent-definitions/browser-agent.js` — both keep working
  against `browser-live.js` exactly as before, which now happens to be
  backed by the engine underneath.
- No markup, layout, or visual styling changed — same `browser.html`,
  same element IDs, same CSS. The reading-mode/summarize/extract-links/
  extract-images functions still reach into the real iframe's
  `contentDocument` (with the same cross-origin `try/catch` guards) since
  that is inherently a DOM concern the headless engine cannot and should
  not perform.

## 4. Validation

Ran
`test-evidence/block2-step5-part1-browser-foundation-regression-suite.js`
against the real, unmodified `os/core/browser-engine.js` (21 checks, all
passing — output in the matching `-output.txt`):

- Browser initializes correctly: `init()` is idempotent (a second call
  does not create a second default session); the default session exists
  immediately with zero tabs (the engine does not auto-create a tab on
  init — only `browser-live.js`'s own `newTab()` call at the end of its
  `init()` does that, matching the original page behavior exactly).
- Navigation state updates: url normalization, back/forward walking the
  real per-tab history stack, and forward-stack truncation on a new
  navigation from the middle of the stack.
- Tabs function correctly: creating a tab without a url leaves it empty;
  closing the last tab in a session reopens a blank one; closing a
  non-active tab leaves the active tab untouched; `switchTab` rejects a
  tab id from a different session.
- Sessions are tracked: a background/agent session's tabs are fully
  isolated from the default session's tabs (different active tab, does
  not appear in the other's `listTabs`); `endSession` tears down all of
  its tabs.
- Browser state (loading/loaded/blocked/error) is driven only by explicit
  `report*()` calls, never assumed; `getSnapshot()`'s shape matches what
  `browser-live.js`'s pre-Engine `getSnapshot()` always returned.
- Bookmarks/history/downloads CRUD, and — like the Memory Foundation
  suite's persistence check — a **second, independent engine instance**
  reading the same `localStorage` sees the same bookmarks/downloads the
  first instance wrote, proving persistence goes through the storage
  layer and not an in-process array. Legacy-key migration runs exactly
  once and does not resurrect data a later write already changed.
- Pub/sub notifications fire for the right events, unsubscribing actually
  stops them, and a throwing listener cannot break another listener or
  the engine.
- No console errors: the suite loads and executes the real file end to
  end under Node's `vm` sandbox without throwing, including a full
  realistic multi-tab session (create, navigate, load, block, bookmark,
  switch, back, close) run end-to-end.

Manual check: `browser.html` was inspected for any remaining state that
still lives outside the engine after the integration changes above —
none found; `js/pages/browser-live.js` contains no state declarations of
its own anymore, only DOM element references and rendering functions.

## 5. Remaining work

This pass is the architecture foundation only, per spec. Reasonable next
steps, explicitly not done here:

1. **Real web automation.** The engine's navigation is still driven
   entirely by a real `<iframe>` that a person (or, currently, the
   Browser Agent via the existing bridge) points at a url — there is no
   agent-initiated autonomous browsing (multi-step navigation, form
   filling, page-state reasoning) yet. The `background` session concept
   built in this pass is the seam a future autonomous agent would plug
   into, so its browsing stays isolated from the user's visible tabs.
2. **Tab/session persistence across a reload.** Tabs and sessions are
   still ephemeral, matching the exact behavior `browser-live.js` always
   had (a hard refresh always started with one fresh blank tab).
   Bookmarks/history/downloads already persist; extending that to
   tabs/sessions is a reasonable, low-risk follow-up now that the engine
   has a clear place to put it (a `KEYS.sessions`/`KEYS.tabs` entry
   behind the same `StorageAdapter`).
3. **`os/runtime/capabilities/browser-bridge.js` calling the engine
   directly.** Right now the bridge still talks to `AxiomBrowserLive`
   (same-window) or `postMessage` (cross-window iframe) exactly as
   before — which is correct, since `browser-live.js` is now backed by
   the engine underneath, so nothing broke. A future pass could let
   Brain/Automation/Memory's own runtime code call
   `window.AxiomBrowserEngine` directly (e.g. to open a background
   session) without needing a live `browser.html` DOM present at all —
   that is a natural Part 2 for this Step, not done here since it starts
   touching the Agent/Bridge files this task's scope explicitly excluded.
4. **OpenRouter / AI wiring** (e.g. AI-driven summarization beyond the
   existing extractive `summarizePage()`) — explicitly out of scope per
   the master order.
