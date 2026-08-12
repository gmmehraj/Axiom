// ============================================================
// AXIOM AI OS — Milestone 8: Memory Intelligence
// ------------------------------------------------------------
// Short-term/long-term memory, recall, tagging and a keyword-overlap
// "semantic recall" already exist (agents.js, wired through the
// Memory Agent in agent-definitions.js). Task 5 also asks for
// "memory ranking" — combining relevance with recency and importance
// rather than relevance alone — which is what this module adds, by
// calling the EXISTING semanticRecall()/getMemoryNotes() and
// re-scoring their output. It never queries storage directly.
//
// It degrades honestly: importance/confidence fields only exist on
// the memory-workspace demo dataset (memory-ultimate.js) today, not
// on the real agent_memory table, so this ranker treats a missing
// field as neutral (0.5) rather than pretending to have data it
// doesn't.
//
// Public surface — window.AxiomMemoryIntelligence:
//   .rank(memories, query?)        -> memories sorted by composite score
//   .rankedRecall(scope, query, limit?) -> Promise<memories>
//   .suggestTags(note, max?)       -> string[]
// ============================================================
window.AxiomMemoryIntelligence = (function () {
  'use strict';

  var STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is',
    'are', 'was', 'were', 'with', 'this', 'that', 'it', 'as', 'at', 'by', 'be', 'has', 'have']);

  function tokenize(s) {
    return String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  }

  function recencyScore(note) {
    var ts = note.ts || (note.created_at ? new Date(note.created_at).getTime() : null) || (note.at || null);
    if (!ts) return 0.5;
    var ageDays = (Date.now() - ts) / 86400000;
    // Half-life-style decay: ~1.0 today, ~0.5 at 7 days, approaching 0 after ~30.
    return Math.max(0, Math.min(1, Math.pow(0.5, ageDays / 7)));
  }

  function relevanceScore(note, queryTokens) {
    if (!queryTokens || !queryTokens.length) return typeof note.relevance === 'number' ? Math.min(1, note.relevance / 5) : 0.5;
    var noteTokens = new Set(tokenize(note.note || note.text).concat((note.tags || []).map(function (t) { return String(t).toLowerCase(); })));
    var hits = queryTokens.filter(function (t) { return noteTokens.has(t); }).length;
    return Math.min(1, hits / queryTokens.length);
  }

  function importanceScore(note) {
    return typeof note.importance === 'number' ? note.importance : 0.5;
  }

  // Composite ranking: weighted blend of relevance, recency and importance.
  // Weights favour relevance when a query is given, recency otherwise (a
  // bare "what do you remember" should surface what's fresh, not just old
  // high-importance notes).
  function rank(memories, query) {
    var list = Array.isArray(memories) ? memories.slice() : [];
    var queryTokens = query ? tokenize(query) : null;
    var wRelevance = queryTokens ? 0.55 : 0.25;
    var wRecency = queryTokens ? 0.25 : 0.5;
    var wImportance = 1 - wRelevance - wRecency;

    return list.map(function (note) {
      var score = wRelevance * relevanceScore(note, queryTokens)
        + wRecency * recencyScore(note)
        + wImportance * importanceScore(note);
      return Object.assign({ rankScore: Math.round(score * 1000) / 1000 }, note);
    }).sort(function (a, b) { return b.rankScore - a.rankScore; });
  }

  function rankedRecall(scope, query, limit) {
    var mem = window.AxiomAgents;
    if (!mem) return Promise.resolve([]);
    var fetcher = query
      ? mem.semanticRecall(scope, query, Math.max((limit || 8) * 2, 16))
      : mem.recentMemories(scope, Math.max((limit || 8) * 2, 16));
    return Promise.resolve(fetcher).then(function (results) {
      return rank(results, query).slice(0, limit || 8);
    });
  }

  // Lightweight auto-tagging: the most frequent non-stopword tokens in a
  // note, offered as tag SUGGESTIONS the caller still chooses to apply
  // (via the existing tag()/remember() ops) — this never writes memory
  // itself.
  function suggestTags(note, max) {
    var counts = {};
    tokenize(note).forEach(function (t) {
      if (STOPWORDS.has(t) || t.length < 3) return;
      counts[t] = (counts[t] || 0) + 1;
    });
    return Object.keys(counts)
      .sort(function (a, b) { return counts[b] - counts[a]; })
      .slice(0, max || 5);
  }

  return { rank: rank, rankedRecall: rankedRecall, suggestTags: suggestTags };
})();
