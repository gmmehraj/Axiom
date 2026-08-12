// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2B-2: OpenRouter Stream Manager
// ------------------------------------------------------------
// Adds SSE streaming on top of the same request/conversation
// foundation Part 2B-1's chat-manager.js already built, exactly the
// "natural, additive follow-up" that Part 2B-1's own validation
// report (§6) called out. This file adds NO new key-storage, HTTP-
// timeout, or error-classification logic of its own — it reuses:
//   - window.AxiomOpenRouter._internal.getStoredKey()   (BYOK key,
//     from api-manager.js)
//   - window.AxiomOpenRouter._internal.classifyError()  (from
//     api-manager.js, delegating to error-handler.js — same
//     401/403/.../network/timeout classification chat-manager.js
//     uses, applied here to failed/aborted stream connections)
//   - window.AxiomOpenRouter._internal.BASE_URL
//   - window.AxiomOpenRouter.chat._internal.{getRawChat,buildPayload,
//     appendUserTurn,appendAssistantTurn}  (new, additive exports on
//     chat-manager.js this Part adds — see its header comment. Reuses
//     chat-manager.js's exact message-array/param-shaping logic and
//     writes the streamed reply into the SAME per-chatId history
//     sendMessage() uses, so getHistory()/listChats() see a streamed
//     turn exactly like a non-streamed one.)
//   - window.AxiomOpenRouter.parser.*                   (from the
//     sibling response-parser.js this Part also adds — every chunk/
//     line/usage/finish-reason normalization decision lives there,
//     not here)
//   - window.AxiomOpenRouter.tokens.recordUsage()        (feature-
//     detected, same as chat-manager.js)
//   - window.AxiomOpenRouter.emit()                      (shared bus)
//
// Scope: this file is pure streaming orchestration — connecting,
// reading the SSE body, accumulating deltas, cancelling, "resuming",
// and emitting progress. It contains no chunk-shape parsing of its
// own (that's response-parser.js) and no conversation-state storage
// of its own (that's chat-manager.js's `chats` map, reused via
// chat._internal above) — same "no duplicated infrastructure"
// standard as chat-manager.js held itself to in Part 2B-1.
//
// Requires api-manager.js AND chat-manager.js (with its `_internal`
// surface) to be loaded — unlike chat-manager.js's own conversation-
// state functions, there is no meaningful "state-only" degrade for a
// stream, since a stream has no purpose without a live conversation
// and a key to reach OpenRouter with. Every public function below
// still degrades to a clearly-coded rejection (`core_not_loaded`)
// rather than a synchronous throw when a dependency is missing, same
// convention as chat-manager.js's own sendMessage().
//
// A note on "resume": OpenRouter's public chat-completions API has no
// resumable-stream token — a dropped SSE connection cannot be
// reattached mid-generation. resumeStream() therefore re-issues a
// fresh `stream: true` request for the same still-pending turn (the
// user turn was already appended to the conversation by
// streamMessage(); the interrupted assistant reply was never
// appended, so the conversation is exactly as it was right before the
// original request), and continues appending new deltas onto the SAME
// `accumulatedContent` the interrupted attempt had already gathered —
// under the SAME streamId, with a new requestId for the new HTTP leg.
// This is a "reconnect and keep building the same logical reply"
// resume, not a byte-exact resume of the original response — that
// distinction is verified directly in the regression suite and
// documented in OPENROUTER_PART2B2_VALIDATION.md.
//
// Public API — window.AxiomOpenRouter.stream:
//   streamMessage(chatId, content, callbacks?, overrides?)
//                                    -> {streamId, promise}
//     callbacks: { onChunk(deltaText, accumulatedText, meta)?,
//                   onProgress(info)?, onComplete(result)?,
//                   onError(classifiedError)?, onCancel(info)? }
//     overrides: same shape as chat.sendMessage()'s overrides —
//                applies to this call only.
//     promise resolves with {chatId, streamId, requestId, model,
//       message, usage, finishReason} on completion; rejects with a
//       classified error on failure, or a `stream_cancelled` usage
//       error if cancelStream() is called before it finishes.
//   cancelStream(streamId, reason?)  -> boolean
//   resumeStream(streamId, callbacks?) -> {streamId, promise} | null
//     (null only for an unknown streamId, or one that isn't currently
//      stopped in 'cancelled'/'error' — nothing to resume)
//   getStream(streamId)              -> stream snapshot | null
//   listStreams(chatId?)             -> Array<stream snapshot>
//   configure(overrides)             -> void (idleTimeoutMs)
// Events (on the existing shared bus — window.AxiomOpenRouter.on()):
//   openrouter_stream_started    {chatId, streamId, requestId, model, at, resumed?}
//   openrouter_stream_chunk      {chatId, streamId, requestId, delta, content, index, at}
//   openrouter_stream_finished   {chatId, streamId, requestId, model, usage, finishReason, message, at}
//   openrouter_stream_cancelled  {chatId, streamId, requestId, reason, partialContent, at}
// ============================================================
(function (global) {
  'use strict';

  var CHAT_ENDPOINT_PATH = '/chat/completions';
  var FALLBACK_BASE_URL = 'https://openrouter.ai/api/v1';

  var options = {
    // Aborts a stream if no byte arrives for this long — protects
    // against a connection that silently hangs forever without ever
    // erroring or closing. Reset on every chunk received, so a slow-
    // but-steady stream never trips it.
    idleTimeoutMs: 30000
  };

  var streams = Object.create(null); // streamId -> mutable stream record
  var streamOrder = [];
  var idSeq = 0;

  // ---------- id generation (same convention as chat-manager.js) ----------
  var uidCache = Object.create(null);
  function makeId(prefix) {
    if (typeof global.AxiomMakeSeqId === 'function') {
      if (!uidCache[prefix]) uidCache[prefix] = global.AxiomMakeSeqId(prefix);
      return uidCache[prefix]();
    }
    idSeq += 1;
    return prefix + '_' + Date.now().toString(36) + '_' + idSeq.toString(36);
  }

  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }

  // ---------- shared-bus / sibling-module helpers (all feature-detected) ----------

  function api() { return global.AxiomOpenRouter; }

  function busEmit(event, payload) {
    try {
      var a = api();
      if (a && typeof a.emit === 'function') a.emit(event, payload);
    } catch (e) { /* bus not installed — no-op, same convention as chat-manager.js */ }
  }

  function internalHelpers() {
    var a = api();
    return (a && a._internal) ? a._internal : null;
  }

  function chatInternal() {
    var a = api();
    return (a && a.chat && a.chat._internal) ? a.chat._internal : null;
  }

  function parser() {
    var a = api();
    return (a && a.parser) ? a.parser : null;
  }

  function baseUrl() {
    var internal = internalHelpers();
    return (internal && internal.BASE_URL) || FALLBACK_BASE_URL;
  }

  function classify(err, context) {
    var internal = internalHelpers();
    if (internal && typeof internal.classifyError === 'function') {
      return internal.classifyError(err, context);
    }
    // Core Foundation not loaded — minimal inline fallback, same
    // shape/convention as chat-manager.js's own classify() fallback.
    return { code: 'unknown', status: (err && err.status) || null, message: (err && err.message) || String(err), retryable: false, at: Date.now(), raw: err || null };
  }

  function usageError(code, message) {
    var err = new Error(message);
    err.code = code;
    err.retryable = false;
    return err;
  }

  function recordUsageIfPossible(modelId, usage, requestId) {
    try {
      var a = api();
      if (a && a.tokens && typeof a.tokens.recordUsage === 'function') {
        return a.tokens.recordUsage({
          model: modelId,
          promptTokens: usage && usage.promptTokens,
          completionTokens: usage && usage.completionTokens,
          requestId: requestId
        });
      }
    } catch (e) { /* tokens.js not loaded, or recordUsage threw — never let accounting break a stream */ }
    return null;
  }

  function safeCallback(callbacks, name) {
    var args = Array.prototype.slice.call(arguments, 2);
    try {
      if (callbacks && typeof callbacks[name] === 'function') callbacks[name].apply(null, args);
    } catch (e) { /* a caller-supplied callback throwing must never break the stream */ }
  }

  function normalizeUsageFallback(usage) {
    var pr = parser();
    if (pr && typeof pr.normalizeUsage === 'function') return pr.normalizeUsage(usage);
    var u = usage || {};
    var prompt = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : (u.promptTokens || 0);
    var completion = typeof u.completion_tokens === 'number' ? u.completion_tokens : (u.completionTokens || 0);
    return { promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion };
  }

  // ---------- deferred promise (streamMessage()/resumeStream() return one alongside a synchronous streamId) ----------

  function makeDeferred() {
    var record = { settled: false };
    record.promise = new Promise(function (resolve, reject) {
      record.resolve = resolve;
      record.reject = reject;
    });
    // A caller using the callback API (onComplete/onError/onCancel)
    // is never required to also await `.promise` — attach a silent
    // catch here so an unawaited rejection (e.g. on cancelStream())
    // never surfaces as an unhandled-rejection warning. The SAME
    // promise instance is still returned to the caller, who may add
    // their own .then()/.catch() on it normally.
    record.promise.catch(function () {});
    return record;
  }

  function settleDeferred(record, kind, value) {
    if (!record || !record.deferred || record.deferred.settled) return;
    record.deferred.settled = true;
    record.deferred[kind](value);
  }

  // ---------- tool-call delta accumulation ----------
  // Streaming tool calls arrive as fragments keyed by `index`: the
  // first chunk for a given index usually carries {id, type,
  // function.name}, every subsequent chunk for that index carries
  // only a `function.arguments` fragment to append. Merged here
  // (stateful across the whole stream) rather than in
  // response-parser.js's normalizeToolCalls(), which only shapes one
  // chunk's worth at a time — see that file's header.
  function mergeToolCalls(existing, deltaCalls) {
    var merged = existing ? existing.slice() : [];
    deltaCalls.forEach(function (tc) {
      var idx = typeof tc.index === 'number' ? tc.index : merged.length;
      var cur = merged[idx] ? Object.assign({}, merged[idx], { function: Object.assign({}, merged[idx].function) }) : { index: idx, id: null, type: 'function', function: { name: '', arguments: '' } };
      if (tc.id) cur.id = tc.id;
      if (tc.type) cur.type = tc.type;
      if (tc.function) {
        if (tc.function.name) cur.function.name += tc.function.name;
        if (tc.function.arguments) cur.function.arguments += tc.function.arguments;
      }
      merged[idx] = cur;
    });
    return merged;
  }

  // ---------- stream record snapshot ----------

  function snapshotStream(s) {
    return {
      streamId: s.streamId,
      chatId: s.chatId,
      requestId: s.requestId,
      status: s.status,
      model: s.model,
      accumulatedContent: s.accumulatedContent,
      chunkCount: s.chunkCount,
      finishReason: s.finishReason,
      usage: s.usage,
      toolCalls: s.toolCalls ? s.toolCalls.slice() : null,
      startedAt: s.startedAt,
      updatedAt: s.updatedAt,
      finishedAt: s.finishedAt,
      error: s.error || null
    };
  }

  function getStream(streamId) {
    var s = (isNonEmptyString(streamId) && streams[streamId]) ? streams[streamId] : null;
    return s ? snapshotStream(s) : null;
  }

  function listStreams(chatId) {
    return streamOrder
      .filter(function (id) { return !!streams[id]; })
      .map(function (id) { return streams[id]; })
      .filter(function (s) { return !chatId || s.chatId === chatId; })
      .map(snapshotStream);
  }

  // ---------- byte decoding ----------

  function decodeChunk(record, value) {
    if (typeof value === 'string') return value;
    if (typeof TextDecoder !== 'undefined') {
      if (!record.decoder) record.decoder = new TextDecoder('utf-8');
      return record.decoder.decode(value, { stream: true });
    }
    // No-TextDecoder environments (older browsers / minimal test
    // sandboxes): if the mock/runtime handed us a Buffer-like value,
    // decode it that way rather than stringifying an opaque object.
    if (value && typeof value.toString === 'function' && typeof value !== 'object') return String(value);
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(value)) return value.toString('utf8');
    return String(value);
  }

  // ---------- per-chunk application ----------

  function applyChunk(record, delta, callbacks) {
    if (!delta) return;
    if (isNonEmptyString(delta.content)) record.accumulatedContent += delta.content;
    if (delta.toolCalls) record.toolCalls = mergeToolCalls(record.toolCalls, delta.toolCalls);
    if (delta.finishReason) record.finishReason = delta.finishReason;
    record.chunkCount += 1;
    record.updatedAt = Date.now();

    busEmit('openrouter_stream_chunk', {
      chatId: record.chatId,
      streamId: record.streamId,
      requestId: record.requestId,
      delta: delta.content || '',
      content: record.accumulatedContent,
      index: record.chunkCount - 1,
      at: record.updatedAt
    });

    safeCallback(callbacks, 'onChunk', delta.content || '', record.accumulatedContent, {
      chunkCount: record.chunkCount,
      finishReason: record.finishReason
    });
    safeCallback(callbacks, 'onProgress', {
      streamId: record.streamId,
      chatId: record.chatId,
      chunkCount: record.chunkCount,
      charsReceived: record.accumulatedContent.length,
      elapsedMs: record.updatedAt - record.startedAt
    });
  }

  // ---------- completion / error / cancel ----------

  function finishStream(record, usage, callbacks) {
    if (record.status !== 'streaming' && record.status !== 'connecting') return record.result || null;
    record.status = 'completed';
    record.usage = normalizeUsageFallback(usage || record.pendingUsage);
    record.finishedAt = Date.now();
    record.updatedAt = record.finishedAt;

    var message = { role: 'assistant', content: record.accumulatedContent, at: record.finishedAt };
    if (record.toolCalls) message.toolCalls = record.toolCalls;

    // Write the finished reply into chat-manager.js's own shared
    // per-chatId history — the same store getHistory()/listChats()
    // read — so a streamed turn is indistinguishable from a
    // sendMessage() turn to any other reader of that history.
    var ci = chatInternal();
    if (ci && typeof ci.appendAssistantTurn === 'function') {
      ci.appendAssistantTurn(record.chatId, record.accumulatedContent, record.finishedAt);
    }

    recordUsageIfPossible(record.model, record.usage, record.requestId);

    var result = {
      chatId: record.chatId,
      streamId: record.streamId,
      requestId: record.requestId,
      model: record.model,
      message: message,
      usage: record.usage,
      finishReason: record.finishReason
    };
    record.result = result;

    busEmit('openrouter_stream_finished', Object.assign({ at: record.finishedAt }, result));
    safeCallback(callbacks, 'onComplete', result);
    settleDeferred(record, 'resolve', result);
    return result;
  }

  function finishWithError(record, err, callbacks) {
    if (record.status !== 'streaming' && record.status !== 'connecting') return record.error || null;
    record.status = 'error';
    // classify() (Part 2A's error-handler.js, via api-manager's
    // _internal) already logs and emits 'openrouter_error' on the
    // shared bus — this file doesn't duplicate that, same as
    // chat-manager.js's own sendMessage() failure path.
    record.error = classify(err, { op: 'streamMessage', chatId: record.chatId, streamId: record.streamId, requestId: record.requestId, model: record.model });
    record.updatedAt = Date.now();
    safeCallback(callbacks, 'onError', record.error);
    settleDeferred(record, 'reject', record.error);
    return record.error;
  }

  function cancelStream(streamId, reason) {
    var record = (isNonEmptyString(streamId) && streams[streamId]) ? streams[streamId] : null;
    if (!record) return false;
    if (record.status !== 'streaming' && record.status !== 'connecting') return false;

    record.status = 'cancelled';
    record.cancelReason = isNonEmptyString(reason) ? reason : 'user_cancelled';
    record.updatedAt = Date.now();
    if (record.idleTimerId) { try { global.clearTimeout(record.idleTimerId); } catch (e) { /* ignore */ } record.idleTimerId = null; }
    try { if (record.controller) record.controller.abort(); } catch (e) { /* ignore */ }
    try { if (record.reader && typeof record.reader.cancel === 'function') record.reader.cancel(); } catch (e2) { /* ignore */ }

    busEmit('openrouter_stream_cancelled', {
      chatId: record.chatId,
      streamId: record.streamId,
      requestId: record.requestId,
      reason: record.cancelReason,
      partialContent: record.accumulatedContent,
      at: record.updatedAt
    });
    safeCallback(record.callbacks, 'onCancel', { streamId: record.streamId, reason: record.cancelReason, partialContent: record.accumulatedContent });
    settleDeferred(record, 'reject', usageError('stream_cancelled', 'Stream "' + record.streamId + '" was cancelled.'));
    return true;
  }

  // ---------- the streaming engine itself ----------

  function readableSupported(res) {
    return !!(res && res.body && typeof res.body.getReader === 'function');
  }

  function resetIdleTimer(record, callbacks) {
    if (record.idleTimerId) { try { global.clearTimeout(record.idleTimerId); } catch (e) { /* ignore */ } }
    record.idleTimerId = global.setTimeout(function () {
      if (record.status !== 'streaming' && record.status !== 'connecting') return;
      try { if (record.controller) record.controller.abort(); } catch (e) { /* ignore */ }
      var err = new Error('OpenRouter stream idle timeout — no data received for ' + options.idleTimeoutMs + 'ms.');
      err.code = 'timeout';
      finishWithError(record, err, callbacks);
    }, options.idleTimeoutMs);
  }
  function clearIdleTimer(record) {
    if (record.idleTimerId) { try { global.clearTimeout(record.idleTimerId); } catch (e) { /* ignore */ } record.idleTimerId = null; }
  }

  function handleNonStreamingFallback(record, res, callbacks) {
    // A minority of fetch-compatible environments don't expose a
    // readable-stream response body even for an SSE request. Rather
    // than hard-failing purely for a platform reason, this degrades
    // to "await the full body, then deliver it as one chunk" so
    // onComplete/the resolved promise still behave correctly — only
    // the incremental onChunk/onProgress calls are skipped.
    return res.json().then(function (json) {
      var pr = parser();
      var normalized = pr && typeof pr.normalizeChatResponse === 'function' ? pr.normalizeChatResponse(json) : null;
      var choice = normalized ? normalized.choices[0] : (json && Array.isArray(json.choices) ? json.choices[0] : null);
      var content = (normalized && choice) ? choice.message.content : ((choice && choice.message && choice.message.content) || '');
      var finishReason = normalized && choice ? choice.finishReason : null;
      applyChunk(record, { content: content, finishReason: finishReason }, callbacks);
      // Pass the RAW usage block through — finishStream()'s
      // normalizeUsageFallback() expects to normalize an OpenAI-shaped
      // {prompt_tokens,...} block exactly once (see the matching note
      // in the streaming pump() above); `normalized.usage` has already
      // been through parser.normalizeUsage() once via
      // normalizeChatResponse() and would be double-normalized here.
      return finishStream(record, json && json.usage, callbacks);
    });
  }

  function runStream(record, payload, apiKey, callbacks) {
    if (typeof fetch !== 'function') {
      return Promise.resolve(finishWithError(record, new Error('fetch() is not available in this environment.'), callbacks));
    }
    var url = baseUrl() + CHAT_ENDPOINT_PATH;
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    record.controller = controller;

    resetIdleTimer(record, callbacks);

    return fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (record.status === 'cancelled') return record.result || null;
      clearIdleTimer(record);

      if (!res.ok) {
        return res.json().catch(function () { return null; }).then(function (body) {
          var pr = parser();
          var normErr = pr && typeof pr.normalizeErrorResponse === 'function' ? pr.normalizeErrorResponse(body, res.status) : null;
          var err = new Error((normErr && normErr.message) || (body && body.error && body.error.message) || ('OpenRouter stream request failed (HTTP ' + res.status + ').'));
          err.status = res.status;
          err.body = body;
          return finishWithError(record, err, callbacks);
        });
      }

      if (!readableSupported(res)) {
        return handleNonStreamingFallback(record, res, callbacks);
      }

      var reader = res.body.getReader();
      record.reader = reader;
      var buffer = '';

      // Re-arm the idle timer to also cover "waiting for the very
      // first chunk" — it was cleared just above once the response
      // headers arrived, and would otherwise stay off until the
      // first successful read() resolves.
      resetIdleTimer(record, callbacks);

      function pump() {
        return reader.read().then(function (result) {
          if (record.status === 'cancelled') return record.result || null;
          if (result.done) {
            clearIdleTimer(record);
            return finishStream(record, record.pendingUsage, callbacks);
          }
          resetIdleTimer(record, callbacks);
          buffer += decodeChunk(record, result.value);
          var lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';

          var pr = parser();
          for (var i = 0; i < lines.length; i++) {
            var parsed = pr && typeof pr.parseSSELine === 'function' ? pr.parseSSELine(lines[i]) : null;
            if (!parsed) continue;
            if (parsed.done) {
              clearIdleTimer(record);
              return finishStream(record, record.pendingUsage, callbacks);
            }
            if (parsed.json) {
              var chunk = pr && typeof pr.normalizeStreamChunk === 'function' ? pr.normalizeStreamChunk(parsed.json) : null;
              if (chunk) {
                if (isNonEmptyString(chunk.model) && !record.model) record.model = chunk.model;
                // Keep the RAW (un-normalized) usage block here, not
                // `chunk.usage` — that's already been through
                // parser.normalizeUsage() once, and normalizeUsageFallback()
                // below expects to normalize a raw OpenAI-shaped
                // {prompt_tokens,...} block exactly once, the same as
                // chat-manager.js's own sendMessage() does with a
                // non-streaming response's `json.usage`.
                if (parsed.json.usage) record.pendingUsage = parsed.json.usage;
                applyChunk(record, { content: chunk.delta.content, toolCalls: chunk.delta.toolCalls, finishReason: chunk.finishReason }, callbacks);
              }
            }
            if (record.status === 'cancelled') return record.result || null;
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      clearIdleTimer(record);
      if (record.status === 'cancelled') return record.result || null; // expected — cancelStream() already handled bookkeeping/events
      return finishWithError(record, err, callbacks);
    });
  }

  // ---------- public: start / resume ----------

  function streamMessage(chatId, content, callbacks, overrides) {
    callbacks = callbacks || {};
    var ci = chatInternal();
    if (!ci || typeof ci.getRawChat !== 'function' || typeof ci.buildPayload !== 'function' || typeof ci.appendUserTurn !== 'function') {
      return { streamId: null, promise: Promise.reject(usageError('core_not_loaded', 'os/api/openrouter/chat-manager.js (Part 2B-1, with its _internal surface) must be loaded before streamMessage() can be used.')) };
    }
    var chat = ci.getRawChat(chatId);
    if (!chat) {
      return { streamId: null, promise: Promise.reject(usageError('chat_not_found', 'No conversation with chatId "' + chatId + '". Call AxiomOpenRouter.chat.createChat() first.')) };
    }
    if (!isNonEmptyString(content)) {
      return { streamId: null, promise: Promise.reject(usageError('invalid_message', 'Message content must be a non-empty string.')) };
    }
    var internal = internalHelpers();
    if (!internal || typeof internal.getStoredKey !== 'function') {
      return { streamId: null, promise: Promise.reject(usageError('core_not_loaded', 'os/api/openrouter/api-manager.js must be loaded before streamMessage() can reach OpenRouter.')) };
    }
    var apiKey = internal.getStoredKey();
    if (!apiKey) {
      return { streamId: null, promise: Promise.reject(usageError('invalid_api_key', 'No OpenRouter API key stored. Call AxiomOpenRouter.setApiKey() first.')) };
    }

    var streamId = makeId('or_stream');
    var requestId = makeId('or_req');
    var startedAt = Date.now();

    // Append the user turn BEFORE building the request payload — same
    // ordering lesson chat-manager.js's own sendMessage() already
    // learned (see its Part 2B-1 validation report §5.3): this turn
    // must be part of the history it sends, and must be recorded as
    // sent regardless of whether the stream ever produces a reply.
    ci.appendUserTurn(chatId, content, startedAt);

    var built = ci.buildPayload(chat, overrides, true);

    var record = {
      streamId: streamId,
      chatId: chatId,
      requestId: requestId,
      model: built.model,
      status: 'streaming',
      accumulatedContent: '',
      chunkCount: 0,
      finishReason: null,
      usage: null,
      pendingUsage: null,
      toolCalls: null,
      startedAt: startedAt,
      updatedAt: startedAt,
      finishedAt: null,
      error: null,
      result: null,
      callbacks: callbacks,
      overrides: overrides || {}
    };
    streams[streamId] = record;
    streamOrder.push(streamId);

    record.deferred = makeDeferred();

    busEmit('openrouter_stream_started', { chatId: chatId, streamId: streamId, requestId: requestId, model: built.model, at: startedAt });

    runStream(record, built.payload, apiKey, callbacks);

    return { streamId: streamId, promise: record.deferred.promise };
  }

  function resumeStream(streamId, overrideCallbacks) {
    var record = (isNonEmptyString(streamId) && streams[streamId]) ? streams[streamId] : null;
    if (!record) return null;
    if (record.status !== 'cancelled' && record.status !== 'error') return null;

    var callbacks = overrideCallbacks || record.callbacks || {};

    var internal = internalHelpers();
    if (!internal || typeof internal.getStoredKey !== 'function') {
      return { streamId: streamId, promise: Promise.reject(usageError('core_not_loaded', 'os/api/openrouter/api-manager.js must be loaded before resumeStream() can reach OpenRouter.')) };
    }
    var apiKey = internal.getStoredKey();
    if (!apiKey) {
      return { streamId: streamId, promise: Promise.reject(usageError('invalid_api_key', 'No OpenRouter API key stored. Call AxiomOpenRouter.setApiKey() first.')) };
    }
    var ci = chatInternal();
    var chat = ci && typeof ci.getRawChat === 'function' ? ci.getRawChat(record.chatId) : null;
    if (!ci || !chat) {
      return { streamId: streamId, promise: Promise.reject(usageError('chat_not_found', 'Conversation "' + record.chatId + '" no longer exists; cannot resume stream "' + streamId + '".')) };
    }

    var built = ci.buildPayload(chat, record.overrides, true);

    record.requestId = makeId('or_req');
    record.status = 'streaming';
    record.error = null;
    record.callbacks = callbacks;
    record.updatedAt = Date.now();
    record.deferred = makeDeferred();
    // record.accumulatedContent / chunkCount / toolCalls are
    // deliberately NOT reset — see the file header's "A note on
    // resume": new deltas continue building onto whatever this
    // streamId had already gathered.

    busEmit('openrouter_stream_started', { chatId: record.chatId, streamId: record.streamId, requestId: record.requestId, model: built.model, at: record.updatedAt, resumed: true });

    runStream(record, built.payload, apiKey, callbacks);

    return { streamId: record.streamId, promise: record.deferred.promise };
  }

  function configure(overrides) {
    if (overrides && typeof overrides === 'object') {
      if (typeof overrides.idleTimeoutMs === 'number' && isFinite(overrides.idleTimeoutMs)) options.idleTimeoutMs = overrides.idleTimeoutMs;
    }
  }

  var StreamManager = {
    streamMessage: streamMessage,
    cancelStream: cancelStream,
    resumeStream: resumeStream,
    getStream: getStream,
    listStreams: listStreams,
    configure: configure
  };

  global.AxiomOpenRouter = global.AxiomOpenRouter || {};
  // Never clobber a sibling namespace another Part 2A/2B file may
  // have already attached — same "install onto existing global"
  // convention used throughout os/api/openrouter/*.
  global.AxiomOpenRouter.stream = StreamManager;
})(typeof window !== 'undefined' ? window : globalThis);
