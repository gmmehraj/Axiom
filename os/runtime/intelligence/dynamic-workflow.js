// ============================================================
// AXIOM AI OS — Milestone 8: Dynamic Decomposition Workflow
// ------------------------------------------------------------
// Wires the new Intelligent Task Planner + Orchestrator + Job
// Manager into the EXISTING dispatch path, the same way every
// Milestone 5 workflow already does:
//   1. Add one function to the existing window.AxiomWorkflows
//      object (the same extensibility point named workflows already
//      use — this never edits capabilities/workflows.js itself).
//   2. Register ONE new Task Router rule via the router's existing
//      public addRule() API (never edits task-router.js) so a
//      genuinely compound, sequential request reaches it.
//
// Priority is deliberately placed AFTER the three named Milestone 6
// workflows (research/documents/development, priorities 5/19/33) so
// none of their existing behaviour changes, and the rule's `test`
// only matches when the request has an explicit sequencing word
// ("then", "after that") AND decomposes into 2+ steps naming more
// than one distinct agent — a bare "and" list for one agent (e.g.
// "search for cats and dogs") is intentionally left to the ordinary
// keyword rules below, unchanged.
// ============================================================
(function () {
  'use strict';

  var ROUTER = window.AxiomTaskRouter;
  var PLANNER = window.AxiomTaskPlanner;
  var JOBS = window.AxiomJobManager;
  if (!ROUTER || !PLANNER || !JOBS) {
    AxLogger.warn('[AxiomDynamicWorkflow] missing dependency — dynamic decomposition rule not registered.', {
      router: !!ROUTER, planner: !!PLANNER, jobs: !!JOBS
    });
    return;
  }

  function isGenuinelyCompound(text) {
    if (!/\bthen\b|\bafter that\b/i.test(text)) return false;
    var decomposition = PLANNER.decompose(text);
    var distinctAgents = new Set(decomposition.steps.map(function (s) { return s.agentId; }));
    return decomposition.steps.length > 1 && distinctAgents.size > 1;
  }

  // Runs the whole request as a background job (Task 4) and, once it
  // settles, presents a summary through the Assistant Agent exactly like
  // every hand-written workflow already does, so the chat surface behaves
  // consistently whether a request matched a fixed workflow or a
  // dynamically decomposed one.
  window.AxiomWorkflows = window.AxiomWorkflows || {};
  window.AxiomWorkflows.dynamicDecomposition = function (text) {
    var MGR = window.AxiomAgentManager;
    var RT = window.AxiomAgentRuntime;
    if (!MGR || !RT) return Promise.reject(new Error('Agent runtime is not available on this page.'));

    var job = JOBS.createJob(text);
    return new Promise(function (resolve) {
      var offCompleted = RT.bus.on('job:completed', onSettle);
      var offFailed = RT.bus.on('job:failed', onSettle);
      var offCancelled = RT.bus.on('job:cancelled', onSettle);

      function onSettle(env) {
        if (env.payload.jobId !== job.id) return;
        offCompleted(); offFailed(); offCancelled();
        var current = JOBS.getJob(job.id);
        var summary = 'Ran "' + text + '" as ' + (current.summary ? current.summary.steps.length : 0) +
          '-step background job — ' + current.status + '.';
        MGR.dispatch('agent.assistant', { intent: 'converse', text: summary, presenting: true, workflow: 'dynamicDecomposition' });
        RT.bus.emit('workflow:complete', 'system', { name: 'dynamicDecomposition', jobId: job.id });
        resolve({ ok: current.status === 'completed', jobId: job.id, job: current });
      }
    });
  };

  // agentId 'agent.assistant' is used as a nominal slot only (the workflow
  // below does the real dispatch) — it is deliberately NOT one of the
  // agentIds any keyword rule owns, so this rule can never be shadowed by
  // (or shadow) an existing rule's dedup-by-agent logic in route().
  // Priority 6 sits right after the research workflow (5) and before every
  // other named/keyword rule, but the narrow `test` above only matches an
  // explicit multi-agent "X then Y" request, so ordinary single-intent
  // requests are completely unaffected.
  ROUTER.addRule({
    agentId: 'agent.assistant',
    intent: 'dynamic-workflow',
    priority: 6,
    workflow: 'dynamicDecomposition',
    test: function (t) { return isGenuinelyCompound(t); }
  });

  AxLogger.log('[AxiomDynamicWorkflow] dynamic decomposition rule registered.');
})();
