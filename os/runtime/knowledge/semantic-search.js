// ============================================================
// AXIOM AI OS — Milestone 12: Semantic Memory Search
// ------------------------------------------------------------
// Objective 2: "Add semantic memory search."
//
// Milestone 6's AxiomAgents.semanticRecall() already reuses the
// existing ilike-based searchMemories() as retrieval and re-ranks by
// RAW keyword-overlap COUNT. This module is a genuine step up in the
// same honest, dependency-free spirit documented there: it scores
// candidates with TF-IDF cosine similarity over the note+tags+category
// text, so a query term that is rare across a person's memory (and
// therefore more distinctive) counts for more than a common one —
// much closer to semantic relevance than a flat hit-count, without
// pretending to run real embeddings.
//
// It NEVER queries storage directly — retrieval is always through the
// existing window.AxiomAgents API (searchMemories/getMemoryNotes), and
// scope discovery for cross-agent search reuses the same registries
// knowledge-graph.js uses (AxiomAgentManager + AxiomAgents.listAll).
// If a real embeddings backend is added later, only scoreCandidates()
// needs to change — callers are unaffected.
//
// Public surface — window.AxiomSemanticSearch:
//   .search(scope, query, limit?)   -> Promise<memories with .score>
//   .searchAll(query, limit?)        -> Promise<memories across scopes>
// ============================================================
window.AxiomSemanticSearch = (function () {
  'use strict';

  function tokenize(s) {
    return String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  }

  function noteText(row) {
    return String(row.note || '') + ' ' + (row.tags || []).join(' ') + ' ' + (row.category || '');
  }

  // Corpus-relative IDF: rarer terms across THIS scope's notes score higher.
  function buildIdf(rows) {
    var df = {};
    rows.forEach(function (row) {
      var seen = new Set(tokenize(noteText(row)));
      seen.forEach(function (t) { df[t] = (df[t] || 0) + 1; });
    });
    var n = rows.length || 1;
    var idf = {};
    Object.keys(df).forEach(function (t) { idf[t] = Math.log(1 + n / df[t]); });
    return idf;
  }

  function tf(tokens) {
    var counts = {};
    tokens.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    var total = tokens.length || 1;
    var out = {};
    Object.keys(counts).forEach(function (t) { out[t] = counts[t] / total; });
    return out;
  }

  function vectorize(tokens, idf) {
    var tfMap = tf(tokens);
    var vec = {};
    Object.keys(tfMap).forEach(function (t) { vec[t] = tfMap[t] * (idf[t] || Math.log(2)); });
    return vec;
  }

  function cosine(a, b) {
    var dot = 0, na = 0, nb = 0;
    Object.keys(a).forEach(function (k) { dot += (a[k] || 0) * (b[k] || 0); na += a[k] * a[k]; });
    Object.keys(b).forEach(function (k) { nb += b[k] * b[k]; });
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  function scoreCandidates(rows, query) {
    var idf = buildIdf(rows);
    var qVec = vectorize(tokenize(query), idf);
    return rows.map(function (row) {
      var score = cosine(qVec, vectorize(tokenize(noteText(row)), idf));
      return Object.assign({ score: Math.round(score * 1000) / 1000 }, row);
    }).sort(function (a, b) { return b.score - a.score; });
  }

  function search(scope, query, limit) {
    var mem = window.AxiomAgents;
    if (!mem || !query) return Promise.resolve([]);
    // Cast a wide net the same way semanticRecall() does, then re-score.
    var candidatesPromise = typeof mem.searchMemories === 'function'
      ? Promise.resolve(mem.searchMemories(scope, query, Math.max((limit || 8) * 4, 30)))
      : Promise.resolve([]);

    return candidatesPromise.then(function (candidates) {
      var poolPromise = (candidates && candidates.length)
        ? Promise.resolve(candidates)
        : (typeof mem.getMemoryNotes === 'function' ? Promise.resolve(mem.getMemoryNotes(scope, 100)) : Promise.resolve([]));
      return poolPromise.then(function (pool) {
        return scoreCandidates(pool || [], query).slice(0, limit || 8);
      });
    }).catch(function () { return []; });
  }

  function discoverScopes() {
    var scopes = [];
    var seen = new Set();
    function add(id) { if (id && !seen.has(id)) { seen.add(id); scopes.push(id); } }
    if (window.AxiomAgentManager && typeof window.AxiomAgentManager.list === 'function') {
      window.AxiomAgentManager.list().forEach(function (a) { add(a.id); });
    }
    if (window.AxiomAgents && typeof window.AxiomAgents.listAll === 'function') {
      return Promise.resolve(window.AxiomAgents.listAll()).then(function (agents) {
        (agents || []).forEach(function (a) { if (a.memoryEnabled !== false) add(a.id); });
        return scopes;
      }).catch(function () { return scopes; });
    }
    return Promise.resolve(scopes);
  }

  function searchAll(query, limit) {
    if (!query) return Promise.resolve([]);
    return discoverScopes().then(function (scopes) {
      return Promise.all(scopes.map(function (scope) {
        return search(scope, query, limit || 8).then(function (results) {
          return results.map(function (r) { return Object.assign({ scope: scope }, r); });
        });
      })).then(function (perScope) {
        var flat = [].concat.apply([], perScope);
        flat.sort(function (a, b) { return b.score - a.score; });
        return flat.slice(0, limit || 8);
      });
    });
  }

  return { search: search, searchAll: searchAll };
})();
