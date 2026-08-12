# AXIOM Navigation & Session Report
### Block 2 / Step 5 / Part 2
Role: Senior Browser Platform Engineer
Scope: Browser Navigation & Session architecture only, continuing from
the Block 2 / Step 5 / Part 1 Browser Engine Foundation. No UI redesign,
no OpenRouter connection, no autonomous browsing, no changes to Brain,
Memory, Automation, Analytics, AI Core, or existing layouts/styling.

---

## 0. Audit — what Part 1 already had vs. what Part 2's six sub-briefs needed

Part 1 (`os/core/browser-engine.js`) already had real, working navigation,
tabs, sessions, and history — this pass is a genuine extension, not a
rebuild. Auditing each of Part 2's six parts against the Part 1 file
found:

| Part | Already present in Part 1 | Gap this pass closes |
|---|---|---|
| A. Navigation Manager | `navigate`/`goBack`/`goForward`/`refresh`, url normalization | No explicit protocol safety check, no stop-loading, no redirect handling, no relative-path resolution, no richer `{ok,url,reason}` result for new callers |
| B. Session Manager | `createSession`/`getSession`/`listSessions`/`endSession`, background sessions | No "which session is in front" concept, no metadata beyond `label`, no way to actually save/restore a session's tabs |
| C. Tab Manager | `createTab`/`closeTab`/`switchTab`/`listTabs`/`getActiveTab` | No duplicate, no reorder |
| D. Browser History | `recordHistory` (internal)/`listHistory`/`clearHistory`, per-tab `hist`/`histIndex` | No explicit back/forward-stack accessors, no aggregate stats for Memory to consume later |
| E. URL Validation | `normalizeUrl()` always produced *something* | **Real gap:** no explicit protocol allowlist — a `javascript:`/`data:`/`vbscript:`/`file:` input only happened to fall through to the DuckDuckGo-search branch by regex coincidence, not by deliberate design. No relative-path handling. No structured validation result a caller could branch on before acting. |
| F. Loading Lifecycle | Coarse `tab.status` (`empty`/`loading`/`loaded`/`blocked`/`error`) | No granular phase model, no cancel/stop capability, `status` conflated "how far did loading get" with "why did it stop" |

The most consequential finding is in **Part E**: while nothing in Part 1
was exploitable in practice (the DOM renderer only ever sets
`iframe.src`, never `iframe.srcdoc` or `eval`s anything), relying on a
regex coincidence rather than an explicit allowlist to keep dangerous
input away from the browser surface is bad practice architecture. This
pass adds a real, explicit `BLOCKED_PROTOCOLS` check ahead of every other
normalization rule — see §3.

## 1. Navigation architecture

`beginNavigation(tab, url, opts)` is the one function every
user-initiated navigation now funnels through — `navigate()`, `goBack()`,
`goForward()`, and `refresh()` all call it. That's a deliberate
architectural choice for the "no duplicate navigation events" quality
requirement: there is exactly one place `tab:navigated` and
`navigation:started` are emitted for any given navigation, no matter
which of the four entry points triggered it, so there's no way for two
code paths to independently double-emit for the same nav.

New capabilities, exposed both as flat methods (`engine.stopLoading()`,
`engine.reportRedirect()`, `engine.validateUrl()`) and as the namespaced
`engine.navigation.*` surface:

- **`stopLoading(sessionId, tabId)`** — only takes effect while a tab is
  actually `loading`; a no-op (`returns false`) once the tab has already
  settled, so it can never "cancel" a page that already finished loading.
  Sets `tab.status = 'cancelled'` and phase `'cancelled'`.
- **`reportRedirect(sessionId, tabId, newUrl)`** — a redirect is the
  *same* logical navigation continuing at a new address: it updates the
  tab's current history entry **in place** rather than pushing a new one,
  so a chain of redirects doesn't inflate back/forward by one step per
  hop, and reports the `'redirecting'` phase.
