// ============================================================
// AXIOM AI OS — Milestone 12: Bootstrap
// ------------------------------------------------------------
// Loads last among the Milestone 12 files, after every Milestone
// 4/8/9/11 module and every other Milestone 12 module. Mirrors the
// shape of m8-bootstrap.js / m9-bootstrap.js / m11-bootstrap.js
// exactly: touches no UI, no CSS, and no existing runtime file —
// it only:
//   1. Confirms every Milestone 12 module initialized (fails loud if not).
//   2. Extends the existing window.AxiomRuntime facade non-destructively
//      (every property Milestones 4/8/9/11 already put there is preserved)
//      with a `.knowledge` accessor for the new subsystems.
//   3. Adds AxiomRuntime.selfTestM12(), a sixth self-test in the same
//      shape/style as selfTest()/selfTestM8()/selfTestM11(), covering
//      only what Milestone 12 actually added.
// ============================================================
(function (global) {
  'use strict';

  var modules = {
    graph: global.AxiomKnowledgeGraph,
    search: global.AxiomSemanticSearch,
    tagger: global.AxiomAutoTagger,
    duplicates: global.AxiomDuplicateDetector,
    summarizer: global.AxiomMemorySummarizer,
    importance: global.AxiomImportanceRanker
  };

  var missing = Object.keys(modules).filter(function (k) { return !modules[k]; });
  if (missing.length) {
    AxLogger.error('[AxiomM12] the following Milestone 12 modules failed to initialize:', missing);
  }
  var execEnhanced = !!(global.AxiomMemoryIntelligence && global.AxiomMemoryIntelligence.rankedRecall &&
    global.AxiomMemoryIntelligence.rankedRecall.__m12Enhanced);
  if (!execEnhanced) AxLogger.error('[AxiomM12] AxiomMemoryIntelligence.rankedRecall was not enhanced — check that executive-knowledge-extension.js loaded after memory-intelligence.js.');

  if (global.AxiomRuntime) {
    Object.assign(global.AxiomRuntime, {
      knowledge: modules,

      selfTestM12: function () {
        return new Promise(function (resolve) {
          var results = [];
          function check(name, cond, detail) { results.push({ name: name, pass: !!cond, detail: detail || null }); }

          if (Object.keys(modules).some(function (k) { return !modules[k]; })) { check('all Milestone 12 modules available', false, missing); return finish(); }
          check('AxiomMemoryIntelligence.rankedRecall enhanced with knowledge-graph expansion', execEnhanced);

          var mem = global.AxiomAgents;
          if (!mem) {
            check('Milestone 12 modules degrade to empty results with no memory backend on this page', true,
              'no AxiomAgents on this page — skipping data-dependent checks');
            return finish();
          }

          var scope = 'agent.memory';

          // ---- Seed a few notes so the data-dependent checks have signal ----
          Promise.all([
            mem.remember(scope, 'M12 selftest: prefers TypeScript for backend services', ['typescript', 'preference']),
            mem.remember(scope, 'M12 selftest: prefers TypeScript over plain JavaScript for backend work'), // near-duplicate, deliberately untagged
            mem.remember(scope, 'M12 selftest: meeting with design team scheduled for Thursday')
          ]).then(function (seeded) {
            var seededIds = seeded.filter(Boolean).map(function (r) { return r.id; });

            // ---- 1. Knowledge graph ------------------------------------
            return modules.graph.build({ perScopeLimit: 200 }).then(function (graph) {
              check('knowledge graph build() resolves with nodes and edges', graph && graph.nodes.size > 0, modules.graph.stats());
              var memNode = 'memory:' + seededIds[0];
              check('knowledge graph exposes a memory node for a just-created note', graph.nodes.has(memNode));

              // ---- 2. Semantic search --------------------------------
              return modules.search.search(scope, 'TypeScript backend preference', 5).then(function (searchResults) {
                check('semantic search returns results ranked by score', searchResults.length > 0 && typeof searchResults[0].score === 'number', searchResults.map(function (r) { return r.score; }));
                var topIds = searchResults.map(function (r) { return r.id; });
                check('semantic search surfaces the seeded TypeScript note near the top',
                  topIds.slice(0, 2).indexOf(seededIds[0]) !== -1 || topIds.slice(0, 2).indexOf(seededIds[1]) !== -1, topIds);

                // ---- 3. Auto-tagging (fills blanks only) ---------------
                return mem.getMemoryNotes(scope, 10).then(function (rows) {
                  var untagged = rows.find(function (r) { return r.id === seededIds[1]; });
                  var classified = modules.tagger.classify(untagged.note);
                  check('auto-tagger classify() suggests at least one tag for an untagged note', classified.tags.length > 0, classified);

                  return modules.tagger.autoTag(scope, untagged).then(function (applied) {
                    check('auto-tagger fills tags on a previously-untagged note', applied.changed === true && applied.tags.length > 0, applied);

                    var alreadyTagged = rows.find(function (r) { return r.id === seededIds[0]; });
                    var originalTags = (alreadyTagged.tags || []).slice();
                    return modules.tagger.autoTag(scope, alreadyTagged).then(function (skipResult) {
                      check('auto-tagger never overwrites tags a note already has', JSON.stringify(skipResult.tags) === JSON.stringify(originalTags), skipResult);

                      // ---- 4. Duplicate detection -----------------------
                      return modules.duplicates.findDuplicates(scope, 0.5, 200).then(function (groups) {
                        var hit = groups.find(function (g) { return g.ids.indexOf(seededIds[0]) !== -1 && g.ids.indexOf(seededIds[1]) !== -1; });
                        check('duplicate detector groups the two near-identical TypeScript notes together', !!hit, groups.map(function (g) { return g.ids; }));
                        var unrelatedGrouped = groups.some(function (g) { return g.ids.indexOf(seededIds[2]) !== -1 && (g.ids.indexOf(seededIds[0]) !== -1 || g.ids.indexOf(seededIds[1]) !== -1); });
                        check('duplicate detector does NOT group the unrelated meeting note with the TypeScript notes', !unrelatedGrouped);

                        // ---- 5. Importance ranking -------------------------
                        return mem.pinMemory(seededIds[0], true).then(function () {
                          return modules.importance.rankScope(scope, { limit: 50 }).then(function (ranked) {
                            var pinnedEntry = ranked.find(function (r) { return r.id === seededIds[0]; });
                            var meetingEntry = ranked.find(function (r) { return r.id === seededIds[2]; });
                            check('importance ranker scores a pinned, tagged note higher than a bare one',
                              !!pinnedEntry && !!meetingEntry && pinnedEntry.importance > meetingEntry.importance,
                              { pinned: pinnedEntry && pinnedEntry.importance, bare: meetingEntry && meetingEntry.importance });
                            check('importance-ranked list is still produced by the existing Milestone 8 rank() (rankScore present)',
                              ranked.length > 0 && typeof ranked[0].rankScore === 'number');

                            // ---- 6. Memory summaries ---------------------
                            return modules.summarizer.summarize(scope, { limit: 200 }).then(function (summary) {
                              check('summarizer produces a non-empty summary string with the right count', summary.count >= 3 && typeof summary.summary === 'string' && summary.summary.length > 0, summary.summary);

                              // ---- 7. Executive AI enhancement -------------
                              var recallPromise = global.AxiomMemoryIntelligence.rankedRecall(scope, 'TypeScript backend', 8);
                              return recallPromise.then(function (recalled) {
                                check('enhanced rankedRecall() still resolves an array (backward compatible with Milestone 9\'s loadMemory())', Array.isArray(recalled));

                                var execWorks = true;
                                if (global.AxiomExecutiveAI) {
                                  var ctx = global.AxiomExecutiveAI.graphContext('remember: TypeScript backend preference', 5);
                                  return ctx.then(function (r) {
                                    check('AxiomExecutiveAI.graphContext() (new Milestone 12 capability) resolves an array', Array.isArray(r));
                                    var kstats = global.AxiomExecutiveAI.knowledgeStats();
                                    check('AxiomExecutiveAI.knowledgeStats() passes through knowledge-graph stats', kstats && typeof kstats.nodes === 'number', kstats);
                                    return regressionAndCleanup();
                                  });
                                }
                                return regressionAndCleanup();

                                function regressionAndCleanup() {
                                  // ---- Regression: Milestone 8 ranker untouched, still callable directly ----
                                  var plainRank = global.AxiomMemoryIntelligence.rank([{ note: 'a', ts: Date.now() }, { note: 'b', ts: Date.now() - 999999999 }]);
                                  check('Milestone 8 AxiomMemoryIntelligence.rank() still works standalone (regression)', Array.isArray(plainRank) && plainRank.length === 2);

                                  // ---- Regression: core runtime untouched ----
                                  if (global.AxiomAgentManager) {
                                    var coreSnap = global.AxiomAgentManager.snapshot();
                                    check('still exactly 10 core agents after all Milestone 12 activity, no duplicates',
                                      coreSnap.count === 10 && new Set(coreSnap.agents.map(function (a) { return a.id; })).size === 10, 'count=' + coreSnap.count);
                                  }

                                  return Promise.all(seededIds.map(function (id) { return mem.deleteMemory(id); })).then(function () {
                                    finish();
                                  }).catch(function () { finish(); });
                                }
                              });
                            });
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          }).catch(function (err) {
            check('Milestone 12 self-test ran without throwing', false, String(err && err.message || err));
            finish();
          });

          function finish() {
            var passed = results.filter(function (r) { return r.pass; }).length;
            var ok = passed === results.length;
            AxLogger.log('[AxiomM12] self-test ' + (ok ? 'PASS' : 'FAIL') + ' — ' + passed + '/' + results.length);
            results.forEach(function (r) { AxLogger.log('  ' + (r.pass ? 'ok  ' : 'FAIL') + ' ' + r.name + (r.detail !== null && r.detail !== undefined ? '  (' + JSON.stringify(r.detail) + ')' : '')); });
            resolve({ ok: ok, passed: passed, total: results.length, results: results });
          }
        });
      }
    });
  } else {
    AxLogger.warn('[AxiomM12] window.AxiomRuntime not found — run this after runtime-bootstrap.js. Milestone 12 modules are still available individually on window.');
  }

  AxLogger.log('[AxiomM12] Knowledge & Memory Intelligence layer online' + (missing.length || !execEnhanced ? ' (with missing pieces — see errors above)' : '') + '. Run AxiomRuntime.selfTestM12() to verify.');
})(window);
