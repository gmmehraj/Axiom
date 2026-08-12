// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2C-1B: OpenRouter Tool Calling
// Tool Call Parser
// ------------------------------------------------------------
// Turns the `tool_calls` a model hands back in a chat-completion
// response (full or streamed) into AXIOM's internal, DATA-ONLY call
// shape — { id, name, arguments, raw } — and optionally checks that
// shape against Part 2C-1A's tool registry. This file never executes
// a tool: dispatching a validated call to an actual callable
// implementation is out of scope here, same as it was out of scope
// for tool-manager.js's registry (see that file's own header).
//
// Reuses, all feature-detected (degrades gracefully with any
// missing):
//   - window.AxiomOpenRouterToolSchema  (Part 2C-1A) — isValidToolName()
//     for call-name shape checks. This file does NOT re-implement
//     tool-*definition* validation; that stays entirely in
//     tool-schema.js.
//   - window.AxiomOpenRouterToolManager (Part 2C-1A) — hasTool()/
//     getTool() to check a call names a registered tool and to read
//     that tool's already-normalized `parameters` schema for
//     argument-structure/required-parameter checks. This file does
//     NOT re-implement the registry; it only reads from it.
//   - window.AxiomOrchestrator — reused directly for the shared event
//     bus (`.emit()`). No new pub/sub here, same convention
//     tool-manager.js already established for this Part.
//   - window.AxLogger — same defensive, feature-detected safeLog()
//     every OpenRouter sibling already uses.
//
// Audited before writing (nothing below is duplicated or modified):
//   - response-parser.js's normalizeToolCalls()/normalizeMessage()
//     already reshape ONE chunk's/message's worth of raw `tool_calls`
//     into a stable per-chunk shape ({index,id,type,function:{name,
//     arguments}}, arguments left as a raw string). This file picks
//     up exactly there — it does not re-touch SSE lines, chat
//     responses, or stream chunks, and does not read
//     response-parser.js's output directly. Its own parseToolCall()/
//     parseToolCalls() accept the SAME raw-tool_call wire shape
//     response-parser.js's normalizeToolCalls() already accepts
//     (`{id, type, function:{name, arguments}}` — OpenRouter's own
//     wire format, "function.name"/"function.arguments"/
//     "tool_call_id" per this Part's own build spec), so a caller can
//     feed either the raw API value or response-parser.js's
//     normalized form into it interchangeably. What THIS file adds
//     that response-parser.js does not do: JSON.parse() of the
//     `arguments` string into an actual object (with a controlled,
//     non-throwing parse-error path), and registry-aware validation.
//   - stream-manager.js already accumulates streaming tool-call
//     DELTAS into its own per-stream record (its internal, unexported
//     mergeToolCalls()) so a finished stream's message carries a
//     complete raw tool_calls array — the SAME raw shape this file's
//     parseToolCall() consumes. This file's own createAccumulator()
//     is a SEPARATE, opt-in, stateless-per-instance utility for a
//     caller that wants finalized-and-parsed (not just merged-raw)
//     calls as chunks arrive; it does not read or write
//     stream-manager.js's internal `streams` map, does not attach to
//     any stream's lifecycle, and stream-manager.js's own streaming
//     behavior is untouched by this file's mere presence — "do not
//     break normal text streaming" (build spec §4) holds trivially
//     because nothing here is wired into stream-manager.js at all.
//     Wiring the two together (e.g. auto-finalizing through this
//     parser when a stream's finish_reason is "tool_calls") is a
//     future Part's concern.
//   - model-manager.js's getCapabilities(id).tools (whether a model
//     supports tool calling at all) is not consulted here — this file
//     has no model-awareness, same posture tool-schema.js already
//     documented for itself.
//
// Why argument-INSTANCE validation lives here and not in
// tool-schema.js: tool-schema.js's validateParameters() checks that a
// tool's declared JSON-Schema *definition* is well-formed (e.g. "is
// `required` an array of strings that are all declared properties").
// It never sees an actual arguments VALUE. Checking whether a given
// parsed-arguments object satisfies a tool's already-validated schema
// (required keys present, primitive types match) is data-instance
// validation — a different, disjoint operation this file owns because
// it is the first Part with an actual argument value to validate.
// Nothing here re-checks whether a schema definition itself is
// well-formed; that question is still answered exclusively by
// tool-schema.js at registration time, before a tool ever reaches the
// registry this file reads from.
//
// Security posture (parsing/validation layer only):
//   - No eval(), no Function(), no dynamic script loading, no shell
//     access — none of these concepts exist in this file at all.
//     Argument parsing uses JSON.parse() exclusively (never eval()),
//     wrapped in try/catch so a malformed payload can never throw out
//     of this module.
//   - Parsed arguments are treated as inert DATA everywhere in this
//     file. There is no `execute`/`invoke`/`call`/`dispatch` concept
//     here — this file converts API data into structured data and
//     stops. Nothing it produces is ever passed to eval/Function/
//     child_process, here or (by construction — this file makes no
//     such call) anywhere downstream it reaches into.
//   - getPartials()/finalize() on the accumulator, and every parsed
//     call this file returns, hand back plain JSON-shaped values
//     only; a caller mutating a returned value cannot corrupt this
//     file's own internal accumulator state (see deepClone() below).
//
// Public API — window.AxiomOpenRouterToolCallParser:
//   parseToolCall(rawToolCall)     -> { id, name, arguments, argumentsRaw, parseError, raw }
//   parseToolCalls(rawToolCalls)   -> Array<parseToolCall() result>   (same order, one-to-one, never drops an entry)
//   validateToolCall(parsedCall)   -> { valid, errors: string[] }
//   createAccumulator()            -> {
//     addDeltas(deltaToolCalls)    -> void   (merge one streaming delta's tool_calls fragment)
//     getPartials()                -> Array<raw partial>              (current accumulated-but-unparsed state)
//     finalize()                   -> Array<parseToolCall() result>   (only entries with an id AND a function name so far)
//     reset()                      -> void
//   }
//
// Events (on the existing AxiomOrchestrator bus, when loaded):
//   openrouter_tool_call_detected      {id, name, at}   (one per raw call seen, before parse/validate)
//   openrouter_tool_call_parsed        {id, name, arguments, at}   (arguments parsed with no error, name present)
//   openrouter_tool_call_parse_failed  {id, name, error, at}       (malformed JSON, or no function name present)
// ============================================================
(function (global) {
  'use strict';

  // ---------- small shared helpers (same conventions as siblings) ----------

  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function safeLog(level, message, detail) {
    try {
      if (global.AxLogger && typeof global.AxLogger[level] === 'function') {
        global.AxLogger[level]('[AxiomOpenRouterToolCallParser] ' + message, detail || '');
        return;
      }
    } catch (e) { /* fall through */ }
    try { if (global.console && typeof global.console[level] === 'function') global.console[level]('[AxiomOpenRouterToolCallParser] ' + message, detail || ''); } catch (e2) { /* ignore */ }
  }

  function busEmit(event, payload) {
    try {
      var Orchestrator = global.AxiomOrchestrator;
      if (Orchestrator && typeof Orchestrator.emit === 'function') Orchestrator.emit(event, payload);
    } catch (e) { /* Orchestrator not installed — no-op, same convention as every sibling */ }
  }

  function publish(event, payload) { busEmit(event, payload); }

  // Deep clone via JSON round-trip — same rationale tool-manager.js's
  // own deepClone() documents: every value this file stores/returns
  // is plain-JSON-shaped by construction (strings, numbers, booleans,
  // plain objects/arrays), so this also doubles as a last-resort
  // guarantee that no function-typed value can ever leave this file
  // attached to a parsed call or accumulator snapshot.
  function deepClone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (e) { return null; }
  }

  function schema() { return global.AxiomOpenRouterToolSchema; }
  function manager() { return global.AxiomOpenRouterToolManager; }

  // ---------- argument parsing (Section 3) ----------
  //
  // Handles every input shape the build spec calls out: a valid JSON
  // string, an empty string, malformed JSON, null/undefined, an
  // already-parsed object (some caller may hand this parser an
  // already-normalized value), and — for anything else — a controlled
  // error rather than a throw.
  function parseArguments(raw) {
    if (raw === undefined || raw === null) {
      return { value: {}, error: null };
    }
    if (isPlainObject(raw)) {
      // Already an object (not the OpenRouter wire shape, but handled
      // gracefully per build spec §3 "object arguments"). Deep-cloned
      // via JSON round-trip — same as every other value this file
      // returns — so a stray function-typed property the caller's
      // object happened to carry can never leave this parser callable
      // (JSON.stringify silently drops function values).
      return { value: deepClone(raw) || {}, error: null };
    }
    if (Array.isArray(raw)) {
      return { value: {}, error: 'arguments: parsed JSON is not an object (got an array)' };
    }
    if (typeof raw !== 'string') {
      return { value: {}, error: 'arguments: unsupported type "' + typeof raw + '"' };
    }
    var trimmed = raw.trim();
    if (trimmed === '') {
      return { value: {}, error: null };
    }
    var parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      return { value: {}, error: 'arguments: malformed JSON — ' + (e && e.message ? e.message : 'parse failed') };
    }
    if (!isPlainObject(parsed)) {
      return { value: {}, error: 'arguments: parsed JSON is not an object' };
    }
    return { value: parsed, error: null };
  }

  // ---------- single-call normalization (Section 1) ----------
  //
  // Accepts the OpenRouter/OpenAI raw wire shape for one tool call —
  // { id, type, function: { name, arguments } } — or the equivalent
  // { tool_call_id, ... } spelling some callers may already carry.
  // Never throws: every field degrades to a safe default, matching
  // the same defensive convention response-parser.js's own
  // normalizeToolCalls() already uses one layer up.
  function parseToolCall(rawToolCall) {
    var raw = isPlainObject(rawToolCall) ? rawToolCall : {};
    var fn = isPlainObject(raw.function) ? raw.function : {};

    var id = null;
    if (isNonEmptyString(raw.id)) id = raw.id;
    else if (isNonEmptyString(raw.tool_call_id)) id = raw.tool_call_id;

    var name = typeof fn.name === 'string' ? fn.name : '';

    var argsResult = parseArguments(fn.arguments);

    var argumentsRaw;
    if (typeof fn.arguments === 'string') argumentsRaw = fn.arguments;
    else if (fn.arguments === undefined || fn.arguments === null) argumentsRaw = '';
    else argumentsRaw = deepClone(fn.arguments);

    return {
      id: id,
      name: name,
      arguments: argsResult.value,
      argumentsRaw: argumentsRaw,
      parseError: argsResult.error,
      raw: deepClone(raw)
    };
  }

  function emitForParsedCall(parsed) {
    var at = Date.now();
    publish('openrouter_tool_call_detected', { id: parsed.id, name: parsed.name, at: at });
    if (parsed.parseError || !isNonEmptyString(parsed.name)) {
      publish('openrouter_tool_call_parse_failed', {
        id: parsed.id,
        name: parsed.name,
        error: parsed.parseError || 'name: missing function name',
        at: at
      });
      safeLog('warn', 'tool call failed to parse cleanly.', { id: parsed.id, name: parsed.name });
    } else {
      publish('openrouter_tool_call_parsed', { id: parsed.id, name: parsed.name, arguments: parsed.arguments, at: at });
    }
  }

  // ---------- multiple tool calls (Section 2) ----------
  //
  // One-to-one, order-preserving map over the input array — every
  // entry, valid or not, produces exactly one output entry and one
  // detected/parsed-or-failed event pair. Nothing is ever silently
  // dropped, per build spec §2.
  function parseToolCalls(rawToolCalls) {
    if (!Array.isArray(rawToolCalls)) return [];
    return rawToolCalls.map(function (rawToolCall) {
      var parsed = parseToolCall(rawToolCall);
      emitForParsedCall(parsed);
      return parsed;
    });
  }

  // ---------- validation (Section 5) ----------

  function typeMatches(value, declaredType) {
    switch (declaredType) {
      case 'string': return typeof value === 'string';
      case 'number': return typeof value === 'number' && isFinite(value);
      case 'integer': return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
      case 'boolean': return typeof value === 'boolean';
      case 'object': return isPlainObject(value);
      case 'array': return Array.isArray(value);
      default: return true; // unrecognized declared type — nothing further to check here
    }
  }

  // Validates a parsed-arguments VALUE against a tool's already-
  // normalized `parameters` schema (registered via tool-manager.js,
  // itself already validated as a well-formed schema DEFINITION by
  // tool-schema.js at registration time — see this file's header for
  // why that is a distinct concern from what happens here).
  function validateArgumentsAgainstSchema(args, paramsSchema, errors, path) {
    if (!isPlainObject(paramsSchema)) return;

    var required = Array.isArray(paramsSchema.required) ? paramsSchema.required : [];
    required.forEach(function (reqName) {
      if (!Object.prototype.hasOwnProperty.call(args, reqName)) {
        errors.push(path + ': missing required argument "' + reqName + '"');
      }
    });

    var properties = isPlainObject(paramsSchema.properties) ? paramsSchema.properties : {};
    Object.keys(args).forEach(function (key) {
      var propSchema = properties[key];
      if (!propSchema) return; // extra/unknown argument — not rejected (additionalProperties left unrestricted, same as tool-schema.js's own posture on unrecognized descriptive keys)

      if (!typeMatches(args[key], propSchema.type)) {
        errors.push(path + '.' + key + ': expected type "' + propSchema.type + '", got "' + (Array.isArray(args[key]) ? 'array' : typeof args[key]) + '"');
        return;
      }

      if (propSchema.type === 'object') {
        validateArgumentsAgainstSchema(args[key], propSchema, errors, path + '.' + key);
      } else if (propSchema.type === 'array' && propSchema.items) {
        args[key].forEach(function (item, i) {
          if (!typeMatches(item, propSchema.items.type)) {
            errors.push(path + '.' + key + '[' + i + ']: expected type "' + propSchema.items.type + '"');
          } else if (propSchema.items.type === 'object') {
            validateArgumentsAgainstSchema(item, propSchema.items, errors, path + '.' + key + '[' + i + ']');
          }
        });
      }
    });
  }

  // Validates a parseToolCall()/parseToolCalls() result against the
  // tool registry: tool name shape, tool existence, argument-parse
  // success, and (when the tool is found) argument structure/required
  // parameters against that tool's registered schema. Never executes
  // the tool — this function only ever returns a verdict + reasons.
  function validateToolCall(parsedCall) {
    var errors = [];
    var call = isPlainObject(parsedCall) ? parsedCall : {};
    var name = call.name;

    if (!isNonEmptyString(name)) {
      errors.push('name: missing');
      return { valid: false, errors: errors };
    }

    var ToolSchema = schema();
    if (ToolSchema && typeof ToolSchema.isValidToolName === 'function' && !ToolSchema.isValidToolName(name)) {
      errors.push('name: invalid tool name "' + name + '"');
    }

    if (call.parseError) {
      errors.push(call.parseError);
    }

    var ToolManager = manager();
    if (!ToolManager || typeof ToolManager.hasTool !== 'function' || typeof ToolManager.getTool !== 'function') {
      errors.push('tool manager: AxiomOpenRouterToolManager not loaded — cannot verify tool exists');
      return { valid: false, errors: errors };
    }

    if (!ToolManager.hasTool(name)) {
      errors.push('tool: unknown tool "' + name + '" is not registered');
      return { valid: false, errors: errors };
    }

    if (errors.length === 0) {
      var tool = ToolManager.getTool(name);
      var args = isPlainObject(call.arguments) ? call.arguments : {};
      validateArgumentsAgainstSchema(args, tool.parameters, errors, 'arguments');
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // ---------- streaming accumulation (Section 4) ----------
  //
  // A caller-owned, stateful-per-instance accumulator (create one per
  // in-flight stream). Merges raw tool_calls delta fragments keyed by
  // `index` — the same OpenRouter streaming convention
  // stream-manager.js's own internal mergeToolCalls() already
  // documents (first chunk for an index carries id/type/function.name,
  // later chunks carry only a function.arguments fragment to append)
  // — but keeps its accumulated state RAW (unparsed argument strings)
  // until finalize() is called, at which point each sufficiently-
  // complete partial is run through parseToolCall() exactly once.
  function createAccumulator() {
    var partials = []; // sparse array, index -> raw partial tool-call fragment

    function ensure(idx) {
      if (!partials[idx]) {
        partials[idx] = { index: idx, id: null, type: 'function', function: { name: '', arguments: '' } };
      }
      return partials[idx];
    }

    function addDeltas(deltaToolCalls) {
      if (!Array.isArray(deltaToolCalls)) return;
      deltaToolCalls.forEach(function (tc, i) {
        tc = isPlainObject(tc) ? tc : {};
        var idx = typeof tc.index === 'number' ? tc.index : i;
        var cur = ensure(idx);
        var fn = isPlainObject(tc.function) ? tc.function : {};

        if (isNonEmptyString(tc.id)) cur.id = tc.id;
        else if (isNonEmptyString(tc.tool_call_id)) cur.id = tc.tool_call_id;
        if (isNonEmptyString(tc.type)) cur.type = tc.type;
        if (typeof fn.name === 'string' && fn.name) cur.function.name += fn.name;
        if (typeof fn.arguments === 'string' && fn.arguments) cur.function.arguments += fn.arguments;
      });
    }

    function getPartials() {
      return partials
        .filter(function (p) { return !!p; })
        .map(function (p) { return deepClone(p); });
    }

    function hasSufficientData(p) {
      // "Sufficient data" per build spec §4: enough to identify WHICH
      // tool is being called and correlate the eventual tool result
      // back to this call — an id and a (possibly still-partial, but
      // non-empty) function name. Arguments may legitimately still be
      // incomplete JSON at this point; parseToolCall()'s own
      // controlled parse-error path (Section 3) handles that safely
      // rather than this function trying to guess JSON completeness.
      return isNonEmptyString(p.id) && isNonEmptyString(p.function.name);
    }

    function finalize() {
      var out = [];
      partials.forEach(function (p) {
        if (!p || !hasSufficientData(p)) return;
        var parsed = parseToolCall(p);
        emitForParsedCall(parsed);
        out.push(parsed);
      });
      return out;
    }

    function reset() {
      partials = [];
    }

    return {
      addDeltas: addDeltas,
      getPartials: getPartials,
      finalize: finalize,
      reset: reset
    };
  }

  var ToolCallParser = {
    parseToolCall: parseToolCall,
    parseToolCalls: parseToolCalls,
    validateToolCall: validateToolCall,
    createAccumulator: createAccumulator
  };

  global.AxiomOpenRouterToolCallParser = ToolCallParser;
})(typeof window !== 'undefined' ? window : globalThis);
