// ============================================================
// AXIOM AI OS — Milestone 11: Plugin Registration API
// ------------------------------------------------------------
// Objective 8: "Add a plugin registration API so external modules
// can register new agents without modifying the runtime."
//
// AxiomAgentManager.register() (Milestone 4) already accepts an agent
// spec at any time, even after start() — that is what already lets a
// newcomer come online with no core-file change. This module does not
// duplicate that lifecycle logic (init/status/task-queue handling all
// still live in the ONE place they always have: agent-runtime.js /
// agent-manager.js). What is missing is a SAFE FRONT DOOR for code
// outside this codebase to use that capability:
//   - namespace enforcement, so a plugin can never claim/overwrite one
//     of the ten reserved 'agent.*' core ids,
//   - manifest validation (id/name/version), so a malformed plugin
//     fails loudly at registration instead of misbehaving later,
//   - a structured event-based registration path (`plugin:register`
//     on the shared bus) so a plugin never needs a direct reference to
//     this module's JS object at all — just the ability to emit a
//     structured event, exactly like every other cross-module
//     interaction in this runtime.
//
// Reuses:
//   - AxiomAgentManager.register()/unregister() — the ONLY place a
//     plugin agent is actually created or torn down.
//   - The Agent Event Bus — both for the registration events this
//     module emits AND as an alternative registration entry point.
//
// Public surface — window.AxiomPluginRegistry:
//   .register(spec)      -> { ok, agent? , error? }
//   .unregister(id)       -> boolean
//   .get(id)               -> plugin metadata | null
//   .list()                 -> plugin metadata[]
// Event-based registration (no JS reference needed):
//   bus.emit('plugin:register', 'my-plugin-module', { id: 'plugin.weather', ... })
//   -> listen for 'plugin:registered' / 'plugin:registration-rejected'
// ============================================================
window.AxiomPluginRegistry = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  var MGR = window.AxiomAgentManager;
  if (!RT || !MGR) {
    AxLogger.error('[AxiomPluginRegistry] requires agent-runtime.js and agent-manager.js loaded first.');
    return null;
  }
  var bus = RT.bus;

  var RESERVED_PREFIX = 'agent.';    // the ten core agents live here — plugins may never claim this namespace
  var REQUIRED_PREFIX = 'plugin.';   // every plugin id must self-identify as external
  var ID_PATTERN = /^plugin\.[a-z0-9][a-z0-9-]*$/;

  var plugins = new Map(); // id -> { id, name, version, source, registeredAt }

  function emit(type, payload) { bus.emit(type, 'plugin-registry', payload || {}); }

  function validate(spec) {
    if (!spec || typeof spec !== 'object') return 'Plugin spec must be an object.';
    if (!spec.id || typeof spec.id !== 'string') return 'Plugin spec requires a string "id".';
    if (spec.id.indexOf(RESERVED_PREFIX) === 0) return 'Plugin id "' + spec.id + '" is reserved for core agents (must not start with "' + RESERVED_PREFIX + '").';
    if (!ID_PATTERN.test(spec.id)) return 'Plugin id "' + spec.id + '" must match ' + ID_PATTERN + ' (e.g. "plugin.weather").';
    if (!spec.name || typeof spec.name !== 'string') return 'Plugin spec requires a string "name".';
    if (!spec.version || typeof spec.version !== 'string') return 'Plugin spec requires a string "version" (e.g. "1.0.0").';
    if (MGR.get(spec.id)) return 'An agent with id "' + spec.id + '" is already registered.';
    return null;
  }

  // Registers a plugin agent through the EXISTING Agent Manager — this
  // function performs no agent lifecycle work itself, only validation and
  // bookkeeping. `spec` is otherwise a normal agent spec (capabilities,
  // tools, subscriptions, handler, canonicalState) — the exact same shape
  // agent-definitions.js already uses for the ten core agents.
  function register(spec) {
    var err = validate(spec);
    if (err) {
      emit('plugin:registration-rejected', { id: spec && spec.id, error: err });
      return { ok: false, error: err };
    }
    var agent = MGR.register(spec);
    plugins.set(spec.id, {
      id: spec.id, name: spec.name, version: spec.version,
      source: spec.source || 'unknown', registeredAt: Date.now()
    });
    emit('plugin:registered', { id: spec.id, name: spec.name, version: spec.version });
    return { ok: true, agent: agent };
  }

  function unregister(id) {
    if (!plugins.has(id)) return false;
    var ok = MGR.unregister(id);
    if (ok) {
      plugins.delete(id);
      emit('plugin:unregistered', { id: id });
    }
    return ok;
  }

  function get(id) { return plugins.has(id) ? Object.assign({}, plugins.get(id)) : null; }
  function list() { return Array.from(plugins.values()).map(function (p) { return Object.assign({}, p); }); }

  // Event-driven front door: a plugin module that only has access to the
  // shared bus (no direct reference to window.AxiomPluginRegistry) can
  // still register itself, honouring "all communication happens through
  // structured runtime events."
  bus.on('plugin:register', function (env) {
    if (env.source === 'plugin-registry') return; // never react to our own emissions
    register(env.payload);
  });
  bus.on('plugin:unregister', function (env) {
    if (env.source === 'plugin-registry') return;
    var id = env.payload && env.payload.id;
    if (id) unregister(id);
  });

  return { register: register, unregister: unregister, get: get, list: list };
})();
