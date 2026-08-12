// ============================================================
// AXIOM AI OS — Milestone 8: Shared Agent Context Store
// ------------------------------------------------------------
// Multi-agent collaborations (Task 2) need somewhere to exchange
// results, status, errors, progress and metadata WITHOUT reaching
// for a global mutable object that any script could poke at
// directly (Task 3). This module is that place.
//
// Design:
//   * State lives in a private closure Map, never on `window`.
//   * Every read returns a deep-ish clone, so a caller mutating the
//     object it got back can never corrupt the store by reference.
//   * Every write goes through set()/merge()/appendEvent() and, in
//     turn, is also announced on the shared Agent Event Bus
//     ('context:updated') — so agents that only listen (rather than
//     hold a reference to this module) can still observe changes,
//     exactly the "communicate only through the Event Bus" rule in
//     Task 2 of the milestone brief.
//   * Contexts are scoped by `runId` (one per orchestrated job/plan)
//     so unrelated collaborations never see each other's data.
//
// Public surface — window.AxiomContextStore:
//   .create(runId, initial?)            -> context
//   .get(runId)                         -> context | null   (clone)
//   .set(runId, key, value, meta?)      -> context | null
//   .merge(runId, patch, meta?)         -> context | null
//   .appendProgress(runId, note, meta?) -> context | null
//   .appendError(runId, error, meta?)   -> context | null
//   .destroy(runId)                     -> boolean
//   .list()                             -> runId[]
// ============================================================
window.AxiomContextStore = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  var bus = RT && RT.bus;

  var store = new Map(); // runId -> context
  var MAX_LOG = 100;      // bounded so long-running jobs can't leak memory

  function clone(v) {
    try { return JSON.parse(JSON.stringify(v)); }
    catch (e) { return v; }
  }

  function emit(type, runId, payload) {
    if (!bus) return;
    bus.emit(type, 'context-store', Object.assign({ runId: runId }, payload || {}));
  }

  function create(runId, initial) {
    if (!runId) throw new Error('[AxiomContextStore] create() requires a runId.');
    var ctx = {
      runId: runId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: (initial && typeof initial === 'object') ? clone(initial) : {},
      status: 'active',      // active | done | error | cancelled
      progress: [],          // [{ at, note, meta }]
      errors: [],            // [{ at, error, meta }]
      metadata: {}
    };
    store.set(runId, ctx);
    emit('context:created', runId, { context: clone(ctx) });
    return clone(ctx);
  }

  function ensure(runId) {
    return store.get(runId) || null;
  }

  function get(runId) {
    var ctx = ensure(runId);
    return ctx ? clone(ctx) : null;
  }

  function set(runId, key, value, meta) {
    var ctx = ensure(runId);
    if (!ctx) return null;
    ctx.data[key] = value;
    ctx.updatedAt = Date.now();
    if (meta) ctx.metadata = Object.assign({}, ctx.metadata, meta);
    emit('context:updated', runId, { key: key, value: value, meta: meta || null });
    return clone(ctx);
  }

  function merge(runId, patch, meta) {
    var ctx = ensure(runId);
    if (!ctx || !patch || typeof patch !== 'object') return null;
    Object.keys(patch).forEach(function (k) { ctx.data[k] = patch[k]; });
    ctx.updatedAt = Date.now();
    if (meta) ctx.metadata = Object.assign({}, ctx.metadata, meta);
    emit('context:merged', runId, { patch: patch, meta: meta || null });
    return clone(ctx);
  }

  function appendProgress(runId, note, meta) {
    var ctx = ensure(runId);
    if (!ctx) return null;
    ctx.progress.push({ at: Date.now(), note: String(note || ''), meta: meta || null });
    if (ctx.progress.length > MAX_LOG) ctx.progress = ctx.progress.slice(-MAX_LOG);
    ctx.updatedAt = Date.now();
    emit('context:progress', runId, { note: note, meta: meta || null });
    return clone(ctx);
  }

  function appendError(runId, error, meta) {
    var ctx = ensure(runId);
    if (!ctx) return null;
    var msg = String((error && error.message) || error || 'unknown error');
    ctx.errors.push({ at: Date.now(), error: msg, meta: meta || null });
    if (ctx.errors.length > MAX_LOG) ctx.errors = ctx.errors.slice(-MAX_LOG);
    ctx.updatedAt = Date.now();
    emit('context:error', runId, { error: msg, meta: meta || null });
    return clone(ctx);
  }

  function setStatus(runId, status) {
    var ctx = ensure(runId);
    if (!ctx) return null;
    ctx.status = status;
    ctx.updatedAt = Date.now();
    emit('context:status', runId, { status: status });
    return clone(ctx);
  }

  function destroy(runId) {
    var existed = store.has(runId);
    store.delete(runId);
    if (existed) emit('context:destroyed', runId, {});
    return existed;
  }

  function list() { return Array.from(store.keys()); }

  // Agents that only have bus access (no reference to this module) can
  // still contribute via structured events instead of calling in.
  if (bus) {
    bus.on('context:set', function (env) {
      var p = env.payload || {};
      if (p.runId && p.key !== undefined) set(p.runId, p.key, p.value, p.meta);
    });
    bus.on('context:merge', function (env) {
      var p = env.payload || {};
      if (p.runId && p.patch) merge(p.runId, p.patch, p.meta);
    });
  }

  return {
    create: create, get: get, set: set, merge: merge,
    appendProgress: appendProgress, appendError: appendError,
    setStatus: setStatus, destroy: destroy, list: list
  };
})();
