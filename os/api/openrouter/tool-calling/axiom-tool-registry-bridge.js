// ============================================================
// AXIOM — Block 2 / Step 9 / Part 2C-2A: OpenRouter Tool Calling
// AXIOM Tool Registry Discovery Bridge
// ------------------------------------------------------------
// A safe, strictly READ-ONLY bridge between OpenRouter Tool Calling
// (AxiomOpenRouterToolManager / AxiomOpenRouterToolSchema) and the
// authoritative AXIOM capability/tool infrastructure (AxiomOrchestrator).
//
// The bridge's job is strictly: DISCOVER → NORMALIZE → VALIDATE → EXPOSE.
//
// What this module explicitly does NOT do:
//   - It does NOT execute any tools or invoke handler functions.
//   - It does NOT perform browser navigation, memory writes, or goal changes.
//   - It does NOT mutate the authoritative AxiomOrchestrator registry.
//   - It does NOT use eval(), Function(), or any dynamic code execution.
//   - It does NOT duplicate tool registration, schema validation, event bus,
//     logger, or runtime context systems.
//
// Public API — window.AxiomOpenRouterToolRegistryBridge:
//   initialize(options)    -> { success, count }
//   discoverTools()        -> Array<bridge tool record>
//   getTool(name)          -> bridge tool record | null
//   hasTool(name)          -> boolean
//   getTools()             -> Array<bridge tool record>
//   getToolDefinitions()  -> Array<OpenRouter wire-format fn>
//   refresh()              -> Array<bridge tool record>
//   getStatus()            -> { initialized, count, lastRefreshedAt, status, source, collisionsCount }
//   destroy()              -> void
//
// Events (emitted on AxiomOrchestrator bus when available):
//   openrouter_axiom_registry_initialized
//   openrouter_axiom_tools_discovered
//   openrouter_axiom_registry_refreshed
//   openrouter_axiom_registry_error
// ============================================================
(function (global) {
  'use strict';

  var NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

  var initialized = false;
  var lastRefreshedAt = null;
  var bridgeRegisteredNames = []; // track normalized tool names registered into ToolManager by this bridge
  var discoveredTools = [];       // array of bridge tool public records
  var collisions = [];            // array of collision records

  // ---------- Small Shared Helpers ----------

  function safeLog(level, message, detail) {
    try {
      if (global.AxLogger && typeof global.AxLogger[level] === 'function') {
        global.AxLogger[level]('[AxiomOpenRouterToolRegistryBridge] ' + message, detail !== undefined ? detail : '');
        return;
      }
    } catch (e) { /* fall through */ }
    try {
      if (global.console && typeof global.console[level] === 'function') {
        global.console[level]('[AxiomOpenRouterToolRegistryBridge] ' + message, detail !== undefined ? detail : '');
      }
    } catch (e2) { /* ignore */ }
  }

  function busEmit(event, payload) {
    try {
      var Orchestrator = global.AxiomOrchestrator;
      if (Orchestrator && typeof Orchestrator.emit === 'function') {
        Orchestrator.emit(event, payload);
      }
    } catch (e) { /* Orchestrator not installed — no-op */ }
  }

  function recordRuntimeContext(event, payload) {
    try {
      var RC = global.AxiomRuntimeContext;
      if (RC && typeof RC.recordEvent === 'function') {
        RC.recordEvent(event, payload);
      }
    } catch (e) { /* ignore */ }
  }

  function deepClone(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (e) {
      return null;
    }
  }

  function normalizeName(originalName) {
    if (typeof originalName !== 'string') return '';
    // Convert forbidden characters (dots, colons, spaces, etc.) to underscores
    var sanitized = originalName.replace(/[^a-zA-Z0-9_-]/g, '_');
    // Ensure max length of 64 chars
    if (sanitized.length > 64) {
      sanitized = sanitized.slice(0, 64);
    }
    // Clean trailing/leading invalid chars if any remain
    sanitized = sanitized.replace(/^_+/, '').replace(/_+$/, '');
    if (!sanitized) {
      sanitized = 'axiom_tool';
    }
    if (!NAME_PATTERN.test(sanitized)) {
      sanitized = 'tool_' + sanitized.replace(/[^a-zA-Z0-9_-]/g, '');
    }
    return sanitized;
  }

  function clearBridgeRegistrations() {
    var ToolManager = global.AxiomOpenRouterToolManager;
    if (ToolManager && typeof ToolManager.unregisterTool === 'function') {
      for (var i = 0; i < bridgeRegisteredNames.length; i++) {
        ToolManager.unregisterTool(bridgeRegisteredNames[i]);
      }
    }
    bridgeRegisteredNames = [];
  }

  // ---------- Discovery & Normalization Core ----------

  function discoverTools() {
    var Orchestrator = global.AxiomOrchestrator;
    var ToolManager = global.AxiomOpenRouterToolManager;

    if (!Orchestrator || typeof Orchestrator.listAgents !== 'function') {
      safeLog('warn', 'AxiomOrchestrator is not loaded or missing listAgents() — returning empty tool list.');
      busEmit('openrouter_axiom_registry_error', {
        error: 'orchestrator_unavailable',
        message: 'AxiomOrchestrator unavailable for discovery',
        timestamp: Date.now(),
        status: 'degraded',
        source: 'axiom'
      });
      clearBridgeRegistrations();
      discoveredTools = [];
      collisions = [];
      return [];
    }

    var agents = Orchestrator.listAgents();
    var candidates = [];
    var seenNormalized = Object.create(null); // normalizedName -> candidate object
    var currentCollisions = [];

    // Query optional subsystem registries for richer schemas/descriptions if present
    var BrowserRegistry = global.AxiomBrowserToolRegistry || global.BrowserToolRegistry;

    for (var aIdx = 0; aIdx < agents.length; aIdx++) {
      var agent = agents[aIdx];
      var isAvailable = agent.health !== 'unhealthy' && agent.status !== 'disabled';

      var rawTools = Array.isArray(agent.tools) && agent.tools.length > 0 ? agent.tools : (
        Array.isArray(agent.capabilities) ? agent.capabilities : []
      );

      for (var tIdx = 0; tIdx < rawTools.length; tIdx++) {
        var rawName = String(rawTools[tIdx]);
        var normName = normalizeName(rawName);

        // Subsystem schema lookup (if available)
        var explicitSchema = null;
        if (BrowserRegistry && typeof BrowserRegistry.getSchema === 'function') {
          explicitSchema = BrowserRegistry.getSchema(rawName) || BrowserRegistry.getSchema(normName);
        }

        var parameters = (explicitSchema && explicitSchema.parameters && typeof explicitSchema.parameters === 'object') ?
          deepClone(explicitSchema.parameters) : { type: 'object', properties: {}, required: [] };

        var description = (explicitSchema && typeof explicitSchema.description === 'string' && explicitSchema.description.length > 0) ?
          explicitSchema.description : ('AXIOM capability ' + rawName + ' provided by ' + (agent.name || agent.id));

        var metadata = {
          source: 'axiom',
          agentId: agent.id,
          agentName: agent.name || agent.id,
          originalName: rawName,
          capability: rawName,
          permissions: Array.isArray(agent.permissions) ? agent.permissions.slice() : [],
          health: agent.health || 'unknown',
          status: agent.status || 'unknown',
          available: isAvailable,
          hasExplicitSchema: Boolean(explicitSchema)
        };

        // Collision Check (Requirement 2 & 7)
        if (Object.prototype.hasOwnProperty.call(seenNormalized, normName)) {
          var existing = seenNormalized[normName];
          if (existing.metadata.originalName !== rawName) {
            // Distinct original names normalizing to the exact same string -> COLLISION!
            var colRecord = {
              normalizedName: normName,
              toolA: existing.metadata.originalName,
              toolB: rawName,
              agentA: existing.metadata.agentId,
              agentB: agent.id,
              timestamp: Date.now()
            };
            currentCollisions.push(colRecord);
            existing.isCollision = true;

            safeLog('warn', 'Tool name collision detected between "' + rawName + '" and "' + existing.metadata.originalName + '" (normalized: "' + normName + '")');
            busEmit('openrouter_axiom_registry_error', {
              error: 'name_collision',
              normalizedName: normName,
              toolA: existing.metadata.originalName,
              toolB: rawName,
              timestamp: Date.now(),
              status: 'error',
              source: 'axiom'
            });
            continue;
          } else {
            // Exact same tool name re-encountered across agents -> retain existing authoritative definition
            continue;
          }
        }

        var candidate = {
          name: normName,
          description: description,
          parameters: parameters,
          metadata: metadata,
          isCollision: false
        };

        seenNormalized[normName] = candidate;
        candidates.push(candidate);
      }
    }

    // Filter out collided candidates
    var validCandidates = candidates.filter(function (c) {
      return !c.isCollision && seenNormalized[c.name] && !seenNormalized[c.name].isCollision;
    });

    // Deterministic sorting by normalized tool name
    validCandidates.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });

    // Clear old bridge registrations from AxiomOpenRouterToolManager
    clearBridgeRegistrations();

    var newBridgeRegisteredNames = [];
    var newDiscoveredTools = [];

    if (ToolManager && typeof ToolManager.registerTool === 'function') {
      for (var cIdx = 0; cIdx < validCandidates.length; cIdx++) {
        var spec = validCandidates[cIdx];
        var regResult = ToolManager.registerTool({
          name: spec.name,
          description: spec.description,
          parameters: spec.parameters,
          metadata: spec.metadata
        });

        if (regResult && regResult.success) {
          newBridgeRegisteredNames.push(spec.name);
          newDiscoveredTools.push(deepClone(regResult.tool));
        } else {
          safeLog('warn', 'Failed to register bridge tool "' + spec.name + '" with ToolManager', regResult ? regResult.errors : '');
        }
      }
    } else {
      // ToolManager not installed fallback
      for (var fIdx = 0; fIdx < validCandidates.length; fIdx++) {
        var vSpec = validCandidates[fIdx];
        newDiscoveredTools.push({
          name: vSpec.name,
          description: vSpec.description,
          parameters: deepClone(vSpec.parameters),
          metadata: deepClone(vSpec.metadata),
          registeredAt: Date.now()
        });
      }
    }

    bridgeRegisteredNames = newBridgeRegisteredNames;
    discoveredTools = newDiscoveredTools;
    collisions = currentCollisions;
    lastRefreshedAt = Date.now();

    busEmit('openrouter_axiom_tools_discovered', {
      count: discoveredTools.length,
      timestamp: lastRefreshedAt,
      status: 'healthy',
      source: 'axiom'
    });

    recordRuntimeContext('openrouter_axiom_tools_discovered', { count: discoveredTools.length });

    return getTools();
  }

  // ---------- Public Methods ----------

  function initialize(options) {
    options = options || {};
    initialized = true;

    var tools = discoverTools();

    busEmit('openrouter_axiom_registry_initialized', {
      count: tools.length,
      timestamp: Date.now(),
      status: 'healthy',
      source: 'axiom'
    });

    recordRuntimeContext('openrouter_axiom_registry_initialized', { count: tools.length });

    safeLog('info', 'Initialized AxiomOpenRouterToolRegistryBridge with ' + tools.length + ' discovered tools.');
    return { success: true, count: tools.length };
  }

  function getTool(name) {
    if (typeof name !== 'string' || !name) return null;
    var norm = normalizeName(name);

    var ToolManager = global.AxiomOpenRouterToolManager;
    if (ToolManager && typeof ToolManager.getTool === 'function') {
      var tmTool = ToolManager.getTool(norm) || ToolManager.getTool(name);
      if (tmTool) return tmTool;
    }

    for (var i = 0; i < discoveredTools.length; i++) {
      var t = discoveredTools[i];
      if (t.name === norm || t.name === name || (t.metadata && t.metadata.originalName === name)) {
        return deepClone(t);
      }
    }
    return null;
  }

  function hasTool(name) {
    return getTool(name) !== null;
  }

  function getTools() {
    return deepClone(discoveredTools);
  }

  function getToolDefinitions() {
    var ToolManager = global.AxiomOpenRouterToolManager;
    if (ToolManager && typeof ToolManager.getToolDefinitions === 'function') {
      var allDefs = ToolManager.getToolDefinitions();
      // Filter for tools registered by this bridge
      return allDefs.filter(function (def) {
        return def && def.function && bridgeRegisteredNames.indexOf(def.function.name) !== -1;
      });
    }

    // Fallback if ToolManager is not loaded
    return discoveredTools.map(function (t) {
      return {
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: deepClone(t.parameters)
        }
      };
    });
  }

  function refresh() {
    var refreshed = discoverTools();

    busEmit('openrouter_axiom_registry_refreshed', {
      count: refreshed.length,
      timestamp: Date.now(),
      status: 'healthy',
      source: 'axiom'
    });

    recordRuntimeContext('openrouter_axiom_registry_refreshed', { count: refreshed.length });

    safeLog('info', 'Refreshed AxiomOpenRouterToolRegistryBridge (' + refreshed.length + ' tools).');
    return refreshed;
  }

  function getStatus() {
    return {
      initialized: initialized,
      count: discoveredTools.length,
      lastRefreshedAt: lastRefreshedAt,
      status: initialized ? 'healthy' : 'uninitialized',
      source: 'axiom',
      collisionsCount: collisions.length
    };
  }

  function destroy() {
    clearBridgeRegistrations();
    discoveredTools = [];
    collisions = [];
    initialized = false;
    lastRefreshedAt = null;
    safeLog('info', 'Destroyed AxiomOpenRouterToolRegistryBridge.');
  }

  // ---------- Public Interface Registration ----------

  var Bridge = {
    initialize: initialize,
    discoverTools: discoverTools,
    getTool: getTool,
    hasTool: hasTool,
    getTools: getTools,
    getToolDefinitions: getToolDefinitions,
    refresh: refresh,
    getStatus: getStatus,
    destroy: destroy
  };

  global.AxiomOpenRouterToolRegistryBridge = Bridge;

})(typeof window !== 'undefined' ? window : globalThis);
