// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2C-1A: OpenRouter Tool Calling
// Tool Manager
// ------------------------------------------------------------
// A pure REGISTRY. This file stores tool *declarations* (name,
// description, JSON-Schema parameters, opaque metadata) so a future
// tool-calling Part can hand `getToolDefinitions()`'s output to
// chat-manager.js/stream-manager.js as the OpenRouter `tools` request
// field. It does not call chat.sendMessage()/stream.streamMessage()
// itself, does not talk to OpenRouter, and — critically — never
// executes a tool. There is no `execute`/`handler`/`run` concept
// anywhere in this file; a registered tool is validated *data*, full
// stop. Wiring an actual callable implementation to a registered
// tool name, and dispatching a model's `tool_calls` response back
// into one, is out of scope for Part 2C-1A and left to a future Part.
//
// Reuses, all feature-detected (degrades gracefully with any
// missing):
//   - window.AxiomOpenRouterToolSchema (this Part's own sibling,
//     tool-schema.js) — the ONLY place validation/normalization logic
//     lives. This file does not re-validate JSON Schema shapes itself
//     — every registerTool() call defers entirely to
//     ToolSchema.validateTool()/normalizeTool().
//   - window.AxiomOrchestrator — reused directly for the shared event
//     bus (`.emit()`), per this Part's own build spec ("Reuse
//     AxiomOrchestrator... Do NOT create another Event Bus"). No new
//     pub/sub is implemented here, unlike some OpenRouter Part 2A/2B
//     siblings that keep their own local `on/emit` — this file has no
//     `on()` of its own; listen on `AxiomOrchestrator.on(...)`
//     directly, same convention os/core/capability-router.js and
//     every other os/core/* orchestration-layer file already uses.
//   - window.AxLogger — same defensive, feature-detected safeLog()
//     every OpenRouter sibling already uses.
//
// Audited before writing (nothing below is duplicated or modified):
//   - ModelManager (window.AxiomOpenRouter.models) — no model
//     awareness needed for pure registration; a future Part that
//     wants to filter tools by `getCapabilities(id).tools` support
//     can do so entirely from this file's already-public
//     getToolDefinitions(), without any change here.
//   - ChatManager / ResponseParser / RuntimeContext — none of
//     registration/schema validation touches a request, a response,
//     or a runtime-context record. Nothing here calls doChatRequest(),
//     normalizeToolCalls(), or createContext(). This is intentional:
//     Part 2C-1A is registry + schema foundation only, per its own
//     build spec ("Part 2C-1A" scope, explicitly not wiring execution).
//
// Security posture (registration/schema layer only):
//   - No eval(), no Function(), no dynamic script loading, no shell
//     access — none of these concepts exist in this file at all.
//   - registerTool() stores ONLY the four documented fields (name,
//     description, parameters, metadata) off of the object it is
//     given; any other property on the input (e.g. a stray `execute`/
//     `handler` function some caller might mistakenly attach) is
//     silently dropped, never stored, never called. A registered
//     tool can therefore never carry an executable payload through
//     this registry.
//   - getTools()/getTool()/getToolDefinitions() all return DEEP
//     CLONES (JSON round-tripped) of stored records, never the
//     original references — a caller mutating what they got back
//     cannot corrupt the registry's own state.
//
// Public API — window.AxiomOpenRouterToolManager:
//   registerTool(tool)      -> { success, tool?, errors? }
//   unregisterTool(name)    -> boolean
//   getTool(name)           -> tool record | null
//   hasTool(name)           -> boolean
//   getTools()              -> Array<tool record>              (registration order)
//   getToolDefinitions()    -> Array<OpenRouter wire-format fn> (registration order)
//   clearTools()            -> void
//
// Events (on the existing AxiomOrchestrator bus, when loaded):
//   openrouter_tool_registered          {name, tool, at}
//   openrouter_tool_unregistered        {name, at}
//   openrouter_tool_registration_failed {name?, errors, at}
// ============================================================
(function (global) {
  'use strict';

  var byName = Object.create(null); // name -> internal record
  var order = [];                   // registration order of names

  // ---------- small shared helpers (same conventions as siblings) ----------

  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }

  function safeLog(level, message, detail) {
    try {
      if (global.AxLogger && typeof global.AxLogger[level] === 'function') {
        global.AxLogger[level]('[AxiomOpenRouterToolManager] ' + message, detail || '');
        return;
      }
    } catch (e) { /* fall through */ }
    try { if (global.console && typeof global.console[level] === 'function') global.console[level]('[AxiomOpenRouterToolManager] ' + message, detail || ''); } catch (e2) { /* ignore */ }
  }

  function busEmit(event, payload) {
    try {
      var Orchestrator = global.AxiomOrchestrator;
      if (Orchestrator && typeof Orchestrator.emit === 'function') Orchestrator.emit(event, payload);
    } catch (e) { /* Orchestrator not installed — no-op, same convention as every sibling */ }
  }

  function schema() { return global.AxiomOpenRouterToolSchema; }

  // Deep clone via JSON round-trip: every stored/returned field here
  // is plain JSON-shaped data (strings, numbers, booleans, plain
  // objects/arrays) by construction — validateTool()/normalizeTool()
  // already reject anything else (functions included, since a
  // function is never a plain object per ToolSchema's own checks).
  // JSON.stringify silently drops function-typed properties too, so
  // this doubles as a last-resort guarantee that no executable value
  // can ever leave this registry attached to a tool record.
  function deepClone(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (e) {
      return null;
    }
  }

  function publicRecord(record) {
    return {
      name: record.name,
      description: record.description,
      parameters: deepClone(record.parameters),
      metadata: record.metadata === null ? null : deepClone(record.metadata),
      registeredAt: record.registeredAt
    };
  }

  // ---------- registration ----------

  function registerTool(tool) {
    var ToolSchema = schema();
    if (!ToolSchema || typeof ToolSchema.validateTool !== 'function' || typeof ToolSchema.normalizeTool !== 'function') {
      var missingErrors = ['AxiomOpenRouterToolSchema not loaded — cannot validate tool'];
      safeLog('error', 'registerTool() called before tool-schema.js was loaded.');
      publish('openrouter_tool_registration_failed', { name: tool && tool.name, errors: missingErrors, at: Date.now() });
      return { success: false, errors: missingErrors };
    }

    var result = ToolSchema.validateTool(tool);
    if (!result.valid) {
      publish('openrouter_tool_registration_failed', { name: tool && tool.name, errors: result.errors, at: Date.now() });
      return { success: false, errors: result.errors };
    }

    if (Object.prototype.hasOwnProperty.call(byName, tool.name)) {
      var dupErrors = ['name: duplicate — a tool named "' + tool.name + '" is already registered'];
      publish('openrouter_tool_registration_failed', { name: tool.name, errors: dupErrors, at: Date.now() });
      return { success: false, errors: dupErrors };
    }

    var normalized = ToolSchema.normalizeTool(tool);
    if (!normalized) {
      // Should not happen — validateTool() already passed above — but
      // handled defensively rather than trusting normalizeTool() blindly.
      var normErrors = ['tool failed normalization after passing validation'];
      publish('openrouter_tool_registration_failed', { name: tool.name, errors: normErrors, at: Date.now() });
      return { success: false, errors: normErrors };
    }

    var record = {
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : '',
      // Store the NORMALIZED parameters (defaults filled: properties
      // {}, required []), not the caller's raw input — every reader
      // of this registry (getTool/getTools/getToolDefinitions) then
      // sees one consistent, already-defaulted shape.
      parameters: normalized.function.parameters,
      metadata: (tool.metadata !== undefined && tool.metadata !== null) ? deepClone(tool.metadata) : null,
      registeredAt: Date.now(),
      normalized: normalized
    };

    byName[tool.name] = record;
    order.push(tool.name);

    var out = publicRecord(record);
    publish('openrouter_tool_registered', { name: tool.name, tool: out, at: record.registeredAt });
    return { success: true, tool: out };
  }

  function unregisterTool(name) {
    if (!isNonEmptyString(name) || !Object.prototype.hasOwnProperty.call(byName, name)) return false;
    delete byName[name];
    var idx = order.indexOf(name);
    if (idx !== -1) order.splice(idx, 1);
    publish('openrouter_tool_unregistered', { name: name, at: Date.now() });
    return true;
  }

  function getTool(name) {
    if (!isNonEmptyString(name) || !Object.prototype.hasOwnProperty.call(byName, name)) return null;
    return publicRecord(byName[name]);
  }

  function hasTool(name) {
    return isNonEmptyString(name) && Object.prototype.hasOwnProperty.call(byName, name);
  }

  function getTools() {
    return order.map(function (name) { return publicRecord(byName[name]); });
  }

  function getToolDefinitions() {
    // Deep-cloned so a caller mutating the array/objects they get
    // back (e.g. before splicing it into a chat request payload)
    // cannot corrupt this registry's own stored normalized form.
    return order.map(function (name) { return deepClone(byName[name].normalized); });
  }

  function clearTools() {
    byName = Object.create(null);
    order = [];
  }

  function publish(event, payload) {
    busEmit(event, payload);
  }

  var ToolManager = {
    registerTool: registerTool,
    unregisterTool: unregisterTool,
    getTool: getTool,
    hasTool: hasTool,
    getTools: getTools,
    getToolDefinitions: getToolDefinitions,
    clearTools: clearTools
  };

  global.AxiomOpenRouterToolManager = ToolManager;
})(typeof window !== 'undefined' ? window : globalThis);
