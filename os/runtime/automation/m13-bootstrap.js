// ============================================================
// AXIOM AI OS — Milestone 13: Bootstrap
// ------------------------------------------------------------
// Loads last among the Milestone 13 files, after every Milestone
// 4/5/8/9/11 module and every other Milestone 13 module. Mirrors the
// shape of m8-bootstrap.js / m9-bootstrap.js / m11-bootstrap.js /
// m12-bootstrap.js exactly: touches no UI, no CSS, and no existing
// runtime file — it only:
//   1. Confirms every Milestone 13 module initialized (fails loud if not).
//   2. Extends the existing window.AxiomRuntime facade non-destructively
//      (every property Milestones 4/8/9/10/11/12 already put there is
//      preserved) with an `.automation` accessor for the new subsystems.
//   3. Adds AxiomRuntime.selfTestM13(), a seventh self-test in the same
//      shape/style as selfTest()/selfTestM8()/.../selfTestM12(), covering
//      only what Milestone 13 actually added.
// ============================================================
(function (global) {
  'use strict';

  var modules = {
    skills: global.AxiomSkillRegistry,
    workflows: global.AxiomWorkflowEngine,
    triggers: global.AxiomTriggerScheduler,
    automations: global.AxiomAutomationEngine,
    history: global.AxiomWorkflowHistory
  };

  var missing = Object.keys(modules).filter(function (k) { return !modules[k]; });
  if (missing.length) {
    AxLogger.error('[AxiomM13] the following Milestone 13 modules failed to initialize:', missing);
  }
  var execExtended = !!(global.AxiomExecutiveAI && typeof global.AxiomExecutiveAI.runAsAutomation === 'function');
  if (!execExtended) AxLogger.error('[AxiomM13] AxiomExecutiveAI.runAsAutomation is missing — check that executive-automation-extension.js loaded after workflow-engine.js and executive-ai.js.');

  if (global.AxiomRuntime) {
    Object.assign(global.AxiomRuntime, {
      automation: modules,

      selfTestM13: async function () {
        var results = [];
        function check(name, cond, detail) { results.push({ name: name, pass: !!cond, detail: detail || null }); }

        if (Object.keys(modules).some(function (k) { return !modules[k]; })) { check('all Milestone 13 modules available', false, missing); return finish(); }
        check('AxiomExecutiveAI extended with runAsAutomation()', execExtended);

        try {
          // ---- 1. Skill registry -------------------------------------
          var badReserved = modules.skills.register({ id: 'agent.evil-twin', name: 'x', version: '1.0.0', handler: function () { return 1; } });
          check('skill registry rejects an id in the reserved "agent." namespace', badReserved.ok === false);

          var badShape = modules.skills.register({ id: 'not-namespaced' });
          check('skill registry rejects a malformed/non-namespaced id', badShape.ok === false);

          var skillReg = modules.skills.register({
            id: 'skill.m13-selftest-echo', name: 'M13 Selftest Echo', version: '1.0.0',
            description: 'Ephemeral skill used only by the Milestone 13 self-test.',
            handler: function (input) { return Promise.resolve({ ok: true, echoed: input }); }
          });
          check('skill registry registers a valid function-backed skill', skillReg.ok === true);

          var dupSkill = modules.skills.register({ id: 'skill.m13-selftest-echo', name: 'dup', version: '1.0.0', handler: function () { return 1; } });
          check('skill registry rejects a second registration of the same id', dupSkill.ok === false);

          var echoResult = await modules.skills.invoke('skill.m13-selftest-echo', { probe: 42 });
          check('a registered skill actually executes and returns its handler result', echoResult && echoResult.ok === true && echoResult.echoed.probe === 42, echoResult);

          // A skill whose handler fails every time — proves bounded retry +
          // terminal failure via the reused Milestone 5 capability kit.
          var attempts = 0;
          modules.skills.register({
            id: 'skill.m13-selftest-flaky', name: 'M13 Selftest Flaky', version: '1.0.0', retries: 3,
            handler: function () { attempts += 1; return Promise.reject(new Error('always fails')); }
          });
          var flakyOutcome = await modules.skills.invoke('skill.m13-selftest-flaky', {}).then(
            function (r) { return { ok: true, r: r }; },
            function (e) { return { ok: false, error: String(e && e.message || e) }; }
          );
          check('a skill with a permanently-failing handler is retried up to its configured bound, then fails (reliability)', flakyOutcome.ok === false && attempts === 3, attempts);

          // ---- 2. Custom workflows: sequential + parallel ------------
          var seqDef = modules.workflows.define({
            id: 'workflow.m13-selftest-sequential', name: 'M13 Selftest Sequential',
            steps: [
              { id: 's1', skill: 'skill.m13-selftest-echo', input: { step: 1 } },
              { id: 's2', skill: 'skill.m13-selftest-echo', input: { step: 2 }, dependsOn: ['s1'] }
            ]
          });
          check('workflow engine defines a valid multi-step workflow', seqDef.ok === true);

          var seqRun = modules.workflows.run('workflow.m13-selftest-sequential', null);
          var seqOutcome = await seqRun.promise;
          check('a workflow with chained dependsOn steps is classified sequential and all steps succeed',
            seqOutcome.mode === 'sequential' && seqOutcome.ok === true, seqOutcome);

          var parDef = modules.workflows.define({
            id: 'workflow.m13-selftest-parallel', name: 'M13 Selftest Parallel',
            steps: [
              { id: 'p1', skill: 'skill.m13-selftest-echo', input: { branch: 'a' } },
              { id: 'p2', skill: 'skill.m13-selftest-echo', input: { branch: 'b' } }
            ]
          });
          check('workflow engine defines a second, independent-step workflow', parDef.ok === true);
          var parOutcome = await modules.workflows.run('workflow.m13-selftest-parallel', null).promise;
          check('a workflow with no dependsOn between steps is classified parallel — genuine multi-agent automation',
            parOutcome.mode === 'parallel' && parOutcome.ok === true, parOutcome);

          var cyclicDef = modules.workflows.define({
            id: 'workflow.m13-selftest-cyclic', name: 'Cyclic',
            steps: [
              { id: 'a', skill: 'skill.m13-selftest-echo', dependsOn: ['b'] },
              { id: 'b', skill: 'skill.m13-selftest-echo', dependsOn: ['a'] }
            ]
          });
          var cyclicOutcome = await modules.workflows.run('workflow.m13-selftest-cyclic', null).promise.then(
            function (r) { return { threw: false, r: r }; }, function (e) { return { threw: true, error: String(e && e.message || e) }; }
          );
          check('workflow engine rejects a cyclic-dependency workflow instead of hanging', cyclicOutcome.threw === true, cyclicOutcome);

          // ---- 3. Scheduled + event-triggered tasks -------------------
          var intervalTrigger = modules.triggers.schedule({ id: 'trigger.m13-selftest-interval', workflowId: 'workflow.m13-selftest-sequential', type: 'interval', intervalMs: 15 });
          check('trigger scheduler accepts a valid interval schedule', intervalTrigger.ok === true);
          await new Promise(function (res) { setTimeout(res, 60); });
          var intervalSnap = modules.triggers.getTrigger('trigger.m13-selftest-interval');
          check('an interval trigger fires on its own at least once with no manual call', intervalSnap && intervalSnap.fireCount > 0, intervalSnap);
          modules.triggers.cancel('trigger.m13-selftest-interval');
          var afterCancel = modules.triggers.getTrigger('trigger.m13-selftest-interval');
          check('cancel() removes a trigger from the registry', afterCancel === null);

          var eventFireCountBefore = 0;
          var eventTrigger = modules.triggers.schedule({ id: 'trigger.m13-selftest-event', workflowId: 'workflow.m13-selftest-parallel', type: 'event', eventType: 'm13:selftest-marker' });
          check('trigger scheduler accepts a valid event-based trigger', eventTrigger.ok === true);
          global.AxiomAgentRuntime.bus.emit('m13:selftest-marker', 'm13-selftest', { probe: true });
          await new Promise(function (res) { setTimeout(res, 30); });
          var eventSnap = modules.triggers.getTrigger('trigger.m13-selftest-event');
          check('emitting the watched event fires the trigger with no polling', eventSnap && eventSnap.fireCount > eventFireCountBefore, eventSnap);
          modules.triggers.cancel('trigger.m13-selftest-event');

          var badTrigger = modules.triggers.schedule({ workflowId: 'workflow.m13-selftest-sequential', type: 'interval' /* missing intervalMs */ });
          check('trigger scheduler rejects an incomplete schedule instead of silently no-op-ing', badTrigger.ok === false);

          // ---- 4. Automation Engine: create / disable / enable --------
          var autoCreate = modules.automations.create({
            id: 'auto.m13-selftest', name: 'M13 Selftest Automation',
            steps: [{ id: 'a1', skill: 'skill.m13-selftest-echo', input: { via: 'automation' } }],
            trigger: { type: 'event', eventType: 'm13:selftest-automation-event' }
          });
          check('automation engine creates an automation from inline steps + a trigger', autoCreate.ok === true, autoCreate.error);

          modules.automations.disable('auto.m13-selftest');
          global.AxiomAgentRuntime.bus.emit('m13:selftest-automation-event', 'm13-selftest', {});
          await new Promise(function (res) { setTimeout(res, 30); });
          var disabledSnap = modules.triggers.getTrigger(autoCreate.automation.triggerId);
          check('a disabled automation does not fire when its trigger event occurs', disabledSnap && disabledSnap.fireCount === 0, disabledSnap);

          modules.automations.enable('auto.m13-selftest');
          global.AxiomAgentRuntime.bus.emit('m13:selftest-automation-event', 'm13-selftest', {});
          await new Promise(function (res) { setTimeout(res, 30); });
          var enabledSnap = modules.triggers.getTrigger(autoCreate.automation.triggerId);
          check('re-enabling the automation lets the same event fire it', enabledSnap && enabledSnap.fireCount > 0, enabledSnap);

          var manualRun = modules.automations.run('auto.m13-selftest', null);
          var manualOutcome = await manualRun.promise;
          check('automations can also be run manually on demand, independent of their trigger', manualOutcome && manualOutcome.ok === true, manualOutcome);

          modules.automations.remove('auto.m13-selftest');
          check('remove() deletes the automation record', modules.automations.get('auto.m13-selftest') === null);

          // ---- 5. Workflow history / logs ------------------------------
          var histRuns = modules.history.byWorkflow('workflow.m13-selftest-sequential');
          check('workflow history recorded the sequential self-test run', histRuns.length > 0 && histRuns[0].status === 'completed', histRuns[0]);
          var histTriggers = modules.history.triggers(50);
          check('workflow history recorded trigger firings from this self-test', histTriggers.some(function (t) { return t.id === 'trigger.m13-selftest-event' || t.id === 'trigger.m13-selftest-interval'; }));
          var histSkills = modules.history.skills(50);
          check('workflow history recorded skill invocations from this self-test', histSkills.some(function (s) { return s.id === 'skill.m13-selftest-echo'; }));

          // ---- 6. Executive AI integration -----------------------------
          var execSingle = await global.AxiomExecutiveAI.runAsAutomation('remember: m13 executive automation selftest').promise;
          check('Executive AI turns a single-clause request into a completed automation run', execSingle && execSingle.ok === true, execSingle);

          var execMulti = global.AxiomExecutiveAI.runAsAutomation('search AI news, then remember it');
          check('Executive AI\'s automation run exposes a live workflowId + runId without blocking', !!(execMulti.workflowId && execMulti.runId));
          var execMultiOutcome = await execMulti.promise;
          check('a multi-clause Executive AI automation runs its steps and reaches a terminal outcome', execMultiOutcome && typeof execMultiOutcome.ok === 'boolean', execMultiOutcome);

          // Event-driven autonomous automation — mirrors Milestone 11's
          // 'executive:auto-request' pattern, now for automation.
          var autoReqEvents = [];
          var offAutoReq = global.AxiomAgentRuntime.bus.on('executive:automation-started', function (env) { autoReqEvents.push(env); });
          global.AxiomAgentRuntime.bus.emit('automation:auto-request', 'm13-selftest', { text: 'remember: m13 event-driven automation request' });
          await new Promise(function (res) { setTimeout(res, 40); });
          offAutoReq();
          check('emitting "automation:auto-request" on the bus autonomously triggers Executive AI to define and run an automation — no direct call needed', autoReqEvents.length > 0, autoReqEvents.length);

          // ---- Regression: core runtime untouched ----------------------
          modules.skills.unregister('skill.m13-selftest-echo');
          modules.skills.unregister('skill.m13-selftest-flaky');
          modules.workflows.remove('workflow.m13-selftest-sequential');
          modules.workflows.remove('workflow.m13-selftest-parallel');
          modules.workflows.remove('workflow.m13-selftest-cyclic');

          if (global.AxiomAgentManager) {
            var coreSnap = global.AxiomAgentManager.snapshot();
            check('still exactly 10 core agents after all Milestone 13 activity, no duplicates',
              coreSnap.count === 10 && new Set(coreSnap.agents.map(function (a) { return a.id; })).size === 10, 'count=' + coreSnap.count);
          }

          return finish();
        } catch (err) {
          check('Milestone 13 self-test ran without throwing', false, String(err && err.message || err));
          return finish();
        }

        function finish() {
          var passed = results.filter(function (r) { return r.pass; }).length;
          var ok = passed === results.length;
          AxLogger.log('[AxiomM13] self-test ' + (ok ? 'PASS' : 'FAIL') + ' — ' + passed + '/' + results.length);
          results.forEach(function (r) { AxLogger.log('  ' + (r.pass ? 'ok  ' : 'FAIL') + ' ' + r.name + (r.detail !== null && r.detail !== undefined ? '  (' + JSON.stringify(r.detail) + ')' : '')); });
          return { ok: ok, passed: passed, total: results.length, results: results };
        }
      }
    });
  } else {
    AxLogger.warn('[AxiomM13] window.AxiomRuntime not found — run this after runtime-bootstrap.js. Milestone 13 modules are still available individually on window.');
  }

  AxLogger.log('[AxiomM13] Automation & Skills Engine online' + (missing.length || !execExtended ? ' (with missing pieces — see errors above)' : '') + '. Run AxiomRuntime.selfTestM13() to verify.');
})(window);
