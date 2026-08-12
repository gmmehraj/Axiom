// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2B-1: OpenRouter Chat Manager
// ------------------------------------------------------------
// Extends the Part 2A "Core Foundation" (api-manager.js,
// model-manager.js, token-manager.js, error-handler.js) with the
// piece Part 2A explicitly scoped out: an actual chat-completion
// request/response path with multi-turn conversation state, built
// entirely on top of that foundation's shared bus, key storage, HTTP
// helpers, and error classification. This file adds NO new
// infrastructure of its own — it is pure orchestration over what
// Part 2A already built:
//   - window.AxiomOpenRouter._internal.getStoredKey()   (BYOK key)
//   - window.AxiomOpenRouter._internal.withTimeout()    (abortable fetch)
//   - window.AxiomOpenRouter._internal.withRuntimeContext()
//     (optional AxiomRuntimeContext wrapping, feature-detected)
//   - window.AxiomOpenRouter._internal.classifyError()  (401/403/.../
//     network/timeout classification + 'openrouter_error' emit + log)
//   - window.AxiomOpenRouter.emit()                     (shared bus:
//     DOM CustomEvent + AxiomOrchestrator + Analytics forwarding,
//     already wired up by api-manager.js — this file never talks to
//     AxiomOrchestrator, AxLogger, or Analytics directly)
//   - window.AxiomOpenRouter.models.getDefaultModel()   (fallback
//     model when a conversation/call doesn't specify one)
//   - window.AxiomOpenRouter.tokens.recordUsage()        (rolls a
//     completed request's real usage.* into the existing token
//     accounting — feature-detected, never required)
//
// Relationship to the two other OpenRouter integrations already in
// this codebase (see OPENROUTER_PART2A_VALIDATION.md §1-2 for the
// full audit — summarized here since it governs every decision
// below):
//   - js/core/openrouter-client.js (untouched) is the chat-UI's
//     credit-billed, server-proxied client (Supabase Edge Functions
//     hold the real key). Not reused, not modified, not imported.
//   - os/api/openrouter/{api-manager,model-manager,token-manager,
//     error-handler}.js (Part 2A, untouched) is the BYOK foundation
//     this file extends.
// This file is a THIRD sibling in the os/api/openrouter/ family, not
// a rework of either — same BYOK, direct-to-OpenRouter design as its
// three siblings, same window.AxiomOpenRouter namespace, own
// sub-namespace (.chat) so it can never collide with .models/.tokens/
// .errors or with js/core/openrouter-client.js's window.OpenRouter.
//
// Scope note: no streaming here. OpenRouter's /chat/completions
// supports SSE streaming (model-manager.js's normalizeModel() even
// marks every model `capabilities.streaming: true`), but Part 2B-1's
// brief is Chat Completion + multi-turn conversation *state*
// management — request/response, not a stream reader/SSE parser.
// That composes naturally onto this same request builder in a later
// Part without changing anything below.
//
// Degrades gracefully, same convention as model-manager.js and
// token-manager.js: if api-manager.js hasn't loaded yet, conversation
// state management (createChat/getHistory/resetChat/etc.) still
// works fully in-memory; only sendMessage() — which needs the stored
// key, HTTP helpers, and error classification — rejects with a clear
// "core foundation not loaded" error instead of throwing.
//
// Public API — window.AxiomOpenRouter.chat:
//   createChat(options?)                  -> chat snapshot
//     options: { chatId?, model?, systemPrompt?, temperature?,
//                topP?, maxTokens?, stopSequences? }
//   getChat(chatId)                       -> chat snapshot | null
//   listChats()                           -> Array<chat summary>
//   getHistory(chatId)                    -> Array<message> | null
//   setSystemPrompt(chatId, prompt)       -> boolean
//   configureChat(chatId, patch)          -> chat snapshot | null
//     patch: { model?, temperature?, topP?, maxTokens?, stopSequences? }
//   sendMessage(chatId, content, overrides?)
//                                          -> Promise<{chatId, requestId,
//                                             message, usage}>
//     overrides: { model?, temperature?, topP?, maxTokens?,
//                  stopSequences? } — applies to this call only,
//                  does not mutate the conversation's saved params
//   resetChat(chatId, options?)           -> boolean
//     options: { clearSystemPrompt?: boolean } (default false —
//                keeps the system prompt, clears turns only)
//   deleteChat(chatId)                    -> boolean
//   configure(overrides)                  -> void (chatRequestTimeoutMs)
// Events (on the existing shared bus — window.AxiomOpenRouter.on()):
//   openrouter_request_started    {chatId, requestId, model, at}
//   openrouter_request_completed  {chatId, requestId, model, usage, at}
//   openrouter_chat_created       {chatId, model, at}
//   openrouter_chat_reset         {chatId, at}
// ============================================================
(function (global) {
  'use strict';

  var CHAT_ENDPOINT_PATH = '/chat/completions';
  var FALLBACK_BASE_URL = 'https://openrouter.ai/api/v1';
  var FALLBACK_DEFAULT_MODEL = 'openai/gpt-4o-mini'; // mirrors model-manager.js's own fallback, kept in sync deliberately
  var MAX_STOP_SEQUENCES = 4; // OpenRouter/OpenAI-compatible limit

  var options = {
    chatRequestTimeoutMs: 60000 // chat completions can legitimately run longer than the 15s default used for key/model lookups
  };

  var chats = Object.create(null); // chatId -> chat record
  var chatOrder = []; // insertion order, for listChats()
  var idSeq = 0;

  // ---------- id generation ----------
  // Reuses the shared os/shared/id-factory.js generator when present
  // (window.AxiomMakeSeqId), same as executive-ai.js/automation-
  // engine.js/etc. already do; falls back to a private counter with
  // the same shape as runtime-context.js's makeId() otherwise, so
  // this file has no hard dependency on load order for id-factory.js.
  var uidCache = Object.create(null);
  function makeId(prefix) {
    if (typeof global.AxiomMakeSeqId === 'function') {
      if (!uidCache[prefix]) uidCache[prefix] = global.AxiomMakeSeqId(prefix);
      return uidCache[prefix]();
    }
    idSeq += 1;
    return prefix + '_' + Date.now().toString(36) + '_' + idSeq.toString(36);
  }

  // ---------- small guards ----------
  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
  function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function normalizeStopSequences(v) {
    if (v === null || v === undefined) return null;
    var arr = Array.isArray(v) ? v : [v];
    var cleaned = arr.filter(isNonEmptyString).slice(0, MAX_STOP_SEQUENCES);
    return cleaned.length ? cleaned : null;
  }

  // ---------- shared-bus helpers (all feature-detected — see header) ----------

  function api() { return global.AxiomOpenRouter; }

  function busEmit(event, payload) {
    try {
      var a = api();
      if (a && typeof a.emit === 'function') a.emit(event, payload);
    } catch (e) { /* bus not installed — no-op, same convention as model-manager.js */ }
  }

  function internalHelpers() {
    var a = api();
    return (a && a._internal) ? a._internal : null;
  }

  function baseUrl() {
    var internal = internalHelpers();
    return (internal && internal.BASE_URL) || FALLBACK_BASE_URL;
  }

  function defaultModel() {
    try {
      var a = api();
      if (a && a.models && typeof a.models.getDefaultModel === 'function') {
        return a.models.getDefaultModel();
      }
    } catch (e) { /* fall through */ }
    return FALLBACK_DEFAULT_MODEL;
  }

  function recordUsageIfPossible(modelId, usage, requestId) {
    try {
      var a = api();
      if (a && a.tokens && typeof a.tokens.recordUsage === 'function') {
        return a.tokens.recordUsage({
          model: modelId,
          promptTokens: usage && usage.prompt_tokens,
          completionTokens: usage && usage.completion_tokens,
          requestId: requestId
        });
      }
    } catch (e) { /* tokens.js not loaded, or recordUsage threw — never let accounting break a chat reply */ }
    return null;
  }

  function classify(err, context) {
    var internal = internalHelpers();
    if (internal && typeof internal.classifyError === 'function') {
      return internal.classifyError(err, context);
    }
    // Core Foundation not loaded — minimal inline fallback, same
    // shape as api-manager.js's own degrade-without-error-handler
    // path, so callers get a consistent object either way.
    return { code: 'unknown', status: (err && err.status) || null, message: (err && err.message) || String(err), retryable: false, at: Date.now(), raw: err || null };
  }

  function usageError(code, message) {
    var err = new Error(message);
    err.code = code;
    err.retryable = false;
    return err;
  }

  // ---------- conversation state ----------

  function snapshotChat(chat) {
    return {
      chatId: chat.chatId,
      model: chat.model,
      systemPrompt: chat.systemPrompt,
      temperature: chat.temperature,
      topP: chat.topP,
      maxTokens: chat.maxTokens,
      stopSequences: chat.stopSequences ? chat.stopSequences.slice() : null,
      messages: chat.messages.map(function (m) { return { role: m.role, content: m.content, at: m.at }; }),
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt
    };
  }

  function requireChat(chatId) {
    return (isNonEmptyString(chatId) && chats[chatId]) ? chats[chatId] : null;
  }

  /**
   * Starts a new, independent multi-turn conversation. Multiple
   * chats coexist freely — each is keyed by its own chatId and holds
   * its own history/model/params, with no shared mutable state
   * between them (verified in the regression suite, section 5).
   */
  function createChat(createOptions) {
    createOptions = createOptions || {};
    var chatId = isNonEmptyString(createOptions.chatId) ? createOptions.chatId : makeId('chat');
    if (chats[chatId]) {
      // Never silently clobber an existing conversation's history —
      // caller asked for a specific id that's already in use.
      return null;
    }
    var now = Date.now();
    var chat = {
      chatId: chatId,
      model: isNonEmptyString(createOptions.model) ? createOptions.model : null,
      systemPrompt: isNonEmptyString(createOptions.systemPrompt) ? createOptions.systemPrompt : null,
      temperature: isFiniteNumber(createOptions.temperature) ? createOptions.temperature : null,
      topP: isFiniteNumber(createOptions.topP) ? createOptions.topP : null,
      maxTokens: isFiniteNumber(createOptions.maxTokens) ? createOptions.maxTokens : null,
      stopSequences: normalizeStopSequences(createOptions.stopSequences),
      messages: [],
      createdAt: now,
      updatedAt: now
    };
    chats[chatId] = chat;
    chatOrder.push(chatId);
    busEmit('openrouter_chat_created', { chatId: chatId, model: chat.model || defaultModel(), at: now });
    return snapshotChat(chat);
  }

  function getChat(chatId) {
    var chat = requireChat(chatId);
    return chat ? snapshotChat(chat) : null;
  }

  function listChats() {
    return chatOrder.filter(function (id) { return !!chats[id]; }).map(function (id) {
      var c = chats[id];
      return {
        chatId: c.chatId,
        model: c.model,
        messageCount: c.messages.length,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt
      };
    });
  }

  function getHistory(chatId) {
    var chat = requireChat(chatId);
    if (!chat) return null;
    return chat.messages.map(function (m) { return { role: m.role, content: m.content, at: m.at }; });
  }

  function setSystemPrompt(chatId, prompt) {
    var chat = requireChat(chatId);
    if (!chat) return false;
    chat.systemPrompt = isNonEmptyString(prompt) ? prompt : null;
    chat.updatedAt = Date.now();
    return true;
  }

  function configureChat(chatId, patch) {
    var chat = requireChat(chatId);
    if (!chat || !isPlainObject(patch)) return null;
    if (isNonEmptyString(patch.model)) chat.model = patch.model;
    if (isFiniteNumber(patch.temperature)) chat.temperature = patch.temperature;
    if (isFiniteNumber(patch.topP)) chat.topP = patch.topP;
    if (isFiniteNumber(patch.maxTokens)) chat.maxTokens = patch.maxTokens;
    if (patch.stopSequences !== undefined) chat.stopSequences = normalizeStopSequences(patch.stopSequences);
    if (isNonEmptyString(patch.systemPrompt)) chat.systemPrompt = patch.systemPrompt;
    chat.updatedAt = Date.now();
    return snapshotChat(chat);
  }

  /**
   * Clears a conversation's turn history so the next sendMessage()
   * starts fresh, without needing a new chatId. The system prompt
   * (and saved model/params) survive a reset by default, matching
   * "reset the conversation, not the configuration" — pass
   * { clearSystemPrompt: true } to drop it too.
   */
  function resetChat(chatId, resetOptions) {
    var chat = requireChat(chatId);
    if (!chat) return false;
    resetOptions = resetOptions || {};
    chat.messages = [];
    if (resetOptions.clearSystemPrompt) chat.systemPrompt = null;
    chat.updatedAt = Date.now();
    busEmit('openrouter_chat_reset', { chatId: chatId, at: chat.updatedAt });
    return true;
  }

  function deleteChat(chatId) {
    if (!requireChat(chatId)) return false;
    delete chats[chatId];
    var idx = chatOrder.indexOf(chatId);
    if (idx !== -1) chatOrder.splice(idx, 1);
    return true;
  }

  // ---------- HTTP: chat completion ----------

  function buildPayload(chat, overrides, streamFlag) {
    overrides = overrides || {};
    var model = isNonEmptyString(overrides.model) ? overrides.model : (chat.model || defaultModel());

    var messages = [];
    if (chat.systemPrompt) messages.push({ role: 'system', content: chat.systemPrompt });
    chat.messages.forEach(function (m) { messages.push({ role: m.role, content: m.content }); });

    // streamFlag is a new, optional third parameter (Part 2B-2) —
    // every existing call site below still calls buildPayload(chat,
    // overrides) with two arguments, so streamFlag is undefined there
    // and !!undefined === false, i.e. byte-for-byte the same
    // `stream: false` this function has always produced. Only
    // stream-manager.js (via _internal.buildPayload below) passes
    // `true`.
    var payload = { model: model, messages: messages, stream: !!streamFlag };

    var temperature = isFiniteNumber(overrides.temperature) ? overrides.temperature : chat.temperature;
    if (isFiniteNumber(temperature)) payload.temperature = temperature;

    var topP = isFiniteNumber(overrides.topP) ? overrides.topP : chat.topP;
    if (isFiniteNumber(topP)) payload.top_p = topP;

    var maxTokens = isFiniteNumber(overrides.maxTokens) ? overrides.maxTokens : chat.maxTokens;
    if (isFiniteNumber(maxTokens)) payload.max_tokens = maxTokens;

    var stop = overrides.stopSequences !== undefined ? normalizeStopSequences(overrides.stopSequences) : chat.stopSequences;
    if (stop) payload.stop = stop;

    return { model: model, payload: payload };
  }

  function doChatRequest(apiKey, payload) {
    if (typeof fetch !== 'function') {
      return Promise.reject(new Error('fetch() is not available in this environment.'));
    }
    var internal = internalHelpers();
    var url = baseUrl() + CHAT_ENDPOINT_PATH;
    var timeoutMs = options.chatRequestTimeoutMs;

    var doRequest = function () {
      return (internal && typeof internal.withTimeout === 'function')
        ? internal.withTimeout(function (signal) {
            return fetch(url, {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: signal
            });
          }, timeoutMs)
        : fetch(url, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
    };

    var runner = (internal && typeof internal.withRuntimeContext === 'function')
      ? function () { return internal.withRuntimeContext('chat-completion', doRequest); }
      : doRequest;

    return runner().then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return null; }).then(function (body) {
          var err = new Error((body && body.error && body.error.message) || ('OpenRouter chat completion failed (HTTP ' + res.status + ').'));
          err.status = res.status;
          err.body = body;
          throw err;
        });
      }
      return res.json();
    });
  }

  /**
   * Sends `content` as the next user turn in an existing
   * conversation, calls OpenRouter's chat-completions endpoint with
   * the full running history (+ system prompt + saved params, with
   * optional one-off overrides), appends the assistant's reply to
   * that conversation's history, and resolves with it.
   *
   * `overrides` apply to this single call only — they never mutate
   * the conversation's saved model/temperature/topP/maxTokens/
   * stopSequences (use configureChat() for that).
   */
  function sendMessage(chatId, content, overrides) {
    var chat = requireChat(chatId);
    if (!chat) return Promise.reject(usageError('chat_not_found', 'No conversation with chatId "' + chatId + '". Call createChat() first.'));
    if (!isNonEmptyString(content)) return Promise.reject(usageError('invalid_message', 'Message content must be a non-empty string.'));

    var internal = internalHelpers();
    if (!internal || typeof internal.getStoredKey !== 'function') {
      return Promise.reject(usageError('core_not_loaded', 'os/api/openrouter/api-manager.js must be loaded before sendMessage() can reach OpenRouter.'));
    }
    var apiKey = internal.getStoredKey();
    if (!apiKey) {
      return Promise.reject(usageError('invalid_api_key', 'No OpenRouter API key stored. Call AxiomOpenRouter.setApiKey() first.'));
    }

    var requestId = makeId('or_req');
    var startedAt = Date.now();

    // Append the user turn BEFORE building the request payload, so
    // this turn is part of the history it sends — and so it's
    // genuinely recorded as sent regardless of whether the reply
    // succeeds: a retry (a fresh sendMessage() call) continues the
    // real conversation rather than silently resending a "lost" one.
    chat.messages.push({ role: 'user', content: content, at: startedAt });
    chat.updatedAt = startedAt;

    var built = buildPayload(chat, overrides);

    busEmit('openrouter_request_started', { chatId: chatId, requestId: requestId, model: built.model, at: startedAt });

    return doChatRequest(apiKey, built.payload).then(
      function (json) {
        var choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
        var assistantContent = (choice && choice.message && typeof choice.message.content === 'string') ? choice.message.content : '';
        var finishedAt = Date.now();
        var assistantMessage = { role: 'assistant', content: assistantContent, at: finishedAt };
        chat.messages.push(assistantMessage);
        chat.updatedAt = finishedAt;

        var rawUsage = json && json.usage;
        recordUsageIfPossible(built.model, rawUsage, requestId);
        var usage = {
          promptTokens: (rawUsage && rawUsage.prompt_tokens) || 0,
          completionTokens: (rawUsage && rawUsage.completion_tokens) || 0,
          totalTokens: (rawUsage && rawUsage.total_tokens) || (((rawUsage && rawUsage.prompt_tokens) || 0) + ((rawUsage && rawUsage.completion_tokens) || 0))
        };

        busEmit('openrouter_request_completed', { chatId: chatId, requestId: requestId, model: built.model, usage: usage, at: finishedAt });
        return { chatId: chatId, requestId: requestId, message: assistantMessage, usage: usage };
      },
      function (err) {
        // classify() (Part 2A's error-handler.js, via api-manager's
        // _internal) already logs and emits 'openrouter_error' on the
        // shared bus — this file doesn't duplicate that, same as
        // api-manager.js's own checkHealth()/setApiKey() failure paths.
        var classified = classify(err, { op: 'sendMessage', chatId: chatId, requestId: requestId, model: built.model });
        throw classified;
      }
    );
  }

  function configure(overrides) {
    if (overrides && typeof overrides === 'object') {
      if (isFiniteNumber(overrides.chatRequestTimeoutMs)) options.chatRequestTimeoutMs = overrides.chatRequestTimeoutMs;
    }
  }

  var ChatManager = {
    createChat: createChat,
    getChat: getChat,
    listChats: listChats,
    getHistory: getHistory,
    setSystemPrompt: setSystemPrompt,
    configureChat: configureChat,
    sendMessage: sendMessage,
    resetChat: resetChat,
    deleteChat: deleteChat,
    configure: configure
  };

  // ---------- internal helpers exposed for sibling Part 2B-2 file only ----------
  // Mirrors api-manager.js's own `_internal` convention (see its
  // header): NOT part of the documented public contract above (every
  // function in `ChatManager` is unchanged from Part 2B-1), but
  // required so stream-manager.js can reuse this file's exact
  // message-array/param-shaping logic and shared per-chatId history
  // instead of a second, divergent implementation. chat-manager.js's
  // own public sendMessage()/createChat()/etc. behavior above is
  // 100% unmodified by this addition.
  var ChatManagerInternal = {
    getRawChat: requireChat,
    buildPayload: buildPayload,
    appendUserTurn: function (chatId, content, at) {
      var chat = requireChat(chatId);
      if (!chat) return null;
      var ts = isFiniteNumber(at) ? at : Date.now();
      var msg = { role: 'user', content: content, at: ts };
      chat.messages.push(msg);
      chat.updatedAt = ts;
      return msg;
    },
    appendAssistantTurn: function (chatId, content, at) {
      var chat = requireChat(chatId);
      if (!chat) return null;
      var ts = isFiniteNumber(at) ? at : Date.now();
      var msg = { role: 'assistant', content: content, at: ts };
      chat.messages.push(msg);
      chat.updatedAt = ts;
      return msg;
    }
  };
  ChatManager._internal = ChatManagerInternal;

  global.AxiomOpenRouter = global.AxiomOpenRouter || {};
  // Never clobber a sibling Part 2A/2B namespace that may already be
  // installed — same "install onto existing global" convention used
  // by error-handler.js/model-manager.js/token-manager.js.
  global.AxiomOpenRouter.chat = ChatManager;
})(typeof window !== 'undefined' ? window : globalThis);
