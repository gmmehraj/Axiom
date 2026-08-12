// ============================================================
// AXIOM AI OS — Milestone 13: Automation Engine
// ------------------------------------------------------------
// Objective 1: "Add an Automation Engine."
//
// The Automation Engine is the top-level object a user (or another
// module) actually names: an "automation" is a persisted binding of
// ONE trigger to ONE workflow (or an inline set of steps, which this
// module simply defines as a workflow through the existing engine
// before wiring it up) — enable/disable/run-now/remove.
//
// It re-implements nothing:
//   - step definition and dependency-ordered, multi-agent execution
//     -> AxiomWorkflowEngine (Milestone 13)
//   - WHEN it fires (interval/at/event)
//     -> AxiomTriggerScheduler (Milestone 13)
//   - visible OS activity for automation work
//     -> the EXISTING 'agent.automation' core agent (Milestone 4/5),
//        nudged via a normal AxiomAgentManager.dispatch() alongside
//        the real execution, so the Automation Agent's status/canonical
//        state genuinely reflects automation activity through the
//        centralized event system — this module never talks to the
//        Automation Agent's internals or duplicates its handler.
//
// Public surface — window.AxiomAutomationEngine:
//   .create(spec) -> { ok, automation?, error? }
//     spec = { id?, name, steps? (defines a workflow inline) |
//              workflowId (reuse an existing one), trigger: {...},
//              enabled? }
//   .enable(id) / .disable(id) -> boolean
//   .run(id, input?)            -> { runId, promise } | null
//   .remove(id)                 -> boolean
//   .get(id) / .list()
// ============================================================
window.AxiomAutomationEngine = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  var MGR = window.AxiomAgentManager;
  var WF = window.AxiomWorkflowEngine;
  var TRG = window.AxiomTriggerScheduler;
  if (!RT || !MGR || !WF || !TRG) {
    AxLogger.error('[AxiomAutomationEngine] requires agent-runtime.js, agent-manager.js, workflow-engine.js and trigger-scheduler.js loaded first.');
    return null;
  }
  var bus = RT.bus;

  var STORAGE_KEY = 'axiom-automations';
  var uid = window.AxiomMakeSeqId('auto'); // see os/shared/id-factory.js
  function emit(type, id, payload) { bus.emit(type, 'automation-engine', Object.assign({ id: id }, payload || {})); }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function save(defs) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(defs)); }
    catch (e) { AxLogger.warn('[AxiomAutomationEngine] could not persist automations:', e); }
  }

  // Nudges the real, existing Automation Agent so its status/canonical
  // AI state lights up for genuine automation activity — a normal,
  // structured dispatch, exactly the same path any other caller uses.
  // Best-effort only: an automation still runs correctly even if this
  // agent is somehow unavailable.
  function nudgeAutomationAgent(name, recipe) {
    try {
      if (MGR.get('agent.automation')) MGR.dispatch('agent.automation', { intent: 'run-workflow', name: name, recipe: recipe || [] });
    } catch (e) { /* best-effort */ }
  }

  function validate(spec) {
    if (!spec || typeof spec !== 'object') return 'Automation spec must be an object.';
    if (!spec.name || typeof spec.name !== 'string') return 'Automation spec requires a string "name".';
    if (!spec.workflowId && !(Array.isArray(spec.steps) && spec.steps.length)) return 'Automation spec requires either "workflowId" (reuse an existing workflow) or inline "steps".';
    if (!spec.trigger || typeof spec.trigger !== 'object') return 'Automation spec requires a "trigger" object.';
    return null;
  }

  function create(spec) {
    spec = spec || {};
    var err = validate(spec);
    if (err) { emit('automation:rejected', spec.id || null, { error: err }); return { ok: false, error: err }; }

    var id = spec.id || uid();
    var defs = load();
    if (defs[id]) { var msg = 'An automation with id "' + id + '" already exists.'; emit('automation:rejected', id, { error: msg }); return { ok: false, error: msg }; }

    var workflowId = spec.workflowId;
    if (!workflowId) {
      // Workflow ids only allow [a-z0-9-] after the "workflow." prefix
      // (see workflow-engine.js's ID_PATTERN) — sanitize the automation
      // id (which may itself contain dots, e.g. "auto.my-thing") rather
      // than assume it is already a legal workflow id.
      var wfId = 'workflow.' + String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      var defResult = WF.define({ id: wfId, name: spec.name + ' workflow', description: 'Auto-defined for automation "' + spec.name + '".', steps: spec.steps });
      if (!defResult.ok) { emit('automation:rejected', id, { error: defResult.error }); return { ok: false, error: defResult.error }; }
      workflowId = wfId;
    } else if (!WF.get(workflowId)) {
      var noWf = 'Unknown workflowId "' + workflowId + '".';
      emit('automation:rejected', id, { error: noWf });
      return { ok: false, error: noWf };
    }

    var triggerSpec = Object.assign({}, spec.trigger, { id: 'trigger.' + id, workflowId: workflowId, enabled: spec.enabled !== false });
    var trgResult = TRG.schedule(triggerSpec);
    if (!trgResult.ok) { emit('automation:rejected', id, { error: trgResult.error }); return { ok: false, error: trgResult.error }; }

    var record = {
      id: id, name: spec.name, workflowId: workflowId, triggerId: trgResult.id,
      enabled: spec.enabled !== false, createdAt: Date.now()
    };
    defs[id] = record;
    save(defs);
    emit('automation:created', id, { workflowId: workflowId, triggerId: trgResult.id });
    nudgeAutomationAgent(spec.name, (spec.steps || []).map(function (s) { return s.op || s.skill || s.id; }));
    return { ok: true, automation: record };
  }

  function enable(id) {
    var defs = load();
    var record = defs[id];
    if (!record) return false;
    record.enabled = true;
    save(defs);
    TRG.resume(record.triggerId);
    emit('automation:enabled', id, {});
    return true;
  }

  function disable(id) {
    var defs = load();
    var record = defs[id];
    if (!record) return false;
    record.enabled = false;
    save(defs);
    TRG.pause(record.triggerId);
    emit('automation:disabled', id, {});
    return true;
  }

  function remove(id) {
    var defs = load();
    var record = defs[id];
    if (!record) return false;
    TRG.cancel(record.triggerId);
    delete defs[id];
    save(defs);
    emit('automation:removed', id, {});
    return true;
  }

  function run(id, input) {
    var defs = load();
    var record = defs[id];
    if (!record) return null;
    emit('automation:manual-run', id, { workflowId: record.workflowId });
    nudgeAutomationAgent(record.name, []);
    return WF.run(record.workflowId, input);
  }

  function get(id) { var defs = load(); return defs[id] ? Object.assign({}, defs[id]) : null; }
  function list() { var defs = load(); return Object.keys(defs).map(function (k) { return Object.assign({}, defs[k]); }); }

  return { create: create, enable: enable, disable: disable, remove: remove, run: run, get: get, list: list };
})();
