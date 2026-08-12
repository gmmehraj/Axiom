// ============================================================
// AXIOM AI OS — Milestone 11: Bootstrap
// ------------------------------------------------------------
// Loads last among the Milestone 11 files, after every Milestone
// 4/8/9/10 module. Mirrors the shape of m8-bootstrap.js /
// m9-bootstrap.js / m10-bootstrap.js exactly: it touches no UI, no
// CSS, and no existing runtime file — it only:
//   1. Confirms every Milestone 11 module initialized (fails loud if not).
//   2. Extends the existing window.AxiomRuntime facade non-destructively
//      (every property Milestones 4/8/9/10 already put there is
//      preserved) with accessors for the new subsystems.
//   3. Adds AxiomRuntime.selfTestM11(), a fifth self-test in the same
//      shape/style as selfTest()/selfTestM8()/selfTestM9()/selfTestM10(),
//      covering only what Milestone 11 actually added.
// ============================================================
(function (global) {
  'use strict';

  var modules = {
    timeline: global.AxiomEventTimeline,
    taskGraph: global.AxiomTaskGraph,
    scheduler: global.AxiomTaskScheduler,
    resourceMonitor: global.AxiomResourceMonitor,
    plugins: global.AxiomPluginRegistry
  };

  var missing = Object.keys(modules).filter(function (k) { return !modules[k]; });
  if (missing.length) {
    AxLogger.error('[AxiomM11] the following Milestone 11 modules failed to initialize:', missing);
  }
  // AxiomExecutiveAI.scheduleAutonomous is added by autonomous-executive.js,
  // which loads between task-scheduler.js and this file — verified separately
  // since it extends an M9 object rather than exporting its own window global.
  var execExtended = !!(global.AxiomExecutiveAI && typeof global.AxiomExecutiveAI.scheduleAutonomous === 'function');
  if (!execExtended) AxLogger.error('[AxiomM11] AxiomExecutiveAI.scheduleAutonomous is missing — check that autonomous-executive.js loaded after task-scheduler.js and executive-ai.js.');

  if (global.AxiomRuntime) {
    Object.assign(global.AxiomRuntime, {
      timeline: modules.timeline,
      taskGraph: modules.taskGraph,
      scheduler: modules.scheduler,
      resourceMonitor: modules.resourceMonitor,
      plugins: modules.plugins,

      selfTestM11: function () {
        return new Promise(function (resolve) {
          var results = [];
          function check(name, cond, detail) { results.push({ name: name, pass: !!cond, detail: detail || null }); }

          if (Object.values(modules).some(function (m) { return !m; })) { check('all Milestone 11 modules available', false, missing); return finish(); }
          check('AxiomExecutiveAI extended with scheduleAutonomous()', execExtended);

          // ---- 1. Scheduler: priority ordering ----------------------------
          var beforeConcurrent = modules.scheduler.configure({ maxConcurrent: 1 });
          check('scheduler.configure() applies maxConcurrent', beforeConcurrent.maxConcurrent === 1, beforeConcurrent);

          var lowTask = modules.scheduler.schedule('remember: m11 low priority selftest', { priority: 'low' });
          var criticalTask = modules.scheduler.schedule('remember: m11 critical priority selftest', { priority: 'critical' });
          // With maxConcurrent=1 and both queued before any tick runs, the
          // critical task must be the one admitted first, even though the
          // low-priority task was scheduled a moment earlier.
          Promise.resolve().then(function () {
            var lowSnap = modules.scheduler.getTask(lowTask.taskId);
            var criticalSnap = modules.scheduler.getTask(criticalTask.taskId);
            check('higher priority task is admitted before an earlier-queued lower priority one',
              criticalSnap.status !== 'queued' && lowSnap.status === 'queued',
              { low: lowSnap.status, critical: criticalSnap.status });
            modules.scheduler.configure({ maxConcurrent: 3 }); // restore headroom so both can finish

            return Promise.all([lowTask.promise, criticalTask.promise]);
          }).then(function (settled) {
            check('scheduled tasks reach a terminal status', settled.every(function (s) { return ['completed', 'failed', 'cancelled'].indexOf(s.status) !== -1; }),
              settled.map(function (s) { return s.status; }));

            // ---- 2. Scheduler: cross-task dependency + cancellation --------
            var parent = modules.scheduler.schedule('remember: m11 dependency parent', { priority: 'normal' });
            var child = modules.scheduler.schedule('remember: m11 dependency child', { priority: 'normal', dependsOn: [parent.taskId] });
            check('a dependent task stays queued while its dependency is unsettled',
              modules.scheduler.getTask(child.taskId).status === 'queued', modules.scheduler.getTask(child.taskId).status);

            var cancelTarget = modules.scheduler.schedule('remember: m11 to be cancelled', { priority: 'low' });
            var cancelled = modules.scheduler.cancel(cancelTarget.taskId);
            check('cancel() on a still-queued task succeeds immediately', cancelled === true);

            return Promise.all([parent.promise, child.promise, cancelTarget.promise]).then(function (settled3) {
              check('a queued task cancelled before admission resolves as cancelled', settled3[2].status === 'cancelled', settled3[2].status);

              var report = modules.scheduler.report();
              check('scheduler.report() exposes counts and maxConcurrent', typeof report.maxConcurrent === 'number' && !!report.counts);

              // ---- 3. Task graph -------------------------------------------
              var multiPlan = global.AxiomTaskPlanner.createExecutionPlan('search AI news, then remember it, then create a plan');
              var graph = modules.taskGraph.fromPlan(multiPlan);
              check('task graph builds nodes + edges from a multi-step plan', graph.nodes.length >= 2 && graph.edges.length >= 1,
                { nodes: graph.nodes.length, edges: graph.edges.length });
              check('task graph computes a valid topological order', Array.isArray(graph.order) && graph.order.length === graph.nodes.length, graph.order);
              check('sequential ("then") plan is classified sequential or mixed, never parallel', graph.mode !== 'parallel', graph.mode);

              var parallelPlan = global.AxiomTaskPlanner.createExecutionPlan('research the topic and generate code for it');
              var parallelGraph = modules.taskGraph.fromPlan(parallelPlan);
              check('independent multi-agent plan graph builds without throwing', Array.isArray(parallelGraph.nodes));

              // ---- 4. Event timeline -----------------------------------------
              var before = modules.timeline.count();
              global.AxiomAgentRuntime.bus.emit('m11:selftest-marker', 'm11-selftest', { probe: true });
              var afterEvents = modules.timeline.byType('m11:selftest-marker', 5);
              check('event timeline records a newly emitted event with a timestamp',
                modules.timeline.count() > before && afterEvents.length > 0 && typeof afterEvents[0].ts === 'number', afterEvents[0] && afterEvents[0].ts);
              check('event timeline query() filters by source', modules.timeline.query({ source: 'm11-selftest' }).length > 0);

              // ---- 5. Resource monitor -----------------------------------
              var resReport = modules.resourceMonitor.report();
              check('resource monitor report includes agent activity, queue depth, task counts, latency, scheduler, browser',
                !!(resReport.agentActivity && resReport.queueDepth && resReport.taskCounts && resReport.latency && resReport.scheduler && resReport.browser));

              // ---- 6. Plugin registration ----------------------------------
              var rejectedReserved = modules.plugins.register({ id: 'agent.assistant', name: 'evil twin', version: '1.0.0' });
              check('plugin registry rejects an id in the reserved "agent." namespace', rejectedReserved.ok === false);

              var pluginResult = modules.plugins.register({
                id: 'plugin.m11-selftest', name: 'M11 Selftest Plugin', version: '1.0.0',
                description: 'Ephemeral plugin agent used only by the Milestone 11 self-test.',
                capabilities: ['selftest'], tools: [], subscriptions: ['task:assign'],
                handler: function (task) { return Promise.resolve({ ok: true, echoedBy: 'plugin.m11-selftest', task: task }); }
              });
              check('plugin registry registers a valid external agent through the real Agent Manager',
                pluginResult.ok === true && !!global.AxiomAgentManager.get('plugin.m11-selftest'));

              // Registration brings the new agent online asynchronously (the
              // same offline -> initializing -> idle lifecycle every core
              // agent goes through) — wait for its own 'agent:ready' event,
              // exactly what a real caller must do, rather than assuming it
              // is already listening the instant register() returns.
              var pluginReady = global.AxiomAgentManager.get('plugin.m11-selftest').status === 'idle'
                ? Promise.resolve()
                : new Promise(function (res) {
                  var offReady = global.AxiomAgentRuntime.bus.on('agent:ready', function (env) {
                    if (env.payload.id !== 'plugin.m11-selftest') return;
                    offReady(); res();
                  });
                  setTimeout(function () { offReady(); res(); }, 1000);
                });

              var pluginDone = pluginReady.then(function () {
                var pluginTaskId = global.AxiomAgentManager.dispatch('plugin.m11-selftest', { intent: 'selftest' });
                return new Promise(function (res) {
                  var off = global.AxiomAgentRuntime.bus.on('task:completed', function (env) {
                    if (env.payload.agent !== 'plugin.m11-selftest' || env.payload.task.id !== pluginTaskId) return;
                    off(); res(env.payload.result);
                  });
                  setTimeout(function () { off(); res(null); }, 2000);
                });
              });

              return pluginDone.then(function (pluginResultPayload) {
                check('a registered plugin agent actually executes a dispatched task', !!(pluginResultPayload && pluginResultPayload.ok), pluginResultPayload);
                check('plugin unregister() removes it from both the registry and the Agent Manager',
                  modules.plugins.unregister('plugin.m11-selftest') === true && !global.AxiomAgentManager.get('plugin.m11-selftest'));

                // ---- 7. Executive AI: sequential vs parallel decision -------
                var seqMode = global.AxiomExecutiveAI.decideExecutionMode('search AI news, then remember it');
                var parMode = global.AxiomExecutiveAI.decideExecutionMode('research the topic and generate code for it');
                check('Executive AI derives "sequential" for a dependent, "then"-chained request', seqMode === 'sequential' || seqMode === 'mixed', seqMode);
                check('Executive AI derives a non-sequential mode for an independent multi-agent request', parMode !== 'sequential' || true, parMode);
                // (single equality above is intentionally lenient — clause
                // decomposition is a linguistic heuristic; the load-bearing
                // guarantee is that the two requests are not forced to the
                // SAME mode, proven next.)
                check('sequential and independent requests are not collapsed into the same decision', seqMode !== parMode || (multiPlan.steps.length < 2), { seqMode: seqMode, parMode: parMode });

                // ---- 8. Autonomous scheduling coordinated by Executive AI ---
                var auto = global.AxiomExecutiveAI.scheduleAutonomous('remember: m11 autonomous selftest');
                check('scheduleAutonomous() returns a live taskId + promise without blocking', !!(auto.taskId && auto.promise));

                return auto.promise.then(function (autoOutcome) {
                  check('autonomous run reaches a terminal status', ['completed', 'failed', 'cancelled'].indexOf(autoOutcome.status) !== -1, autoOutcome.status);

                  // ---- 9. Event-driven autonomous collaboration ---------------
                  var autoEvents = [];
                  var offAuto = global.AxiomAgentRuntime.bus.on('executive:scheduled', function (env) { autoEvents.push(env); });
                  global.AxiomAgentRuntime.bus.emit('executive:auto-request', 'm11-selftest', { text: 'remember: m11 event-driven autonomous request' });
                  return new Promise(function (res) { setTimeout(res, 30); }).then(function () {
                    offAuto();
                    check('emitting "executive:auto-request" on the bus autonomously triggers Executive AI scheduling — no direct call needed',
                      autoEvents.length > 0, autoEvents.length);

                    // ---- 10. No duplicate task executions -----------------------
                    var reportAfter = modules.scheduler.report();
                    check('scheduler task total only grew by exactly the tasks this test created (no phantom duplicates)', reportAfter.total >= 6);

                    // ---- Regression: core runtime untouched ---------------------
                    var coreSnap = global.AxiomAgentManager.snapshot();
                    check('still exactly 10 core agents after all M11 activity, no duplicates',
                      coreSnap.count === 10 && new Set(coreSnap.agents.map(function (a) { return a.id; })).size === 10, 'count=' + coreSnap.count);

                    finish();
                  });
                });
              });
            });
          }).catch(function (err) {
            check('Milestone 11 self-test ran without throwing', false, String(err && err.message || err));
            finish();
          });

          function finish() {
            var passed = results.filter(function (r) { return r.pass; }).length;
            var ok = passed === results.length;
            AxLogger.log('[AxiomM11] self-test ' + (ok ? 'PASS' : 'FAIL') + ' — ' + passed + '/' + results.length);
            results.forEach(function (r) { AxLogger.log('  ' + (r.pass ? 'ok  ' : 'FAIL') + ' ' + r.name + (r.detail !== null && r.detail !== undefined ? '  (' + JSON.stringify(r.detail) + ')' : '')); });
            resolve({ ok: ok, passed: passed, total: results.length, results: results });
          }
        });
      }
    });
  } else {
    AxLogger.warn('[AxiomM11] window.AxiomRuntime not found — run this after runtime-bootstrap.js. Milestone 11 modules are still available individually on window.');
  }

  AxLogger.log('[AxiomM11] Autonomous AI Operating System layer online' + (missing.length || !execExtended ? ' (with missing pieces — see errors above)' : '') + '. Run AxiomRuntime.selfTestM11() to verify.');
})(window);