- **`validateUrl(input, contextUrl?)`** — returns
  `{ valid, kind: 'url'|'search'|'invalid', reason, normalized }` without
  mutating anything. `normalizeUrl(input, contextUrl?)` (Part 1's
  original public function) now delegates to it — **calling
  `normalizeUrl(input)` with one argument, exactly as Part 1 and
  `browser-live.js` already do everywhere, reproduces Part 1's exact
  original output for every input Part 1's own regression suite checks**
  (re-run and confirmed passing — see §6).
- **`engine.navigation.navigate(sessionId, tabId, input)`** — a new,
  additive entry point for future callers (Brain/Automation/Agent
  integrations) that want a real answer instead of `null` on failure:
  returns `{ ok: true, url, reason: null }` or
  `{ ok: false, url: null, reason: 'blocked-protocol' | 'invalid-url' | ... }`.
  The original flat `engine.navigate()` keeps returning exactly what Part
  1 returned (`{url}` or `null`) — nothing about its contract changed.

## 2. URL validation flow (Part E)

```
input
  │
  ▼
empty/whitespace only? ────────────────► invalid: 'empty-input'
  │ no
  ▼
matches BLOCKED_PROTOCOLS?  ────────────► invalid: 'blocked-protocol'
  (javascript:, data:, vbscript:, file:)
  │ no
  ▼
starts with http:// or https:// ? ──────► valid, kind: 'url' (used as-is)
  │ no
  ▼
starts with "/" AND a contextUrl
was given (the current tab's url)? ─────► valid, kind: 'url'
  │ no                                     (resolved via `new URL(input, contextUrl)`)
  ▼
looks like "word.tld" with no spaces? ──► valid, kind: 'url' (https:// prefixed)
  │ no
  ▼
────────────────────────────────────────► valid, kind: 'search'
                                            (DuckDuckGo query — always
                                            produces somewhere to go,
                                            never a dead end)
```

The protocol check runs **before** every other rule, so a blocked
protocol is rejected outright rather than ever reaching the
bare-domain or search-fallback branches. `navigate()` (and
`engine.navigation.navigate()`) both refuse and emit
`navigation:failed` with `reason: 'blocked-protocol'` — the tab's `url`
is left completely untouched (verified in the regression suite: a
blocked-protocol `navigate()` call leaves `tab.url` exactly as it was
before the call).

