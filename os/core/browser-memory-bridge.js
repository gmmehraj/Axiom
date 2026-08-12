// ============================================================
// AXIOM — Block 2 / Step 5 / Part 3: Connect Memory to the Browser
// ------------------------------------------------------------
// The Browser Engine (os/core/browser-engine.js, Parts 1-2) has a real,
// persisted tab/session/navigation lifecycle exposed via
// AxiomBrowserEngine.onChange(). The Memory Foundation (os/core/
// memory-engine.js) already has a real, persisted, queryable store
// (addMemory/queryMemories) and a stable read API
// (os/core/memory-manager.js). Before this file, nothing connected the
// two: browsing happened, but nothing durable remembered which pages
// were visited, when, or what a session's open tabs looked like, beyond
// the engine's own bounded (MAX_HISTORY = 200 entries) localStorage
// arrays.
//
// This module is the connector. The Browser Engine is the producer;
// AxiomMemoryEngine is the persistent store. It never invents a url,
// title, or timestamp — every record written here is a direct
// reflection of a real engine event, read straight off the engine's own
// fields (engine.listHistory(), engine.getSession(), engine.listTabs()).
//
// Objective checklist -> where each piece of history actually comes from:
//   Browsing history / URL history <- one 'browser-visit' Memory record
//                                       per real 'history:recorded' event
//                                       (fired only for genuine forward
//                                       navigations — see
//                                       browser-engine.js's
//                                       beginNavigation(), which skips
//                                       recordHistory() for back/forward/
//                                       refresh replays), keyed by the
//                                       engine's own {url, title, time}
//   Navigation timestamps            <- the same history entry's own
//                                       `time` field, never recomputed
//   Active pages / session metadata  <- one 'browser-session' Memory
//                                       record per session id, rebuilt
//                                       from engine.getSession() +
//                                       engine.listTabs() on every real
//                                       session/tab event
//   Browser events / navigation
//     metadata                       <- the same 'browser-session'
//                                       record's data, kept current by
//                                       consuming the engine's own
//                                       onChange() events rather than
//                                       polling
//
// No vector memory, no embeddings, no semantic search, no AI reasoning
// over history — this module only stores structured fields it read
// straight off the engine's own objects and exposes plain
// equality/sort/paginate lookups, the same non-semantic retrieval
// AxiomMemoryEngine/AxiomMemoryManager already provide for every other
// memory record (see automation-memory-bridge.js for the identical
// convention on the Automation side).
//
// Explicitly NOT done here: no new UI, no change to browser.html's or
// memory.html's existing markup, no change to AxiomBrowserEngine's or
// AxiomMemoryEngine's own business logic — only new listeners that call
// their existing, unchanged public APIs.
//
// De-duplication / no stale state:
//   - Every session record is written under the STABLE id
//     `browser-session:<sessionId>`. AxiomMemoryEngine.addMemory() keys
//     its store by id, so writing the same id twice overwrites in place
//     rather than creating a duplicate — the record always reflects the
//     session's CURRENT tabs/metadata, not a growing log of every tick.
//   - A session's tab/metadata snapshot is cached locally (sessionCache)
//     on every event *before* a possible 'session:ended', because the
//     engine itself deletes a session's data at the moment it emits
//     'session:ended' — the cache lets the final record still describe
//     what the session actually contained, instead of an empty stub.
//   - Every visit record is written under the STABLE id
//     `browser-visit:<time>:<url>`. Because 'history:recorded' fires at
//     most once per genuine navigation and `time` is that navigation's
//     own Date.now() capture, revisiting the same url later gets its own
//     distinct (not duplicate) id, exactly as it is its own distinct
//     history entry in the engine's own history array.
//
// Public API — window.AxiomBrowserMemoryBridge (small, for tests/UI):
//   listVisits(opts?)   -> { items, total, offset, limit }
//                           opts: { sort? ('recent'|'oldest'), offset?, limit? }
//   listSessions(opts?) -> { items, total, offset, limit }
//                           opts: { includeEnded?, offset?, limit? }
//   getSessionRecord(sessionId) -> the stored session record | null
//   getStats()          -> { visitsRecorded, sessionWrites }
//   destroy()           -> unsubscribes from the engine (page-teardown /
//                           test isolation)
// ============================================================
window.AxiomBrowserMemoryBridge = (function () {
  'use strict';

  var Engine = window.AxiomBrowserEngine;
  var Memory = window.AxiomMemoryEngine;

  // Harmless no-op on any page that has one but not the other (mirrors
  // the guard pattern already used by brain-memory-bridge.js and
  // automation-memory-bridge.js).
  if (!Engine || !Memory) {
    return {
      listVisits: function () { return { items: [], total: 0, offset: 0, limit: 0 }; },
      listSessions: function () { return { items: [], total: 0, offset: 0, limit: 0 }; },
      getSessionRecord: function () { return null; },
      getStats: function () { return null; },
      destroy: function () {}
    };
  }

  Engine.init(); // idempotent — safe even if a page already called this
  Memory.init(); // idempotent — safe even if a page already called this

  var DEFAULT_LIMIT = 25;
  var MAX_LIMIT = 200;

  var stats = { visitsRecorded: 0, sessionWrites: 0 };
  var sessionCache = new Map(); // sessionId -> last known {label, background, metadata, tabs, ...}
  var recordedVisitIds = new Set(); // local guard against redundant work, not correctness-critical

  function snapshotSession(sessionId) {
    var session = Engine.getSession(sessionId);
    if (!session) return sessionCache.get(sessionId) || null;
    var tabs = Engine.listTabs(sessionId).map(function (t) {
      return { id: t.id, url: t.url, title: t.title, status: t.status };
    });
    var snap = {
      id: sessionId,
      label: session.label,
      background: session.background,
      metadata: Object.assign({}, session.metadata),
      activeTabId: session.activeTabId,
      tabCount: tabs.length,
      tabs: tabs,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt
    };
    sessionCache.set(sessionId, snap);
    return snap;
  }

  function writeSessionRecord(sessionId, extra) {
    if (!sessionId) return;
    var snap = snapshotSession(sessionId);
    if (!snap) return;
    var ended = !!(extra && extra.ended);
    Memory.addMemory({
      id: 'browser-session:' + sessionId,
      text: 'Browser session "' + snap.label + '" — ' + snap.tabCount + ' tab(s)' + (ended ? ' (ended)' : '') + '.',
      agent: 'BrowserEngine',
      type: 'browser-session',
      tags: ['browser', 'session'].concat(snap.background ? ['background'] : []).concat(ended ? ['ended'] : []),
      importance: 0.2,
      confidence: 1,
      pinned: false,
      ttl: null, // durable session metadata, not a transient status
      data: Object.assign({}, snap, extra || {})
    });
    stats.sessionWrites++;
  }

  function recordVisit() {
    var recent = Engine.listHistory(1)[0];
    if (!recent) return;
    var id = 'browser-visit:' + recent.time + ':' + recent.url;
    if (recordedVisitIds.has(id)) return; // same navigation event observed twice — never expected, but safe
    recordedVisitIds.add(id);
    Memory.addMemory({
      id: id,
      text: 'Visited ' + recent.title + ' (' + recent.url + ').',
      agent: 'BrowserEngine',
      type: 'browser-visit',
      tags: ['browser', 'navigation', 'visit'],
      importance: 0.15,
      confidence: 1,
      pinned: false,
      ttl: null, // durable history, not a transient status
      data: { url: recent.url, title: recent.title, time: recent.time }
    });
    stats.visitsRecorded++;
  }

  function onEngineChange(type, detail) {
    detail = detail || {};
    switch (type) {
      case 'session:started':
      case 'session:activated':
      case 'session:restored':
      case 'session:metadata-updated':
      case 'tab:created':
      case 'tab:switched':
      case 'tab:closed':
      case 'tab:navigated':
      case 'tab:status':
      case 'tab:duplicated':
      case 'tab:reordered':
        writeSessionRecord(detail.sessionId);
        break;
      case 'session:ended':
        writeSessionRecord(detail.sessionId, { ended: true, endedAt: Date.now() });
        sessionCache.delete(detail.sessionId);
        break;
      case 'history:recorded':
        recordVisit();
        break;
      // bookmark:*/download:*/session:persisted/lifecycle:phase/
      // navigation:* are either covered by the tab/session snapshot
      // above already, or (bookmarks/downloads) out of this pass's
      // objective checklist — deliberately not persisted here.
      default:
        break;
    }
  }

  var unsubscribe = Engine.onChange(onEngineChange);

  // Seed once with whatever the engine already knows on load — e.g.
  // sessions that already exist before this bridge subscribed on this
  // page load. Safe to call every time: writeSessionRecord() overwrites
  // the same stable id rather than duplicating. Historical visits from
  // before this bridge existed are NOT bulk-imported here — only new
  // 'history:recorded' events going forward are recorded, to avoid a
  // one-time mass import every time this file is added to a new page.
  (function seed() {
    Engine.listSessions().forEach(function (session) {
      writeSessionRecord(session.id);
    });
  })();

  // ---- browsing helpers (plain equality/sort/paginate — no semantic
  //      search, no embeddings, matching AxiomMemoryManager's own
  //      read-layer conventions) ------------------------------------------
  function paginate(items, opts) {
    opts = opts || {};
    var total = items.length;
    var offset = (typeof opts.offset === 'number' && opts.offset >= 0) ? opts.offset : 0;
    var limit = (typeof opts.limit === 'number') ? opts.limit : DEFAULT_LIMIT;
    limit = Math.max(1, Math.min(MAX_LIMIT, limit));
    return { items: items.slice(offset, offset + limit), total: total, offset: offset, limit: limit };
  }

  function listVisits(opts) {
    opts = opts || {};
    var items = Memory.queryMemories({ type: 'browser-visit' });
    items = items.slice().sort(function (a, b) {
      return opts.sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
    });
    return paginate(items, opts);
  }

  function listSessions(opts) {
    opts = opts || {};
    var items = Memory.queryMemories({ type: 'browser-session' });
    if (!opts.includeEnded) items = items.filter(function (m) { return !(m.data && m.data.ended); });
    items = items.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    return paginate(items, opts);
  }

  function getSessionRecord(sessionId) {
    if (!sessionId) return null;
    return Memory.getMemory('browser-session:' + sessionId);
  }

  function destroy() {
    if (typeof unsubscribe === 'function') unsubscribe();
  }

  function getStats() {
    return Object.assign({}, stats);
  }

  return {
    listVisits: listVisits,
    listSessions: listSessions,
    getSessionRecord: getSessionRecord,
    getStats: getStats,
    destroy: destroy
  };
})();
