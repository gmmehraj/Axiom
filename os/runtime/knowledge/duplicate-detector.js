// ============================================================
// AXIOM AI OS — Milestone 12: Duplicate Memory Detection
// ------------------------------------------------------------
// Objective 5: "Detect duplicate memories."
//
// Read-only by default: findDuplicates()/findDuplicatesAll() only
// REPORT near-duplicate groups (token-overlap similarity above a
// threshold) — nothing is deleted automatically, because silently
// discarding a note the person or an agent saved would be an unsafe,
// irreversible surprise. merge() is provided for a caller (a human
// action in the Memory workspace, or an explicit Executive AI
// decision) to actually consolidate a group, and it does so through
// the SAME existing write paths as every other memory mutation —
// AxiomAgents.updateMemory()/deleteMemory() (Milestone 5) — never a
// second delete/merge system.
//
// Public surface — window.AxiomDuplicateDetector:
//   .similarity(noteA, noteB)             -> 0..1 Jaccard token overlap
//   .findDuplicates(scope, threshold?, limit?) -> Promise<groups>
//   .findDuplicatesAll(threshold?)          -> Promise<{scope: groups[]}>
//   .merge(keepId, discardIds, opts?)        -> Promise<mergedRow>
// ============================================================
window.AxiomDuplicateDetector = (function () {
  'use strict';

  var DEFAULT_THRESHOLD = 0.75;

  function tokenize(s) { return String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []; }

  function similarity(a, b) {
    var ta = new Set(tokenize(a && a.note ? a.note : a));
    var tb = new Set(tokenize(b && b.note ? b.note : b));
    if (!ta.size || !tb.size) return 0;
    var inter = 0;
    ta.forEach(function (t) { if (tb.has(t)) inter++; });
    var union = ta.size + tb.size - inter;
    return union ? inter / union : 0;
  }

  // Simple union-find so a chain of near-duplicates (A~B, B~C) is
  // reported as one group instead of overlapping pairs.
  function groupRows(rows, threshold) {
    var parent = rows.map(function (_, i) { return i; });
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    function union(i, j) { var ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj; }

    var pairScores = {};
    for (var i = 0; i < rows.length; i++) {
      for (var j = i + 1; j < rows.length; j++) {
        var s = similarity(rows[i], rows[j]);
        if (s >= threshold) { union(i, j); pairScores[i + ':' + j] = s; }
      }
    }

    var groupsByRoot = {};
    rows.forEach(function (row, idx) {
      var root = find(idx);
      (groupsByRoot[root] = groupsByRoot[root] || []).push(idx);
    });

    return Object.keys(groupsByRoot)
      .map(function (root) { return groupsByRoot[root]; })
      .filter(function (idxs) { return idxs.length > 1; })
      .map(function (idxs) {
        var scores = [];
        idxs.forEach(function (i) { idxs.forEach(function (j) { if (i < j && pairScores[i + ':' + j] != null) scores.push(pairScores[i + ':' + j]); }); });
        var avg = scores.length ? scores.reduce(function (a, b) { return a + b; }, 0) / scores.length : threshold;
        return {
          ids: idxs.map(function (i) { return rows[i].id; }),
          notes: idxs.map(function (i) { return rows[i]; }),
          similarity: Math.round(avg * 1000) / 1000
        };
      });
  }

  function findDuplicates(scope, threshold, limit) {
    var mem = window.AxiomAgents;
    if (!mem || typeof mem.getMemoryNotes !== 'function') return Promise.resolve([]);
    return Promise.resolve(mem.getMemoryNotes(scope, limit || 200)).then(function (rows) {
      return groupRows(rows || [], threshold || DEFAULT_THRESHOLD);
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

  function findDuplicatesAll(threshold) {
    return discoverScopes().then(function (scopes) {
      return Promise.all(scopes.map(function (scope) {
        return findDuplicates(scope, threshold).then(function (groups) { return { scope: scope, groups: groups }; });
      })).then(function (perScope) {
        var out = {};
        perScope.forEach(function (entry) { if (entry.groups.length) out[entry.scope] = entry.groups; });
        return out;
      });
    });
  }

  // Consolidates a duplicate group into one row: unions tags onto the
  // kept row, then deletes the rest — both through the existing
  // update/delete write paths, never a bespoke merge table.
  function merge(keepId, discardIds, opts) {
    var mem = window.AxiomAgents;
    if (!mem || !keepId || !discardIds || !discardIds.length) return Promise.resolve(null);
    opts = opts || {};
    var extraTags = opts.unionTags || [];
    var updatePromise = extraTags.length && typeof mem.tagMemory === 'function'
      ? Promise.resolve(mem.tagMemory(keepId, extraTags))
      : Promise.resolve(null);
    return updatePromise.then(function () {
      return Promise.all(discardIds.map(function (id) {
        return typeof mem.deleteMemory === 'function' ? mem.deleteMemory(id) : Promise.resolve(null);
      }));
    }).then(function () {
      return { keptId: keepId, discarded: discardIds };
    });
  }

  return { similarity: similarity, findDuplicates: findDuplicates, findDuplicatesAll: findDuplicatesAll, merge: merge };
})();