Relative-path resolution is opt-in via a second `contextUrl` argument
that only `navigate()` supplies internally (as the tab's current `url`)
— a bare call to `normalizeUrl('/pricing')` with no context still falls
through to a search query, identical to Part 1's original behavior, so
nothing that already calls `normalizeUrl(input)` with one argument
anywhere in the codebase changes behavior.

## 3. Session architecture

A session's shape is unchanged from Part 1
(`{ id, background, label, tabIds, activeTabId, createdAt, lastActiveAt }`)
plus one new field, `metadata` (a free-form object, `{}` by default).
Part 2 adds:

- **Active session tracking** — a new `activeSessionId` pointer,
  independent of any single session's own `activeTabId`. `init()` marks
  the default session active; `setActiveSessionId(id)` switches it
  (refused for an unknown id); ending the active session automatically
  falls back to another non-background session if one exists. This is
  meaningful once more than one visible session exists — with today's
  single-window browser UI it's always equal to `getDefaultSessionId()`,
  but it's the seam a future multi-window shell would use without any
  further engine changes.
- **`updateSessionMetadata(id, patch)`** — merges into a session's
  `metadata` (`Object.assign`, never replaces the whole object), for
  whatever a future integration wants to attach (e.g. "which Automation
  workflow opened this session").
- **`serializeSession(id)` / `restoreSession(snapshot)`** — real,
  working save/restore of a session's tab set (each tab's `title`, `url`,
  `hist`, `histIndex`, plus which one was active). `restoreSession`
  always creates a **new** session — it never overwrites an existing one
  — with each restored tab marked `status: 'loaded'` / `phase:
  'completed'` directly (no re-navigation, no history-array spam; the
  real page load only happens the next time that tab is actually
  rendered, at which point `browser-live.js`'s existing render path takes
  over exactly as it would for any other tab).
- **`persistSessionSnapshot(id, key?)` / `loadSessionSnapshot(key)` /
  `listPersistedSessionKeys()`** — the "session persistence hooks" the
  brief asked for, backed by the same namespaced `StorageAdapter` Part 1
  built for bookmarks/history/downloads (`axiom:browser:v1:session-
  snapshots`). These are real, callable, and verified to round-trip
  through `localStorage` to a second, independent engine instance — but,
  deliberately, **nothing calls them automatically**. A session's tabs
  remain exactly as ephemeral as Part 1 left them unless a caller
  explicitly saves one. See §5.

## 4. Tab architecture

Unchanged tab shape plus one new field, `phase` (see §6). New
capabilities:

- **`duplicateTab(sessionId, tabId)`** — copies `title`/`url`/`favicon`/
  `hist`/`histIndex` into a brand-new tab id, inserted immediately after
  its source in `tabIds` (so it visually lands next to where it was
  duplicated from). Refused (`returns null`) for a tab id from a
  different session.
- **`reorderTabs(sessionId, tabId, newIndex)`** — moves a tab within its
  session's `tabIds` array; an out-of-range index clamps to the nearest
  valid position rather than throwing or silently no-op'ing.

Both are wired into `browser-live.js`'s `postMessage` bridge
(`duplicate-tab`, `reorder-tab` ops) and onto `window.AxiomBrowserLive`
(`duplicateTab`, `reorderTab`) for a same-window caller — but **no new
buttons or menu items were added to `browser.html`**, per "do not
redesign the UI." These are capabilities the architecture now supports;
wiring visible controls to them is a UI task for a later pass.

## 5. History architecture

Unchanged storage/shape. New read-only accessors, all derived from the
exact same `history` array and each tab's existing `hist`/`histIndex` —
nothing new is stored:

- **`getBackStack(tabId)` / `getForwardStack(tabId)`** — the same
  navigation stack a tab already tracked, exposed as two plain arrays
  instead of requiring a caller to understand the internal
  single-array-plus-index representation.
- **`getHistoryStats()`** — `{ totalVisits, uniqueHosts, visitsByHost }`,
  aggregated from the same history log. Built specifically because the
  Part 1 spec called out "History APIs should be reusable by Memory
  later" — this is the shape a Memory integration would want (per-host
  visit frequency) without Memory needing to re-derive it from raw
  history entries itself.

## 6. Loading lifecycle flow

```
navigate()/goBack()/goForward()/refresh()
        │
        ▼
   phase: started
        │
        ▼
   phase: connecting     ← placeholder-timed (no real DNS/TCP/TLS data
        │                   is available to this architecture — the
        ▼                   spec explicitly allows this)
   phase: loading  ────────────────────┐  status: 'loading'
        │                              │
        │ (renderer's real <iframe>    │ reportRedirect() ──► phase: redirecting
        │  eventually settles)         │  (updates url/hist in place, stays
        ▼                              │   in the loading status)
  ┌─────┴─────────┬───────────────┐    │
  ▼                ▼                ▼   │
reportLoaded()  reportBlocked()  reportError()   stopLoading()
  │                │                │              │
  ▼                ▼                ▼              ▼
content-ready    failed           failed        cancelled
  │             status: blocked  status: error  status: cancelled
  ▼
completed
status: loaded
```

`status` (`empty`/`loading`/`loaded`/`blocked`/`error`/`cancelled`) still
answers "what should the UI show" (unchanged from Part 1 — the blocked
vs. error distinction the existing "blocked embed" panel depends on is
untouched). `phase` is the new, finer-grained answer to "how far through
loading did this navigation get, and how did it end" — both are driven
by the exact same `reportLoading`/`reportLoaded`/`reportBlocked`/
`reportError` calls `browser-live.js` already makes, plus the one new
`stopLoading()` call this pass adds; **no renderer changes were required
for the basic phase sequence to start working**, which is why
`browser-live.js` needed only three small additions (see below) rather
than a rewrite.

## 7. `js/pages/browser-live.js` changes (renderer-side)

Minimal, additive, no markup/visual changes:
- `stopLoading()`, `duplicateTab()`, `reorderTab()` wrapper functions
  added alongside the existing thin engine wrappers, and exposed on
  `window.AxiomBrowserLive`.
- Three new `postMessage` ops (`stop-loading`, `duplicate-tab`,
  `reorder-tab`) added to the existing command handler, same ack
  contract as every other op.
