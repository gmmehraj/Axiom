// ============================================================
// AXIOM AI OS — Milestone 10: Conversation Stream
// ------------------------------------------------------------
// Requirement 5 asks for progressive responses — a thinking state,
// streamed progress, results updated as agents finish — while staying
// event-driven. Every one of those signals already exists on the
// shared Agent Event Bus (Milestone 4/8/9 emit 'executive:*',
// 'orchestrator:step-*', 'job:progress', etc.) — this module does not
// invent new telemetry. It only SUBSCRIBES to that existing bus,
// re-shapes each envelope into a small, stable, conversation-scoped
// contract, and re-emits it on the same bus as 'conversation:*' so a
// future UI layer can subscribe to one simple event family instead of
// learning every internal runtime event name.
//
// This module never dispatches to an agent, never calls the
// Orchestrator/JobManager/ExecutiveAI, and never decides anything —
// it is a pure relay with a small routing table (executiveId/jobId ->
// conversationId/turnId), registered by whoever kicks off the work
// (the Conversation Manager). That keeps it usable on its own, and
// keeps the Conversation Manager from having to know the bus's event
// vocabulary itself.
//
// Public surface — window.AxiomConversationStream:
//   .track(conversationId, turnId, ids)      -> void   (ids: {executiveId, jobId?})
//   .untrack(executiveId)                    -> void
//   .subscribe(conversationId, callback)     -> unsubscribe()
//   .replay(conversationId, limit?)          -> event[]   (for a UI that joins late)
// ============================================================
window.AxiomConversationStream = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  if (!RT) {
    AxLogger.error('[AxiomConversationStream] requires os/runtime/agent-runtime.js loaded first.');
    return null;
  }
  var bus = RT.bus;

  var routes = new Map();          // executiveId -> { conversationId, turnId, jobId }
  var subscribers = new Map();     // conversationId -> Set<callback>
  var backlog = new Map();         // conversationId -> event[] (bounded ring buffer)
  var BACKLOG_MAX = 30;

  function track(conversationId, turnId, ids) {
    if (!conversationId || !turnId || !ids || !ids.executiveId) return;
    routes.set(ids.executiveId, { conversationId: conversationId, turnId: turnId, jobId: ids.jobId || null });
  }

  function untrack(executiveId) {
    routes.delete(executiveId);
  }

  function routeFor(executiveId, jobId) {
    if (executiveId && routes.has(executiveId)) return routes.get(executiveId);
    if (!jobId) return null;
    var found = null;
    routes.forEach(function (r) { if (r.jobId === jobId) found = r; });
    return found;
  }

  function publish(conversationId, turnId, type, payload) {
    var evt = { type: type, conversationId: conversationId, turnId: turnId, payload: payload || {}, ts: Date.now() };
    var log = backlog.get(conversationId) || [];
    log.push(evt);
    if (log.length > BACKLOG_MAX) log.shift();
    backlog.set(conversationId, log);

    var subs = subscribers.get(conversationId);
    if (subs) subs.forEach(function (fn) { try { fn(evt); } catch (e) { /* one bad subscriber never breaks the stream */ } });

    // Also on the shared bus, namespaced, so anything else already
    // listening at the bus level (no direct reference to this module)
    // can observe conversation-shaped events too.
    bus.emit('conversation:' + type, 'conversation-stream', Object.assign({ conversationId: conversationId, turnId: turnId }, payload || {}));
  }

  function subscribe(conversationId, callback) {
    if (!subscribers.has(conversationId)) subscribers.set(conversationId, new Set());
    subscribers.get(conversationId).add(callback);
    return function unsubscribe() {
      var subs = subscribers.get(conversationId);
      if (subs) subs.delete(callback);
    };
  }

  function replay(conversationId, limit) {
    var log = backlog.get(conversationId) || [];
    return log.slice(-1 * (limit || BACKLOG_MAX));
  }

  // -------------------- Relay: existing bus events -> conversation:* -----
  bus.on('executive:analyzing', function (env) {
    var r = routeFor(env.payload.executiveId, null);
    if (r) publish(r.conversationId, r.turnId, 'thinking', { stage: 'analyzing' });
  });
  bus.on('executive:memory-loaded', function (env) {
    var r = routeFor(env.payload.executiveId, null);
    if (r) publish(r.conversationId, r.turnId, 'thinking', { stage: 'memory-loaded', count: env.payload.count });
  });
  bus.on('executive:strategy-selected', function (env) {
    var r = routeFor(env.payload.executiveId, null);
    if (r) publish(r.conversationId, r.turnId, 'thinking', { stage: 'strategy-selected', mode: env.payload.mode, agents: env.payload.agents });
  });
  bus.on('executive:submitted', function (env) {
    var r = routeFor(env.payload.executiveId, null);
    if (r) {
      r.jobId = env.payload.jobId;
      routes.set(env.payload.executiveId, r);
      publish(r.conversationId, r.turnId, 'progress', { stage: 'submitted', jobId: env.payload.jobId, mode: env.payload.mode });
    }
  });
  // Per-agent "a result just came in" updates already exist as
  // 'orchestrator:step-completed' — but that event only carries a runId,
  // not the jobId/executiveId this module routes on. Rather than
  // duplicate JobManager's own runId<->jobId bookkeeping, this reuses the
  // SAME aggregation JobManager already does: it turns every
  // step-completed into a 'job:progress' note for exactly this jobId.
  // Subscribing to job:progress therefore already IS "update results as
  // agents finish", through the existing pipeline, without a second
  // runId-tracking mechanism living here too.
  bus.on('job:progress', function (env) {
    routes.forEach(function (r) {
      if (r.jobId === env.payload.jobId) {
        publish(r.conversationId, r.turnId, 'progress', { notes: env.payload.notes });
      }
    });
  });
  bus.on('executive:adapting', function (env) {
    var r = routeFor(env.payload.executiveId, null);
    if (r) publish(r.conversationId, r.turnId, 'progress', { stage: 'adapting', attempt: env.payload.attempt });
  });
  bus.on('executive:completed', function (env) {
    var r = routeFor(env.payload.executiveId, null);
    if (r) { publish(r.conversationId, r.turnId, 'done', { status: 'completed', jobId: env.payload.jobId, ms: env.payload.ms }); untrack(env.payload.executiveId); }
  });
  bus.on('executive:clarification-needed', function (env) {
    var r = routeFor(env.payload.executiveId, null);
    if (r) { publish(r.conversationId, r.turnId, 'clarification-needed', { reason: env.payload.reason }); untrack(env.payload.executiveId); }
  });
  bus.on('executive:cancelled', function (env) {
    var r = routeFor(env.payload.executiveId, null);
    if (r) { publish(r.conversationId, r.turnId, 'done', { status: 'cancelled', jobId: env.payload.jobId }); untrack(env.payload.executiveId); }
  });

  return {
    track: track,
    untrack: untrack,
    subscribe: subscribe,
    replay: replay
  };
})();
