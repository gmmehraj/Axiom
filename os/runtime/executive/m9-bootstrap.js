// ============================================================
// AXIOM AI OS — Milestone 9: Bootstrap
// ------------------------------------------------------------
// Loads last among the Milestone 9 files, after every Milestone 8
// module. It touches no UI, no CSS, and no existing runtime file —
// it only:
//   1. Confirms the Executive AI module initialized (fails loud if not).
//   2. Extends the existing window.AxiomRuntime facade (added
//      non-destructively — every property Milestones 4/8 already put
//      there is preserved) with a `.executive` accessor.
//   3. Adds AxiomRuntime.selfTestM9(), a third self-test in the same
//      shape/style as selfTest() and selfTestM8(), covering only what
//      Milestone 9 actually added.
// ============================================================
(function (global) {
  'use strict';

  var EXEC = global.AxiomExecutiveAI;

  if (!EXEC) {
    AxLogger.error('[AxiomM9] AxiomExecutiveAI failed to initialize — check that executive-ai.js loaded ' +
      'after runtime-bootstrap.js and every os/runtime/intelligence/*.js file.');
  }

  if (global.AxiomRuntime) {
    Object.assign(global.AxiomRuntime, {
      executive: EXEC,

      selfTestM9: function () {
        return new Promise(function (resolve) {
          var results = [];
          function check(name, cond, detail) { results.push({ name: name, pass: !!cond, detail: detail || null }); }

          if (!EXEC) { check('AxiomExecutiveAI available', false); return finish(); }

          // 1. Clarification: a bare pronoun reference with nothing to
          //    resolve against is caught before anything is planned or run.
          var vague = EXEC.handle('do it');
          check('vague request short-circuits to clarification', vague.status === 'needs-clarification', vague.status);
          check('clarification never produced a jobId', vague.jobId === null);

          // 2. Clarification recovery: answering it re-enters the normal
          //    pipeline (still never executing directly — goes to handle()).
          var resumed = EXEC.resolveClarification(vague.executiveId, 'reset my password preference');
          check('resolveClarification re-enters the pipeline', !!(resumed && resumed.executiveId), resumed && resumed.status);

          // 3. End-to-end: a concrete request analyzes, plans, submits
          //    through the existing Job Manager, and supervises to completion.
          var run = EXEC.handle('remember: milestone 9 self-test ran');
          check('handle() returns a live executiveId + promise', !!(run.executiveId && run.promise));

          run.promise.then(function (outcome) {
            check('run reaches a terminal status', ['completed', 'needs-clarification', 'cancelled'].indexOf(outcome.status) !== -1, outcome.status);

            var snap = EXEC.status(run.executiveId);
            check('status() reports plan/job linkage', !!(snap && snap.planId && snap.jobId), snap && { planId: snap.planId, jobId: snap.jobId });

            var rep = EXEC.report();
            check('report() returns a learning ledger', rep && typeof rep.ledger === 'object');

            // 4. Never executes directly: every agent dispatch traced back to
            //    this run must have gone through AgentManager.dispatch (i.e.
            //    a plain task:assign envelope), never a bare function call
            //    Executive made on an agent itself. We can't prove a negative
            //    from outside, but we CAN confirm the orchestrator (the only
            //    thing Executive ever calls to move work forward) shows the
            //    run as a real, tracked run with real steps — meaning
            //    dispatch happened through the normal path, not a shortcut.
            var orchStatus = snap && snap.runId ? global.AxiomOrchestrator.status(snap.runId) : null;
            check('execution traced through the real Orchestrator', !!(orchStatus && orchStatus.steps && orchStatus.steps.length >= 1),
              orchStatus && orchStatus.steps.length);

            finish();
          }, function (err) {
            check('run reaches a terminal status', false, String(err && err.message || err));
            finish();
          });

          function finish() {
            var passed = results.filter(function (r) { return r.pass; }).length;
            var ok = passed === results.length;
            AxLogger.log('[AxiomM9] self-test ' + (ok ? 'PASS' : 'FAIL') + ' — ' + passed + '/' + results.length);
            results.forEach(function (r) { AxLogger.log('  ' + (r.pass ? 'ok  ' : 'FAIL') + ' ' + r.name + (r.detail !== null ? '  (' + JSON.stringify(r.detail) + ')' : '')); });
            resolve({ ok: ok, passed: passed, total: results.length, results: results });
          }
        });
      }
    });
  } else {
    AxLogger.warn('[AxiomM9] window.AxiomRuntime not found — run this after runtime-bootstrap.js. ' +
      'AxiomExecutiveAI is still available directly on window.');
  }

  AxLogger.log('[AxiomM9] Executive AI online' + (EXEC ? '' : ' (module missing — see error above)') +
    '. Run AxiomRuntime.selfTestM9() to verify.');
})(window);
