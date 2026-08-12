// ============================================================
// AXIOM AI OS — Milestone 10: Bootstrap
// ------------------------------------------------------------
// Loads last among the Milestone 10 files, after Executive AI
// (Milestone 9) and every conversation/*.js module above it. Mirrors
// the shape of m8-bootstrap.js/m9-bootstrap.js exactly: it touches no
// UI, no CSS, and no existing runtime file — it only:
//   1. Confirms the Conversation Manager initialized (fails loud if not).
//   2. Extends the existing window.AxiomRuntime facade non-destructively
//      (every property Milestones 4/8/9 already put there is preserved)
//      with a `.conversation` accessor.
//   3. Adds AxiomRuntime.selfTestM10(), a fourth self-test in the same
//      shape/style as selfTest()/selfTestM8()/selfTestM9(), covering
//      only what Milestone 10 actually added.
// ============================================================
(function (global) {
  'use strict';

  var CONV = global.AxiomConversationManager;

  if (!CONV) {
    AxLogger.error('[AxiomM10] AxiomConversationManager failed to initialize — check that ' +
      'nlu-resolver.js, conversation-stream.js, conversation-memory.js and conversation-manager.js ' +
      'all loaded after executive-ai.js.');
  }

  if (global.AxiomRuntime) {
    Object.assign(global.AxiomRuntime, {
      conversation: CONV,

      selfTestM10: function () {
        return new Promise(function (resolve) {
          var results = [];
          function check(name, cond, detail) { results.push({ name: name, pass: !!cond, detail: detail || null }); }

          if (!CONV) { check('AxiomConversationManager available', false); return finish(); }

          var convId = CONV.start();
          check('start() returns a conversationId', typeof convId === 'string' && convId.length > 0);

          // 1. Single-turn: an ordinary request runs the normal Milestone
          //    9 pipeline unchanged and reaches a terminal status.
          var first = CONV.send(convId, 'remember: milestone 10 self-test turn one');
          check('send() returns a live turnId + promise', !!(first.turnId && first.promise));

          first.promise.then(function (outcome) {
            check('turn 1 reaches a terminal status', ['completed', 'needs-clarification', 'cancelled', 'error'].indexOf(outcome.status) !== -1, outcome.status);

            // 2. Multi-turn + reference resolution: "it" in turn two must
            //    resolve against turn one's topic without repeating it.
            var second = CONV.send(convId, 'Now save it.');
            check('follow-up with a resolvable reference is NOT sent to clarification', second.status !== 'needs-clarification', second.status);
            check('reference was rewritten before reaching Executive AI',
              !!(second.resolvedText && !/\bit\b/i.test(second.resolvedText)), second.resolvedText);

            return second.promise.then(function (outcome2) {
              check('turn 2 reaches a terminal status', ['completed', 'needs-clarification', 'cancelled', 'error'].indexOf(outcome2.status) !== -1, outcome2.status);

              // 3. Ambiguous request in a BRAND NEW conversation (no topic
              //    at all yet) must ask for clarification, never guess.
              var freshConvId = CONV.start();
              var ambiguous = CONV.send(freshConvId, 'open it');
              check('bare reference with zero history asks for clarification', ambiguous.status === 'needs-clarification', ambiguous.status);

              // 4. Streaming: subscribing to a conversation surfaces at
              //    least one progressive event before completion.
              var thirdConvId = CONV.start();
              var streamed = [];
              var unsub = CONV.subscribe(thirdConvId, function (evt) { streamed.push(evt.type); });
              var third = CONV.send(thirdConvId, 'remember: milestone 10 streaming check');

              return third.promise.then(function () {
                unsub();
                check('conversation stream emitted at least one progressive event', streamed.length > 0, streamed);

                // 5. Context loading: build() assembles a bundle without
                //    throwing, pulling from the modules that actually own
                //    each piece of state.
                var ctxAvailable = !!global.AxiomConversationContext;
                check('AxiomConversationContext available', ctxAvailable);
                var ctxPromise = ctxAvailable ? global.AxiomConversationContext.build(convId) : Promise.resolve(null);

                return ctxPromise.then(function (ctx) {
                  check('context bundle loads all sections', !ctxAvailable || !!(ctx && ctx.conversation && 'selectedMemory' in ctx && 'browserSession' in ctx && 'plannerState' in ctx));

                  // 6. History bounded, per-conversation, no cross-talk.
                  var histA = CONV.history(convId);
                  var histFresh = CONV.history(freshConvId);
                  check('conversation history is scoped per conversationId (no cross-talk)',
                    histA.length >= 1 && histFresh.length >= 1 && histA[0].turnId !== histFresh[0].turnId);

                  finish();
                });
              });
            });
          }, function (err) {
            check('turn 1 reaches a terminal status', false, String(err && err.message || err));
            finish();
          });

          function finish() {
            var passed = results.filter(function (r) { return r.pass; }).length;
            var ok = passed === results.length;
            AxLogger.log('[AxiomM10] self-test ' + (ok ? 'PASS' : 'FAIL') + ' — ' + passed + '/' + results.length);
            results.forEach(function (r) { AxLogger.log('  ' + (r.pass ? 'ok  ' : 'FAIL') + ' ' + r.name + (r.detail !== null ? '  (' + JSON.stringify(r.detail) + ')' : '')); });
            resolve({ ok: ok, passed: passed, total: results.length, results: results });
          }
        });
      }
    });
  } else {
    AxLogger.warn('[AxiomM10] window.AxiomRuntime not found — run this after runtime-bootstrap.js. ' +
      'AxiomConversationManager is still available directly on window.');
  }

  AxLogger.log('[AxiomM10] Conversation Manager online' + (CONV ? '' : ' (module missing — see error above)') +
    '. Run AxiomRuntime.selfTestM10() to verify.');
})(window);
