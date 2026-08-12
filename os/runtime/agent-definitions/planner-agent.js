// ============================================================
// AXIOM AI OS — Agent Definition: Planner Agent
// ------------------------------------------------------------
// Split out of the former monolithic os/runtime/agent-definitions.js
// as part of Phase 8 Part 2 (Code Quality & Maintainability). Behavior
// is unchanged — this is the exact same spec object, just given its
// own file. See os/runtime/agent-definitions/_shared.js for the
// `tick`/`has` helpers and os/runtime/agent-definitions/_assemble.js
// for how every agent file's spec is collected into the same
// window.AxiomAgentDefinitions / window.AxiomAgentDefinitionsById
// globals the rest of the runtime already depends on.
// ============================================================
(function (global) {
  'use strict';
  var tick = global.AxiomAgentDefHelpers.tick;
  var has = global.AxiomAgentDefHelpers.has;

  (global.__axiomAgentDefs = global.__axiomAgentDefs || []).push(
{
  id: 'agent.planner',
  name: 'Planner Agent',
  description: 'Decomposes a high-level goal into an ordered plan of sub-tasks and hands each step to the agent best suited to it.',
  icon: '\uD83D\uDDFA\uFE0F',
  canonicalState: 'thinking',
  capabilities: ['decompose', 'sequence', 'orchestrate', 'prioritize', 'track-progress',
    'goals', 'subtasks', 'deadlines', 'dependencies', 'daily-plan', 'weekly-plan', 'execution-tracking'],
  tools: ['planner'],
  subscriptions: ['task:assign'],
  // Milestone 5: backed by planner-store.js, the task infrastructure
  // this OS didn't have yet — create/organize/prioritize/update/
  // complete all go through that one store.
  handler: async function (task, ctx) {
    var planner = global.AxiomPlanner;
    var op = task.op || (task.goal || task.text ? 'create-plan' : 'list-plans');

    if (!planner) {
      await tick(150);
      return { ok: true, op: op, note: 'Planner op "' + op + '" acknowledged (no planner store on this page).' };
    }

    var run = function () {
      switch (op) {
        case 'create-plan':
          return Promise.resolve(planner.createPlan({ goal: task.goal || task.text, steps: task.steps }));
        case 'list-plans':
          return Promise.resolve(planner.listPlans());
        case 'get-plan':
          if (!task.planId) throw new Error('"get-plan" requires a planId.');
          return Promise.resolve(planner.getPlan(task.planId));
        case 'add-step':
          if (!task.planId || !task.title) throw new Error('"add-step" requires a planId and title.');
          return Promise.resolve(planner.addStep(task.planId, task.title, task.opts));
        case 'update-step':
          if (!task.planId || !task.stepId) throw new Error('"update-step" requires a planId and stepId.');
          return Promise.resolve(planner.updateStep(task.planId, task.stepId, task.patch || {}));
        case 'prioritize':
          if (!task.planId || !task.order) throw new Error('"prioritize" requires a planId and order.');
          return Promise.resolve(planner.prioritize(task.planId, task.order));
        case 'complete':
          if (!task.planId || !task.stepId) throw new Error('"complete" requires a planId and stepId.');
          return Promise.resolve(planner.markComplete(task.planId, task.stepId));
        case 'progress':
          if (!task.planId) throw new Error('"progress" requires a planId.');
          return Promise.resolve(planner.progress(task.planId));
        case 'delete-plan':
          if (!task.planId) throw new Error('"delete-plan" requires a planId.');
          return Promise.resolve(planner.deletePlan(task.planId));
        // -------------------- Milestone 6 --------------------
        case 'create-goal':
          return Promise.resolve(planner.createGoal({ goal: task.goal || task.text, steps: task.steps, targetDate: task.targetDate }));
        case 'add-subtask':
          if (!task.planId || !task.parentStepId || !task.title) throw new Error('"add-subtask" requires a planId, parentStepId and title.');
          return Promise.resolve(planner.addSubtask(task.planId, task.parentStepId, task.title, task.opts));
        case 'set-deadline':
          if (!task.planId || !task.stepId) throw new Error('"set-deadline" requires a planId and stepId.');
          return Promise.resolve(planner.setDeadline(task.planId, task.stepId, task.dueAt));
        case 'add-dependency':
          if (!task.planId || !task.stepId || !task.dependsOnStepId) throw new Error('"add-dependency" requires a planId, stepId and dependsOnStepId.');
          return Promise.resolve(planner.addDependency(task.planId, task.stepId, task.dependsOnStepId));
        case 'remove-dependency':
          if (!task.planId || !task.stepId || !task.dependsOnStepId) throw new Error('"remove-dependency" requires a planId, stepId and dependsOnStepId.');
          return Promise.resolve(planner.removeDependency(task.planId, task.stepId, task.dependsOnStepId));
        case 'can-start':
          if (!task.planId || !task.stepId) throw new Error('"can-start" requires a planId and stepId.');
          return Promise.resolve({ canStart: planner.canStart(task.planId, task.stepId) });
        case 'complete-checked':
          if (!task.planId || !task.stepId) throw new Error('"complete-checked" requires a planId and stepId.');
          return Promise.resolve(planner.markCompleteChecked(task.planId, task.stepId));
        case 'execution-log':
          if (!task.planId) throw new Error('"execution-log" requires a planId.');
          return Promise.resolve(planner.executionLog(task.planId));
        case 'daily-plan':
          return Promise.resolve(planner.dailyPlan(task.date));
        case 'weekly-plan':
          return Promise.resolve(planner.weeklyPlan(task.date));
        default:
          throw new Error('Unsupported planner op "' + op + '".');
      }
    };

    var kit = global.AxiomCapabilityKit;
    try {
      var result = kit
        ? await kit.withCapability('planner:' + op, task, ctx, run, { timeoutMs: 5000, retries: 2 })
        : await run();
      // Preserve the existing "dispatch each step through the router"
      // behaviour for callers that explicitly ask for it.
      if (op === 'create-plan' && task.dispatch && result && Array.isArray(result.steps) &&
          ctx.manager && typeof ctx.manager.route === 'function') {
        result.steps.forEach(function (s) { ctx.manager.route(s.title, { via: 'planner' }); });
      }
      return { ok: true, op: op, result: result };
    } catch (e) {
      return { ok: false, op: op, error: String(e && e.message || e) };
    }
  }
}
  );
})(window);
