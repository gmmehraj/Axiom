// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2A: OpenRouter Core Foundation
// Token Manager
// ------------------------------------------------------------
// Tracks prompt/completion/total token usage per request and per
// model, and estimates USD cost using the pricing metadata
// model-manager.js caches from OpenRouter's /models endpoint. Holds
// only in-memory, session-scoped counters — no persistence, no
// network calls, no dependency on any other Part 2A file being
// loaded (getPricing() is feature-detected so cost estimation simply
// returns null, not a throw, if model-manager.js isn't present).
//
// A note on countPromptTokens(): this ships a plain, documented
// character-based approximation (chars / 4, the commonly-cited rule
// of thumb for English text through BPE tokenizers), not a real
// tokenizer. This project has no bundler/build step and no vetted
// tokenizer dependency already in the codebase to wrap, so an exact
// count is out of scope for Part 2A — OpenRouter's own response
// always includes the authoritative usage.prompt_tokens /
// usage.completion_tokens, and recordUsage() is built to take those
// real numbers, not the estimate. countPromptTokens() exists only for
// pre-flight estimates (e.g. "will this fit in the context window?")
// before a request is actually sent.
//
// Public API — window.AxiomOpenRouter.tokens:
//   countPromptTokens(text)                        -> number (approximation)
//   recordUsage({model, promptTokens, completionTokens, requestId?})
//                                                   -> usage record
//   getUsageStats(modelId?)                         -> totals (global, or scoped to one model)
//   estimateCost(modelId, promptTokens, completionTokens) -> number | null (USD)
//   resetStats()                                    -> void
// ============================================================
(function (global) {
  'use strict';

  var CHARS_PER_TOKEN_ESTIMATE = 4; // documented rule-of-thumb approximation, see header note

  var totals = { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0, costUsd: 0 };
  var byModel = Object.create(null); // modelId -> same shape as `totals`
  var history = []; // bounded ring buffer of individual recordUsage() calls
  var HISTORY_LIMIT = 500;

  function safeLog(level, message) {
    try {
      if (global.AxLogger && typeof global.AxLogger[level] === 'function') { global.AxLogger[level]('[AxiomOpenRouter:tokens] ' + message); return; }
    } catch (e) { /* fall through */ }
    try { if (global.console && typeof global.console[level] === 'function') global.console[level]('[AxiomOpenRouter:tokens] ' + message); } catch (e2) { /* ignore */ }
  }

  function emptyBucket() {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0, costUsd: 0 };
  }

  /**
   * Rough token estimate for plain text. Not exact — see header note.
   * @param {string} text
   * @returns {number}
   */
  function countPromptTokens(text) {
    if (typeof text !== 'string' || !text.length) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
  }

  /**
   * Looks up per-token pricing via model-manager.js (if loaded) and
   * multiplies by the given token counts. Returns null — never
   * throws, never returns 0 as a stand-in for "unknown" — when
   * pricing can't be determined, so callers can distinguish "$0"
   * from "we don't know."
   */
  function estimateCost(modelId, promptTokens, completionTokens) {
    try {
      var models = global.AxiomOpenRouter && global.AxiomOpenRouter.models;
      if (!models || typeof models.getPricing !== 'function') return null;
      var pricing = models.getPricing(modelId);
      if (!pricing || pricing.prompt === null || pricing.completion === null) return null;
      var p = (Number(promptTokens) || 0) * pricing.prompt;
      var c = (Number(completionTokens) || 0) * pricing.completion;
      return p + c;
    } catch (e) {
      return null;
    }
  }

  function addToBucket(bucket, promptTokens, completionTokens, cost) {
    bucket.promptTokens += promptTokens;
    bucket.completionTokens += completionTokens;
    bucket.totalTokens += promptTokens + completionTokens;
    bucket.requests += 1;
    if (typeof cost === 'number' && isFinite(cost)) bucket.costUsd += cost;
  }

  /**
   * Records a completed request's real token usage (as reported by
   * OpenRouter, e.g. response.usage.{prompt_tokens,completion_tokens})
   * and rolls it into the global + per-model running totals.
   * @param {{model:string, promptTokens:number, completionTokens:number, requestId?:string}} usage
   * @returns {{model:string, promptTokens:number, completionTokens:number, totalTokens:number, costUsd:?number, requestId:?string, at:number}}
   */
  function recordUsage(usage) {
    usage = usage || {};
    var modelId = usage.model || 'unknown';
    var promptTokens = Number(usage.promptTokens) || 0;
    var completionTokens = Number(usage.completionTokens) || 0;
    var cost = estimateCost(modelId, promptTokens, completionTokens);

    addToBucket(totals, promptTokens, completionTokens, cost);
    if (!byModel[modelId]) byModel[modelId] = emptyBucket();
    addToBucket(byModel[modelId], promptTokens, completionTokens, cost);

    var record = {
      model: modelId,
      promptTokens: promptTokens,
      completionTokens: completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd: cost,
      requestId: usage.requestId || null,
      at: Date.now()
    };
    history.push(record);
    if (history.length > HISTORY_LIMIT) history.shift();

    safeLog('log', 'recorded ' + record.totalTokens + ' tokens for ' + modelId + (cost !== null ? ' ($' + cost.toFixed(6) + ')' : ''));
    return record;
  }

  /**
   * @param {string} [modelId] - when given, returns just that model's
   *   totals (or a zeroed bucket if nothing has been recorded for it
   *   yet); omitted, returns the global totals across every model.
   */
  function getUsageStats(modelId) {
    if (modelId) {
      var bucket = byModel[modelId] || emptyBucket();
      return Object.assign({ model: modelId }, bucket);
    }
    return Object.assign({ models: Object.keys(byModel).length }, totals);
  }

  function getHistory(limit) {
    var n = typeof limit === 'number' && limit > 0 ? limit : history.length;
    return history.slice(Math.max(0, history.length - n));
  }

  function resetStats() {
    totals = emptyBucket();
    byModel = Object.create(null);
    history = [];
  }

  var TokenManager = {
    countPromptTokens: countPromptTokens,
    recordUsage: recordUsage,
    getUsageStats: getUsageStats,
    getHistory: getHistory,
    estimateCost: estimateCost,
    resetStats: resetStats
  };

  global.AxiomOpenRouter = global.AxiomOpenRouter || {};
  global.AxiomOpenRouter.tokens = TokenManager;
})(typeof window !== 'undefined' ? window : globalThis);
