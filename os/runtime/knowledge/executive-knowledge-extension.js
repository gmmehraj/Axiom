// ============================================================
// AXIOM AI OS — Milestone 12: Executive AI + Knowledge Graph
// ------------------------------------------------------------
// Objective 8: "Improve Executive AI using the Knowledge Graph."
//
// Same non-destructive extension technique Milestone 11's
// autonomous-executive.js already used on this exact object (adding
// .scheduleAutonomous without editing executive-ai.js): this file
// changes ZERO lines of executive-ai.js or memory-intelligence.js.
// Instead it wraps ONE existing, already-public function —
// window.AxiomMemoryIntelligence.rankedRecall(), which
// executive-ai.js's private loadMemory() already calls on every
// handle() — so Executive AI's automatic memory recall gets richer
// for free, with no change to its own call site.
//
// What the wrap adds: after the existing ranked recall runs, the top
// couple of hits are expanded with their graph-related memories
// (Milestone 12 knowledge-graph.js — shared tag/category/token
// overlap), merged with the original candidates (de-duplicated by id),
// and re-ranked through the SAME unmodified rank() function Milestone
// 8 already exposes. If the graph hasn't been built yet (or isn't
// available on this page), the wrapper transparently falls back to
// the original, unexpanded recall — Executive AI keeps working exactly
// as it did before Milestone 12.
//
// Also adds two small, purely additive read-only capabilities to
// window.AxiomExecutiveAI itself (same Object.assign pattern M11 used):
//   .graphContext(text, limit?) -> the graph-expanded memories a
//                                   request would recall, without
//                                   actually running the request —
//                                   useful for the Memory workspace UI
//                                   to preview "what Executive AI would
//                                   remember" for a given goal.
//   .knowledgeStats()            -> passthrough to AxiomKnowledgeGraph.stats()
// ============================================================
(function (global) {
  'use strict';

  var MEM = global.AxiomMemoryIntelligence;
  var KG = global.AxiomKnowledgeGraph;
  var EXEC = global.AxiomExecutiveAI;
  var RT = global.AxiomAgentRuntime;

  if (!MEM || typeof MEM.rankedRecall !== 'function') {
    AxLogger.error('[AxiomM12] AxiomMemoryIntelligence.rankedRecall is missing — executive-knowledge-extension.js requires memory-intelligence.js (Milestone 8) loaded first.');
    return;
  }
  if (MEM.rankedRecall.__m12Enhanced) return; // idempotent if this file loads twice

  var originalRankedRecall = MEM.rankedRecall;
  var bus = RT && RT.bus;

  function expandWithGraph(results, limit) {
    if (!KG || typeof KG.relatedMemories !== 'function' || typeof KG.getGraph !== 'function' || !KG.getGraph()) {
      return results; // no graph built yet — behave exactly like Milestone 8
    }
    var seen = new Set(results.map(function (r) { return r.id; }));
    var extra = [];
    results.slice(0, 2).forEach(function (r) {
      if (!r.id) return;
      KG.relatedMemories(r.id, 3).forEach(function (related) {
        if (!related.memoryId || seen.has(related.memoryId)) return;
        seen.add(related.memoryId);
        extra.push({
          id: related.memoryId, note: related.note, tags: related.tags,
          category: related.category, pinned: related.pinned, created_at: related.createdAt,
          fromGraphExpansion: true
        });
      });
    });
    if (!extra.length) return results;
    return results.concat(extra);
  }

  function enhancedRankedRecall(scope, query, limit) {
    return originalRankedRecall(scope, query, Math.max((limit || 8) * 2, 16)).then(function (ranked) {
      var expanded = expandWithGraph(ranked, limit);
      if (expanded === ranked) return ranked.slice(0, limit || 8);
      var reRanked = MEM.rank(expanded, query).slice(0, limit || 8);
      if (bus) bus.emit('knowledge:memory-recall-enhanced', 'executive-knowledge-extension',
        { scope: scope, query: query, baseCount: ranked.length, expandedCount: expanded.length });
      return reRanked;
    });
  }
  enhancedRankedRecall.__m12Enhanced = true;
  enhancedRankedRecall.__original = originalRankedRecall;

  MEM.rankedRecall = enhancedRankedRecall;

  if (EXEC) {
    Object.assign(EXEC, {
      graphContext: function (text, limit) {
        return MEM.rankedRecall('agent.memory', text, limit || 5);
      },
      knowledgeStats: function () {
        return KG && typeof KG.stats === 'function' ? KG.stats() : { nodes: 0, edges: 0, byType: {} };
      }
    });
  }

  AxLogger.log('[AxiomM12] Executive AI memory recall enhanced with Knowledge Graph expansion' +
    (KG ? '' : ' (AxiomKnowledgeGraph not loaded — falls back to Milestone 8 behaviour until it is)') + '.');
})(window);
