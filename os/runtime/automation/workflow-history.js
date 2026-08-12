// ============================================================
// AXIOM AI OS — Milestone 13: Workflow History & Logs
// ------------------------------------------------------------
// Objective 6: "Add workflow history and logs."
//
// Exactly the same non-invasive shape as event-timeline.js
// (Milestone 11): a pure, read-only SUBSCRIBER on the shared Agent
// Event Bus. It never calls into the Workflow Engine, Trigger
// Scheduler, Skill Registry, or Automation Engine — it only listens
// to the structured lifecycle events those modules already emit and
// correlates them (by runId / id) into bounded, queryable, persisted
// run records. No other module reads or writes this log for its own
// logic, so history can never desync execution behaviour.
//
// Public surface — window.AxiomWorkflowHistory:
//   .runs(limit?)              -> WorkflowRun[]   (newest-first)
//   .getRun(runId)             -> WorkflowRun | null
//   .byWorkflow(workflowId, limit?) -> WorkflowRun[]
//   .triggers(limit?)          -> TriggerFiring[] (newest-first)
//   .skills(limit?)            -> SkillInvocation[] (newest-first)
//   .clear()                   -> empties the in-memory + persisted log
// ============================================================
window.AxiomWorkflowHistory = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  if (!RT) {
    AxLogger.error('[AxiomWorkflowHistory] requires agent-runtime.js loaded first.');
    return null;
  }
  var bus = RT.bus;

  var MAX_RUNS = 300, MAX_TRIGGERS = 300, MAX_SKILLS = 300;
  var PERSIST_KEY = 'axiom-workflow-history';

  var runsById = new Map();   // runId -> record
  var runOrder = [];          // runId insertion order, bounded
  var triggerLog = [];        // bounded
  var skillLog = [];          // bounded

  function loadPersisted() {
    try {
      var raw = JSON.parse(localStorage.getItem(PERSIST_KEY) || '{}');
      (raw.runs || []).forEach(function (r) { runsById.set(r.runId, r); runOrder.push(r.runId); });
      triggerLog = raw.triggers || [];
      skillLog = raw.skills || [];
    } catch (e) { /* corrupt or unavailable — start empty */ }
  }
  function persist() {
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify({
        runs: runOrder.slice(-MAX_RUNS).map(function (id) { return runsById.get(id); }).filter(Boolean),
        triggers: triggerLog.slice(-MAX_TRIGGERS),
        skills: skillLog.slice(-MAX_SKILLS)
      }));
    } catch (e) { /* storage full/unavailable — log still works in-memory */ }
  }

  loadPersisted();

  function ensureRun(runId, workflowId) {
    if (!runsById.has(runId)) {
      runsById.set(runId, { runId: runId, workflowId: workflowId || null, status: 'running', startedAt: Date.now(), finishedAt: null, mode: null, steps: [] });
      runOrder.push(runId);
      if (runOrder.length > MAX_RUNS) { var evicted = runOrder.shift(); runsById.delete(evicted); }
    }
    return runsById.get(runId);
  }

  bus.on('workflow:custom-start', function (env) {
    var p = env.payload || {};
    var record = ensureRun(p.runId, p.workflowId);
    record.mode = p.mode || record.mode;
    persist();
  });
  bus.on('workflow:custom-step-done', function (env) {
    var p = env.payload || {};
    var record = runsById.get(p.runId);
    if (!record) return;
    record.steps.push({ stepId: p.stepId, ok: true, at: Date.now() });
    persist();
  });
  bus.on('workflow:custom-step-failed', function (env) {
    var p = env.payload || {};
    var record = runsById.get(p.runId);
    if (!record) return;
    record.steps.push({ stepId: p.stepId, ok: false, error: p.error || null, skipped: !!p.skipped, at: Date.now() });
    persist();
  });
  bus.on('workflow:custom-complete', function (env) {
    var p = env.payload || {};
    var record = ensureRun(p.runId, p.workflowId);
    record.status = 'completed';
    record.finishedAt = Date.now();
    persist();
  });
  bus.on('workflow:custom-failed', function (env) {
    var p = env.payload || {};
    var record = ensureRun(p.runId, p.workflowId);
    record.status = 'failed';
    record.finishedAt = Date.now();
    record.error = p.error || null;
    persist();
  });

  bus.on('trigger:fired', function (env) {
    triggerLog.push({ id: env.payload.id, fireCount: env.payload.fireCount, at: Date.now(), status: 'fired' });
    if (triggerLog.length > MAX_TRIGGERS) triggerLog.shift();
    persist();
  });
  bus.on('trigger:completed', function (env) {
    triggerLog.push({ id: env.payload.id, fireCount: env.payload.fireCount, at: Date.now(), status: 'completed' });
    if (triggerLog.length > MAX_TRIGGERS) triggerLog.shift();
    persist();
  });
  bus.on('trigger:failed', function (env) {
    triggerLog.push({ id: env.payload.id, fireCount: env.payload.fireCount, at: Date.now(), status: 'failed', error: env.payload.error || null });
    if (triggerLog.length > MAX_TRIGGERS) triggerLog.shift();
    persist();
  });

  bus.on('skill:invoked', function (env) {
    skillLog.push({ id: env.payload.id, invocationId: env.payload.invocationId, at: Date.now(), status: 'invoked' });
    if (skillLog.length > MAX_SKILLS) skillLog.shift();
    persist();
  });
  bus.on('skill:completed', function (env) {
    skillLog.push({ id: env.payload.id, invocationId: env.payload.invocationId, at: Date.now(), status: 'completed' });
    if (skillLog.length > MAX_SKILLS) skillLog.shift();
    persist();
  });
  bus.on('skill:failed', function (env) {
    skillLog.push({ id: env.payload.id, invocationId: env.payload.invocationId, at: Date.now(), status: 'failed', error: env.payload.error || null });
    if (skillLog.length > MAX_SKILLS) skillLog.shift();
    persist();
  });

  function newestFirst(list) { return list.slice().reverse(); }

  function runs(limit) { return newestFirst(runOrder.map(function (id) { return runsById.get(id); })).slice(0, limit || 50); }
  function getRun(runId) { return runsById.has(runId) ? Object.assign({}, runsById.get(runId)) : null; }
  function byWorkflow(workflowId, limit) {
    return newestFirst(runOrder.map(function (id) { return runsById.get(id); }).filter(function (r) { return r && r.workflowId === workflowId; })).slice(0, limit || 50);
  }
  function triggers(limit) { return newestFirst(triggerLog).slice(0, limit || 50); }
  function skills(limit) { return newestFirst(skillLog).slice(0, limit || 50); }

  function clear() {
    runsById.clear(); runOrder = []; triggerLog = []; skillLog = [];
    try { localStorage.removeItem(PERSIST_KEY); } catch (e) { /* ignore */ }
  }

  return { runs: runs, getRun: getRun, byWorkflow: byWorkflow, triggers: triggers, skills: skills, clear: clear };
})();