- `onEngineChange` now also refreshes the tab strip on `tab:duplicated`
  and `tab:reordered` (grouped with the existing `tab:closed`/
  `tab:status` "just re-render the strip" case) — neither ever changes
  what the active tab is showing, so no `<iframe>` reload is triggered
  for them.
- No new buttons, panels, or layout changes in `browser.html` itself.

## 8. Validation

`test-evidence/block2-step5-part2-navigation-session-regression-suite.js`
— 28 checks, all passing, against the real, unmodified `browser-engine.js`
(output in the matching `-output.txt`):

- ✓ Browser initializes correctly — re-verified via the Part 1 suite
  re-run at the bottom of the Part 2 suite (21/21).
- ✓ Navigation works — blocked-protocol input refused without touching
  tab state; `engine.navigation.navigate()`'s rich result shape;
  relative-path resolution against the active tab's real origin, and the
  no-context fallback proven byte-identical to Part 1.
- ✓ Tabs work — duplicate (copies state, lands next to source, refused
  cross-session), reorder (moves and clamps out-of-range indices).
- ✓ Sessions work — active-session tracking independent of per-session
  active tabs, metadata merge, serialize/restore into a genuinely new
  session with the correct active tab preserved, persist/load round-trip
  through `localStorage` to an independent engine instance, and — an
  explicit negative check — nothing is auto-persisted unless
  `persistSessionSnapshot()` is called.
- ✓ Browser history updates correctly — back/forward-stack accessors
  match the real per-tab position; `getHistoryStats()` aggregates real
  per-host visit counts.
- ✓ URL validation prevents invalid requests — all four blocked
  protocols rejected by both `validateUrl()` and `normalizeUrl()`.
- ✓ Loading lifecycle updates correctly — the full `started → connecting
  → loading → content-ready → completed` phase sequence observed via
  `onChange` for a real navigation; `reportError`/`reportBlocked` both
  land on `'failed'` while `status` still distinguishes which; `stopLoading`
  only works mid-flight.
- ✓ No duplicate navigation events — a single `navigate()` call verified
  to emit exactly one `tab:navigated` and one `navigation:started`.
- ✓ No duplicate session creation — `init()` called five times still
  yields exactly one non-background session.
- ✓ No console errors — a realistic multi-feature workflow (validate,
  navigate, redirect, duplicate, reorder, serialize, restore, persist)
  runs end-to-end under Node's `vm` sandbox without throwing.
- ✓ Existing Browser UI remains functional — the full Part 1 suite
  (21 checks) re-run against this same, now-extended engine file and
  still passes with zero changes to its own assertions.

## 9. Remaining work for Part 3

1. **Wire visible controls to the new Tab Manager capabilities.**
   `duplicateTab`/`reorderTab` are real and reachable via
   `AxiomBrowserLive`/`postMessage`, but `browser.html` has no
   right-click menu or drag-to-reorder UI yet — that's a UI task
   explicitly out of scope for this architecture-focused pass.
2. **Automatic/continuous session persistence.** `persist()`/
   `loadPersisted()` work end-to-end today but nothing calls them on a
   timer, on tab change, or on page unload — a session is only ever
   saved if something explicitly asks for it. Wiring an autosave (and a
   "restore last session" affordance on `browser.html`) is a reasonable
   Part 3.
3. **`os/runtime/capabilities/browser-bridge.js` exposing the new
   commands.** The Browser Agent bridge still only knows the Part 1 op
   set — teaching it `stop-loading`/`duplicate-tab`/`reorder-tab` (and
   the richer `engine.navigation.navigate()` result shape) is Agent-side
   work this task's scope excluded ("Do NOT modify unrelated systems").
4. **Multi-window session UI.** `getActiveSessionId()`/
   `setActiveSessionId()` are real and tested, but there's still only one
   visible session in the actual product (`browser.html` never creates a
   second non-background one) — the architecture supports a second
   browser window/session without further engine changes, but nothing
   in the UI creates one yet.
5. **Real web automation / OpenRouter-powered browsing** — explicitly out
   of scope per the master order, same as Part 1.
