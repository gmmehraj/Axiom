// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2B-2: OpenRouter Response Parser
// ------------------------------------------------------------
// Pure, side-effect-free normalization shared by stream-manager.js
// (and available to chat-manager.js / any future caller) for turning
// OpenRouter/OpenAI-compatible response shapes — full chat-completion
// bodies, individual SSE streaming chunks, raw SSE lines, usage
// blocks, finish reasons, tool-call deltas, and error bodies — into
// one stable internal shape.
//
// Makes NO network calls, holds NO state, and does not require any
// other os/api/openrouter/* file to be loaded first — same standalone
// convention as error-handler.js. Nothing in this file talks to the
// shared bus, localStorage, or fetch(); it only transforms JS values
// already in hand.
//
// Distinct from error-handler.js's classify()/handle(): that module
// classifies a JS Error / fetch Response / thrown value into a
// retryable-or-not verdict for the *transport* failure. This module's
// normalizeErrorResponse() only reshapes the JSON *body* OpenRouter
// sends back on a non-2xx response into a stable shape. Callers
// (stream-manager.js, chat-manager.js) still run the resulting Error
// through error-handler.js's classify() for the retryable verdict —
// this file is not a replacement for that and does not duplicate it.
//
// Public API — window.AxiomOpenRouter.parser:
//   normalizeChatResponse(json)        -> {id, model, choices, usage, raw}
//   normalizeStreamChunk(json)         -> {id, model, index, delta, finishReason, usage, raw} | null
//   parseSSELine(line)                 -> {done:true} | {json, raw} | null
//   normalizeUsage(usage)              -> {promptTokens, completionTokens, totalTokens}
//   normalizeFinishReason(reason)      -> stable string | null
//   normalizeToolCalls(toolCalls)      -> Array<{index,id,type,function}> | null
//   normalizeMessage(message)          -> {role, content, toolCalls?}
//   normalizeErrorResponse(body,status)-> {status, code, type, message, param, raw}
// ============================================================
(function (global) {
  'use strict';

  // OpenAI/OpenRouter finish_reason values, mapped to themselves plus
  // the one legacy alias (`function_call`, from the pre-`tool_calls`
  // API generation) some providers routed through OpenRouter still
  // emit — normalized to the modern `tool_calls` code so callers only
  // ever have to branch on one spelling.
  var FINISH_REASON_ALIASES = {
    function_call: 'tool_calls'
  };

  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  /**
   * Maps a raw `finish_reason` string to a stable code. Unrecognized
   * values pass through unchanged (rather than collapsing to a lossy
   * "unknown") so a caller inspecting a new provider-specific reason
   * still sees exactly what OpenRouter sent.
   */
  function normalizeFinishReason(reason) {
    if (!isNonEmptyString(reason)) return null;
    return FINISH_REASON_ALIASES[reason] || reason;
  }

  /**
   * Normalizes an OpenAI/OpenRouter `usage` block. Missing/non-number
   * fields default to 0, matching chat-manager.js's own existing
   * `sendMessage()` usage-shaping convention (never NaN/undefined).
   */
  function normalizeUsage(usage) {
    var u = usage || {};
    var prompt = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : 0;
    var completion = typeof u.completion_tokens === 'number' ? u.completion_tokens : 0;
    var total = typeof u.total_tokens === 'number' ? u.total_tokens : (prompt + completion);
    return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
  }

  /**
   * Normalizes a `tool_calls` array (present on a full message, or on
   * one streaming delta). Streaming deltas often carry a partial
   * `function.arguments` fragment and omit `id`/`type`/`name` on
   * later chunks — this function normalizes shape only, one call's
   * worth at a time; accumulating fragments across multiple chunks
   * into one final call is a stateful, per-stream concern left to the
   * caller (stream-manager.js does this — see its mergeToolCalls()).
   */
  function normalizeToolCalls(toolCalls) {
    if (!Array.isArray(toolCalls) || !toolCalls.length) return null;
    return toolCalls.map(function (tc, i) {
      tc = tc || {};
      var fn = tc.function || {};
      return {
        index: typeof tc.index === 'number' ? tc.index : i,
        id: tc.id || null,
        type: tc.type || 'function',
        function: {
          name: typeof fn.name === 'string' ? fn.name : '',
          arguments: typeof fn.arguments === 'string' ? fn.arguments : ''
        }
      };
    });
  }

  /**
   * Normalizes one full `message` object (from a non-streaming
   * response's `choices[i].message`).
   */
  function normalizeMessage(message) {
    message = message || {};
    var out = {
      role: message.role || 'assistant',
      content: typeof message.content === 'string' ? message.content : ''
    };
    var toolCalls = normalizeToolCalls(message.tool_calls);
    if (toolCalls) out.toolCalls = toolCalls;
    return out;
  }

  /**
   * Normalizes a full, non-streaming `POST /chat/completions`
   * response body into a stable shape. Safe on a malformed/partial
   * body — every field degrades to an empty/neutral default rather
   * than throwing, since a caller normalizing a response is usually
   * already inside an error/edge-case path.
   */
  function normalizeChatResponse(json) {
    json = json || {};
    var choices = Array.isArray(json.choices) ? json.choices : [];
    return {
      id: json.id || null,
      model: json.model || null,
      choices: choices.map(function (c, i) {
        c = c || {};
        return {
          index: typeof c.index === 'number' ? c.index : i,
          message: normalizeMessage(c.message),
          finishReason: normalizeFinishReason(c.finish_reason)
        };
      }),
      usage: normalizeUsage(json.usage),
      raw: json
    };
  }

  /**
   * Normalizes one already-JSON-parsed streaming chunk object (the
   * payload of one `data: {...}` SSE line from `POST
   * /chat/completions` with `stream: true`) into a stable shape.
   * Returns null for a non-object input (caller's parseSSELine()
   * already isolated the JSON.parse failure case as `json: null`
   * before this ever runs).
   */
  function normalizeStreamChunk(json) {
    if (!isPlainObject(json)) return null;
    var choice = Array.isArray(json.choices) ? json.choices[0] : null;
    var delta = (choice && choice.delta) || {};
    return {
      id: json.id || null,
      model: json.model || null,
      index: (choice && typeof choice.index === 'number') ? choice.index : 0,
      delta: {
        role: delta.role || null,
        content: typeof delta.content === 'string' ? delta.content : null,
        toolCalls: normalizeToolCalls(delta.tool_calls)
      },
      finishReason: normalizeFinishReason(choice && choice.finish_reason),
      // Most providers only attach `usage` (when requested via
      // `stream_options: {include_usage: true}`) on the final chunk;
      // normalized here too so a caller doesn't need a second parser
      // just for that one chunk.
      usage: json.usage ? normalizeUsage(json.usage) : null,
      raw: json
    };
  }

  /**
   * Parses one raw line of an SSE ("text/event-stream") response
   * body. Returns:
   *  - null for a line that carries no usable event data: a blank
   *    line, an SSE comment/keep-alive line (starts with ":"), or a
   *    non-"data:" field ("event:"/"id:"/"retry:") — OpenRouter's
   *    chat-completions stream only ever needs the "data:" field.
   *  - {done: true} for the terminal "data: [DONE]" sentinel.
   *  - {json: object, raw: string} for a well-formed "data: {...}"
   *    line.
   *  - {json: null, raw: string, parseError: string} for a
   *    "data: ..." line whose payload fails JSON.parse — returned
   *    rather than thrown, so one malformed chunk never kills an
   *    otherwise-healthy stream; the caller decides whether to skip
   *    it or surface it.
   */
  function parseSSELine(line) {
    if (typeof line !== 'string') return null;
    var trimmed = line.trim();
    if (!trimmed || trimmed.indexOf(':') === 0) return null;
    if (trimmed.indexOf('data:') !== 0) return null;
    var dataStr = trimmed.slice(5).trim();
    if (dataStr === '[DONE]') return { done: true };
    try {
      return { json: JSON.parse(dataStr), raw: dataStr };
    } catch (e) {
      return { json: null, raw: dataStr, parseError: e && e.message };
    }
  }

  /**
   * Normalizes an OpenRouter/OpenAI-shaped error response body
   * (`{error: {message, type, code, param}}`, or occasionally
   * `{error: "some string"}`) into a stable shape. Pure reshaping —
   * see the file header for how this differs from and complements
   * error-handler.js's classify()/handle().
   */
  function normalizeErrorResponse(body, status) {
    var raw = (body && body.error) || {};
    var message = (typeof raw === 'string' ? raw : raw.message) || 'OpenRouter request failed.';
    return {
      status: typeof status === 'number' ? status : null,
      code: (typeof raw === 'object' && raw.code) || null,
      type: (typeof raw === 'object' && raw.type) || null,
      message: message,
      param: (typeof raw === 'object' && raw.param) || null,
      raw: body || null
    };
  }

  var ResponseParser = {
    normalizeChatResponse: normalizeChatResponse,
    normalizeStreamChunk: normalizeStreamChunk,
    parseSSELine: parseSSELine,
    normalizeUsage: normalizeUsage,
    normalizeFinishReason: normalizeFinishReason,
    normalizeToolCalls: normalizeToolCalls,
    normalizeMessage: normalizeMessage,
    normalizeErrorResponse: normalizeErrorResponse
  };

  global.AxiomOpenRouter = global.AxiomOpenRouter || {};
  // Never clobber a sibling namespace another Part 2A/2B file may
  // have already attached — same "install onto existing global"
  // convention used throughout os/api/openrouter/*.
  global.AxiomOpenRouter.parser = ResponseParser;
})(typeof window !== 'undefined' ? window : globalThis);
