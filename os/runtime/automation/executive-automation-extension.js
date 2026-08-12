// ============================================================
// AXIOM AI OS — Milestone 13: Executive AI Automation Extension
// ------------------------------------------------------------
// Objective 8: "Integrate with Executive AI."
// Objective 5 (continued): "Allow multi-agent automation" — driven
// autonomously by Executive AI's own planning, not just by a
// hand-authored workflow.
//
// Extends the EXISTING window.AxiomExecutiveAI object — exactly the
// same non-destructive Object.assign technique autonomous-executive.js
// (Milestone 11) and executive-knowledge-extension.js (Milestone 12)
// already used on this object. Zero edits to executive-ai.js itself.
//
// What it adds: Executive AI can turn any natural-language request
// into a genuine, dependency-ordered, multi-agent CUSTOM WORKFLOW
// (Milestone 13) instead of only a one-off Job Manager run — reusing
// its own EXISTING decomposition:
//   AxiomTaskPlanner.createExecutionPlan(text)  (unchanged, Milestone 8)
//     -> plan.steps[] {id, agentId, clause, dependsOn}
//     -> reshaped (not re-derived) into workflow steps
//     -> AxiomWorkflowEngine.define() + .run()   (Milestone 13)
//
// Reuses:
//   - AxiomExecutiveAI.needsClarification() — same guard handle() uses.
//   - AxiomTaskPlanner.createExecutionPlan() — decomposition, unchanged.
//   - AxiomWorkflowEngine — definition + dependency-layered execution.
//   - The Agent Event Bus — the only channel another agent/module uses
//     to ask Executive AI for an autonomous automation, mirroring
//     'executive:auto-request' from Milestone 11.
// ============================================================
(function (global) {
  'use strict';

  var EXEC = global.AxiomExecutiveAI;
  var PLANNER = global.AxiomTaskPlanner;
  var WF = global.AxiomWorkflowEngine;
  var RT = global.AxiomAgentRuntime;

  if (!EXEC || !PLANNER || !WF || !RT) {
    AxLogger.error('[AxiomExecutiveAutomation] requires AxiomExecutiveAI (Milestone 9), AxiomTaskPlanner (Milestone 8), ' +
      'and AxiomWorkflowEngine (Milestone 13) all loaded first.');
    return;
  }
  var bus = RT.bus;
  var uid = window.AxiomMakeSeqId('exec-auto'); // see os/shared/id-factory.js
  function emit(type, executiveId, payload) {
    bus.emit(type, 'executive-ai', Object.assign({ executiveId: executiveId }, payload || {}));
  }

  // Reshapes an UNCHANGED AxiomTaskPlanner plan into workflow-engine step
  // shape — every agentId/clause/dependsOn value is carried over verbatim,
  // never re-derived, so routing behaviour cannot drift from what
  // handle()/scheduleAutonomous() would have used for the same text.
  function planToWorkflowSteps(plan) {
    return plan.steps.map(function (s) {
      return { id: s.id, agentId: s.agentId, name: s.clause, op: 'executive-automation', input: { text: s.clause }, dependsOn: s.dependsOn || [] };
    });
  }

  function runAsAutomation(request, opts) {
    opts = opts || {};
    var text = typeof request === 'string' ? request : String((request && (request.text || request.query || request.intent)) || '');
    var id = uid();

    var clarify = EXEC.needsClarification(text);
    if (clarify.required && !opts.skipClarification) {
      emit('executive:clarification-needed', id, { reason: clarify.reason, automation: true });
      return { executiveId: id, workflowId: null, runId: null, status: 'needs-clarification',
        promise: Promise.resolve({ status: 'needs-clarification', executiveId: id, reason: clarify.reason }) };
    }

    var plan = PLANNER.createExecutionPlan(text);
    var workflowId = 'workflow.executive-' + (plan.planId || id);
    var defResult = WF.define({
      id: workflowId, name: 'Executive automation: ' + text, overwrite: true,
      description: 'Auto-defined by Executive AI from a natural-language request.',
      steps: planToWorkflowSteps(plan)
    });
    if (!defResult.ok) {
      emit('executive:clarification-needed', id, { reason: 'Could not define an automation workflow: ' + defResult.error });
      return { executiveId: id, workflowId: null, runId: null, status: 'failed',
        promise: Promise.resolve({ status: 'failed', executiveId: id, error: defResult.error }) };
    }

    emit('executive:automation-defined', id, { workflowId: workflowId, steps: plan.steps.length });
    var run = WF.run(workflowId, opts.input);
    emit('executive:automation-started', id, { workflowId: workflowId, runId: run.runId });

    var promise = run.promise.then(function (outcome) {
      emit(outcome.ok ? 'executive:automation-completed' : 'executive:automation-failed', id, { workflowId: workflowId, runId: run.runId });
      return Object.assign({ executiveId: id, workflowId: workflowId }, outcome);
    });

    return { executiveId: id, workflowId: workflowId, runId: run.runId, status: 'running', promise: promise };
  }

  // Autonomous, event-driven front door — mirrors Milestone 11's
  // 'executive:auto-request': any agent or module can ask Executive AI
  // to turn a request into a running multi-agent automation with no
  // direct function reference and no user turn involved.
  bus.on('automation:auto-request', function (env) {
    if (env.source === 'executive-ai') return;
    var payload = env.payload || {};
    if (!payload.text) return;
    runAsAutomation(payload.text, { input: payload.input });
  });

  Object.assign(EXEC, {
    runAsAutomation: runAsAutomation
  });
})(window);
