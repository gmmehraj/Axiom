// ============================================================
// AXIOM — Block 2 / Step 5 / Part 3: Connect the Brain to the Browser
// ------------------------------------------------------------
// The Browser Engine (os/core/browser-engine.js, Parts 1-2) already has
// a full, real tab/session/navigation lifecycle exposed via
// AxiomBrowserEngine.onChange(). The Brain (os/core/axiom-brain.js)
// already tracks live AI-pipeline/automation state (see
// brain-automation-bridge.js for the established pattern this file
// follows) but, before this file, had no idea a browser session, tab,
// or page load existed at all.
//
// This module is the connector. The Browser Engine is the producer;
// the Brain is the consumer. It never invents a url, title, or status —
// every write here is either a direct field off a real engine event, or
// the engine's own getSnapshot()/getSession() (the same computed view
// browser-live.js and the Browser Agent bridge already rely on), so
// Brain.browser is always a reflection of engine state that already
// existed, not a second copy of it.
//
// Objective checklist -> where each field actually comes from:
//   Active page / current URL   <- engine.getSnapshot(sessionId).url/title
//   Navigation state             <- snapshot.canGoBack/canGoForward + a
//                                    'navigating' flag toggled by the real
//                                    'navigation:started' / 'navigation:
//                                    completed' / 'navigation:cancelled'
//                                    events (never inferred/guessed)
//   Loading state                <- 'lifecycle:phase' (the granular Part 2
//                                    phase model) + snapshot.blocked
//   Active tab / active session <- snapshot.activeTabId / snapshot.sessionId
//   Session state                <- 'session:started' / 'session:ended' /
//                                    'session:activated' / 'session:restored'
//   Browser errors                <- 'navigation:failed' (reason/tabId/input
//                                    taken verbatim from the event)
//   Navigation lifecycle events  <- 'navigation:started/completed/
//                                    cancelled/redirected', surfaced as the
//                                    'navigating' flag + snapshot refresh
//
// No duplicated browser state: this bridge does not keep its own copy of
// tabs/history/bookmarks — Brain.browser is a single live-status pointer
// (same convention as Brain.automation in brain-automation-bridge.js),
// always rebuilt from engine.getSnapshot() rather than accumulated.
//
// Explicitly NOT done here: no new UI, no change to browser.html's
// markup, no change to AxiomBrowserEngine's own business logic — only
// new listeners that call its existing, unchanged public API
// (onChange/getSnapshot/getActiveSessionId) and Brain's existing
// setState()/getState().
//
// Public API — window.AxiomBrowserBrainBridge (small, for tests/cleanup):
//   getStats()  -> { eventsObserved }
//   destroy()   -> unsubscribes from the engine (page-teardown / test isolation)
// ============================================================
window.AxiomBrowserBrainBridge = (function () {
  'use strict';

  var Brain = window.AxiomBrain;
  var Engine = window.AxiomBrowserEngine;

  // Harmless no-op on any page that has one but not the other (mirrors the
  // guard pattern already used by brain-automation-bridge.js and
  // brain-memory-bridge.js).
  if (!Brain || !Engine) {
    return { getStats: function () { return null; }, destroy: function () {} };
  }

  Engine.init(); // idempotent — safe even if a page already called this

  var stats = { eventsObserved: 0 };

  function writeBrowserState(patch) {
    var current = Brain.getState().browser || {};
    Brain.setState({ browser: Object.assign({}, current, patch) });
  }

  // Rebuilds Brain.browser's live-state fields from the engine's own
  // snapshot — the single authoritative computed view, never
  // reconstructed by hand from individual event payloads.
  function syncSnapshot(sessionId) {
    var sid = sessionId || Engine.getActiveSessionId();
    if (!sid) return;
    var snap = Engine.getSnapshot(sid);
    writeBrowserState({
      sessionId: snap.sessionId,
      activeTabId: snap.activeTabId,
      url: snap.url,
      title: snap.title,
      canGoBack: snap.canGoBack,
      canGoForward: snap.canGoForward,
      tabCount: snap.tabs.length,
      blocked: snap.blocked,
      phase: snap.phase
    });
  }

  function onEngineChange(type, detail) {
    detail = detail || {};
    stats.eventsObserved++;
    switch (type) {
      // Session lifecycle -> Session state
      case 'engine:initialized':
        syncSnapshot(detail.defaultSessionId);
        break;
      case 'session:started':
      case 'session:activated':
      case 'session:restored':
        syncSnapshot(detail.sessionId);
        break;
      case 'session:ended':
        // The ended session is gone from the engine; fall back to
        // whatever is active now (may be null if nothing is left).
        syncSnapshot(Engine.getActiveSessionId());
        break;

      // Tab / active-page state
      case 'tab:created':
      case 'tab:switched':
      case 'tab:closed':
      case 'tab:status':
        syncSnapshot(detail.sessionId);
        break;

      // Navigation lifecycle events -> Navigation state + Active page/URL
      case 'tab:navigated':
        syncSnapshot(detail.sessionId);
        break;
      case 'navigation:started':
        syncSnapshot(detail.sessionId);
        writeBrowserState({ navigating: true });
        break;
      case 'navigation:completed':
        syncSnapshot(detail.sessionId);
        writeBrowserState({ navigating: false, lastError: null });
        break;
      case 'navigation:cancelled':
        syncSnapshot(detail.sessionId);
        writeBrowserState({ navigating: false });
        break;
      case 'navigation:redirected':
        syncSnapshot(detail.sessionId);
        break;
      // Browser errors — real reason from the engine, never a generic string
      case 'navigation:failed':
        writeBrowserState({
          navigating: false,
          lastError: { reason: detail.reason || null, tabId: detail.tabId || null, input: detail.input || null, at: Date.now() }
        });
        break;

      // Loading state — the granular Part 2 phase model
      case 'lifecycle:phase':
        writeBrowserState({ phase: detail.phase });
        break;

      // 'tab:duplicated' / 'tab:reordered' / 'session:metadata-updated' /
      // 'session:persisted' / bookmark:*/history:*/download:* are
      // bookkeeping, not live browsing/navigation status — deliberately
      // not surfaced on the Brain, which tracks "what's happening right
      // now" the same way Brain.automation does. (Durable history of
      // these goes through browser-memory-bridge.js instead.)
      default:
        break;
    }
  }

  var unsubscribe = Engine.onChange(onEngineChange);

  // Seed once with whatever the engine already knows on load (e.g. the
  // page was reopened with a session already active), so Brain.browser
  // doesn't start blank until the next real event.
  (function seed() {
    var sid = Engine.getActiveSessionId() || Engine.getDefaultSessionId();
    if (sid) syncSnapshot(sid);
  })();

  function destroy() {
    if (typeof unsubscribe === 'function') unsubscribe();
  }

  function getStats() {
    return Object.assign({}, stats);
  }

  return { getStats: getStats, destroy: destroy };
})();
