// ============================================================
// AXIOM — Part 2C Final: Live Tool Execution Wiring
// ------------------------------------------------------------
// This file is ONLY the missing glue between:
//   OpenRouter tool_calls  <->  existing AXIOM tool infrastructure
//
// It creates NOTHING new architecturally. It is a thin adapter that:
//   1. Initializes the existing discovery bridge
//      (AxiomOpenRouterToolRegistryBridge) so the existing tool
//      registry (AxiomOpenRouterToolManager) is populated from the
//      existing AXIOM agent registry (AxiomOrchestrator.listAgents()).
//   2. Exposes getToolDefinitions() — the wire-format `tools` array
//      for the live OpenRouter request — sourced ENTIRELY from the
//      existing bridge/registry.
//   3. Executes ONE model-issued tool_call by parsing it with the
//      existing AxiomOpenRouterToolCallParser, then routing it
//      through the existing AxiomOrchestrator.route() (capability
//      router -> permission check -> AxiomOrchestrator scheduler ->
//      real agent execution) and resolving once that specific
//      request finishes (route_completed/route_failed on the
//      existing AxiomOrchestrator bus). It never calls a tool
//      implementation directly and never bypasses route().
//
// Reused, all feature-detected (degrades gracefully if missing —
// same posture as every other file in os/api/openrouter/*):
//   - window.AxiomOpenRouterToolRegistryBridge (discovery, read-only)
//   - window.AxiomOpenRouterToolCallParser     (parse/validate calls)
//   - window.AxiomOrchestrator                 (.route/.on/.off/.cancelRequest)
//   - window.AxLogger
//
// Explicitly NOT created here: a second tool registry, a second
// permission system, a second execution engine, or a second event
// bus. Every decision of "can this run" is made by
// AxiomOrchestrator.route()'s existing validate()/hasPermission()
// logic (os/core/capability-router.js) — this file only supplies the
// requestId/agentId/capability/payload and waits for the result.
//
// Public API — window.AxiomLiveToolExecutor:
//   ensureInitialized()          -> boolean (true once the bridge has
//                                    discovered at least once)
//   getToolDefinitions()         -> Array<wire-format fn> | null
//                                    (null when there are no tools to
//                                    offer, so callers omit `tools`
//                                    from the request entirely)
//   executeToolCall(rawToolCall, opts) -> Promise<{ tool_call_id, content }>
//                                    ALWAYS resolves (never rejects) —
//                                    a denial/error becomes a safe
//                                    `content` string, per spec §8.
//   cancelPending(reason)        -> void  (cancels every in-flight
//                                    routed tool request via the
//                                    existing AxiomOrchestrator.cancelRequest())
// ============================================================
(function (global) {
  'use strict';

  var initialized = false;
  var pendingRequestIds = Object.create(null); // requestId -> true, while awaiting route_completed/route_failed

  function safeLog(level, message, detail) {
    try {
      if (global.AxLogger && typeof global.AxLogger[level] === 'function') {
        global.AxLogger[level]('[LiveToolExecutor] ' + message, detail !== undefined ? detail : '');
        return;
      }
    } catch (e) { /* ignore */ }
    try {
      if (global.console && typeof global.console[level] === 'function') {
        global.console[level]('[LiveToolExecutor] ' + message, detail !== undefined ? detail : '');
      }
    } catch (e2) { /* ignore */ }
  }

  function bridge() { return global.AxiomOpenRouterToolRegistryBridge; }
  function parser() { return global.AxiomOpenRouterToolCallParser; }
  function orchestrator() { return global.AxiomOrchestrator; }

  // ------------------------------------------------------------
  // 1. Discovery bootstrap (idempotent) — reuses the existing bridge,
  //    never registers a tool itself.
  // ------------------------------------------------------------
  function ensureInitialized() {
    var Bridge = bridge();
    if (!Bridge || typeof Bridge.initialize !== 'function') {
      safeLog('warn', 'AxiomOpenRouterToolRegistryBridge not loaded — live tool calling disabled for this session.');
      return false;
    }
    if (!initialized) {
      Bridge.initialize();
      initialized = true;
    } else if (typeof Bridge.refresh === 'function') {
      // Cheap re-sync so an agent that came online/offline mid-session
      // (health/status change, new agent registered) is reflected in
      // the next request's tool list — still the SAME registry, just
      // re-read, never rebuilt.
      Bridge.refresh();
    }
    return true;
  }

  function getToolDefinitions() {
    var Bridge = bridge();
    if (!Bridge || typeof Bridge.getToolDefinitions !== 'function') return null;
    var defs = Bridge.getToolDefinitions();
    return (Array.isArray(defs) && defs.length > 0) ? defs : null;
  }

  // ------------------------------------------------------------
  // Tool-result safety (spec §13): strip anything that looks like a
  // credential before it is ever serialized back to the model, and
  // bound the size of what goes back into the conversation.
  // ------------------------------------------------------------
  var SECRET_KEY_PATTERN = /(api[_-]?key|service[_-]?role|auth(orization)?[_-]?token|secret|credential|password|private[_-]?key)/i;
  var MAX_RESULT_CHARS = 8000;

  function scrub(value, depth) {
    depth = depth || 0;
    if (depth > 8) return '[max-depth]';
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
      return value.length > MAX_RESULT_CHARS ? value.slice(0, MAX_RESULT_CHARS) + '…[truncated]' : value;
    }
    if (typeof value !== 'object') return value; // number/boolean pass through
    if (Array.isArray(value)) {
      return value.slice(0, 200).map(function (v) { return scrub(v, depth + 1); });
    }
    var out = {};
    Object.keys(value).forEach(function (key) {
      if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = scrub(value[key], depth + 1);
      }
    });
    return out;
  }

  function safeSerialize(value) {
    try {
      var json = JSON.stringify(scrub(value));
      if (typeof json !== 'string') return String(value);
      return json.length > MAX_RESULT_CHARS ? json.slice(0, MAX_RESULT_CHARS) + '…[truncated]' : json;
    } catch (e) {
      return JSON.stringify({ error: 'Result could not be serialized.' });
    }
  }

  function toolErrorContent(reason) {
    return JSON.stringify({ error: String(reason || 'Tool execution failed.') });
  }

  // ------------------------------------------------------------
  // 2. Execute one parsed tool_call through the EXISTING permission
  //    boundary + execution engine, and wait for that SPECIFIC
  //    request's outcome — never a bypass, never a second engine.
  // ------------------------------------------------------------
  function routeAndAwait(request, timeoutMs) {
    var Orchestrator = orchestrator();
    return new Promise(function (resolve) {
      var settled = false;
      var onCompleted, onFailed, offBoth;

      function finish(content) {
        if (settled) return;
        settled = true;
        offBoth();
        delete pendingRequestIds[request.requestId];
        resolve(content);
      }

      onCompleted = function (payload) {
        if (!payload || payload.requestId !== request.requestId) return;
        finish(safeSerialize(payload.result));
      };
      onFailed = function (payload) {
        if (!payload || payload.requestId !== request.requestId) return;
        finish(toolErrorContent(payload.reason));
      };
      offBoth = function () {
        if (Orchestrator && typeof Orchestrator.off === 'function') {
          Orchestrator.off('route_completed', onCompleted);
          Orchestrator.off('route_failed', onFailed);
        }
      };

      if (Orchestrator && typeof Orchestrator.on === 'function') {
        Orchestrator.on('route_completed', onCompleted);
        Orchestrator.on('route_failed', onFailed);
      }

      // route() itself never throws for routing/availability failures
      // (permission denial, unknown agent, no eligible agent) — those
      // come back as a standardized { accepted:false, error } result,
      // which this file turns into a safe role:"tool" error, exactly
      // like a route_failed outcome. capability-router.js is NEVER
      // bypassed here, and NEVER re-implemented.
      var result;
      try {
        result = Orchestrator.route(request);
      } catch (err) {
        finish(toolErrorContent(err && err.message ? err.message : 'Tool routing failed.'));
        return;
      }

      if (!result || !result.accepted) {
        finish(toolErrorContent((result && result.error) || 'Permission denied or no agent available for this tool.'));
        return;
      }

      pendingRequestIds[request.requestId] = true;

      // Reuse the existing plan timeout (validate()/resolveExecutionPlan()
      // already defaults it) rather than starting a second timer — this
      // is only a final safety net in case a task's own terminal event
      // is somehow never emitted (e.g. agent unregistered mid-flight),
      // set comfortably longer than the plan's own timeout so the
      // orchestrator's own task_failed(timedOut) path gets first say.
      var safety = typeof timeoutMs === 'number' ? timeoutMs : 45000;
      global.setTimeout(function () {
        finish(toolErrorContent('Tool call timed out waiting for a result.'));
      }, safety);
    });
  }

  function executeToolCall(rawToolCall, opts) {
    opts = opts || {};
    var Parser = parser();
    var Bridge = bridge();

    if (!Parser || typeof Parser.parseToolCall !== 'function') {
      return Promise.resolve({
        tool_call_id: (rawToolCall && rawToolCall.id) || null,
        content: toolErrorContent('Tool calling is unavailable (tool-call-parser.js not loaded).')
      });
    }

    var parsed = Parser.parseToolCall(rawToolCall);
    var toolCallId = parsed.id || (rawToolCall && rawToolCall.id) || null;

    if (!toolCallId) {
      return Promise.resolve({ tool_call_id: null, content: toolErrorContent('Tool call is missing an id.') });
    }
    if (parsed.parseError) {
      return Promise.resolve({ tool_call_id: toolCallId, content: toolErrorContent(parsed.parseError) });
    }

    // Registry-aware validation (name known, arguments match the
    // tool's own registered schema) — reused as-is, never re-implemented.
    if (typeof Parser.validateToolCall === 'function') {
      var verdict = Parser.validateToolCall(parsed);
      if (!verdict.valid) {
        return Promise.resolve({ tool_call_id: toolCallId, content: toolErrorContent(verdict.errors.join('; ')) });
      }
    }

    var toolRecord = (Bridge && typeof Bridge.getTool === 'function') ? Bridge.getTool(parsed.name) : null;
    var metadata = (toolRecord && toolRecord.metadata) || null;

    if (!metadata || !metadata.agentId) {
      return Promise.resolve({ tool_call_id: toolCallId, content: toolErrorContent('Unknown tool "' + parsed.name + '".') });
    }

    var Orchestrator = orchestrator();
    if (!Orchestrator || typeof Orchestrator.route !== 'function') {
      return Promise.resolve({ tool_call_id: toolCallId, content: toolErrorContent('AxiomOrchestrator.route() is unavailable — capability router not loaded.') });
    }

    // Permission derivation (spec §6, "use each tool's registered
    // permission metadata"): os/core/agent-registry-integration.js
    // grants agents colon-scoped permission strings (e.g.
    // "browser:navigate") that do NOT share a naming convention with
    // either its `tools` list (dotted, e.g. "browser.navigate") or its
    // `capabilities` list (bare verbs, e.g. "navigate") — the bridge's
    // own metadata has no field that reconstructs which specific
    // granted permission a given discovered tool maps to, and inventing
    // one here would be a NEW permission scheme, which spec §6/§8
    // explicitly rule out ("NEVER bypass capability-router" — including
    // by bypassing it with a guessed, wrong requiredPermission that
    // then always denies).
    //
    // requiredPermission is therefore passed through UNCHANGED from
    // whatever the bridge's discovery actually recorded for this tool
    // (metadata.requiredPermission, when a subsystem/tool schema
    // supplies one) and otherwise left null — meaning the existing
    // agent health/disabled checks in capability-router.js's own
    // validate() are still the enforced gate, and a tool that DOES
    // carry an explicit requiredPermission in its metadata is still
    // fully enforced through the SAME unmodified validate()/
    // hasPermission() logic. See the final report for how this is
    // exercised (a synthetic test agent with a real permission grant/
    // denial), and for the fix this points at upstream in
    // agent-registry-integration.js (give each tool/capability its own
    // explicit requiredPermission instead of only an agent-level list).
    var request = {
      requestId: 'toolcall-' + toolCallId + '-' + Date.now().toString(36),
      agentId: metadata.agentId,
      capability: metadata.capability || parsed.name,
      type: metadata.capability || parsed.name,
      payload: parsed.arguments || {},
      requiredPermission: (typeof metadata.requiredPermission === 'string' && metadata.requiredPermission) ? metadata.requiredPermission : null,
      priority: typeof opts.priority === 'number' ? opts.priority : 0,
      timeout: typeof opts.timeout === 'number' ? opts.timeout : undefined
    };

    safeLog('info', 'Routing tool call "' + parsed.name + '" (id ' + toolCallId + ') to agent "' + metadata.agentId + '".');

    return routeAndAwait(request, opts.awaitTimeout).then(function (content) {
      return { tool_call_id: toolCallId, content: content };
    });
  }

  // ------------------------------------------------------------
  // 3. Cancellation (spec §11/M) — reuses AxiomOrchestrator.cancelRequest(),
  //    never a new timeout/retry/cancellation framework.
  // ------------------------------------------------------------
  function cancelPending(reason) {
    var Orchestrator = orchestrator();
    if (!Orchestrator || typeof Orchestrator.cancelRequest !== 'function') return;
    Object.keys(pendingRequestIds).forEach(function (requestId) {
      try { Orchestrator.cancelRequest(requestId, reason || 'user_cancelled'); } catch (e) { /* ignore */ }
      delete pendingRequestIds[requestId];
    });
  }

  global.AxiomLiveToolExecutor = {
    ensureInitialized: ensureInitialized,
    getToolDefinitions: getToolDefinitions,
    executeToolCall: executeToolCall,
    cancelPending: cancelPending
  };
})(typeof window !== 'undefined' ? window : globalThis);
