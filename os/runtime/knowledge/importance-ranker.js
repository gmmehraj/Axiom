// ============================================================
// AXIOM AI OS — Milestone 12: Memory Importance Ranking
// ------------------------------------------------------------
// Objective 7: "Add memory importance ranking."
//
// Milestone 8's memory-intelligence.js already blends relevance,
// recency and importance into ONE composite rank() — but its
// importanceScore() honestly defaults every note to a neutral 0.5,
// because nothing upstream ever computed a real importance value. This
// module is that missing signal generator, not a second ranking system:
// it computes a genuine 0..1 importance score per note from signals
// every earlier milestone already stores —
//   - pinned flag                  (Milestone 6)
//   - tag richness                 (Milestone 5)
//   - category presence            (Milestone 6)
//   - recency                      (created_at, same decay shape M8 uses)
//   - graph centrality             (Milestone 12 knowledge-graph.js, if built)
//   - duplicate-group penalty      (Milestone 12 duplicate-detector.js, if run)
// — then hands the SAME notes (with `.importance` now populated) to the
// EXISTING window.AxiomMemoryIntelligence.rank(), so the final sort
// order still comes from Milestone 8's one ranker.
//
// Public surface — window.AxiomImportanceRanker:
//   .score(note, ctx?)            -> 0..1 (pure, no I/O)
//   .rankScope(scope, opts?)       -> Promise<memories, sorted, with .importance>
// ============================================================
window.AxiomImportanceRanker = (function () {
  'use strict';

  function recencyScore(note) {
    var ts = note.ts || (note.created_at ? new Date(note.created_at).getTime() : null);
    if (!ts || isNaN(ts)) return 0.5;
    var ageDays = (Date.now() - ts) / 86400000;
    return Math.max(0, Math.min(1, Math.pow(0.5, ageDays / 7)));
  }

  function score(note, ctx) {
    ctx = ctx || {};
    var pinnedScore = note.pinned ? 1 : 0;
    var tagScore = Math.min(1, ((note.tags && note.tags.length) || 0) / 5);
    var categoryScore = note.category ? 1 : 0;
    var recency = recencyScore(note);

    var centralityScore = 0.5; // neutral unless a graph is actually available
    if (ctx.graph && typeof ctx.graph.centrality === 'function' && note.id) {
      var edges = ctx.graph.centrality('memory:' + note.id);
      centralityScore = Math.min(1, edges / 6); // 6+ connections treated as "well-linked"
    }

    var duplicatePenalty = 0;
    if (ctx.duplicateIds && ctx.duplicateIds.has(note.id)) duplicatePenalty = 0.3;

    var raw = 0.30 * pinnedScore + 0.20 * tagScore + 0.15 * categoryScore
      + 0.20 * recency + 0.15 * centralityScore - duplicatePenalty;

    return Math.max(0, Math.min(1, Math.round(raw * 1000) / 1000));
  }

  function rankScope(scope, opts) {
    opts = opts || {};
    var mem = window.AxiomAgents;
    var mi = window.AxiomMemoryIntelligence;
    if (!mem || typeof mem.getMemoryNotes !== 'function') return Promise.resolve([]);

    var graph = window.AxiomKnowledgeGraph;
    var graphInstance = (graph && typeof graph.getGraph === 'function' && graph.getGraph()) ? graph : null;

    var dupPromise = (opts.detectDuplicates !== false && window.AxiomDuplicateDetector)
      ? window.AxiomDuplicateDetector.findDuplicates(scope, opts.duplicateThreshold).catch(function () { return []; })
      : Promise.resolve([]);

    return Promise.all([
      Promise.resolve(mem.getMemoryNotes(scope, opts.limit || 100)),
      dupPromise
    ]).then(function (results) {
      var rows = results[0] || [];
      var dupGroups = results[1] || [];
      var duplicateIds = new Set();
      dupGroups.forEach(function (g) { g.ids.slice(1).forEach(function (id) { duplicateIds.add(id); } ); });

      var ctx = { graph: graphInstance, duplicateIds: duplicateIds };
      var scored = rows.map(function (row) {
        return Object.assign({}, row, { importance: score(row, ctx) });
      });

      // Reuse the EXISTING Milestone 8 ranker for the final composite sort
      // — this module only supplies a real importance signal, never a
      // second sorting algorithm.
      if (mi && typeof mi.rank === 'function') {
        return mi.rank(scored, opts.query).slice(0, opts.limit || 100);
      }
      scored.sort(function (a, b) { return b.importance - a.importance; });
      return scored;
    }).catch(function () { return []; });
  }

  return { score: score, rankScope: rankScope };
})();
