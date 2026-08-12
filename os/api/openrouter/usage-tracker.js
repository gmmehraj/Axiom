// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2B-4: OpenRouter Usage Tracker
// ------------------------------------------------------------
// A pure OBSERVER over the request lifecycle Part 2A/2B-1/2B-2/2B-3
// already built. This file adds NO new HTTP, retry, streaming, or
// queueing logic of its own — it only listens to the existing shared
// bus and rolls what it hears into running counters. It never calls
// chat.sendMessage()/stream.streamMessage()/queue.enqueue() and never
// mutates any state owned by another file.
//
// Reuses, all feature-detected (works standalone with none loaded):
//   - window.AxiomOpenRouter.on()/emit()        (Event Bus — Part 2A)
//     Subscribes to the SAME events chat-manager.js/stream-manager.js/
//     request-queue.js already emit; publishes its own
//     'openrouter_usage_updated' back onto that same bus, which
//     already forwards to AxiomOrchestrator/Analytics/DOM CustomEvent
//     — this file never talks to Analytics/Orchestrator directly,
//     same convention as every sibling.
//   - window.AxiomOpenRouter.tokens.estimateCost() (Token Manager —
//     Part 2A) for USD cost per completed request. Token Manager
//     already keeps its OWN global/per-model token totals; this file
//     does not duplicate that ledger — it reuses estimateCost() ONLY,
//     to attach a cost figure to each request/session/day/month
//     bucket that Token Manager itself has no concept of.
//   - window.AxLogger (Logger)                    — same defensive,
//     feature-detected safeLog() every sibling already uses.
//   - window.AxiomRuntimeContext (Runtime Context) — read-only:
//     chat-manager.js's doChatRequest() already wraps every real
//     chat-completion call in an AxiomRuntimeContext record via
//     api-manager.js's withRuntimeContext('chat-completion', ...);
//     this file never creates/mutates a context, it only reads
//     listContexts({ownerAgent:'openrouter', status:'running'}) when
//     present to cross-check in-flight request count (same read-only
//     reuse pattern os/core/autonomous-decision-engine.js already
//     uses against Runtime Context) — falls back to its own
//     in-memory pending-request count when Runtime Context isn't
//     loaded.
//
// What counts as a "request" here: exactly the two request-shaped
// event pairs the codebase already emits —
//   chat-manager.js:   openrouter_request_started / _completed
//   stream-manager.js: openrouter_stream_started   / _finished
// (a resumed stream — {resumed:true} on openrouter_stream_started —
// is NOT counted a second time; it's the same logical request
// continuing after a page reload, per stream-manager.js's own
// resumeStream() doc comment).
// request-queue.js's own openrouter_queue_completed is deliberately
// NOT used to count requests/successes/failures: a queued chat/stream
// task's execute() is chat.sendMessage()/stream.streamMessage()
// itself, so counting both would double-count every queued request.
// openrouter_retry IS reused, for exactly one purpose — retries have
// no other event anywhere in the codebase, and request-queue.js only
// ever fires it on a genuine re-attempt of a chat/stream call.
// Failures are attributed via openrouter_error, but ONLY when its
// `op` is 'sendMessage' or 'streamMessage' (chat-manager.js's/
// stream-manager.js's own context tag on that event) — this excludes
// unrelated errors (key validation, health checks, model list
// fetches) from ever being counted as a tracked request's failure.
//
// Session: this codebase has no existing "session" concept to reuse
// (grepped os/core/runtime-context.js and every os/api/openrouter/*
// file — none exists). Every request-shaped event already carries a
// `chatId`, which is the closest existing stable identifier for "one
// ongoing conversation" — so per-session usage here means per-chatId,
// reusing that existing id rather than inventing a second, parallel
// identifier. Requests with no chatId (should not occur for the
// events this file listens to, but handled defensively) roll into a
// single 'unknown' bucket rather than being dropped.
//
// Degrades gracefully like every sibling: if AxiomOpenRouter.on isn't
// present at load time, install() no-ops (logged once, non-fatal) —
// this file has no dependency on load order for its OWN presence,
// only its live tracking requires api-manager.js to already be
// loaded, same requirement chat-manager.js/stream-manager.js/
// request-queue.js already have for their own bus usage.
//
// Public API — window.AxiomOpenRouter.usage:
//   getStats()                    -> global totals snapshot
//   getModelStats(modelId)        -> one model's bucket (zeroed if none yet)
//   listModelStats()              -> { [modelId]: bucket, ... }
//   getSessionStats(sessionId)    -> one chatId's bucket (zeroed if none yet)
//   listSessionStats()            -> { [chatId]: bucket, ... }
//   getDailyStats(dateKey?)       -> one day's bucket, default = today (UTC, 'YYYY-MM-DD')
//   listDailyStats()              -> { [dateKey]: bucket, ... }
//   getMonthlyStats(monthKey?)    -> one month's bucket, default = this month (UTC, 'YYYY-MM')
//   listMonthlyStats()            -> { [monthKey]: bucket, ... }
//   getActiveRequestCount()       -> number (in-flight, not yet settled)
//   resetStats()                  -> void
//   configure(overrides)          -> void  { historyLimit }
//
// Published event (on the existing shared bus):
//   openrouter_usage_updated  {trigger, requestId?, sessionId?, model?,
//                               totals, at}
//     — fired after every counted request start/completion/failure/
//       retry, `totals` is the same shape getStats() returns, so a
//       single listener can stay current without polling.
// ============================================================
(function (global) {
  'use strict';

  var settings = {
    // Bounds the in-memory pending-request map so a page that never
    // sees a matching completion/error for some requests (e.g. a
    // request-queue task cancelled before chat-manager.js itself
    // would have fired anything) can't grow this unboundedly. Same
    // "bounded ring buffer" convention as token-manager.js's history.
    maxPendingTracked: 2000
  };

  function emptyBucket() {
    return {
      requests: 0,
      successes: 0,
      failures: 0,
      retries: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      latencyMsSum: 0,
      latencyCount: 0
    };
  }

  var totals = emptyBucket();
  var byModel = Object.create(null);   // modelId -> bucket
  var bySession = Object.create(null); // chatId  -> bucket
  var byDay = Object.create(null);     // 'YYYY-MM-DD' (UTC) -> bucket
  var byMonth = Object.create(null);   // 'YYYY-MM' (UTC)    -> bucket

  // requestId -> { startedAt, model, sessionId, kind: 'chat'|'stream' }
  // Tracks in-flight requests purely to compute latency on completion/
  // failure and to answer getActiveRequestCount() without Runtime
  // Context. Entries are removed the moment a matching _completed/
  // _finished/_error/is observed.
  var pending = Object.create(null);
  var pendingOrder = [];

  var installed = false;

  // ---------- small shared helpers (same conventions as siblings) ----------

  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function safeLog(level, message, detail) {
    try {
      if (global.AxLogger && typeof global.AxLogger[level] === 'function') {
        global.AxLogger[level]('[AxiomOpenRouter:usage] ' + message, detail || '');
        return;
      }
    } catch (e) { /* fall through */ }
    try { if (global.console && typeof global.console[level] === 'function') global.console[level]('[AxiomOpenRouter:usage] ' + message, detail || ''); } catch (e2) { /* ignore */ }
  }

  function api() { return global.AxiomOpenRouter; }

  function busOn(event, fn) {
    var a = api();
    if (a && typeof a.on === 'function') return a.on(event, fn);
    return function () {};
  }

  function busEmit(event, payload) {
    try {
      var a = api();
      if (a && typeof a.emit === 'function') a.emit(event, payload);
    } catch (e) { /* bus not installed — no-op, same convention as every sibling */ }
  }

  function bucketFor(map, key) {
    if (!map[key]) map[key] = emptyBucket();
    return map[key];
  }

  function publicBucket(bucket) {
    var avgLatencyMs = bucket.latencyCount > 0 ? bucket.latencyMsSum / bucket.latencyCount : null;
    return {
      requests: bucket.requests,
      successes: bucket.successes,
      failures: bucket.failures,
      retries: bucket.retries,
      promptTokens: bucket.promptTokens,
      completionTokens: bucket.completionTokens,
      totalTokens: bucket.totalTokens,
      costUsd: bucket.costUsd,
      avgLatencyMs: avgLatencyMs
    };
  }

  function dateKeys(at) {
    var iso = new Date(typeof at === 'number' ? at : Date.now()).toISOString();
    return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
  }

  // ---------- cost estimation (reuses Token Manager, never re-derives pricing) ----------

  function estimateCost(model, promptTokens, completionTokens) {
    try {
      var tm = global.AxiomOpenRouter && global.AxiomOpenRouter.tokens;
      if (!tm || typeof tm.estimateCost !== 'function') return null;
      return tm.estimateCost(model, promptTokens, completionTokens);
    } catch (e) {
      return null;
    }
  }

  // ---------- pending (in-flight) request tracking ----------

  function trackStart(requestId, model, sessionId, kind, at) {
    if (!isNonEmptyString(requestId)) return;
    if (pending[requestId]) return; // already tracked (e.g. duplicate start) — never double-count
    pending[requestId] = { startedAt: at, model: model || 'unknown', sessionId: sessionId || 'unknown', kind: kind };
    pendingOrder.push(requestId);
    if (pendingOrder.length > settings.maxPendingTracked) {
      var oldest = pendingOrder.shift();
      if (oldest && pending[oldest]) delete pending[oldest];
    }
  }

  function takePending(requestId) {
    if (!isNonEmptyString(requestId) || !pending[requestId]) return null;
    var entry = pending[requestId];
    delete pending[requestId];
    var idx = pendingOrder.indexOf(requestId);
    if (idx !== -1) pendingOrder.splice(idx, 1);
    return entry;
  }

  // ---------- recording ----------

  function recordStart(model, sessionId) {
    totals.requests += 1;
    bucketFor(byModel, model || 'unknown').requests += 1;
    bucketFor(bySession, sessionId || 'unknown').requests += 1;
    var keys = dateKeys(Date.now());
    bucketFor(byDay, keys.day).requests += 1;
    bucketFor(byMonth, keys.month).requests += 1;
  }

  function recordOutcome(kind, model, sessionId, promptTokens, completionTokens, latencyMs, at) {
    model = model || 'unknown';
    sessionId = sessionId || 'unknown';
    var cost = kind === 'success' ? estimateCost(model, promptTokens || 0, completionTokens || 0) : null;
    var keys = dateKeys(at);
    var targets = [totals, bucketFor(byModel, model), bucketFor(bySession, sessionId), bucketFor(byDay, keys.day), bucketFor(byMonth, keys.month)];

    targets.forEach(function (bucket) {
      if (kind === 'success') {
        bucket.successes += 1;
        bucket.promptTokens += promptTokens || 0;
        bucket.completionTokens += completionTokens || 0;
        bucket.totalTokens += (promptTokens || 0) + (completionTokens || 0);
        if (typeof cost === 'number' && isFinite(cost)) bucket.costUsd += cost;
      } else {
        bucket.failures += 1;
      }
      if (typeof latencyMs === 'number' && isFinite(latencyMs) && latencyMs >= 0) {
        bucket.latencyMsSum += latencyMs;
        bucket.latencyCount += 1;
      }
    });
  }

  function recordRetry(sessionId) {
    totals.retries += 1;
    bucketFor(bySession, sessionId || 'unknown').retries += 1;
    var keys = dateKeys(Date.now());
    bucketFor(byDay, keys.day).retries += 1;
    bucketFor(byMonth, keys.month).retries += 1;
  }

  function publish(trigger, extra) {
    busEmit('openrouter_usage_updated', Object.assign({ trigger: trigger, totals: publicBucket(totals), at: Date.now() }, extra || {}));
  }

  // ---------- event handlers ----------
  // Each is a thin adapter from one already-documented bus payload
  // shape (see chat-manager.js/stream-manager.js/request-queue.js's
  // own header comments) onto the recording functions above — no
  // event payload shape is invented here.

  function onRequestStarted(payload) {
    payload = isPlainObject(payload) ? payload : {};
    trackStart(payload.requestId, payload.model, payload.chatId, 'chat', payload.at || Date.now());
    recordStart(payload.model, payload.chatId);
    publish('request_started', { requestId: payload.requestId, sessionId: payload.chatId, model: payload.model });
  }

  function onStreamStarted(payload) {
    payload = isPlainObject(payload) ? payload : {};
    if (payload.resumed) return; // same logical request continuing — not a new one, see header note
    trackStart(payload.requestId, payload.model, payload.chatId, 'stream', payload.at || Date.now());
    recordStart(payload.model, payload.chatId);
    publish('stream_started', { requestId: payload.requestId, sessionId: payload.chatId, model: payload.model });
  }

  function onRequestCompleted(payload) {
    payload = isPlainObject(payload) ? payload : {};
    var entry = takePending(payload.requestId);
    var startedAt = entry ? entry.startedAt : null;
    var latencyMs = (typeof startedAt === 'number' && typeof payload.at === 'number') ? (payload.at - startedAt) : null;
    var usage = isPlainObject(payload.usage) ? payload.usage : {};
    recordOutcome('success', payload.model, payload.chatId, usage.promptTokens, usage.completionTokens, latencyMs, payload.at || Date.now());
    publish('request_completed', { requestId: payload.requestId, sessionId: payload.chatId, model: payload.model });
  }

  function onStreamFinished(payload) {
    payload = isPlainObject(payload) ? payload : {};
    var entry = takePending(payload.requestId);
    var startedAt = entry ? entry.startedAt : null;
    var latencyMs = (typeof startedAt === 'number' && typeof payload.at === 'number') ? (payload.at - startedAt) : null;
    var usage = isPlainObject(payload.usage) ? payload.usage : {};
    recordOutcome('success', payload.model, payload.chatId, usage.promptTokens, usage.completionTokens, latencyMs, payload.at || Date.now());
    publish('stream_finished', { requestId: payload.requestId, sessionId: payload.chatId, model: payload.model });
  }

  function onError(payload) {
    payload = isPlainObject(payload) ? payload : {};
    if (payload.op !== 'sendMessage' && payload.op !== 'streamMessage') return; // not a tracked request's failure — see header note
    var entry = takePending(payload.requestId);
    var startedAt = entry ? entry.startedAt : null;
    var at = (payload.error && payload.error.at) || Date.now();
    var latencyMs = (typeof startedAt === 'number') ? (at - startedAt) : null;
    recordOutcome('failure', payload.model, payload.chatId, 0, 0, latencyMs, at);
    publish('request_failed', { requestId: payload.requestId, sessionId: payload.chatId, model: payload.model });
  }

  function onRetry(payload) {
    payload = isPlainObject(payload) ? payload : {};
    var sessionId = payload.meta && payload.meta.chatId;
    recordRetry(sessionId);
    publish('retry', { requestId: payload.requestId, sessionId: sessionId, attempt: payload.attempt });
  }

  // ---------- install ----------

  function install() {
    if (installed) return true;
    var a = api();
    if (!a || typeof a.on !== 'function') {
      safeLog('warn', 'window.AxiomOpenRouter.on() not found — usage tracking is inactive until api-manager.js is loaded.');
      return false;
    }
    a.on('openrouter_request_started', onRequestStarted);
    a.on('openrouter_request_completed', onRequestCompleted);
    a.on('openrouter_stream_started', onStreamStarted);
    a.on('openrouter_stream_finished', onStreamFinished);
    a.on('openrouter_error', onError);
    a.on('openrouter_retry', onRetry);
    installed = true;
    return true;
  }

  // ---------- optional Runtime Context integration (read-only) ----------
  // Mirrors os/core/autonomous-decision-engine.js's own read-only
  // reuse of AxiomRuntimeContext (listContexts()) rather than
  // creating/owning contexts itself — this file makes no network
  // calls and has nothing of its own worth wrapping in a context; it
  // only cross-checks in-flight count against the 'chat-completion'-
  // labelled contexts api-manager.js's withRuntimeContext() already
  // creates around every real request when Runtime Context is loaded.
  function getActiveRequestCount() {
    try {
      var RC = global.AxiomRuntimeContext;
      if (RC && typeof RC.listContexts === 'function') {
        var running = RC.listContexts({ ownerAgent: 'openrouter', status: 'running' });
        if (Array.isArray(running)) return running.length;
      }
    } catch (e) { /* Runtime Context absent/incompatible — fall back below */ }
    return pendingOrder.length;
  }

  // ---------- public read API ----------

  function getStats() {
    return Object.assign({ models: Object.keys(byModel).length, sessions: Object.keys(bySession).length }, publicBucket(totals));
  }

  function getModelStats(modelId) {
    var bucket = (isNonEmptyString(modelId) && byModel[modelId]) || emptyBucket();
    return Object.assign({ model: modelId || null }, publicBucket(bucket));
  }

  function listModelStats() {
    var out = {};
    Object.keys(byModel).forEach(function (k) { out[k] = publicBucket(byModel[k]); });
    return out;
  }

  function getSessionStats(sessionId) {
    var bucket = (isNonEmptyString(sessionId) && bySession[sessionId]) || emptyBucket();
    return Object.assign({ sessionId: sessionId || null }, publicBucket(bucket));
  }

  function listSessionStats() {
    var out = {};
    Object.keys(bySession).forEach(function (k) { out[k] = publicBucket(bySession[k]); });
    return out;
  }

  function getDailyStats(dateKey) {
    var key = isNonEmptyString(dateKey) ? dateKey : dateKeys(Date.now()).day;
    var bucket = byDay[key] || emptyBucket();
    return Object.assign({ date: key }, publicBucket(bucket));
  }

  function listDailyStats() {
    var out = {};
    Object.keys(byDay).forEach(function (k) { out[k] = publicBucket(byDay[k]); });
    return out;
  }

  function getMonthlyStats(monthKey) {
    var key = isNonEmptyString(monthKey) ? monthKey : dateKeys(Date.now()).month;
    var bucket = byMonth[key] || emptyBucket();
    return Object.assign({ month: key }, publicBucket(bucket));
  }

  function listMonthlyStats() {
    var out = {};
    Object.keys(byMonth).forEach(function (k) { out[k] = publicBucket(byMonth[k]); });
    return out;
  }

  function resetStats() {
    totals = emptyBucket();
    byModel = Object.create(null);
    bySession = Object.create(null);
    byDay = Object.create(null);
    byMonth = Object.create(null);
    pending = Object.create(null);
    pendingOrder = [];
  }

  function configure(overrides) {
    if (!isPlainObject(overrides)) return;
    if (typeof overrides.historyLimit === 'number' && overrides.historyLimit > 0) {
      settings.maxPendingTracked = Math.floor(overrides.historyLimit);
    }
  }

  var UsageTracker = {
    getStats: getStats,
    getModelStats: getModelStats,
    listModelStats: listModelStats,
    getSessionStats: getSessionStats,
    listSessionStats: listSessionStats,
    getDailyStats: getDailyStats,
    listDailyStats: listDailyStats,
    getMonthlyStats: getMonthlyStats,
    listMonthlyStats: listMonthlyStats,
    getActiveRequestCount: getActiveRequestCount,
    resetStats: resetStats,
    configure: configure,

    // exposed for the regression suite only — not part of the
    // documented public contract, same convention as api-manager.js's
    // own _internal surface.
    _internal: {
      install: install
    }
  };

  global.AxiomOpenRouter = global.AxiomOpenRouter || {};
  // Never clobber a sibling Part 2A/2B namespace that may already be
  // installed — same "install onto existing global" convention used
  // throughout os/api/openrouter/*.
  global.AxiomOpenRouter.usage = UsageTracker;

  // Auto-install immediately on load, same timing chat-manager.js's/
  // stream-manager.js's/request-queue.js's own busEmit() calls assume
  // api-manager.js already ran first for. If it hasn't, install()
  // logs and no-ops rather than throwing — usage tracking simply
  // stays inactive (getStats() etc. still work, just report zeros)
  // until something calls _internal.install() again after api-
  // manager.js loads.
  install();
})(typeof window !== 'undefined' ? window : globalThis);
