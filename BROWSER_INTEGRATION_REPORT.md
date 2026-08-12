# Browser Integration Report — Block 2 · Step 5 · Part 3

**Role:** Senior Browser Systems Architect
**Scope:** Integrate the existing Browser Engine (Parts 1-2) with Brain,
Memory, the existing Browser UI, and the Browser Agent Bridge; add real
session persistence. No UI redesign, no OpenRouter, no autonomous
browsing, no changes to Automation/Analytics/AI Core.

---

## 1. Starting point

Parts 1-2 already built a complete, single-source-of-truth Browser Engine
(`os/core/browser-engine.js`) with real Navigation, Session, Tab,
History, and Loading Lifecycle managers, all backed by one internal
`tabs`/`sessions` Map and one `history`/`bookmarks`/`downloads` array, and
one `onChange()` pub/sub bus. Before this pass:

| Sub-brief | Status found |
|---|---|
| A — Browser ↔ Brain | **Missing.** No file connected engine events to `AxiomBrain`. |
| B — Browser ↔ Memory | **Missing.** No file connected engine events to `AxiomMemoryEngine`. |
| C — Browser UI Integration | **Already done in Part 1.** `browser-live.js` held no state of its own and every control already called the engine. |
| D — Browser Agent Bridge | **Partially done.** The agent/bridge already went only through the engine (via `AxiomBrowserLive`), but the bridge's op set hadn't been updated for Part 2's new capabilities. |
| E — Session Persistence | **Hooks existed, nothing called them.** `persist()`/`restore()` were real but never invoked automatically, exactly as Part 2's own report flagged. |

One additional, unplanned finding: a legacy decorative script
(`browser-studio-ultimate.js`) was actively destroying the real engine's
`<iframe>` on every page load — see §4.

---

## 2. Browser ↔ Brain event flow (Part A)

```
AxiomBrowserEngine.onChange(type, detail)
        │
        ▼
os/core/browser-brain-bridge.js
        │  (guarded no-op if either global is missing)
        │
        ├─ engine:initialized / session:started / session:activated /
        │  session:restored / session:ended / tab:created / tab:switched /
        │  tab:closed / tab:status / tab:navigated
        │       → syncSnapshot(sessionId): pulls engine.getSnapshot(),
        │         writes {sessionId, activeTabId, url, title, canGoBack,
        │         canGoForward, tabCount, blocked, phase} onto Brain.browser
        │
        ├─ navigation:started   → snapshot + navigating:true
        ├─ navigation:completed → snapshot + navigating:false, lastError:null
        ├─ navigation:cancelled → snapshot + navigating:false
        ├─ navigation:redirected→ snapshot
        ├─ navigation:failed    → lastError:{reason, tabId, input, at}
        │                          (navigating:false)
        └─ lifecycle:phase      → phase
        │
        ▼
Brain.setState({ browser: {...} })   (single live-status pointer,
                                       same convention as Brain.automation)
```

`Brain.browser` is always rebuilt from the engine's own `getSnapshot()` —
never hand-assembled from individual event payloads — so it can never
drift from what the engine actually reports. Events that are bookkeeping
rather than live browsing status (`tab:duplicated`, `tab:reordered`,
`session:metadata-updated`, `session:persisted`, `bookmark:*`,
`history:*`, `download:*`) are deliberately not surfaced on the Brain,
mirroring how `brain-automation-bridge.js` only surfaces live run/queue
status and leaves durable history to the Memory bridge.

Seeded once on load from whatever session is already active, so
`Brain.browser` is populated immediately rather than staying blank until
the next event.

---

## 3. Browser ↔ Memory data flow (Part B)

```
AxiomBrowserEngine.onChange(type, detail)
        │
        ▼
os/core/browser-memory-bridge.js
        │  (guarded no-op if either global is missing)
        │
        ├─ history:recorded
        │       → recordVisit(): reads engine.listHistory(1)[0] for the
        │         {url, title, time} that was just pushed, writes one
        │         Memory record:
        │           id:   browser-visit:<time>:<url>
        │           type: 'browser-visit'
        │           data: {url, title, time}
        │
        └─ session:started / session:activated / session:restored /
           session:metadata-updated / tab:created / tab:switched /
           tab:closed / tab:navigated / tab:status / tab:duplicated /
           tab:reordered
                → writeSessionRecord(sessionId): reads
                  engine.getSession() + engine.listTabs(), writes/
                  overwrites one Memory record:
                    id:   browser-session:<sessionId>
                    type: 'browser-session'
                    data: {label, background, metadata, activeTabId,
                           tabCount, tabs:[{id,url,title,status}], ...}
        │
        └─ session:ended
                → writeSessionRecord(sessionId, {ended:true, endedAt})
                  using a local sessionCache snapshot taken on the prior
                  event, since the engine has already deleted the
                  session's data by the time session:ended fires.
        │
        ▼
AxiomMemoryEngine.addMemory({...})   (stable id → overwrite in place,
                                       never a growing duplicate log)
```

Read helpers (`listVisits`, `listSessions`, `getSessionRecord`) reuse the
same plain equality/sort/paginate convention `AxiomAutomationMemoryBridge`
already established — no semantic search, no embeddings, nothing beyond
what Memory already provides for every other record type.

`history:recorded` only fires for genuine forward navigations — the
engine's own `beginNavigation()` skips it for back/forward/refresh
replays (`fromHistoryNav: true`) — so every visit record really is a new
page load, not a re-render of one already seen.

---

## 4. Browser UI architecture (Part C)

Part 1 already completed this: `browser-live.js`'s file header states it
"holds NO browser state of its own" and every control (`navigate`,
`goBack`, tab switching, bookmarking, etc.) is a thin wrapper calling the
engine directly, confirmed by re-reading the file in full for this pass.

