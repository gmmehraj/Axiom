// ============================================================
// AXIOM AI OS — Milestone 11: Autonomous Executive Extension
// ------------------------------------------------------------
// Objective 2: "Add autonomous multi-agent collaboration coordinated
// by the Executive AI."
// Objective 7: "Extend the Executive AI so it can decide between
// sequential and parallel execution based on task dependencies."
//
// Milestone 9's Executive AI already plans, dispatches, and supervises
// ONE request at a time, synchronously kicked off by a caller. This
// file extends that SAME object — window.AxiomExecutiveAI — exactly
// the way m8-bootstrap.js/m9-bootstrap.js/m10-bootstrap.js already
// extend window.AxiomRuntime: additively, via Object.assign, with
// zero edits to executive-ai.js itself. It adds one new capability:
// Executive AI can now be asked to autonomously plan a request, decide
// its execution mode from the REAL dependency graph (not just clause
// heuristics), and hand it to the Milestone 11 Task Scheduler for
// prioritized, background execution — including in response to
// another agent's own request, with zero user turn involved.
//
// Reuses:
//   - AxiomExecutiveAI.needsClarification() — the exact same guard
//     Milestone 9's handle() uses; an autonomous request with nothing
//     to resolve is refused the same way a conversational one is.
//   - AxiomTaskPlanner.createExecutionPlan() — decomposition, unchanged.
//   - AxiomTaskGraph.fromPlan()/.decideMode() (Milestone 11) — the
//     structural sequential/parallel decision.
//   - AxiomTaskScheduler.schedule() (Milestone 11) — prioritized,
//     dependency-aware, background execution. This module never calls
//     the Job Manager or Orchestrator directly.
//   - The Agent Event Bus — the ONLY channel other agents/modules use
//     to ask Executive AI for autonomous follow-up work.
// ============================================================
(function (global) {
  'use strict';

  var EXEC = global.AxiomExecutiveAI;
  var PLANNER = global.AxiomTaskPlanner;
  var GRAPH = global.AxiomTaskGraph;
  var SCHED = global.AxiomTaskScheduler;
  var RT = global.AxiomAgentRuntime;

  if (!EXEC || !PLANNER || !GRAPH || !SCHED || !RT) {
    AxLogger.error('[AxiomAutonomousExecutive] requires AxiomExecutiveAI (Milestone 9), AxiomTaskPlanner (Milestone 8), ' +
      'and AxiomTaskGraph/AxiomTaskScheduler (Milestone 11) all loaded first.');
    return;
  }
  var bus = RT.bus;
  var uid = window.AxiomMakeSeqId('auto-exec'); // see os/shared/id-factory.js
  function emit(type, executiveId, payload) {
    bus.emit(type, 'executive-ai', Object.assign({ executiveId: executiveId }, payload || {}));
  }

  // Concurrency for a parallel-mode plan is capped by the number of
  // distinct agents involved — identical policy to Executive AI's own
  // buildStrategy() in executive-ai.js, applied here to the structural
  // (graph-derived) mode instead of the clause-heuristic one.
  function concurrencyFor(mode, graph) {
    if (mode !== 'parallel') return 1;
    var distinctAgents = new Set(graph.nodes.map(function (n) { return n.agentId; }));
    return Math.min(distinctAgents.size, 4);
  }

  function scheduleAutonomous(request, opts) {
    opts = opts || {};
    var text = typeof request === 'string' ? request : String((request && (request.text || request.query || request.intent)) || '');
    var id = uid();

    var clarify = EXEC.needsClarification(text);
    if (clarify.required && !opts.skipClarification) {
      emit('executive:clarification-needed', id, { reason: clarify.reason, autonomous: true });
      return {
        executiveId: id, taskId: null, status: 'needs-clarification', mode: null,
        promise: Promise.resolve({ status: 'needs-clarification', executiveId: id, reason: clarify.reason })
      };
    }

    var plan = PLANNER.createExecutionPlan(text);
    var graph = GRAPH.fromPlan(plan);
    var mode = graph.mode; // 'sequential' | 'parallel' | 'mixed' — decided from the real dependency graph

    emit('executive:strategy-selected', id, { mode: mode, agents: graph.nodes.map(function (n) { return n.agentId; }), autonomous: true });

    var scheduled = SCHED.schedule(plan, {
      priority: opts.priority || 'normal',
      dependsOn: opts.dependsOn || [],
      retries: opts.retries,
      jobOpts: { concurrency: concurrencyFor(mode, graph) }
    });

    emit('executive:scheduled', id, { taskId: scheduled.taskId, mode: mode, priority: scheduled.priority, planId: plan.planId });

    var outcomePromise = scheduled.promise.then(function (result) {
      emit('executive:autonomous-' + result.status, id, { taskId: scheduled.taskId, jobId: result.jobId });
      return Object.assign({ executiveId: id, mode: mode }, result);
    });

    return { executiveId: id, taskId: scheduled.taskId, status: 'scheduled', mode: mode, promise: outcomePromise };
  }

  // Event-driven autonomous collaboration: ANY agent or module — never
  // just the user — can ask Executive AI to plan and coordinate a new
  // piece of multi-agent work by emitting a structured event, with no
  // direct function reference required. This is what makes the
  // collaboration "autonomous": it needs no synchronous caller waiting
  // on a return value, and it runs entirely in the background.
  bus.on('executive:auto-request', function (env) {
    if (env.source === 'executive-ai') return; // never react to our own emissions
    var payload = env.payload || {};
    if (!payload.text) return;
    scheduleAutonomous(payload.text, { priority: payload.priority, dependsOn: payload.dependsOn, retries: payload.retries });
  });

  Object.assign(EXEC, {
    scheduleAutonomous: scheduleAutonomous,
    decideExecutionMode: function (text) { return GRAPH.decideMode(GRAPH.fromPlan(PLANNER.createExecutionPlan(text))); }
  });
})(window);
