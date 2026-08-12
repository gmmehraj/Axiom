// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2A: OpenRouter Core Foundation
// Error Handler
// ------------------------------------------------------------
// Pure, side-effect-light error classification shared by every
// OpenRouter Core Foundation module (api-manager.js, model-manager.js,
// token-manager.js). This is the single place "what kind of failure
// was this, and is it worth retrying?" gets decided, so the other
// three files never have to duplicate status-code/regex sniffing.
//
// Does not make network calls, hold connection state, or require any
// other os/api/openrouter/* file to be loaded first. The other three
// files call into this one; this file never calls into them, except
// to (optionally, feature-detected) emit onto the shared
// window.AxiomOpenRouter bus that api-manager.js installs, and to log
// through the existing os/shared/logger.js (window.AxLogger) exactly
// like js/core/supabase/connection-manager.js already does.
//
// Handles, per Part 2A spec:
//   401, 403, 404, 408, 429, 500, 502, 503, 504,
//   timeout (AbortError), network errors, invalid API key,
//   model unavailable.
//
// Public API — window.AxiomOpenRouter.errors:
//   CODES                          -> map of stable string codes
//   classify(input)                -> classified error object (pure)
//   handle(input, context)         -> classify() + log + emit 'openrouter_error'
//   isRetryable(codeOrClassified)  -> boolean
// ============================================================
(function (global) {
  'use strict';

  var CODES = {
    INVALID_API_KEY: 'invalid_api_key',
    FORBIDDEN: 'forbidden',
    NOT_FOUND: 'not_found',
    MODEL_UNAVAILABLE: 'model_unavailable',
    REQUEST_TIMEOUT: 'request_timeout',
    RATE_LIMITED: 'rate_limited',
    SERVER_ERROR: 'server_error',
    BAD_GATEWAY: 'bad_gateway',
    SERVICE_UNAVAILABLE: 'service_unavailable',
    GATEWAY_TIMEOUT: 'gateway_timeout',
    NETWORK_ERROR: 'network_error',
    TIMEOUT: 'timeout',
    UNKNOWN: 'unknown'
  };

  // HTTP status -> stable code. 401 maps to INVALID_API_KEY (not a
  // generic "unauthorized") because for a single-key BYOK client, a
  // 401 from OpenRouter always means the stored key itself is bad.
  var STATUS_TO_CODE = {
    401: CODES.INVALID_API_KEY,
    403: CODES.FORBIDDEN,
    404: CODES.NOT_FOUND,
    408: CODES.REQUEST_TIMEOUT,
    429: CODES.RATE_LIMITED,
    500: CODES.SERVER_ERROR,
    502: CODES.BAD_GATEWAY,
    503: CODES.SERVICE_UNAVAILABLE,
    504: CODES.GATEWAY_TIMEOUT
  };

  var RETRYABLE = {};
  RETRYABLE[CODES.REQUEST_TIMEOUT] = true;
  RETRYABLE[CODES.RATE_LIMITED] = true;
  RETRYABLE[CODES.SERVER_ERROR] = true;
  RETRYABLE[CODES.BAD_GATEWAY] = true;
  RETRYABLE[CODES.SERVICE_UNAVAILABLE] = true;
  RETRYABLE[CODES.GATEWAY_TIMEOUT] = true;
  RETRYABLE[CODES.NETWORK_ERROR] = true;
  RETRYABLE[CODES.TIMEOUT] = true;
  // Deliberately NOT retryable: invalid_api_key, forbidden, not_found,
  // model_unavailable, unknown — retrying without changing something
  // (the key, the model id, the permission) would just fail again.

  function safeLog(level, message, detail) {
    try {
      if (global.AxLogger && typeof global.AxLogger[level] === 'function') {
        global.AxLogger[level]('[AxiomOpenRouter:errors] ' + message, detail || '');
        return;
      }
    } catch (e) { /* fall through to console */ }
    try {
      if (global.console && typeof global.console[level] === 'function') {
        global.console[level]('[AxiomOpenRouter:errors] ' + message, detail || '');
      }
    } catch (e2) { /* logging must never break the caller */ }
  }

  function messageOf(input) {
    if (!input) return 'Unknown OpenRouter error';
    if (typeof input === 'string') return input;
    if (input.message) return input.message;
    if (input.error && input.error.message) return input.error.message;
    if (input.error && typeof input.error === 'string') return input.error;
    try { return JSON.stringify(input); } catch (e) { return String(input); }
  }

  function extractStatus(input) {
    if (!input || typeof input !== 'object') return null;
    if (typeof input.status === 'number') return input.status;
    if (typeof input.statusCode === 'number') return input.statusCode;
    // fetch Response objects also carry `.status`; already covered above.
    return null;
  }

  function isAbort(input) {
    return !!(input && (input.name === 'AbortError' || input.code === 'ABORT_ERR'));
  }

  function isNetworkFailure(input) {
    if (isAbort(input)) return false; // aborts are classified as TIMEOUT, not NETWORK_ERROR
    var msg = messageOf(input);
    return /failed to fetch|networkerror|network error|load failed|err_internet|err_connection|err_name_not_resolved/i.test(msg);
  }

  /**
   * Classifies an Error, a fetch Response-like object ({status, ...}),
   * an OpenRouter JSON error body ({error: {message, code}}), or a
   * plain string into one consistent shape. Never throws.
   * @param {*} input
   * @returns {{code:string,status:?number,type:string,message:string,retryable:boolean,at:number,raw:*}}
   */
  function classify(input) {
    var status = extractStatus(input);
    var message = messageOf(input);
    var code = CODES.UNKNOWN;

    if (isAbort(input)) {
      code = CODES.TIMEOUT;
    } else if (status && STATUS_TO_CODE[status]) {
      code = STATUS_TO_CODE[status];
    } else if (isNetworkFailure(input)) {
      code = CODES.NETWORK_ERROR;
    } else if (/invalid[\s\S]{0,20}api[\s\S]{0,5}key|no auth credentials|missing bearer/i.test(message)) {
      code = CODES.INVALID_API_KEY;
    } else if (/model[\s\S]{0,25}(not found|unavailable|does not exist|is not available)/i.test(message)) {
      code = CODES.MODEL_UNAVAILABLE;
    } else if (status && status >= 500) {
      code = CODES.SERVER_ERROR;
    }

    return {
      code: code,
      status: status,
      type: code, // alias — some call sites read `.type`, some read `.code`
      message: message,
      retryable: !!RETRYABLE[code],
      at: Date.now(),
      raw: input || null
    };
  }

  function isRetryable(codeOrClassified) {
    if (!codeOrClassified) return false;
    var code = typeof codeOrClassified === 'string' ? codeOrClassified : codeOrClassified.code;
    return !!RETRYABLE[code];
  }

  /**
   * classify() + log + emit. This is what api-manager.js and
   * model-manager.js call on every failed request; classify() alone
   * is available for callers (e.g. regression tests) that just want
   * the pure classification without side effects.
   */
  function handle(input, context) {
    var classified = classify(input);
    safeLog('error', classified.message, Object.assign({ code: classified.code, status: classified.status }, context || {}));
    try {
      if (global.AxiomOpenRouter && typeof global.AxiomOpenRouter.emit === 'function') {
        global.AxiomOpenRouter.emit('openrouter_error', Object.assign({ error: classified }, context || {}));
      }
    } catch (e) { /* bus not installed yet (error-handler.js loaded standalone) — classification is still returned */ }
    return classified;
  }

  var ErrorHandler = {
    CODES: CODES,
    classify: classify,
    handle: handle,
    isRetryable: isRetryable
  };

  global.AxiomOpenRouter = global.AxiomOpenRouter || {};
  // Never clobber a namespace another Part 2A file already populated —
  // same "install onto existing global" convention as
  // os/core/runtime-context.js installing onto AxiomOrchestrator.
  global.AxiomOpenRouter.errors = ErrorHandler;
})(typeof window !== 'undefined' ? window : globalThis);
