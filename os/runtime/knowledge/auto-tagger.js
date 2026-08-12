// ============================================================
// AXIOM AI OS — Milestone 12: Automatic Tagging & Categorization
// ------------------------------------------------------------
// Objective 3: "Add automatic tagging and categorization."
//
// Milestone 8's memory-intelligence.js already offers suggestTags() as
// a pure suggestion the CALLER chooses whether to apply. This module
// reuses that exact function for tag suggestion (no second tokenizer/
// suggestion algorithm), adds a lightweight keyword-based CATEGORY
// classifier (the one thing that genuinely didn't exist yet), and —
// unlike suggestTags() — actually APPLIES the result, through the
// SAME existing write path every other memory mutation already uses:
// window.AxiomAgents.tagMemory()/setCategory() (Milestone 5/6).
//
// Safety rule that matters here: auto-tagging only ever fills BLANKS.
// It never overwrites a tag list or category a person (or an earlier
// milestone's UI) already set — that would silently destroy real data
// and break backward compatibility with the existing tag/category
// features.
//
// Public surface — window.AxiomAutoTagger:
//   .classify(note, opts?)        -> { tags: string[], category: string|null } (pure, no writes)
//   .autoTag(scope, memoryRow)     -> Promise<{ id, tags, category, changed }>
//   .autoTagScope(scope, opts?)     -> Promise<{ scanned, tagged, categorized }>
// ============================================================
window.AxiomAutoTagger = (function () {
  'use strict';

  // Keyword -> category map. Kept intentionally small and readable —
  // this is an honest heuristic classifier, not a trained model.
  var CATEGORY_KEYWORDS = {
    preferences: ['prefers', 'preference', 'likes', 'favorite', 'favourite', 'dislikes', 'tone', 'style'],
    technical: ['code', 'coding', 'bug', 'api', 'typescript', 'javascript', 'python', 'server', 'database', 'deploy', 'repo', 'framework'],
    project: ['project', 'working on', 'milestone', 'deadline', 'launch', 'roadmap'],
    schedule: ['meeting', 'tomorrow', 'today', 'schedule', 'calendar', 'reminder', 'appointment'],
    personal: ['birthday', 'family', 'friend', 'hobby', 'vacation', 'weekend'],
    research: ['research', 'article', 'paper', 'study', 'reading', 'source'],
    contact: ['email', 'phone', 'contact', 'address'],
    finance: ['budget', 'invoice', 'payment', 'price', 'cost']
  };

  function tokenize(s) { return String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []; }

  function classify(note, opts) {
    opts = opts || {};
    var text = String(note || '').toLowerCase();
    var tags = (window.AxiomMemoryIntelligence && typeof window.AxiomMemoryIntelligence.suggestTags === 'function')
      ? window.AxiomMemoryIntelligence.suggestTags(note, opts.maxTags || 5)
      : [];

    var bestCategory = null, bestHits = 0;
    Object.keys(CATEGORY_KEYWORDS).forEach(function (category) {
      var hits = CATEGORY_KEYWORDS[category].filter(function (kw) { return text.indexOf(kw) !== -1; }).length;
      if (hits > bestHits) { bestHits = hits; bestCategory = category; }
    });

    return { tags: tags, category: bestHits > 0 ? bestCategory : null };
  }

  function autoTag(scope, memoryRow) {
    var mem = window.AxiomAgents;
    if (!mem || !memoryRow || !memoryRow.id) return Promise.resolve(null);
    var result = classify(memoryRow.note);
    var needsTags = !(memoryRow.tags && memoryRow.tags.length);
    var needsCategory = !memoryRow.category;
    var writes = [];

    if (needsTags && result.tags.length && typeof mem.tagMemory === 'function') {
      writes.push(mem.tagMemory(memoryRow.id, result.tags));
    }
    if (needsCategory && result.category && typeof mem.setCategory === 'function') {
      writes.push(mem.setCategory(memoryRow.id, result.category));
    }
    if (!writes.length) {
      return Promise.resolve({ id: memoryRow.id, tags: memoryRow.tags || [], category: memoryRow.category || null, changed: false });
    }
    return Promise.all(writes).then(function () {
      return {
        id: memoryRow.id,
        tags: needsTags && result.tags.length ? result.tags : (memoryRow.tags || []),
        category: needsCategory && result.category ? result.category : (memoryRow.category || null),
        changed: true
      };
    });
  }

  function autoTagScope(scope, opts) {
    opts = opts || {};
    var mem = window.AxiomAgents;
    if (!mem || typeof mem.getMemoryNotes !== 'function') return Promise.resolve({ scanned: 0, tagged: 0, categorized: 0 });
    return Promise.resolve(mem.getMemoryNotes(scope, opts.limit || 50)).then(function (rows) {
      rows = rows || [];
      var candidates = rows.filter(function (r) { return !(r.tags && r.tags.length) || !r.category; });
      return Promise.all(candidates.map(function (r) { return autoTag(scope, r); })).then(function (results) {
        var applied = results.filter(function (r) { return r && r.changed; });
        return {
          scanned: rows.length,
          tagged: applied.filter(function (r) { return r.tags && r.tags.length; }).length,
          categorized: applied.filter(function (r) { return !!r.category; }).length
        };
      });
    }).catch(function () { return { scanned: 0, tagged: 0, categorized: 0 }; });
  }

  return { classify: classify, autoTag: autoTag, autoTagScope: autoTagScope };
})();
