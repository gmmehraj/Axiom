// ============================================================
// AXIOM AI OS — Milestone 4: Runtime Bootstrap
// ------------------------------------------------------------
// The single entry point that turns the four runtime modules
// (agent-runtime, agent-definitions, agent-manager, task-router)
// into a live system on whatever page loads it. It:
//
//   1. Verifies its dependencies are present (fails loud, not silent).
//   2. Starts the Agent Manager, which registers and initializes the
//      ten core agents.
//   3. Links the runtime to the Milestone 3 canonical AI-state system
//      in BOTH directions:
//        - agent activity  -> AxiomAIState   (handled inside the manager)
//        - ambient OS context (AxiomAIState) -> a light "listening"
//          nudge on the matching agent, so status changes are driven by
//          the centralized AI event system as the brief requires.
//   4. Exposes a tiny convenience facade, window.AxiomRuntime, plus a
//      one-call self-test used by the verification step.
//
// It loads last and touches nothing else — no UI, no visuals, no CSS.
// ============================================================
(function (global) {
  'use strict';

  var RT = global.AxiomAgentRuntime;
  var MGR = global.AxiomAgentManager;
  var ROUTER = global.AxiomTaskRouter;

  if (!RT || !MGR || !ROUTER) {
    AxLogger.error('[AxiomRuntime] missing dependencies — expected agent-runtime.js, agent-manager.js and task-router.js to load first.',
      { runtime: !!RT, manager: !!MGR, router: !!ROUTER });
    return;
  }

  // ---- 1/2. Start the manager (registers + boots the 10 core agents) ----
  MGR.start();

  // ---- 3. Ambient context -> agent (canonical system drives status) -----
  // When the OS shell switches workspace, Milestone 3 already resolves a
  // canonical AI state and fires `axiom:ai-state`. We map that ambient
  // context onto the agent that owns it and put that agent into a light,
  // non-working "listening" posture — i.e. the centralized AI event system
  // is what changes an agent's status here, not a direct caller.
  var CANONICAL_TO_AGENT = {
    browsing: 'agent.browser', researching: 'agent.research', coding: 'agent.coding',
    vision: 'agent.vision', voice: 'agent.voice', listening: 'agent.voice',
    memory: 'agent.memory', automation: 'agent.automation', learning: 'agent.research',
    thinking: 'agent.planner', responding: 'agent.assistant', heavy: 'agent.file'
  };

  var lastNudged = null;
  document.addEventListener('axiom:ai-state', function (e) {
    var state = e && e.detail && e.detail.state;
    var src = e && e.detail && e.detail.source;
    // Ignore the states WE just produced (source 'agent-manager') to avoid a loop.
    if (!state || src === 'agent-manager') return;
    var agentId = CANONICAL_TO_AGENT[state];

    // Release the previously-nudged agent back to idle if focus moved.
    if (lastNudged && lastNudged !== agentId) {
      var prev = MGR.get(lastNudged);
      if (prev && prev.status === RT.STATES.LISTENING) prev.setStatus(RT.STATES.IDLE, { source: 'ambient-release' });
      lastNudged = null;
    }
    if (!agentId) return;
    var agent = MGR.get(agentId);
    // Only nudge an idle agent; never interrupt one that is actually working.
    if (agent && agent.status === RT.STATES.IDLE) {
      agent.setStatus(RT.STATES.LISTENING, { source: 'ambient-context', state: state });
      lastNudged = agentId;
    }
  });

  // ---- 4. Facade + self-test -------------------------------------------
  var AxiomRuntime = {
    runtime: RT,
    manager: MGR,
    router: ROUTER,
    bus: RT.bus,

    // Fire a request through the whole pipeline (router -> manager -> agent).
    submit: function (request, meta) { return MGR.route(request, meta); },

    // Convenience passthroughs.
    agents: function () { return MGR.list().map(function (a) { return a.describe(); }); },
    snapshot: function () { return MGR.snapshot(); },
    health: function () { return MGR.health(); },

    // One-shot verification used by the milestone check. Resolves with a
    // structured report; logs a compact PASS/FAIL summary to the console.
    selfTest: function () {
      return new Promise(function (resolve) {
        var results = [];
        function check(name, cond, detail) { results.push({ name: name, pass: !!cond, detail: detail || null }); }

        var snap = MGR.snapshot();
        check('manager started', snap.started);
        check('ten core agents registered', snap.count === 10, 'count=' + snap.count);
        check('no duplicate ids', new Set(snap.agents.map(function (a) { return a.id; })).size === snap.count);
        check('all agents idle after boot', snap.agents.every(function (a) { return a.status === 'idle'; }));

        // Routing checks from the brief's examples.
        var cases = [
          { q: 'Search the web for AXIOM', want: 'agent.browser' },
          { q: 'Summarize this PDF', want: 'agent.file' },
          { q: 'Generate code for a login form', want: 'agent.coding' },
          { q: 'Remember this password preference', want: 'agent.memory' },
          { q: 'Create a plan for launch', want: 'agent.planner' }
        ];
        cases.forEach(function (c) {
          var d = ROUTER.route(c.q);
          var ids = d.agents.map(function (a) { return a.agentId; });
          check('route "' + c.q + '" -> ' + c.want, ids.indexOf(c.want) !== -1, ids.join(','));
        });

        // Multi-agent collaboration check.
        var multi = ROUTER.route('research the topic then generate code for it');
        check('multi-agent collaboration', multi.agents.length >= 2, multi.agents.map(function (a) { return a.agentId; }).join(','));

        // End-to-end dispatch check: submit a task and confirm completion.
        var doneOff = RT.bus.on('task:completed', function (env) {
          if (env.payload && env.payload.agent === 'agent.assistant') {
            doneOff();
            check('end-to-end task completion', true, env.payload.agent);
            finish();
          }
        });
        MGR.dispatch('agent.assistant', { intent: 'converse', text: 'ping' });
        // Safety timeout so selfTest always resolves.
        var guard = setTimeout(function () { doneOff(); check('end-to-end task completion', false, 'timeout'); finish(); }, 2000);

        function finish() {
          clearTimeout(guard);
          var passed = results.filter(function (r) { return r.pass; }).length;
          var ok = passed === results.length;
          AxLogger.log('[AxiomRuntime] self-test ' + (ok ? 'PASS' : 'FAIL') + ' — ' + passed + '/' + results.length);
          results.forEach(function (r) { AxLogger.log('  ' + (r.pass ? 'ok  ' : 'FAIL') + ' ' + r.name + (r.detail ? '  (' + r.detail + ')' : '')); });
          resolve({ ok: ok, passed: passed, total: results.length, results: results });
        }
      });
    }
  };

  global.AxiomRuntime = AxiomRuntime;
  RT.bus.emit('runtime:ready', 'system', { agents: MGR.list().length });
  AxLogger.log('[AxiomRuntime] online —', MGR.list().length, 'agents registered. Run AxiomRuntime.selfTest() to verify.');
})(window);
