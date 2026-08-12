// ============================================================
// AXIOM AI OS — Milestone 5: Planner Task Infrastructure
// ------------------------------------------------------------
// The milestone brief says "reuse the existing task infrastructure
// if available" — none exists yet anywhere in the codebase (no
// tasks/plans table, no todo store), so this file IS that
// infrastructure, built once, here, so the Planner Agent and any
// future agent/UI shares exactly one source of truth rather than
// each inventing its own.
//
// It follows the same persistence pattern browser-live.js already
// established for bookmarks/history: plain localStorage, so
// planning works immediately with no sign-in or backend required,
// and every method is synchronous-shaped (returns the value, not a
// Promise) so the Planner Agent's handler can await it uniformly
// alongside the other (async) capabilities.
//
// Public surface — window.AxiomPlanner:
//   .createPlan({goal, steps}) -> plan
//   .listPlans() -> plan[]
//   .getPlan(id) -> plan | null
//   .deletePlan(id) -> boolean
//   .addStep(planId, title, opts) -> step | null
//   .updateStep(planId, stepId, patch) -> step | null
//   .prioritize(planId, orderedStepIds) -> plan | null
//   .markComplete(planId, stepId) -> step | null
//   .progress(planId) -> {done, total, pct} | null
// ============================================================
window.AxiomPlanner = (function () {
  'use strict';

  var STORAGE_KEY = 'axiom-planner-plans';

  function uid(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return prefix + '-' + window.crypto.randomUUID();
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function save(plans) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(plans)); return true; }
    catch (e) { AxLogger.warn('[AxiomPlanner] could not persist plans:', e); return false; }
  }

  function findPlan(plans, id) {
    for (var i = 0; i < plans.length; i++) { if (plans[i].id === id) return plans[i]; }
    return null;
  }

  function createPlan(spec) {
    spec = spec || {};
    var goal = String(spec.goal || 'Untitled plan').trim();
    var rawSteps = Array.isArray(spec.steps) && spec.steps.length ? spec.steps : [goal];
    var now = Date.now();
    var plan = {
      id: uid('plan'),
      goal: goal,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      steps: rawSteps.map(function (s, i) {
        return {
          id: uid('step'),
          title: String(typeof s === 'string' ? s : (s.title || s.intent || 'Step ' + (i + 1))),
          status: 'pending', // pending | in_progress | done
          priority: rawSteps.length - i, // first steps default to higher priority
          order: i
        };
      })
    };
    var plans = load();
    plans.unshift(plan);
    save(plans);
    return plan;
  }

  function listPlans() { return load(); }

  function getPlan(id) { return findPlan(load(), id); }

  function deletePlan(id) {
    var plans = load();
    var next = plans.filter(function (p) { return p.id !== id; });
    if (next.length === plans.length) return false;
    save(next);
    return true;
  }

  function addStep(planId, title, opts) {
    opts = opts || {};
    var plans = load();
    var plan = findPlan(plans, planId);
    if (!plan) return null;
    var step = {
      id: uid('step'),
      title: String(title || 'New step'),
      status: 'pending',
      priority: typeof opts.priority === 'number' ? opts.priority : 0,
      order: plan.steps.length
    };
    plan.steps.push(step);
    plan.updatedAt = Date.now();
    save(plans);
    return step;
  }

  function updateStep(planId, stepId, patch) {
    patch = patch || {};
    var plans = load();
    var plan = findPlan(plans, planId);
    if (!plan) return null;
    var step = null;
    for (var i = 0; i < plan.steps.length; i++) { if (plan.steps[i].id === stepId) { step = plan.steps[i]; break; } }
    if (!step) return null;
    if (typeof patch.title === 'string') step.title = patch.title;
    if (typeof patch.status === 'string') step.status = patch.status;
    if (typeof patch.priority === 'number') step.priority = patch.priority;
    if ('deadline' in patch) step.deadline = patch.deadline; // Milestone 6: deadlines
    plan.updatedAt = Date.now();
    save(plans);
    return step;
  }

  // Reorders steps per `orderedStepIds` and derives priority from position
  // (first = highest), so "prioritize work" and "organize steps" share one
  // code path instead of two competing notions of order.
  function prioritize(planId, orderedStepIds) {
    var plans = load();
    var plan = findPlan(plans, planId);
    if (!plan || !Array.isArray(orderedStepIds)) return null;
    var byId = {};
    plan.steps.forEach(function (s) { byId[s.id] = s; });
    var reordered = orderedStepIds.map(function (id) { return byId[id]; }).filter(Boolean);
    // Anything not mentioned keeps its relative order, appended at the end.
    plan.steps.forEach(function (s) { if (orderedStepIds.indexOf(s.id) === -1) reordered.push(s); });
    reordered.forEach(function (s, i) { s.order = i; s.priority = reordered.length - i; });
    plan.steps = reordered;
    plan.updatedAt = Date.now();
    save(plans);
    return plan;
  }

  function markComplete(planId, stepId) {
    var step = updateStep(planId, stepId, { status: 'done' });
    if (!step) return null;
    var plan = getPlan(planId);
    if (plan && plan.steps.every(function (s) { return s.status === 'done'; })) {
      var plans = load();
      var p = findPlan(plans, planId);
      if (p) { p.status = 'completed'; p.updatedAt = Date.now(); save(plans); }
    }
    return step;
  }

  function progress(planId) {
    var plan = getPlan(planId);
    if (!plan) return null;
    var total = plan.steps.length;
    var done = plan.steps.filter(function (s) { return s.status === 'done'; }).length;
    return { done: done, total: total, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  // ================================================================
  // Milestone 6 — Planner upgrade: goals, subtasks, deadlines,
  // dependencies, daily/weekly plans, execution tracking.
  // Everything below still reads/writes the SAME `axiom-planner-plans`
  // localStorage array via load()/save()/findPlan() above — this is an
  // additive extension of the one planner store, not a second one.
  // ================================================================

  // "Goals": a plan flagged as a goal (vs. an ad-hoc task list). Goals are
  // plans in every other respect, so they get the full step/priority/
  // dependency machinery for free.
  function createGoal(spec) {
    spec = spec || {};
    var plan = createPlan(spec);
    var plans = load();
    var stored = findPlan(plans, plan.id);
    if (stored) {
      stored.type = 'goal';
      if (spec.targetDate) stored.targetDate = spec.targetDate;
      save(plans);
      plan = stored;
    }
    return plan;
  }

  // "Subtasks": a step nested under a parent step via `parentId`. Progress
  // and execution tracking both walk this same flat `steps` array, so a
  // subtask is a first-class step everywhere else in the store.
  function addSubtask(planId, parentStepId, title, opts) {
    opts = opts || {};
    var plans = load();
    var plan = findPlan(plans, planId);
    if (!plan) return null;
    var parent = null;
    for (var i = 0; i < plan.steps.length; i++) { if (plan.steps[i].id === parentStepId) { parent = plan.steps[i]; break; } }
    if (!parent) return null;
    var step = {
      id: uid('step'),
      title: String(title || 'New subtask'),
      status: 'pending',
      priority: typeof opts.priority === 'number' ? opts.priority : 0,
      order: plan.steps.length,
      parentId: parentStepId,
      dependsOn: [],
      deadline: opts.deadline || null
    };
    plan.steps.push(step);
    plan.updatedAt = Date.now();
    save(plans);
    return step;
  }

  function subtasksOf(planId, parentStepId) {
    var plan = getPlan(planId);
    if (!plan) return [];
    return plan.steps.filter(function (s) { return s.parentId === parentStepId; });
  }

  // "Deadlines": a due timestamp (ms epoch) on any step (goal-level, task,
  // or subtask — they're all steps).
  function setDeadline(planId, stepId, dueAt) {
    return updateStep(planId, stepId, { deadline: dueAt || null });
  }

  // "Dependencies": stepId B can't start until stepId A is done. Stored as
  // an array of step ids on the dependent step.
  function addDependency(planId, stepId, dependsOnStepId) {
    var plans = load();
    var plan = findPlan(plans, planId);
    if (!plan) return null;
    var step = null;
    for (var i = 0; i < plan.steps.length; i++) { if (plan.steps[i].id === stepId) { step = plan.steps[i]; break; } }
    if (!step || stepId === dependsOnStepId) return null;
    step.dependsOn = step.dependsOn || [];
    if (step.dependsOn.indexOf(dependsOnStepId) === -1) step.dependsOn.push(dependsOnStepId);
    plan.updatedAt = Date.now();
    save(plans);
    return step;
  }

  function removeDependency(planId, stepId, dependsOnStepId) {
    var plans = load();
    var plan = findPlan(plans, planId);
    if (!plan) return null;
    var step = null;
    for (var i = 0; i < plan.steps.length; i++) { if (plan.steps[i].id === stepId) { step = plan.steps[i]; break; } }
    if (!step) return null;
    step.dependsOn = (step.dependsOn || []).filter(function (id) { return id !== dependsOnStepId; });
    plan.updatedAt = Date.now();
    save(plans);
    return step;
  }

  // A step "can start" once every step it depends on is done (or it has no
  // dependencies). Used by execution tracking to block premature completion.
  function canStart(planId, stepId) {
    var plan = getPlan(planId);
    if (!plan) return false;
    var byId = {};
    plan.steps.forEach(function (s) { byId[s.id] = s; });
    var step = byId[stepId];
    if (!step || !step.dependsOn || !step.dependsOn.length) return true;
    return step.dependsOn.every(function (depId) { return byId[depId] && byId[depId].status === 'done'; });
  }

  // Dependency-aware completion: refuses to mark a step done while a
  // dependency is still open, instead of silently letting the graph go
  // inconsistent. Falls through to the existing markComplete once clear.
  function markCompleteChecked(planId, stepId) {
    if (!canStart(planId, stepId)) {
      return { blocked: true, reason: 'One or more dependencies are not done yet.' };
    }
    return markComplete(planId, stepId);
  }

  // "Execution tracking": every status change on a step is appended to the
  // plan's own executionLog, so "what happened and when" survives without a
  // separate audit-log store. Wraps the existing updateStep in place.
  var _origUpdateStep = updateStep;
  updateStep = function (planId, stepId, patch) {
    var before = getPlan(planId);
    var beforeStep = before && before.steps.filter(function (s) { return s.id === stepId; })[0];
    var result = _origUpdateStep(planId, stepId, patch);
    if (result && patch && typeof patch.status === 'string') {
      var plans = load();
      var plan = findPlan(plans, planId);
      if (plan) {
        plan.executionLog = plan.executionLog || [];
        plan.executionLog.push({
          at: Date.now(), stepId: stepId,
          from: beforeStep ? beforeStep.status : null, to: patch.status
        });
        if (plan.executionLog.length > 200) plan.executionLog = plan.executionLog.slice(-200);
        save(plans);
      }
    }
    return result;
  };

  function executionLog(planId) {
    var plan = getPlan(planId);
    return plan ? (plan.executionLog || []) : [];
  }

  // "Daily plans" / "weekly plans": derived views over every step across
  // every plan that has a deadline landing in the requested window — not a
  // separate calendar store, just a query over the one planner store.
  function dayBounds(dateLike) {
    var d = dateLike ? new Date(dateLike) : new Date();
    var start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var end = start + 24 * 60 * 60 * 1000 - 1;
    return { start: start, end: end };
  }

  function weekBounds(dateLike) {
    var d = dateLike ? new Date(dateLike) : new Date();
    var day = d.getDay(); // 0=Sun
    var mondayOffset = (day === 0 ? -6 : 1 - day);
    var monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + mondayOffset);
    var start = monday.getTime();
    var end = start + 7 * 24 * 60 * 60 * 1000 - 1;
    return { start: start, end: end };
  }

  function stepsInWindow(start, end) {
    var out = [];
    load().forEach(function (plan) {
      plan.steps.forEach(function (s) {
        if (typeof s.deadline === 'number' && s.deadline >= start && s.deadline <= end) {
          out.push(Object.assign({ planId: plan.id, goal: plan.goal }, s));
        }
      });
    });
    return out.sort(function (a, b) { return (a.deadline || 0) - (b.deadline || 0); });
  }

  function dailyPlan(dateLike) {
    var b = dayBounds(dateLike);
    return { date: new Date(b.start).toISOString().slice(0, 10), steps: stepsInWindow(b.start, b.end) };
  }

  function weeklyPlan(dateLike) {
    var b = weekBounds(dateLike);
    return {
      weekStart: new Date(b.start).toISOString().slice(0, 10),
      weekEnd: new Date(b.end).toISOString().slice(0, 10),
      steps: stepsInWindow(b.start, b.end)
    };
  }

  return {
    createPlan: createPlan, listPlans: listPlans, getPlan: getPlan, deletePlan: deletePlan,
    addStep: addStep, updateStep: updateStep, prioritize: prioritize,
    markComplete: markComplete, progress: progress,
    // Milestone 6 additions:
    createGoal: createGoal, addSubtask: addSubtask, subtasksOf: subtasksOf,
    setDeadline: setDeadline, addDependency: addDependency, removeDependency: removeDependency,
    canStart: canStart, markCompleteChecked: markCompleteChecked, executionLog: executionLog,
    dailyPlan: dailyPlan, weeklyPlan: weeklyPlan
  };
})();
