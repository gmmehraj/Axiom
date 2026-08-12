// ============================================================
// AXIOM AI OS — Milestone 12: Memory Summaries
// ------------------------------------------------------------
// Objective 6: "Generate memory summaries."
//
// An honest, dependency-free EXTRACTIVE summarizer — no external LLM
// call is assumed to exist for this milestone, so rather than fake
// one, this composes a short natural-language digest from statistics
// every earlier milestone's data already supports: note count, date
// range, most frequent tags/categories, pinned count, and the most
// important notes (via importance-ranker.js, itself an extension of
// the Milestone 8 ranker — no duplicate ranking here either).
//
// Public surface — window.AxiomMemorySummarizer:
//   .summarize(scope, opts?)   -> Promise<summary>
//   .summarizeAll(opts?)        -> Promise<{scope: summary}>
// ============================================================
window.AxiomMemorySummarizer = (function () {
  'use strict';

  function topCounts(items, max) {
    var counts = {};
    items.forEach(function (v) { if (v) counts[v] = (counts[v] || 0) + 1; });
    return Object.keys(counts)
      .sort(function (a, b) { return counts[b] - counts[a]; })
      .slice(0, max || 5)
      .map(function (k) { return { value: k, count: counts[k] }; });
  }

  function formatDate(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  function composeText(scope, rows, topTags, topCategories, pinnedCount, mostImportant) {
    if (!rows.length) return 'No memories recorded yet for "' + scope + '".';
    var dates = rows.map(function (r) { return r.created_at ? new Date(r.created_at).getTime() : null; }).filter(Boolean);
    var earliest = dates.length ? formatDate(new Date(Math.min.apply(null, dates)).toISOString()) : null;
    var latest = dates.length ? formatDate(new Date(Math.max.apply(null, dates)).toISOString()) : null;

    var parts = [];
    parts.push(rows.length + ' memor' + (rows.length === 1 ? 'y' : 'ies') + ' recorded for "' + scope + '"' +
      (earliest && latest ? (' between ' + earliest + ' and ' + latest) : '') + '.');
    if (topTags.length) parts.push('Most common tags: ' + topTags.map(function (t) { return t.value; }).join(', ') + '.');
    if (topCategories.length) parts.push('Most common category: ' + topCategories[0].value + '.');
    if (pinnedCount) parts.push(pinnedCount + ' pinned as important.');
    if (mostImportant.length) {
      parts.push('Most notable: ' + mostImportant.slice(0, 3).map(function (n) {
        var text = String(n.note || '');
        return text.length > 80 ? text.slice(0, 77) + '...' : text;
      }).join(' | '));
    }
    return parts.join(' ');
  }

  function summarize(scope, opts) {
    opts = opts || {};
    var mem = window.AxiomAgents;
    if (!mem || typeof mem.getMemoryNotes !== 'function') {
      return Promise.resolve({ scope: scope, count: 0, summary: 'No memory backend available on this page.' });
    }
    return Promise.resolve(mem.getMemoryNotes(scope, opts.limit || 200)).then(function (rows) {
      rows = rows || [];
      var topTags = topCounts([].concat.apply([], rows.map(function (r) { return r.tags || []; })), 5);
      var topCategories = topCounts(rows.map(function (r) { return r.category; }), 3);
      var pinnedCount = rows.filter(function (r) { return r.pinned; }).length;

      var importancePromise = window.AxiomImportanceRanker
        ? window.AxiomImportanceRanker.rankScope(scope, { limit: opts.limit || 200 }).catch(function () { return rows.slice(0, 5); })
        : Promise.resolve(rows.slice(0, 5));

      return importancePromise.then(function (ranked) {
        var mostImportant = (ranked || []).slice(0, 5);
        return {
          scope: scope,
          count: rows.length,
          dateRange: {
            earliest: rows.length ? formatDate(rows.map(function (r) { return r.created_at; }).sort()[0]) : null,
            latest: rows.length ? formatDate(rows.map(function (r) { return r.created_at; }).sort().slice(-1)[0]) : null
          },
          topTags: topTags,
          topCategories: topCategories,
          pinnedCount: pinnedCount,
          mostImportant: mostImportant,
          summary: composeText(scope, rows, topTags, topCategories, pinnedCount, mostImportant)
        };
      });
    }).catch(function () { return { scope: scope, count: 0, summary: 'Could not summarize memory for "' + scope + '".' }; });
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

  function summarizeAll(opts) {
    return discoverScopes().then(function (scopes) {
      return Promise.all(scopes.map(function (scope) { return summarize(scope, opts); }));
    }).then(function (summaries) {
      var out = {};
      summaries.forEach(function (s) { if (s.count > 0) out[s.scope] = s; });
      return out;
    });
  }

  return { summarize: summarize, summarizeAll: summarizeAll };
})();
