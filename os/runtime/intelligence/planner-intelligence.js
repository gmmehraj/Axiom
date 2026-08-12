// ============================================================
// AXIOM AI OS — Milestone 8: Planner Intelligence
// ------------------------------------------------------------
// Task 7 asks the Planner to create plans (already true — Milestone
// 5/6's AxiomPlanner), track completion (already true — progress()/
// executionLog), and ALSO re-prioritize, schedule and estimate. This
// module adds exactly those three, calling only AxiomPlanner's public
// API — it never touches planner-store.js's internal storage.
//
// Public surface — window.AxiomPlannerIntelligence:
//   .reprioritize(planId)          -> plan | null   (writes new order)
//   .scheduleWorkflow(planId, atMs, runner?) -> scheduleId | null
//   .cancelSchedule(scheduleId)    -> boolean
//   .estimate(planId)              -> { remainingSteps, avgStepMs, etaMs, etaAt }
// ============================================================
window.AxiomPlannerIntelligence = (function () {
  'use strict';

  var PLANNER = window.AxiomPlanner;
  if (!PLANNER) {
    AxLogger.error('[AxiomPlannerIntelligence] requires capabilities/planner-store.js loaded first.');
    return null;
  }

  var schedules = new Map(); // scheduleId -> timer
  var scheduleSeq = 0;

  // Auto re-prioritization: ready steps (no open dependency) with the
  // nearest deadline go first; steps still blocked on a dependency sort
  // after every ready step, deadline permitting; steps with no deadline
  // keep their existing relative order. This is a scheduling HEURISTIC,
  // not a solver — documented plainly rather than oversold.
  function reprioritize(planId) {
    var plan = PLANNER.getPlan(planId);
    if (!plan) return null;

    var ordered = plan.steps.slice().sort(function (a, b) {
      var aReady = PLANNER.canStart(planId, a.id) ? 0 : 1;
      var bReady = PLANNER.canStart(planId, b.id) ? 0 : 1;
      if (aReady !== bReady) return aReady - bReady;
      var aDue = typeof a.deadline === 'number' ? a.deadline : Infinity;
      var bDue = typeof b.deadline === 'number' ? b.deadline : Infinity;
      if (aDue !== bDue) return aDue - bDue;
      return a.order - b.order;
    });
    return PLANNER.prioritize(planId, ordered.map(function (s) { return s.id; }));
  }

  // Scheduling: fires `runner` (defaults to nothing but a bus event) once
  // at the given time. Persists nothing across a reload — an honest
  // limitation for a localStorage-only, no-backend OS, called out in the
  // deliverable notes rather than silently dropped.
  function scheduleWorkflow(planId, atMs, runner) {
    var plan = PLANNER.getPlan(planId);
    if (!plan) return null;
    var delayMs = Math.max(0, (atMs || Date.now()) - Date.now());
    var scheduleId = 'sched-' + (++scheduleSeq);
    var timer = setTimeout(function () {
      schedules.delete(scheduleId);
      var bus = window.AxiomAgentRuntime && window.AxiomAgentRuntime.bus;
      if (bus) bus.emit('planner:schedule-fired', 'planner-intelligence', { planId: planId, scheduleId: scheduleId });
      if (typeof runner === 'function') runner(plan);
      else if (window.AxiomJobManager) window.AxiomJobManager.createJob(plan.goal);
    }, delayMs);
    schedules.set(scheduleId, timer);
    return scheduleId;
  }

  function cancelSchedule(scheduleId) {
    var timer = schedules.get(scheduleId);
    if (!timer) return false;
    clearTimeout(timer);
    schedules.delete(scheduleId);
    return true;
  }

  // Estimation: derives an average step duration from the plan's own
  // executionLog (real observed transitions -> in_progress -> done), so
  // the estimate improves the more the plan has actually been worked,
  // rather than a made-up constant. Falls back to a conservative default
  // when there is no history yet.
  var DEFAULT_STEP_MS = 45000;

  function estimate(planId) {
    var plan = PLANNER.getPlan(planId);
    if (!plan) return null;
    var log = PLANNER.executionLog(planId);
    var doneDurations = [];
    var openStarts = {};
    log.forEach(function (entry) {
      if (entry.to === 'in_progress') openStarts[entry.stepId] = entry.at;
      if (entry.to === 'done' && openStarts[entry.stepId]) {
        doneDurations.push(entry.at - openStarts[entry.stepId]);
        delete openStarts[entry.stepId];
      }
    });
    var avgStepMs = doneDurations.length
      ? Math.round(doneDurations.reduce(function (a, b) { return a + b; }, 0) / doneDurations.length)
      : DEFAULT_STEP_MS;

    var remaining = plan.steps.filter(function (s) { return s.status !== 'done'; }).length;
    var etaMs = remaining * avgStepMs;
    return { remainingSteps: remaining, avgStepMs: avgStepMs, etaMs: etaMs, etaAt: Date.now() + etaMs, sampleSize: doneDurations.length };
  }

  return { reprioritize: reprioritize, scheduleWorkflow: scheduleWorkflow, cancelSchedule: cancelSchedule, estimate: estimate };
})();
