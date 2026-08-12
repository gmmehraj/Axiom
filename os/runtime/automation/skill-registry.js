// ============================================================
// AXIOM AI OS — Milestone 13: Skill Registry
// ------------------------------------------------------------
// Objective 2: "Create reusable AI Skills."
//
// A Skill is a named, versioned, invokable unit of work that is NOT
// tied to any single conversation or workflow — the same skill can be
// called from a custom workflow (workflow-engine.js), a scheduled or
// triggered automation (trigger-scheduler.js / automation-engine.js),
// or directly by any other module, always through the same front
// door. A skill is either:
//   - a plain function  (spec.handler(input, ctx) -> result | Promise), or
//   - a thin pointer at an existing agent capability
//     (spec.agentId + spec.op), so a skill can also mean "reuse
//     agent.browser's search-web op" without any new agent logic.
//
// This module owns NO retry/timeout/cancellation logic of its own —
// every invocation runs through the EXISTING Milestone 5
// AxiomCapabilityKit.withCapability(), the same wrapper every agent
// capability already uses, so a skill gets loading/success/failure/
// retry/timeout/cancellation for free and for exactly one reason:
// reuse, not reimplementation. Dispatching to an agent-backed skill
// goes through the EXISTING AxiomAgentManager.dispatch() + the shared
// Agent Event Bus — never a direct call into an agent.
//
// Mirrors the shape of plugin-registry.js (Milestone 11): namespace
// enforcement (a skill id must live under "skill." and can never
// collide with the reserved "agent." core-agent namespace), manifest
// validation, and an event-based front door so a caller with no JS
// reference to this module can still invoke a skill.
//
// Public surface — window.AxiomSkillRegistry:
//   .register(spec)         -> { ok, skill?, error? }
//   .unregister(id)          -> boolean
//   .get(id)                 -> skill metadata | null
//   .list()                  -> skill metadata[]
//   .invoke(id, input, opts?) -> Promise<result>
// Event-based invocation (no JS reference needed):
//   bus.emit('skill:invoke', 'caller-id', { id: 'skill.x', input: ... })
//   -> listen for 'skill:completed' / 'skill:failed'
// ============================================================
window.AxiomSkillRegistry = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  var MGR = window.AxiomAgentManager;
  var KIT = window.AxiomCapabilityKit;
  if (!RT || !MGR || !KIT) {
    AxLogger.error('[AxiomSkillRegistry] requires agent-runtime.js, agent-manager.js and capabilities/capability-kit.js loaded first.');
    return null;
  }
  var bus = RT.bus;

  var RESERVED_PREFIX = 'agent.';
  var REQUIRED_PREFIX = 'skill.';
  var ID_PATTERN = /^skill\.[a-z0-9][a-z0-9-]*$/;

  var skills = new Map(); // id -> { id, name, version, description, tags, agentId?, op?, retries, timeoutMs, registeredAt }
  var handlers = new Map(); // id -> function(input, ctx)
  var uid = window.AxiomMakeSeqId('skill-inv'); // see os/shared/id-factory.js
  function emit(type, payload) { bus.emit(type, 'skill-registry', payload || {}); }

  function validate(spec) {
    if (!spec || typeof spec !== 'object') return 'Skill spec must be an object.';
    if (!spec.id || typeof spec.id !== 'string') return 'Skill spec requires a string "id".';
    if (spec.id.indexOf(RESERVED_PREFIX) === 0) return 'Skill id "' + spec.id + '" is reserved for core agents (must not start with "' + RESERVED_PREFIX + '").';
    if (spec.id.indexOf(REQUIRED_PREFIX) !== 0 || !ID_PATTERN.test(spec.id)) return 'Skill id "' + spec.id + '" must match ' + ID_PATTERN + ' (e.g. "skill.summarize-note").';
    if (!spec.name || typeof spec.name !== 'string') return 'Skill spec requires a string "name".';
    if (!spec.version || typeof spec.version !== 'string') return 'Skill spec requires a string "version" (e.g. "1.0.0").';
    if (skills.has(spec.id)) return 'A skill with id "' + spec.id + '" is already registered.';
    var hasHandler = typeof spec.handler === 'function';
    var hasAgentPointer = typeof spec.agentId === 'string' && spec.agentId.length > 0;
    if (!hasHandler && !hasAgentPointer) return 'Skill spec requires either a function "handler" or an "agentId" (+ optional "op") to dispatch to.';
    if (hasAgentPointer && !MGR.get(spec.agentId) && spec.agentId.indexOf(RESERVED_PREFIX) === 0) {
      // Only warn for core agent ids that don't exist yet (plugin agents may
      // register after this skill does) — never a hard validation failure.
      AxLogger.warn('[AxiomSkillRegistry] skill "' + spec.id + '" points at agent "' + spec.agentId + '", which is not currently registered.');
    }
    return null;
  }

  // Waits for one specific agent+task to settle. Same pattern
  // capabilities/workflows.js already uses for agent hand-offs — reused
  // here rather than re-implemented, just generalised to any agent/op.
  function dispatchAndWait(agentId, task) {
    return new Promise(function (resolve, reject) {
      var taskId = MGR.dispatch(agentId, task);
      if (!taskId) { reject(new Error('Unknown agent "' + agentId + '".')); return; }
      var offDone = bus.on('task:completed', function (env) {
        if (env.payload.agent !== agentId || env.payload.task.id !== taskId) return;
        offDone(); offFail();
        resolve(env.payload.result);
      });
      var offFail = bus.on('task:failed', function (env) {
        if (env.payload.agent !== agentId || env.payload.task.id !== taskId) return;
        offDone(); offFail();
        reject(new Error(env.payload.error || (agentId + ' task failed.')));
      });
    });
  }

  function register(spec) {
    var err = validate(spec);
    if (err) {
      emit('skill:registration-rejected', { id: spec && spec.id, error: err });
      return { ok: false, error: err };
    }
    var meta = {
      id: spec.id, name: spec.name, version: spec.version,
      description: spec.description || '', tags: (spec.tags || []).slice(),
      agentId: spec.agentId || null, op: spec.op || null,
      retries: typeof spec.retries === 'number' ? spec.retries : 1,
      timeoutMs: typeof spec.timeoutMs === 'number' ? spec.timeoutMs : 10000,
      registeredAt: Date.now()
    };
    skills.set(spec.id, meta);
    if (typeof spec.handler === 'function') handlers.set(spec.id, spec.handler);
    emit('skill:registered', { id: spec.id, name: spec.name, version: spec.version });
    return { ok: true, skill: Object.assign({}, meta) };
  }

  function unregister(id) {
    if (!skills.has(id)) return false;
    skills.delete(id);
    handlers.delete(id);
    emit('skill:unregistered', { id: id });
    return true;
  }

  function get(id) { return skills.has(id) ? Object.assign({}, skills.get(id)) : null; }
  function list() { return Array.from(skills.values()).map(function (s) { return Object.assign({}, s); }); }

  // The ONE execution path every invocation goes through, whether called
  // directly, from a workflow step, from a trigger, or from the event
  // front door below — so retry/timeout/lifecycle behaviour can never
  // drift between call sites.
  function invoke(id, input, opts) {
    opts = opts || {};
    var skill = skills.get(id);
    if (!skill) {
      emit('skill:failed', { id: id, error: 'Unknown skill "' + id + '".' });
      return Promise.reject(new Error('Unknown skill "' + id + '".'));
    }
    var invocationId = uid();
    var task = { id: invocationId, cancelled: false };
    var ctx = { bus: bus, agent: { id: id }, manager: MGR };
    emit('skill:invoked', { id: id, invocationId: invocationId });

    var fn = handlers.has(id)
      ? function () { return handlers.get(id)(input, { bus: bus, manager: MGR }); }
      : function () { return dispatchAndWait(skill.agentId, Object.assign({ intent: skill.op || 'skill', op: skill.op || 'skill', input: input }, opts.taskExtra || {})); };

    return KIT.withCapability('skill:' + id, task, ctx, fn, {
      retries: typeof opts.retries === 'number' ? opts.retries : skill.retries,
      timeoutMs: typeof opts.timeoutMs === 'number' ? opts.timeoutMs : skill.timeoutMs
    }).then(function (result) {
      emit('skill:completed', { id: id, invocationId: invocationId });
      return result;
    }, function (err) {
      emit('skill:failed', { id: id, invocationId: invocationId, error: String(err && err.message || err) });
      throw err;
    });
  }

  // Event-driven front door: a caller with no JS reference to this module
  // (e.g. a plugin loaded from elsewhere) can still invoke a skill purely
  // through the shared bus, exactly like plugin-registry's registration path.
  bus.on('skill:invoke', function (env) {
    if (env.source === 'skill-registry') return;
    var payload = env.payload || {};
    if (!payload.id) return;
    invoke(payload.id, payload.input, payload.opts).catch(function () { /* failure already emitted by invoke() */ });
  });

  return { register: register, unregister: unregister, get: get, list: list, invoke: invoke };
})();