**What this pass changed here:** not the intended UI wiring, but a real
regression sitting alongside it. `js/pages/browser-studio-ultimate.js` — a
legacy "Arc-style" decorative enhancement — ran on every `browser.html`
load and, ~200ms in, executed:

```js
viewport.innerHTML = '';               // wipes the real .ax-browser-viewport
viewport.appendChild(mainArea);        // ...replaces it with a static
viewport.appendChild(sidebarPanel);    //     mock "page loaded" placeholder
```

`.ax-browser-viewport` is the exact element (`id="axBrowserViewport"`)
containing the real `<iframe id="axBrowserFrame">` plus the empty/
loading/blocked state elements `browser-live.js` holds direct references
to. This deleted all of them and replaced the surface with copy driven by
three hardcoded fake tabs (`Axiom AI OS`, `GitHub`, `Documentation`) that
had no connection to the real engine at all — a second, disconnected copy
of "browser state" competing with the real one for the same DOM, and
actively breaking live navigation once the timer fired (every subsequent
engine-driven render wrote to detached nodes).

**Fix:** a single guard at the top of `enhanceBrowser()` — return
immediately if `#axBrowserFrame` (the real engine-backed iframe) already
exists in the document. This is a bug fix, not a redesign: no markup,
CSS, or layout was touched on `browser.html` or `studios.html`
(`enhanceStudios()`'s unrelated path is untouched). It satisfies the
"remove any duplicated browser state if verified" objective directly.

---

## 5. Browser Agent architecture (Part D)

```
agent.browser (os/runtime/agent-definitions/browser-agent.js)
        │  task.op → run()
        ▼
AxiomBrowserBridge (os/runtime/capabilities/browser-bridge.js)
        │
        ├─ same window: window.AxiomBrowserLive.<method>()
        └─ cross-window: postMessage 'axiom-browser-command' → browser-live.js
                          listener → same engine calls, acked back
        │
        ▼
AxiomBrowserEngine   (only path in — no direct state manipulation
                       anywhere in the agent or bridge)
```

This chain already ran only through the engine before this pass — the
gap was that the bridge's `command()` switch (same-window path) and the
agent's own op list hadn't been updated for Part 2's Navigation/Tab
Manager additions, even though `browser-live.js` and its `postMessage`
listener already supported them. Added in this pass:

- `browser-bridge.js`: `'stop-loading'`, `'duplicate-tab'`,
  `'reorder-tab'` cases in the same-window switch, plus
  `stopLoading()`/`duplicateTab(tabId)`/`reorderTab(tabId, index)`
  convenience methods.
- `browser-agent.js`: the same three ops added to the handler's switch
  and to the agent's declared `capabilities` list.

No new navigation path was created — every new op is still exactly one
call into `AxiomBrowserLive`, which is still exactly one call into the
engine.

---

## 6. Session persistence flow (Part E)

```
Page load
   │
   ▼
engine.init()                 → loads bookmarks/history/downloads,
   │                             creates one fresh (empty) default session
   ▼
tryRestoreLastSession()
   │
   ├─ engine.loadSessionSnapshot('default')  → null? → keep the fresh
   │                                            default session, call
   │                                            newTab() as before
   │
   └─ snapshot found → engine.restoreSession(snapshot)
            → a NEW session with each tab's saved {url, title, hist,
              histIndex}, marked 'loaded'/'completed' (no re-navigation,
              no history/loading spam)
            → this renderer's `sessionId` now points at the restored
              session; the unused fresh default session is simply never
              referenced again (left alone rather than calling
              engine.endSession() on it, so the engine's own
              defaultSessionId bookkeeping is never pointed at a deleted
              session)
            → renderTabs() + renderActiveTabIntoFrame() render it
              immediately — the real <iframe> load (and the engine's
              real reportLoading/reportLoaded lifecycle) only happens
              now, exactly as it would for any other tab

Page unload ('beforeunload')
   │
   ▼
persistCurrentSession() → engine.persistSessionSnapshot(sessionId, 'default')
                           (also exposed as AxiomBrowserLive.saveSession()
                            and the 'save-session' postMessage op, for a
                            future explicit "save session" UI action)
```

Cloud-sync readiness: this reuses the engine's existing namespaced
`StorageAdapter`/localStorage backend untouched — the same "swap this one
adapter" seam Part 1 documented for a future IndexedDB/remote store. The
fixed `'default'` key is a single-window placeholder; multi-window/
multi-account persistence needs a real key scheme built on top of the
already-real `getActiveSessionId()`/`setActiveSessionId()` surface (see
§7.3).

---

## 7. Remaining work before further browser passes

1. **No Memory browsing UI yet.** `browser-memory-bridge.js`'s
   `listVisits()`/`listSessions()` are ready to back a "recent browsing"
   panel (e.g. on `memory.html`), but no such panel exists yet — out of
   scope for an integration-only pass.
2. **No Brain browsing status UI yet.** `Brain.browser` is live and
   populated, but no dashboard card reads it yet.
3. **Single-key session persistence.** Works correctly for the one
   visible session `browser.html` creates today; a second visible session
   (already supported by `getActiveSessionId()`/`setActiveSessionId()`
   per Part 2, but not yet created by any UI) would need its own
   persistence key.
4. **Bulk visit history is not backfilled into Memory.** Only visits
   recorded going forward are stored — pre-existing `engine.listHistory()`
   entries from before this bridge existed are not imported, to avoid a
   one-time mass write on first load. A deliberate, documented choice,
   not an oversight.
5. **Real web automation / OpenRouter-powered browsing** — explicitly out
   of scope per the master order, same as Parts 1 and 2.
