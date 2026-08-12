// ============================================================
// AXIOM AI OS — Milestone 11: Event Timeline
// ------------------------------------------------------------
// Objective 4: "Add an event timeline that records runtime events
// with timestamps." The Agent Event Bus (Milestone 4) already keeps
// a small internal ring buffer (`bus.recentEvents()`, 200 entries,
// no query surface). This module does not duplicate the bus or
// re-implement delivery — it is a pure, read-only SUBSCRIBER that
// listens on the wildcard channel the bus already exposes and turns
// the raw stream into a bounded, queryable, optionally-persisted
// timeline any subsystem (Task Graph, Resource Monitor, a future
// panel) can read without touching the bus directly.
//
// Reuses:
//   - AxiomAgentRuntime.bus.on('*', fn)  -> the ONLY way this module
//     ever learns about an event. It never calls into the Orchestrator,
//     Job Manager, Executive AI, or Agent Manager directly.
//
// Public surface — window.AxiomEventTimeline:
//   .recent(n?)                 -> newest-first Event[]
//   .since(ts, n?)               -> Event[] at/after ts, newest-first
//   .byType(type, n?)            -> Event[] filtered by exact type
//   .bySource(source, n?)        -> Event[] filtered by source id
//   .query(opts)                 -> Event[] { type?, source?, target?, since?, until?, limit? }
//   .count()                     -> total events recorded (since load, not just buffer)
//   .clear()                     -> empties the in-memory + persisted timeline
// ============================================================
window.AxiomEventTimeline = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  if (!RT) {
    AxLogger.error('[AxiomEventTimeline] requires agent-runtime.js loaded first.');
    return null;
  }
  var bus = RT.bus;

  var MAX_ENTRIES = 2000;          // bounded ring buffer — cannot leak memory in a long session
  var PERSIST_KEY = 'axiom-event-timeline';
  var PERSIST_EVERY = 25;          // batch localStorage writes — don't touch disk every single event
  var PERSIST_MAX = 500;           // persisted slice is smaller than the live in-memory buffer

  var timeline = [];   // newest pushed to the end; bounded by MAX_ENTRIES
  var totalCount = 0;
  var sinceLastPersist = 0;

  function loadPersisted() {
    try {
      var raw = JSON.parse(localStorage.getItem(PERSIST_KEY) || '[]');
      if (Array.isArray(raw)) timeline = raw.slice(-MAX_ENTRIES);
    } catch (e) { /* corrupt or unavailable — start empty, non-fatal */ }
  }
  function persist() {
    try { localStorage.setItem(PERSIST_KEY, JSON.stringify(timeline.slice(-PERSIST_MAX))); }
    catch (e) { /* storage full/unavailable — timeline still works in-memory this session */ }
  }

  // A compact, serialisable projection of the bus envelope — never keeps a
  // live reference to caller-owned payload objects longer than needed, and
  // never includes anything that would grow unbounded (payloads are kept,
  // but capped in size defensively).
  function project(envelope) {
    var payload = envelope.payload;
    var safePayload = payload;
    try {
      var json = JSON.stringify(payload);
      if (json && json.length > 4000) safePayload = { truncated: true, preview: json.slice(0, 4000) };
    } catch (e) { safePayload = { unserializable: true }; }
    return {
      id: envelope.id,
      ts: envelope.ts || Date.now(),
      type: envelope.type,
      source: envelope.source,
      target: envelope.target || null,
      payload: safePayload
    };
  }

  loadPersisted();

  bus.on('*', function (envelope) {
    timeline.push(project(envelope));
    totalCount += 1;
    if (timeline.length > MAX_ENTRIES) timeline.shift();
    sinceLastPersist += 1;
    if (sinceLastPersist >= PERSIST_EVERY) { sinceLastPersist = 0; persist(); }
  });

  function newestFirst(list) { return list.slice().reverse(); }

  function recent(n) { return newestFirst(timeline).slice(0, n || 50); }

  function since(ts, n) {
    var filtered = timeline.filter(function (e) { return e.ts >= ts; });
    return newestFirst(filtered).slice(0, n || filtered.length);
  }

  function byType(type, n) {
    var filtered = timeline.filter(function (e) { return e.type === type; });
    return newestFirst(filtered).slice(0, n || 50);
  }

  function bySource(source, n) {
    var filtered = timeline.filter(function (e) { return e.source === source; });
    return newestFirst(filtered).slice(0, n || 50);
  }

  function query(opts) {
    opts = opts || {};
    var filtered = timeline.filter(function (e) {
      if (opts.type && e.type !== opts.type) return false;
      if (opts.source && e.source !== opts.source) return false;
      if (opts.target && e.target !== opts.target) return false;
      if (typeof opts.since === 'number' && e.ts < opts.since) return false;
      if (typeof opts.until === 'number' && e.ts > opts.until) return false;
      return true;
    });
    return newestFirst(filtered).slice(0, opts.limit || filtered.length);
  }

  function count() { return totalCount; }

  function clear() {
    timeline = [];
    sinceLastPersist = 0;
    try { localStorage.removeItem(PERSIST_KEY); } catch (e) { /* ignore */ }
  }

  return { recent: recent, since: since, byType: byType, bySource: bySource, query: query, count: count, clear: clear };
})();
