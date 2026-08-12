// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2B-3: OpenRouter Request Queue
// ------------------------------------------------------------
// Adds a client-side scheduling layer in front of the request paths
// Part 2A/2B-1/2B-2 already built. This file adds NO new HTTP,
// key-storage, error-classification, or event-forwarding logic of
// its own — it reuses:
//   - window.AxiomOpenRouter._internal.classifyError()   (from
//     api-manager.js, delegating to error-handler.js — the SAME
//     401/403/.../network/timeout classification chat-manager.js and
//     stream-manager.js already run every failure through)
//   - window.AxiomOpenRouter.errors.isRetryable()         (from
//     error-handler.js — see "Retry infrastructure" below)
//   - window.AxiomOpenRouter._internal.withRuntimeContext() (optional
//     AxiomRuntimeContext wrapping, feature-detected, same as
//     api-manager.js's own doRequest()/chat-manager.js's
//     doChatRequest())
//   - window.AxiomOpenRouter.emit()                        (shared
//     bus — already forwards to AxiomOrchestrator, the in-app
//     Analytics log surface, and a DOM CustomEvent; this file never
//     talks to AxiomOrchestrator/AxLogger/Analytics directly, exactly
//     like chat-manager.js and stream-manager.js don't)
//   - window.AxiomOpenRouter.chat.sendMessage()            (2B-1,
//     wrapped by enqueueChatMessage() below)
//   - window.AxiomOpenRouter.stream.streamMessage() /
//     .cancelStream()                                       (2B-2,
//     wrapped by enqueueStream() below — cancelStream() is what
//     gives a queued stream task a REAL abort, not just a
//     stop-waiting-for-it one)
//
// Retry infrastructure — what "reuse" means here: there is no
// existing retry *scheduler* anywhere in os/api/openrouter/* to
// reuse (confirmed by grepping every sibling file for
// retry/backoff — chat-manager.js's and stream-manager.js's own
// header comments both describe "a retry" as simply "a fresh
// sendMessage()/streamMessage() call", i.e. retrying today means the
// caller manually calls the function again). What DOES already exist,
// and is fully reused rather than reimplemented, is the retryability
// *verdict*: error-handler.js's `CODES`/`RETRYABLE` table and its
// `isRetryable()` function are the single source of truth this file
// asks on every failure — this file only adds the scheduling
// (backoff delay, attempt counting, re-queueing) around that
// pre-existing verdict. It does not duplicate or second-guess
// error-handler.js's classification.
//
// Scope: this file is pure scheduling/orchestration over requests
// that already exist. It contains no chunk parsing (response-
// parser.js), no conversation state (chat-manager.js's `chats` map),
// no stream reading (stream-manager.js), and no key storage/HTTP
// helpers (api-manager.js) — it only decides WHEN and IN WHAT ORDER
// an already-built request executor runs, and re-runs it on a
// retryable failure.
//
// Degrades gracefully, same convention as every sibling: the generic
// enqueue() primitive has no dependency on any other os/api/openrouter
// file and works standalone (useful for tests and for queuing
// arbitrary async work). Its two convenience wrappers,
// enqueueChatMessage() and enqueueStream(), each reject with a
// clearly-coded `core_not_loaded` error (same shape as
// stream-manager.js's own dependency checks) if chat-manager.js /
// stream-manager.js respectively haven't loaded — they never throw
// synchronously and never silently no-op.
//
// Public API — window.AxiomOpenRouter.queue:
//   enqueue(execute, options?)        -> {requestId, promise}
//     execute: () => Promise   (required; the unit of work to run)
//     options: { priority=0, timeoutMs, maxRetries, retryBaseDelayMs,
//                retryMaxDelayMs, cancel?: (reason)=>void, id?, meta? }
//     promise resolves with whatever execute()'s promise resolves
//     with, or rejects with a classified error (incl. on exhausted
//     retries or cancellation).
//   enqueueChatMessage(chatId, content, options?)
//                                      -> {requestId, promise}
//     Queues window.AxiomOpenRouter.chat.sendMessage(chatId, content,
//     options.overrides). Same options as enqueue() above, minus
//     `cancel` (a queued-but-not-yet-started chat send has nothing to
//     abort; once dispatched it runs to completion or timeout, same
//     as calling sendMessage() directly always has).
//   enqueueStream(chatId, content, callbacks?, options?)
//                                      -> {requestId, promise}
//     Queues window.AxiomOpenRouter.stream.streamMessage(chatId,
//     content, callbacks, options.overrides), with `cancel` wired to
//     stream.cancelStream() automatically — cancelling a running
//     queued stream task, or a timeout hitting it, calls the SAME
//     real abort a caller-invoked cancelStream() would.
//   cancel(requestId, reason?)        -> boolean
//   getRequest(requestId)             -> request snapshot | null
//   listRequests(filter?)             -> Array<request snapshot>
//     filter: { status?: 'queued'|'retrying'|'running'|'succeeded'|
//                         'failed'|'cancelled' }
//   getMetrics()                      -> queue metrics snapshot
//   pause() / resume()                -> void  (manual dispatch gate,
//     independent of the automatic rate-limit cooldown below)
//   clear(reason?)                    -> number (cancels every
//     currently *queued* — not running — request; returns count)
//   configure(overrides)              -> void
//     { maxConcurrent, maxRetries, retryBaseDelayMs, retryMaxDelayMs,
//       defaultTimeoutMs, rateLimitCooldownMs }
//
// Events (on the existing shared bus — window.AxiomOpenRouter.on()):
//   openrouter_queue_added      {requestId, priority, attempt:0,
//                                 queueLength, meta, at}
//   openrouter_queue_started    {requestId, priority, attempt,
//                                 startedAt, meta}
//   openrouter_retry            {requestId, attempt, previousAttempt,
//                                 delayMs, error, rateLimited, meta, at}
//   openrouter_queue_completed  {requestId, status: 'succeeded'|
//                                 'failed'|'cancelled', attempt,
//                                 priority, enqueuedAt, startedAt,
//                                 finishedAt, waitMs, runMs, error,
//                                 meta, at}
//     — fired exactly once per request, on every terminal outcome
//       (success, retries-exhausted failure, or cancellation), so a
//       single listener can track "is this request done yet?"
//       without also listening to the two events below.
// Additional events (same naming convention, not required by the
// base spec but natural companions to the four above — mirrors how
// stream-manager.js's Part also emitted more events than its own
// bare public-API list implied was strictly necessary):
//   openrouter_queue_timeout       {requestId, attempt, timeoutMs,
//                                    meta, at}
//   openrouter_queue_rate_limited  {requestId, cooldownMs, until,
//                                    meta, at}
//   openrouter_queue_cancelled     {requestId, reason, meta, at}
// ============================================================
(function (global) {
  'use strict';

  var settings = {
    maxConcurrent: 3,
    maxRetries: 3,
    retryBaseDelayMs: 500,
    retryMaxDelayMs: 15000,
    defaultTimeoutMs: 30000,
    rateLimitCooldownMs: 20000
  };

  var requests = Object.create(null); // requestId -> mutable record
  var requestOrder = [];              // insertion order, never pruned (mirrors stream-manager.js's `streams` convention)
  var pending = [];                   // records currently waiting to run, kept sorted (priority desc, seq asc)
  var running = Object.create(null);  // requestId -> record, currently dispatched
  var runningCount = 0;
  var paused = false;
  var rateLimitedUntil = 0;
  var rateLimitTimer = null;
  var seq = 0;

  var metrics = {
    totalEnqueued: 0,
    totalSucceeded: 0,
    totalFailed: 0,
    totalCancelled: 0,
    totalRetries: 0,
    totalRateLimited: 0
  };

  // ---------- small shared helpers (same conventions as siblings) ----------

  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
  function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  var uidCache = Object.create(null);
  var idSeq = 0;
  function makeId(prefix) {
    if (typeof global.AxiomMakeSeqId === 'function') {
      if (!uidCache[prefix]) uidCache[prefix] = global.AxiomMakeSeqId(prefix);
      return uidCache[prefix]();
    }
    idSeq += 1;
    return prefix + '_' + Date.now().toString(36) + '_' + idSeq.toString(36);
  }

  function api() { return global.AxiomOpenRouter; }

  function busEmit(event, payload) {
    try {
      var a = api();
      if (a && typeof a.emit === 'function') a.emit(event, payload);
    } catch (e) { /* bus not installed — no-op, same convention as chat-manager.js/stream-manager.js */ }
  }

  function internalHelpers() {
    var a = api();
    return (a && a._internal) ? a._internal : null;
  }

  function safeLog(level, message, detail) {
    try {
      if (global.AxLogger && typeof global.AxLogger[level] === 'function') {
        global.AxLogger[level]('[AxiomOpenRouter:queue] ' + message, detail || '');
        return;
      }
    } catch (e) { /* fall through to console */ }
    try {
      if (global.console && typeof global.console[level] === 'function') {
        global.console[level]('[AxiomOpenRouter:queue] ' + message, detail || '');
      }
    } catch (e2) { /* logging must never break the queue */ }
  }

  function usageError(code, message) {
    var err = new Error(message);
    err.code = code;
    err.retryable = false;
    return err;
  }

  // A pre-classified, error-handler-shaped object (has both `.code`
  // and a boolean `.retryable`) is passed through as-is rather than
  // re-run through classify() — chat.sendMessage()/stream.streamMessage()
  // rejections are ALREADY the output of error-handler.js's classify()
  // (see api-manager.js/chat-manager.js/stream-manager.js), so
  // re-classifying here would mean guessing a code back out of an
  // already-final classification instead of reusing it.
  function looksClassified(e) {
    return !!(e && typeof e === 'object' && typeof e.code === 'string' && typeof e.retryable === 'boolean');
  }

  function classifyRejection(err, context) {
    if (looksClassified(err)) return err;
    var internal = internalHelpers();
    if (internal && typeof internal.classifyError === 'function') return internal.classifyError(err, context);
    var a = api();
    if (a && a.errors && typeof a.errors.classify === 'function') return a.errors.classify(err);
    // Neither api-manager.js nor error-handler.js loaded — minimal
    // inline fallback, same shape/convention as every sibling's own
    // fallback classify().
    return { code: 'unknown', status: (err && err.status) || null, message: (err && err.message) || String(err), retryable: false, at: Date.now(), raw: err || null };
  }

  function isRetryableError(classified) {
    var a = api();
    if (a && a.errors && typeof a.errors.isRetryable === 'function') return a.errors.isRetryable(classified);
    return !!(classified && classified.retryable);
  }

  function timeoutClassified(record) {
    return {
      code: 'timeout',
      status: null,
      type: 'timeout',
      message: 'Queued request "' + record.requestId + '" timed out after ' + record.timeoutMs + 'ms.',
      retryable: true, // matches error-handler.js CODES.TIMEOUT's retryable verdict
      at: Date.now(),
      raw: null
    };
  }

  // ---------- deferred promise (enqueue() returns one alongside a synchronous requestId, same pattern as stream-manager.js's makeDeferred()) ----------

  function makeDeferred() {
    var record = { settled: false };
    record.promise = new Promise(function (resolve, reject) {
      record.resolve = resolve;
      record.reject = reject;
    });
    record.promise.catch(function () {}); // never let an un-awaited rejection surface as unhandled
    return record;
  }

  function settleDeferred(record, kind, value) {
    if (!record.deferred || record.deferred.settled) return;
    record.deferred.settled = true;
    record.deferred[kind](value);
  }

  function missingDeps(code, message) {
    return { requestId: makeId('or_qreq'), promise: Promise.reject(usageError(code, message)) };
  }

  // ---------- priority queue insertion (Priority Queue + Request Ordering) ----------
  // Kept sorted by (priority desc, arrival seq asc) on insertion —
  // O(n) insert, O(1) "next" via shift(). Queue sizes in this client
  // are small (a handful of in-flight/queued OpenRouter calls), so a
  // sorted array is simpler to read and test than a heap while giving
  // the same ordering guarantee: higher priority always runs first,
  // and requests of equal priority always run in the order they were
  // enqueued (or re-queued after a retry wait — see scheduleRetry()).
  function insertPending(record) {
    var idx = pending.length;
    for (var i = 0; i < pending.length; i++) {
      if (record.priority > pending[i].priority) { idx = i; break; }
    }
    pending.splice(idx, 0, record);
  }

  // ---------- snapshots ----------

  function snapshotRequest(record) {
    return {
      requestId: record.requestId,
      status: record.status,
      priority: record.priority,
      attempt: record.attempt,
      maxRetries: record.maxRetries,
      meta: record.meta,
      enqueuedAt: record.enqueuedAt,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      waitMs: record.startedAt ? (record.startedAt - record.enqueuedAt) : null,
      runMs: (record.startedAt && record.finishedAt) ? (record.finishedAt - record.startedAt) : null,
      error: record.error || null,
      result: record.status === 'succeeded' ? record.result : null
    };
  }

  function queueCompletedPayload(record, status, error) {
    return {
      requestId: record.requestId,
      status: status,
      attempt: record.attempt,
      priority: record.priority,
      enqueuedAt: record.enqueuedAt,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      waitMs: record.startedAt ? (record.startedAt - record.enqueuedAt) : null,
      runMs: (record.startedAt && record.finishedAt) ? (record.finishedAt - record.startedAt) : null,
      error: error || null,
      meta: record.meta,
      at: record.finishedAt
    };
  }

  function getRequest(requestId) {
    var r = isNonEmptyString(requestId) ? requests[requestId] : null;
    return r ? snapshotRequest(r) : null;
  }

  function listRequests(filter) {
    var status = (filter && isNonEmptyString(filter.status)) ? filter.status : null;
    var out = [];
    requestOrder.forEach(function (id) {
      var r = requests[id];
      if (!r) return;
      if (status && r.status !== status) return;
      out.push(snapshotRequest(r));
    });
    return out;
  }

  function countByStatus(status) {
    var n = 0;
    requestOrder.forEach(function (id) {
      var r = requests[id];
      if (r && r.status === status) n += 1;
    });
    return n;
  }

  function getMetrics() {
    return {
      totalEnqueued: metrics.totalEnqueued,
      totalSucceeded: metrics.totalSucceeded,
      totalFailed: metrics.totalFailed,
      totalCancelled: metrics.totalCancelled,
      totalRetries: metrics.totalRetries,
      totalRateLimited: metrics.totalRateLimited,
      queued: pending.length,
      running: runningCount,
      retrying: countByStatus('retrying'),
      paused: paused,
      rateLimited: isRateLimited(),
      rateLimitedUntil: rateLimitedUntil || null
    };
  }

  // ---------- rate limit handling ----------
  // A 429 doesn't just fail its own request — it means OpenRouter
  // has asked the whole client to slow down. So on top of that
  // request's own retry (scheduled normally, below), the QUEUE stops
  // dispatching any NEW requests (including other already-queued
  // ones, and any queued-but-not-yet-started ones added later) until
  // `rateLimitedUntil`. Already-running requests are left to finish
  // — this is a dispatch gate, not a cancellation. OpenRouter's
  // actual `Retry-After` header isn't reachable from here (neither
  // chat.sendMessage() nor stream.streamMessage() surface response
  // headers to their callers today — only status/body via
  // error-handler.js's classify()), so `rateLimitCooldownMs` is a
  // configurable fixed cooldown rather than a header-derived one;
  // documented in OPENROUTER_PART2B3_VALIDATION.md as a known
  // limitation and natural follow-up if a future Part threads
  // response headers through.
  function isRateLimited() { return rateLimitedUntil > Date.now(); }

  function armRateLimitTimer() {
    if (rateLimitTimer) return;
    var wait = Math.max(0, rateLimitedUntil - Date.now());
    rateLimitTimer = global.setTimeout(function () {
      rateLimitTimer = null;
      pump();
    }, wait);
  }

  // ---------- dispatch loop (Parallel Requests) ----------

  function pump() {
    if (paused) return;
    while (runningCount < settings.maxConcurrent && pending.length > 0 && !isRateLimited()) {
      dispatch(pending.shift());
    }
    if (isRateLimited() && pending.length > 0) armRateLimitTimer();
  }

  function cleanupRunning(record) {
    if (running[record.requestId]) {
      delete running[record.requestId];
      runningCount = Math.max(0, runningCount - 1);
    }
  }

  // ---------- Runtime Context reuse ----------
  // Wraps just the executor invocation of a dispatched attempt in an
  // AxiomRuntimeContext record (feature-detected, via api-manager.js's
  // `_internal.withRuntimeContext`, the exact same helper
  // chat-manager.js's doChatRequest() and api-manager.js's own
  // validateApiKey()/checkHealth() already use) — purely for
  // observability of "this queue attempt is in flight"; never
  // required, and orthogonal to whatever Runtime Context usage (if
  // any) already happens inside the wrapped execute() itself (e.g. a
  // queued chat send's own doChatRequest() already wraps its network
  // call the same way — nesting two independent, unlinked contexts is
  // harmless and each is torn down on its own settle).
  function runExecutor(record) {
    var fn = function () {
      var p;
      try {
        p = record.execute();
      } catch (e) {
        return Promise.reject(e);
      }
      if (!p || typeof p.then !== 'function') {
        return Promise.reject(usageError('invalid_task', 'execute() must return a Promise.'));
      }
      return p;
    };
    var internal = internalHelpers();
    if (internal && typeof internal.withRuntimeContext === 'function') {
      try { return internal.withRuntimeContext('queue:' + ((record.meta && record.meta.kind) || 'task'), fn); }
      catch (e) { return fn(); } // Runtime Context rejected/unavailable — degrade silently, same as api-manager.js
    }
    return fn();
  }

  function dispatch(record) {
    record.status = 'running';
    record.attempt += 1;
    record.startedAt = Date.now();
    record.cancelRequested = false;
    var token = {};
    record.dispatchToken = token;
    running[record.requestId] = record;
    runningCount += 1;

    busEmit('openrouter_queue_started', {
      requestId: record.requestId, priority: record.priority, attempt: record.attempt,
      startedAt: record.startedAt, meta: record.meta
    });

    if (record.timeoutMs > 0) {
      record.timeoutTimer = global.setTimeout(function () {
        record.timeoutTimer = null;
        onSettle(record, token, false, null, { isTimeout: true });
      }, record.timeoutMs);
    }

    runExecutor(record).then(
      function (result) { onSettle(record, token, true, result, {}); },
      function (err) { onSettle(record, token, false, err, {}); }
    );
  }

  // ---------- settle handling: success / retry / failure (Retry Scheduling + Timeout Handling) ----------

  function onSettle(record, token, success, value, opts) {
    // A stale settlement from a dispatch that timeout/cancel() already
    // resolved — e.g. the real execute() promise finally settles
    // after this attempt was already timed out or cancelled. Ignored
    // rather than double-settling the deferred or double-emitting.
    if (record.dispatchToken !== token) return;
    if (record.timeoutTimer) { global.clearTimeout(record.timeoutTimer); record.timeoutTimer = null; }

    if (success) {
      finalizeSuccess(record, value);
      return;
    }

    var classified = opts && opts.isTimeout
      ? timeoutClassified(record)
      : classifyRejection(value, { op: 'queue', requestId: record.requestId, attempt: record.attempt });

    if (opts && opts.isTimeout) {
      busEmit('openrouter_queue_timeout', {
        requestId: record.requestId, attempt: record.attempt, timeoutMs: record.timeoutMs,
        meta: record.meta, at: Date.now()
      });
    }

    var rateLimited = classified.code === 'rate_limited';
    if (rateLimited) {
      rateLimitedUntil = Date.now() + settings.rateLimitCooldownMs;
      metrics.totalRateLimited += 1;
      busEmit('openrouter_queue_rate_limited', {
        requestId: record.requestId, cooldownMs: settings.rateLimitCooldownMs,
        until: rateLimitedUntil, meta: record.meta, at: Date.now()
      });
    }

    if (!record.cancelRequested && isRetryableError(classified) && record.attempt <= record.maxRetries) {
      scheduleRetry(record, classified, rateLimited);
    } else {
      finalizeFailure(record, classified);
    }
  }

  function computeBackoff(record, rateLimited) {
    var exp = record.retryBaseDelayMs * Math.pow(2, Math.max(0, record.attempt - 1));
    var delay = Math.min(record.retryMaxDelayMs, exp) + Math.floor(Math.random() * 250);
    if (rateLimited) delay = Math.max(delay, settings.rateLimitCooldownMs);
    return delay;
  }

  function scheduleRetry(record, classified, rateLimited) {
    cleanupRunning(record); // free the concurrency slot while this attempt waits to retry
    record.status = 'retrying';
    record.error = classified;
    var delay = computeBackoff(record, rateLimited);
    metrics.totalRetries += 1;

    busEmit('openrouter_retry', {
      requestId: record.requestId, attempt: record.attempt + 1, previousAttempt: record.attempt,
      delayMs: delay, error: classified, rateLimited: !!rateLimited, meta: record.meta, at: Date.now()
    });

    record.retryTimer = global.setTimeout(function () {
      record.retryTimer = null;
      if (record.status !== 'retrying') return; // cancelled while waiting to retry
      record.status = 'queued';
      insertPending(record);
      pump();
    }, delay);
  }

  function finalizeSuccess(record, result) {
    cleanupRunning(record);
    record.status = 'succeeded';
    record.result = result;
    record.error = null;
    record.finishedAt = Date.now();
    metrics.totalSucceeded += 1;
    settleDeferred(record, 'resolve', result);
    busEmit('openrouter_queue_completed', queueCompletedPayload(record, 'succeeded', null));
    pump();
  }

  function finalizeFailure(record, classified) {
    cleanupRunning(record);
    record.status = 'failed';
    record.error = classified;
    record.finishedAt = Date.now();
    metrics.totalFailed += 1;
    settleDeferred(record, 'reject', classified);
    busEmit('openrouter_queue_completed', queueCompletedPayload(record, 'failed', classified));
    pump();
  }

  // ---------- cancellation ----------

  function cancel(requestId, reason) {
    var record = isNonEmptyString(requestId) ? requests[requestId] : null;
    if (!record) return false;
    if (record.status === 'succeeded' || record.status === 'failed' || record.status === 'cancelled') return false;

    var reasonMsg = isNonEmptyString(reason) ? reason : 'Cancelled.';
    record.cancelRequested = true;

    if (record.status === 'queued') {
      var idx = pending.indexOf(record);
      if (idx !== -1) pending.splice(idx, 1);
    } else if (record.status === 'retrying') {
      if (record.retryTimer) { global.clearTimeout(record.retryTimer); record.retryTimer = null; }
    } else if (record.status === 'running') {
      // Invalidate this dispatch's eventual settlement (a late resolve
      // or reject from the real execute() promise will now be a no-op
      // in onSettle()) and free its concurrency slot immediately —
      // from the queue's perspective this attempt is abandoned now,
      // not "still running but ignored".
      record.dispatchToken = {};
      if (record.timeoutTimer) { global.clearTimeout(record.timeoutTimer); record.timeoutTimer = null; }
      cleanupRunning(record);
      if (typeof record.cancelFn === 'function') {
        // Best-effort real abort (e.g. enqueueStream()'s wired-up
        // stream.cancelStream()). A plain enqueue()/enqueueChatMessage()
        // task with no `cancel` supplied has no way to interrupt
        // in-flight work — the queue stops waiting on/accounting for
        // it, but the underlying call may still complete in the
        // background with no further effect, same "best-effort
        // cancellation" honesty as stream-manager.js's own
        // cancelStream() documents for non-cancellable legs.
        try { record.cancelFn(reasonMsg); }
        catch (e) { safeLog('warn', 'cancel() handler for "' + record.requestId + '" threw', e && e.message); }
      }
    }

    record.status = 'cancelled';
    record.error = usageError('cancelled', reasonMsg);
    record.finishedAt = Date.now();
    metrics.totalCancelled += 1;
    settleDeferred(record, 'reject', record.error);

    busEmit('openrouter_queue_cancelled', { requestId: record.requestId, reason: reasonMsg, meta: record.meta, at: record.finishedAt });
    busEmit('openrouter_queue_completed', queueCompletedPayload(record, 'cancelled', record.error));

    pump();
    return true;
  }

  function clear(reason) {
    var reasonMsg = isNonEmptyString(reason) ? reason : 'Queue cleared.';
    var ids = pending.map(function (r) { return r.requestId; });
    var n = 0;
    ids.forEach(function (id) { if (cancel(id, reasonMsg)) n += 1; });
    return n;
  }

  function pause() { paused = true; }
  function resume() { paused = false; pump(); }

  // ---------- enqueue: the generic primitive ----------

  function enqueue(execute, options) {
    if (typeof execute !== 'function') {
      return missingDeps('invalid_task', 'enqueue() requires an execute() function that returns a Promise.');
    }
    options = isPlainObject(options) ? options : {};

    seq += 1;
    var requestId = isNonEmptyString(options.id) ? options.id : makeId('or_qreq');
    var record = {
      requestId: requestId,
      seq: seq,
      priority: isFiniteNumber(options.priority) ? options.priority : 0,
      execute: execute,
      cancelFn: (typeof options.cancel === 'function') ? options.cancel : null,
      meta: isPlainObject(options.meta) ? options.meta : {},
      timeoutMs: isFiniteNumber(options.timeoutMs) ? options.timeoutMs : settings.defaultTimeoutMs,
      maxRetries: isFiniteNumber(options.maxRetries) ? options.maxRetries : settings.maxRetries,
      retryBaseDelayMs: isFiniteNumber(options.retryBaseDelayMs) ? options.retryBaseDelayMs : settings.retryBaseDelayMs,
      retryMaxDelayMs: isFiniteNumber(options.retryMaxDelayMs) ? options.retryMaxDelayMs : settings.retryMaxDelayMs,
      attempt: 0,
      status: 'queued',
      cancelRequested: false,
      enqueuedAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      error: null,
      result: null,
      retryTimer: null,
      timeoutTimer: null,
      dispatchToken: null
    };
    record.deferred = makeDeferred();

    requests[requestId] = record;
    requestOrder.push(requestId);
    insertPending(record);
    metrics.totalEnqueued += 1;

    busEmit('openrouter_queue_added', {
      requestId: requestId, priority: record.priority, attempt: 0,
      queueLength: pending.length, meta: record.meta, at: record.enqueuedAt
    });

    pump();
    return { requestId: requestId, promise: record.deferred.promise };
  }

  // ---------- convenience wrappers over chat-manager.js / stream-manager.js ----------

  function enqueueChatMessage(chatId, content, options) {
    options = isPlainObject(options) ? options : {};
    var a = api();
    if (!a || !a.chat || typeof a.chat.sendMessage !== 'function') {
      return missingDeps('core_not_loaded', 'os/api/openrouter/chat-manager.js must be loaded before enqueueChatMessage() can queue a request.');
    }
    var execute = function () {
      return a.chat.sendMessage(chatId, content, options.overrides);
    };
    var meta = Object.assign({ kind: 'chat', chatId: chatId }, isPlainObject(options.meta) ? options.meta : {});
    return enqueue(execute, Object.assign({}, options, { meta: meta }));
  }

  function enqueueStream(chatId, content, callbacks, options) {
    options = isPlainObject(options) ? options : {};
    var a = api();
    if (!a || !a.stream || typeof a.stream.streamMessage !== 'function') {
      return missingDeps('core_not_loaded', 'os/api/openrouter/stream-manager.js must be loaded before enqueueStream() can queue a request.');
    }
    var handle = null;
    var execute = function () {
      handle = a.stream.streamMessage(chatId, content, callbacks, options.overrides);
      return handle.promise;
    };
    var cancelFn = function (reason) {
      if (handle && handle.streamId && typeof a.stream.cancelStream === 'function') {
        try { a.stream.cancelStream(handle.streamId, reason); } catch (e) { /* best-effort — see cancel()'s own try/catch */ }
      }
    };
    var meta = Object.assign({ kind: 'stream', chatId: chatId }, isPlainObject(options.meta) ? options.meta : {});
    return enqueue(execute, Object.assign({}, options, { cancel: cancelFn, meta: meta }));
  }

  // ---------- configuration ----------

  function configure(overrides) {
    if (!isPlainObject(overrides)) return;
    if (isFiniteNumber(overrides.maxConcurrent) && overrides.maxConcurrent > 0) settings.maxConcurrent = Math.floor(overrides.maxConcurrent);
    if (isFiniteNumber(overrides.maxRetries) && overrides.maxRetries >= 0) settings.maxRetries = Math.floor(overrides.maxRetries);
    if (isFiniteNumber(overrides.retryBaseDelayMs) && overrides.retryBaseDelayMs >= 0) settings.retryBaseDelayMs = overrides.retryBaseDelayMs;
    if (isFiniteNumber(overrides.retryMaxDelayMs) && overrides.retryMaxDelayMs >= 0) settings.retryMaxDelayMs = overrides.retryMaxDelayMs;
    if (isFiniteNumber(overrides.defaultTimeoutMs) && overrides.defaultTimeoutMs >= 0) settings.defaultTimeoutMs = overrides.defaultTimeoutMs;
    if (isFiniteNumber(overrides.rateLimitCooldownMs) && overrides.rateLimitCooldownMs >= 0) settings.rateLimitCooldownMs = overrides.rateLimitCooldownMs;
    pump();
  }

  var RequestQueue = {
    enqueue: enqueue,
    enqueueChatMessage: enqueueChatMessage,
    enqueueStream: enqueueStream,
    cancel: cancel,
    getRequest: getRequest,
    listRequests: listRequests,
    getMetrics: getMetrics,
    pause: pause,
    resume: resume,
    clear: clear,
    configure: configure
  };

  global.AxiomOpenRouter = global.AxiomOpenRouter || {};
  // Never clobber a sibling Part 2A/2B namespace that may already be
  // installed — same "install onto existing global" convention used
  // throughout os/api/openrouter/*.
  global.AxiomOpenRouter.queue = RequestQueue;
})(typeof window !== 'undefined' ? window : globalThis);
