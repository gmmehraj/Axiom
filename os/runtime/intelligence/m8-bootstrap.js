// ============================================================
// AXIOM AI OS — Milestone 8: Bootstrap
// ------------------------------------------------------------
// Loads last among the Milestone 8 modules. It touches no UI, no
// CSS, and no existing runtime file — it only:
//   1. Confirms every M8 module initialized (fails loud if not).
//   2. Extends the existing window.AxiomRuntime facade (added
//      non-destructively — every Milestone 4 property it already
//      had is preserved) with accessors for the new subsystems.
//   3. Adds AxiomRuntime.selfTestM8(), a second self-test in the
//      same shape/style as the Milestone 4 selfTest(), covering
//      only what Milestone 8 actually added.
// ============================================================
(function (global) {
  'use strict';

  var modules = {
    contextStore: global.AxiomContextStore,
    taskPlanner: global.AxiomTaskPlanner,
    orchestrator: global.AxiomOrchestrator,
    jobs: global.AxiomJobManager,
    monitor: global.AxiomRuntimeMonitor,
    recovery: global.AxiomErrorRecovery,
    plannerIntel: global.AxiomPlannerIntelligence,
    browserIntel: global.AxiomBrowserIntelligence,
    memoryIntel: global.AxiomMemoryIntelligence
  };

  var missing = Object.keys(modules).filter(function (k) { return !modules[k]; });
  if (missing.length) {
    AxLogger.error('[AxiomM8] the following Milestone 8 modules failed to initialize:', missing);
  }

  if (global.AxiomRuntime) {
    Object.assign(global.AxiomRuntime, {
      context: modules.contextStore,
      planner8: modules.taskPlanner,
      orchestrator: modules.orchestrator,
      jobs: modules.jobs,
      monitor: modules.monitor,
      recovery: modules.recovery,
      plannerIntelligence: modules.plannerIntel,
      browserIntelligence: modules.browserIntel,
      memoryIntelligence: modules.memoryIntel,

      selfTestM8: function () {
        return new Promise(function (resolve) {
          var results = [];
          function check(name, cond, detail) { results.push({ name: name, pass: !!cond, detail: detail || null }); }

          // 1. Decomposition splits a compound request into ordered,
          //    dependency-linked, multi-agent steps.
          var decomposition = modules.taskPlanner
            ? modules.taskPlanner.decompose('search AI startups, then remember the best ones, then create a plan')
            : null;
          check('decompose produces multiple steps', decomposition && decomposition.steps.length >= 2,
            decomposition && decomposition.steps.length);
          check('decompose links dependencies in order', decomposition && decomposition.steps.length > 1 &&
            decomposition.steps[decomposition.steps.length - 1].dependsOn.length > 0);

          // 2. Orchestrator executes a trivial single-step plan end-to-end.
          var orchestratorCheck = modules.orchestrator
            ? modules.orchestrator.run({ goal: 'selftest', steps: [{ id: 'st-1', clause: 'ping', agentId: 'agent.assistant', task: { intent: 'converse', text: 'ping' }, dependsOn: [] }] }).promise
            : Promise.resolve(null);

          orchestratorCheck.then(function (result) {
            check('orchestrator run completes', result && result.status === 'completed', result && result.status);

            // 3. Runtime monitor reports the expected shape.
            var rep = modules.monitor ? modules.monitor.report() : null;
            check('monitor report shape', rep && rep.taskCounters && rep.queueSizes !== undefined);

            // 4. Error recovery reports without throwing.
            var recReport = modules.recovery ? modules.recovery.report() : null;
            check('error recovery report available', !!recReport);

            // 5. Planner intelligence estimate/reprioritize on a real plan.
            if (modules.plannerIntel && global.AxiomPlanner) {
              var plan = global.AxiomPlanner.createPlan({ goal: 'M8 selftest plan', steps: ['a', 'b', 'c'] });
              var est = modules.plannerIntel.estimate(plan.id);
              check('planner estimate returns an ETA', est && typeof est.etaMs === 'number');
              var reprioritized = modules.plannerIntel.reprioritize(plan.id);
              check('planner reprioritize returns a plan', !!reprioritized);
              global.AxiomPlanner.deletePlan(plan.id);
            } else {
              check('planner estimate returns an ETA', false, 'module missing');
            }

            // 6. Job manager creates a trackable job.
            var job = modules.jobs ? modules.jobs.createJob('ping the assistant') : null;
            check('job manager creates a job', !!(job && job.id));

            finish();
          }, function (err) {
            check('orchestrator run completes', false, String(err && err.message || err));
            finish();
          });

          function finish() {
            var passed = results.filter(function (r) { return r.pass; }).length;
            var ok = passed === results.length;
            AxLogger.log('[AxiomM8] self-test ' + (ok ? 'PASS' : 'FAIL') + ' — ' + passed + '/' + results.length);
            results.forEach(function (r) { AxLogger.log('  ' + (r.pass ? 'ok  ' : 'FAIL') + ' ' + r.name + (r.detail !== null ? '  (' + r.detail + ')' : '')); });
            resolve({ ok: ok, passed: passed, total: results.length, results: results });
          }
        });
      }
    });
  } else {
    AxLogger.warn('[AxiomM8] window.AxiomRuntime not found — run this after runtime-bootstrap.js. M8 modules are still available individually on window.');
  }

  AxLogger.log('[AxiomM8] Milestone 8 intelligence layer online' + (missing.length ? ' (with missing modules — see above)' : '') + '. Run AxiomRuntime.selfTestM8() to verify.');
})(window);
