// ============================================================
// AXIOM AI OS — Milestone 4: Agent Manager
// ------------------------------------------------------------
// The single authority over the agent population. Exactly one
// Agent Manager exists per tab (window.AxiomAgentManager). It is
// the only thing that:
//
//   * registers / unregisters agents (rejecting duplicate ids),
//   * discovers agents by id, capability, tool, or status,
//   * activates / deactivates agents (drives their lifecycle),
//   * routes an incoming request to the right agent(s) via the
//     Task Router, then dispatches structured task events,
//   * tracks live status for every agent,
//   * monitors health with a heartbeat and reports stalls.
//
// It owns NO capability logic itself — capability lives in each
// agent's handler. The manager only coordinates. That separation
// is what prevents duplicated agent logic.
//
// Integration with Milestone 3: the manager is the bridge between
// the agent runtime and the canonical AI-state system. It listens
// to `agent:status` events on the runtime bus and, when an agent
// starts real work, pushes the agent's canonical state into
// window.AxiomAIState so the OS AI Core / Brain / ambient FX all
// reflect real agent activity through the existing centralized
// event system — never by touching those visuals directly.
// ============================================================
window.AxiomAgentManager = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  if (!RT) {
    AxLogger.error('[AxiomAgentManager] AxiomAgentRuntime missing — load agent-runtime.js first.');
    return null;
  }

  var STATES = RT.STATES;
  var bus = RT.bus;

  var registry = new Map();   // id -> Agent
  var started = false;
  var heartbeatTimer = null;
  var HEARTBEAT_MS = 5000;
  var STALL_MS = 15000;       // working/thinking longer than this = suspect

  // Which agent's activity is currently "on stage" in the canonical AI
  // state, so we don't thrash AxiomAIState when several agents blip idle.
  var activeCanonicalOwner = null;

  // -------------------- Canonical AI-state bridge (Milestone 3) ----------
  function pushCanonical(state) {
    try {
      if (window.AxiomAIState && typeof window.AxiomAIState.setState === 'function') {
        window.AxiomAIState.setState(state, { source: 'agent-manager' });
      }
    } catch (e) { /* AI state manager absent on this page — harmless */ }
  }

  function anyBusy() {
    var busy = null;
    registry.forEach(function (a) {
      if (a.status === STATES.WORKING || a.status === STATES.THINKING || a.status === STATES.LISTENING) {
        if (!busy) busy = a;
      }
    });
    return busy;
  }

  // React to every status change flowing through the bus: keep the
  // canonical AI state in sync with real agent activity.
  bus.on('agent:status', function (env) {
    var busy = anyBusy();
    if (busy) {
      activeCanonicalOwner = busy.id;
      pushCanonical(busy.canonicalState || 'thinking');
    } else if (activeCanonicalOwner) {
      // No agent is busy any more — settle the OS back to idle.
      activeCanonicalOwner = null;
      pushCanonical('idle');
    }
  });

  // -------------------- Registration / discovery -------------------------
  /**
   * Register an agent spec (plain object) or an already-constructed
   * RT.Agent instance. Duplicate ids are ignored (the existing agent is
   * returned unchanged) rather than throwing, so a misconfigured plugin
   * load can't take down the whole manager.
   * @param {object|RT.Agent} specOrAgent
   * @returns {RT.Agent} the registered (or pre-existing) agent
   */
  function register(specOrAgent) {
    var agent = (specOrAgent instanceof RT.Agent)
      ? specOrAgent
      : new RT.Agent(specOrAgent);

    if (registry.has(agent.id)) {
      AxLogger.warn('[AxiomAgentManager] duplicate registration ignored for "' + agent.id + '".');
      return registry.get(agent.id);
    }
    agent._manager = api;         // give the agent a back-reference for orchestration
    registry.set(agent.id, agent);
    bus.emit('agent:registered', 'manager', { id: agent.id, name: agent.name });
    // If the manager is already running, bring the newcomer online immediately
    // — this is what lets plugins be added at runtime with no core changes.
    if (started) agent.init();
    return agent;
  }

  /**
   * Shut down and remove an agent from the population.
   * @param {string} id
   * @returns {boolean} true if an agent with that id existed and was removed
   */
  function unregister(id) {
    var agent = registry.get(id);
    if (!agent) return false;
    agent.shutdown();
    registry.delete(id);
    bus.emit('agent:unregistered', 'manager', { id: id });
    return true;
  }

  /** @param {string} id @returns {RT.Agent|null} */
  function get(id) { return registry.get(id) || null; }
  /** @returns {RT.Agent[]} every currently-registered agent */
  function list() { return Array.from(registry.values()); }

  // Discovery: filter the population by capability, tool, or status.
  function discover(filter) {
    filter = filter || {};
    return list().filter(function (a) {
      if (filter.capability && a.capabilities.indexOf(filter.capability) === -1) return false;
      if (filter.tool && a.tools.indexOf(filter.tool) === -1) return false;
      if (filter.status && a.status !== filter.status) return false;
      return true;
    });
  }

  function findByCapability(capability) { return discover({ capability: capability }); }

  // -------------------- Activation / lifecycle ---------------------------
  /**
   * Bring a registered agent online (runs its init lifecycle).
   * @param {string} id
   * @returns {Promise<RT.Agent|null>} resolves with the agent, or null if unknown
   */
  function activate(id) {
    var a = registry.get(id);
    if (!a) return Promise.resolve(null);
    return a.init();
  }

  /** Take a registered agent offline. @param {string} id */
  function deactivate(id) {
    var a = registry.get(id);
    if (!a) return false;
    a.shutdown();
    return true;
  }

  /**
   * Register the ten built-in core agent specs from
   * window.AxiomAgentDefinitions (a no-op for any id already registered).
   * @returns {number} total agent count after registering the defaults
   */
  function registerDefaults() {
    var defs = window.AxiomAgentDefinitions || [];
    defs.forEach(function (spec) { register(spec); });
    return registry.size;
  }

  /**
   * Start the manager: register the default agents if none are registered
   * yet, bring every registered agent online, and start the heartbeat.
   * Idempotent — calling start() again while already started is a no-op.
   * @returns {object} the manager's public API (`api`), for chaining
   */
  function start() {
    if (started) return api;
    started = true;
    // Register the ten core agents if the caller hasn't already.
    if (registry.size === 0) registerDefaults();
    // Bring every registered agent online (offline -> initializing -> idle).
    var boots = [];
    registry.forEach(function (a) { boots.push(a.init()); });
    startHeartbeat();
    Promise.all(boots).then(function () {
      bus.emit('manager:started', 'manager', { agents: registry.size });
    });
    return api;
  }

  /** Stop the heartbeat and shut down every registered agent. */
  function stop() {
    stopHeartbeat();
    registry.forEach(function (a) { a.shutdown(); });
    started = false;
    bus.emit('manager:stopped', 'manager', {});
  }

  // -------------------- Task routing / dispatch --------------------------
  // Route a natural-language (or structured) request to agent(s) using the
  // Task Router, then dispatch a structured task to each. Supports multiple
  // agents collaborating on one request. Returns the routing decision.
  function route(request, meta) {
    var router = window.AxiomTaskRouter;
    if (!router || typeof router.route !== 'function') {
      AxLogger.warn('[AxiomAgentManager] no Task Router present — cannot route request.');
      return { matched: [], request: request };
    }
    var decision = router.route(request);
    bus.emit('router:decision', 'router', { request: decision.text, intent: decision.intent, agents: decision.agents });

    decision.agents.forEach(function (hop) {
      // A workflow hop hands the request to a named, pre-built multi-agent
      // collaboration (see capabilities/workflows.js) instead of a single
      // dispatch — this is how "research X" becomes Browser -> Memory ->
      // Planner -> Assistant without the router or manager duplicating
      // that orchestration logic themselves.
      if (hop.workflow) {
        var workflows = window.AxiomWorkflows;
        if (workflows && typeof workflows[hop.workflow] === 'function') {
          bus.emit('workflow:start', 'manager', { name: hop.workflow, text: decision.text });
          workflows[hop.workflow](decision.text, { via: (meta && meta.via) || 'router' });
        } else {
          AxLogger.warn('[AxiomAgentManager] workflow "' + hop.workflow + '" not available — falling back to plain dispatch.');
          dispatch(hop.agentId, Object.assign({ intent: decision.intent, text: decision.text }, hop.task || {}));
        }
        return;
      }
      var agent = registry.get(hop.agentId);
      if (!agent) { AxLogger.warn('[AxiomAgentManager] routed to unknown agent "' + hop.agentId + '".'); return; }
      var task = Object.assign({ intent: decision.intent, text: decision.text, via: (meta && meta.via) || 'router' }, hop.task || {});
      dispatch(hop.agentId, task);
    });
    return decision;
  }

  // Dispatch a concrete task to a specific agent via a structured event
  // (never a direct method call from outside), then enqueue it.
  function dispatch(agentId, task) {
    var agent = registry.get(agentId);
    if (!agent) return null;
    task = task || {};
    // Emit only — the target agent's own 'task:assign' listener enqueues it
    // (see Agent.prototype.onEvent). Calling agent.enqueue() here too would
    // run the exact same task twice under one id.
    bus.emit('task:assign', 'manager', task, { target: agentId });
    return task.id || null;
  }

  // -------------------- Cancellation --------------------------------------
  /**
   * Cancel a queued or in-flight task on a specific agent.
   * @param {string} agentId
   * @param {string} taskId
   * @returns {boolean} true if the agent existed and the cancel took effect
   */
  function cancel(agentId, taskId) {
    var a = registry.get(agentId);
    if (!a) return false;
    return !!a.cancel(taskId);
  }

  // -------------------- Status tracking ----------------------------------
  /** @returns {Object<string,string>} map of agent id -> current status */
  function status() {
    var out = {};
    registry.forEach(function (a) { out[a.id] = a.status; });
    return out;
  }

  /** @returns {object} a point-in-time summary of manager + agent state */
  function snapshot() {
    return {
      started: started,
      count: registry.size,
      activeCanonicalOwner: activeCanonicalOwner,
      agents: list().map(function (a) { return a.describe(); })
    };
  }

  // -------------------- Health monitoring --------------------------------
  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(function () {
      var now = Date.now();
      var report = health();
      report.stalled.forEach(function (id) {
        var a = registry.get(id);
        // A stuck agent is nudged back to idle rather than left wedged.
        if (a) { AxLogger.warn('[AxiomAgentManager] agent "' + id + '" appears stalled — recovering.'); a.setStatus(STATES.IDLE, { recoveredBy: 'heartbeat' }); }
      });
      bus.emit('manager:heartbeat', 'manager', { at: now, health: report.summary });
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  function health() {
    var now = Date.now();
    var summary = { total: registry.size, online: 0, idle: 0, busy: 0, error: 0, offline: 0 };
    var stalled = [];
    registry.forEach(function (a) {
      if (a.status === STATES.OFFLINE) summary.offline += 1;
      else summary.online += 1;
      if (a.status === STATES.IDLE) summary.idle += 1;
      if (a.status === STATES.ERROR) summary.error += 1;
      if (a.status === STATES.WORKING || a.status === STATES.THINKING) {
        summary.busy += 1;
        if (a.stats.lastActiveAt && (now - a.stats.lastActiveAt) > STALL_MS) stalled.push(a.id);
      }
    });
    return { at: now, summary: summary, stalled: stalled };
  }

  var api = {
    // lifecycle
    start: start, stop: stop, get started() { return started; },
    // registration / discovery
    register: register, unregister: unregister, registerDefaults: registerDefaults,
    get: get, list: list, discover: discover, findByCapability: findByCapability,
    // activation
    activate: activate, deactivate: deactivate,
    // routing / dispatch
    route: route, dispatch: dispatch, cancel: cancel,
    // status / health
    status: status, snapshot: snapshot, health: health,
    // expose the bus for advanced consumers/tests
    bus: bus
  };

  return api;
})();
