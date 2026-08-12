// ============================================================
// AXIOM AI OS — Milestone 13: Custom Workflow Engine
// ------------------------------------------------------------
// Objective 3: "Support custom workflows."
// Objective 5: "Allow multi-agent automation" (a workflow's steps may
// target several different agents/skills, run in dependency order).
//
// window.AxiomWorkflows (Milestone 5) already gives three fixed,
// hard-coded multi-agent recipes. This module does not touch or
// duplicate that file — it adds the thing that was actually missing:
// a way for ANYONE (a user, a plugin, Executive AI) to DEFINE a new,
// named, reusable workflow made of arbitrary steps, persist it, and
// run it whenever they like, with steps that can point at either a
// Milestone 13 Skill (skill-registry.js) or an existing agent op.
//
// Reuses, never re-implements:
//   - AxiomTaskGraph.fromPlan() (Milestone 11) for dependency
//     resolution, cycle detection, and sequential/parallel/mixed mode
//     classification — a custom workflow's steps are simply shaped
//     into the same {id, agentId, clause, dependsOn} step format
//     AxiomTaskGraph already understands, so it never re-derives
//     graph logic itself.
//   - AxiomSkillRegistry.invoke() for skill-backed steps.
//   - AxiomAgentManager.dispatch() + the Agent Event Bus for
//     agent-backed steps (never a direct agent call).
//   - AxiomCapabilityKit.withCapability() for uniform per-step
//     retry/timeout/lifecycle events (Objective 7 — reliability).
//   - localStorage persistence in the same bounded, best-effort
//     pattern job-manager.js / planner-store.js already use.
//
// Execution model: steps run in dependency LAYERS (every step whose
// dependencies have all settled runs concurrently with its layer-
// mates via Promise.all, then the next layer starts) — this is what
// makes a workflow with independent steps genuinely multi-agent/
// parallel, and a workflow with dependsOn chains genuinely
// sequential, using the exact graph AxiomTaskGraph built.
//
// Public surface — window.AxiomWorkflowEngine:
//   .define(spec)          -> { ok, workflow?, error? }
//   .remove(id)             -> boolean
//   .get(id)                -> workflow definition | null
//   .list()                 -> workflow definition[]
//   .run(id, input?, opts?) -> { runId, promise }
// ============================================================
window.AxiomWorkflowEngine = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  var MGR = window.AxiomAgentManager;
  var KIT = window.AxiomCapabilityKit;
  var GRAPH = window.AxiomTaskGraph;
  if (!RT || !MGR || !KIT || !GRAPH) {
    AxLogger.error('[AxiomWorkflowEngine] requires agent-runtime.js, agent-manager.js, capability-kit.js and the Milestone 11 task-graph.js loaded first.');
    return null;
  }
  var bus = RT.bus;

  var STORAGE_KEY = 'axiom-custom-workflows';
  var ID_PATTERN = /^workflow\.[a-z0-9][a-z0-9-]*$/;
  var seq = 0;

  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + (++seq).toString(36); }
  function emit(type, payload) { bus.emit(type, 'workflow-engine', payload || {}); }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function save(defs) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(defs)); }
    catch (e) { AxLogger.warn('[AxiomWorkflowEngine] could not persist workflow definitions:', e); }
  }

  function validateStep(s) {
    if (!s || !s.id) return 'every step requires an "id".';
    if (!s.skill && !s.agentId) return 'step "' + (s && s.id) + '" requires a "skill" id or an "agentId" to run against.';
    return null;
  }

  function validate(spec) {
    if (!spec || typeof spec !== 'object') return 'Workflow spec must be an object.';
    if (!spec.id || typeof spec.id !== 'string' || !ID_PATTERN.test(spec.id)) return 'Workflow spec requires an id matching ' + ID_PATTERN + ' (e.g. "workflow.daily-digest").';
    if (!spec.name || typeof spec.name !== 'string') return 'Workflow spec requires a string "name".';
    if (!Array.isArray(spec.steps) || !spec.steps.length) return 'Workflow spec requires a non-empty "steps" array.';
    var ids = {};
    for (var i = 0; i < spec.steps.length; i++) {
      var err = validateStep(spec.steps[i]);
      if (err) return err;
      if (ids[spec.steps[i].id]) return 'duplicate step id "' + spec.steps[i].id + '".';
      ids[spec.steps[i].id] = true;
    }
    return null;
  }

  function define(spec) {
    var defs = load();
    var err = validate(spec);
    if (err) { emit('workflow:definition-rejected', { id: spec && spec.id, error: err }); return { ok: false, error: err }; }
    if (defs[spec.id] && !spec.overwrite) { var msg = 'A workflow with id "' + spec.id + '" already exists (pass overwrite:true to replace it).'; emit('workflow:definition-rejected', { id: spec.id, error: msg }); return { ok: false, error: msg }; }

    var workflow = {
      id: spec.id, name: spec.name, description: spec.description || '',
      steps: spec.steps.map(function (s) {
        return {
          id: s.id, name: s.name || s.id, skill: s.skill || null, agentId: s.agentId || null,
          op: s.op || null, input: s.input !== undefined ? s.input : null,
          dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.slice() : [],
          retries: typeof s.retries === 'number' ? s.retries : 1
        };
      }),
      createdAt: (defs[spec.id] && defs[spec.id].createdAt) || Date.now(),
      updatedAt: Date.now()
    };
    defs[spec.id] = workflow;
    save(defs);
    emit('workflow:defined', { id: spec.id, name: spec.name, steps: workflow.steps.length });
    return { ok: true, workflow: workflow };
  }

  function remove(id) {
    var defs = load();
    if (!defs[id]) return false;
    delete defs[id];
    save(defs);
    emit('workflow:removed', { id: id });
    return true;
  }

  function get(id) { var defs = load(); return defs[id] ? Object.assign({}, defs[id]) : null; }
  function list() { var defs = load(); return Object.keys(defs).map(function (k) { return Object.assign({}, defs[k]); }); }

  // Build the same {id, agentId, clause, dependsOn} shape AxiomTaskGraph
  // already understands, purely for dependency/cycle/mode analysis — the
  // graph's synthetic nodes are never executed directly; execution below
  // reads back the ORIGINAL step definitions by id.
  function graphFor(workflow) {
    var planLike = {
      goal: workflow.name,
      steps: workflow.steps.map(function (s) {
        return { id: s.id, agentId: s.skill ? ('skill:' + s.skill) : s.agentId, clause: s.name, dependsOn: s.dependsOn };
      })
    };
    return GRAPH.fromPlan(planLike);
  }

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

  // Runs ONE step through the uniform capability wrapper (retry/timeout/
  // lifecycle events for free — Objective 7), then hands off to whichever
  // backend the step names. A skill-backed step already gets its OWN
  // capability-kit wrap inside AxiomSkillRegistry.invoke(); this outer
  // wrap is given exactly one attempt in that case so retries are never
  // applied twice for the same failure.
  function runStep(step, runId, input) {
    var SKILLS = window.AxiomSkillRegistry;
    var task = { id: runId + ':' + step.id, cancelled: false };
    var ctx = { bus: bus, agent: { id: 'workflow-step' }, manager: MGR };
    emit('workflow:custom-step-start', { runId: runId, stepId: step.id, name: step.name });

    var fn;
    var retries;
    if (step.skill) {
      if (!SKILLS) return Promise.reject(new Error('AxiomSkillRegistry is not available — cannot run skill-backed step "' + step.id + '".'));
      fn = function () { return SKILLS.invoke(step.skill, step.input !== null ? step.input : input); };
      retries = 1; // skill.invoke already retries internally per the skill's own policy
    } else {
      fn = function () { return dispatchAndWait(step.agentId, Object.assign({ intent: step.op || 'workflow-step', op: step.op || 'workflow-step', text: step.name }, (step.input !== null ? step.input : input) || {})); };
      retries = step.retries;
    }

    return KIT.withCapability('workflow-step:' + step.id, task, ctx, fn, { retries: retries, timeoutMs: 15000 })
      .then(function (result) {
        emit('workflow:custom-step-done', { runId: runId, stepId: step.id, result: result });
        return { stepId: step.id, ok: true, result: result };
      }, function (err) {
        emit('workflow:custom-step-failed', { runId: runId, stepId: step.id, error: String(err && err.message || err) });
        return { stepId: step.id, ok: false, error: String(err && err.message || err) };
      });
  }

  function runWorkflow(workflow, input, opts) {
    opts = opts || {};
    var runId = uid('wfrun');
    var graph = graphFor(workflow);
    if (graph.order === null) {
      var cycleErr = 'workflow "' + workflow.id + '" has a cyclic step dependency.';
      emit('workflow:custom-failed', { runId: runId, workflowId: workflow.id, error: cycleErr });
      return { runId: runId, promise: Promise.reject(new Error(cycleErr)) };
    }

    emit('workflow:custom-start', { runId: runId, workflowId: workflow.id, name: workflow.name, mode: graph.mode, steps: workflow.steps.length });

    var byId = {}; workflow.steps.forEach(function (s) { byId[s.id] = s; });
    var done = {}; // stepId -> result envelope
    var stopOnFailure = opts.stopOnFailure !== false; // default true: don't run a step whose dependency failed

    function layerReady() {
      return graph.nodes.filter(function (n) {
        if (done[n.id]) return false;
        return n.dependsOn.every(function (depId) { return !!done[depId]; });
      });
    }

    function step() {
      var ready = layerReady();
      if (!ready.length) {
        var allDone = graph.nodes.every(function (n) { return !!done[n.id]; });
        return Promise.resolve(allDone);
      }
      var runnable = ready.filter(function (n) {
        if (!stopOnFailure) return true;
        return n.dependsOn.every(function (depId) { return done[depId] && done[depId].ok; });
      });
      var skipped = ready.filter(function (n) { return runnable.indexOf(n) === -1; });
      skipped.forEach(function (n) {
        done[n.id] = { stepId: n.id, ok: false, error: 'skipped — an upstream dependency failed', skipped: true };
        emit('workflow:custom-step-failed', { runId: runId, stepId: n.id, error: done[n.id].error, skipped: true });
      });
      if (!runnable.length) return step(); // everything left this layer was skipped — advance
      return Promise.all(runnable.map(function (n) { return runStep(byId[n.id], runId, input); }))
        .then(function (results) {
          results.forEach(function (r) { done[r.stepId] = r; });
          return step();
        });
    }

    var promise = step().then(function () {
      var results = workflow.steps.map(function (s) { return done[s.id]; });
      var ok = results.every(function (r) { return r && r.ok; });
      var outcome = { runId: runId, workflowId: workflow.id, ok: ok, mode: graph.mode, steps: results };
      emit(ok ? 'workflow:custom-complete' : 'workflow:custom-failed', { runId: runId, workflowId: workflow.id, ok: ok, steps: results });
      return outcome;
    });

    return { runId: runId, promise: promise };
  }

  function run(id, input, opts) {
    var workflow = get(id);
    if (!workflow) {
      var err = 'Unknown workflow "' + id + '".';
      emit('workflow:custom-failed', { runId: null, workflowId: id, error: err });
      return { runId: null, promise: Promise.reject(new Error(err)) };
    }
    return runWorkflow(workflow, input, opts);
  }

  return { define: define, remove: remove, get: get, list: list, run: run };
})();
