// ============================================================
// AXIOM AI OS — Milestone 8: Browser Intelligence
// ------------------------------------------------------------
// Multi-tab workflows, page summarization and link extraction were
// already built in Milestone 6 (see capabilities/browser-bridge.js:
// newTab/switchTab/summarizePage/extractLinks). Task 6 also asks for
// "search planning" and "website automation" — the two pieces that
// were genuinely missing — so that is all this module adds, and it
// adds them purely by calling AxiomBrowserBridge's existing public
// commands, never by touching browser-live.js or re-implementing
// navigation/tab logic.
//
// Public surface — window.AxiomBrowserIntelligence:
//   .planSearch(topic)                 -> string[] of query variants
//   .researchMultiTab(topic, opts?)    -> Promise<{ query, summary }[]>
//   .recordMacro(name, steps)          -> saved macro
//   .runMacro(name)                    -> Promise<snapshot[]>
//   .listMacros()                      -> macro[]
// ============================================================
window.AxiomBrowserIntelligence = (function () {
  'use strict';

  var BRIDGE = window.AxiomBrowserBridge;
  if (!BRIDGE) {
    AxLogger.error('[AxiomBrowserIntelligence] requires capabilities/browser-bridge.js loaded first.');
    return null;
  }

  var MACRO_KEY = 'axiom-browser-macros';

  // Search planning: expands one topic into a small set of complementary
  // query angles instead of a single flat search — a deliberate, readable
  // heuristic (not a real query-planning model), matching how other
  // "intelligence" additions in this codebase are documented.
  function planSearch(topic) {
    var t = String(topic || '').trim();
    if (!t) return [];
    var year = new Date().getFullYear();
    return [
      t,
      t + ' overview',
      t + ' latest news ' + year,
      t + ' pros and cons',
      t + ' alternatives'
    ];
  }

  // Runs the planned queries across separate tabs (reusing newTab/search
  // from the existing bridge) and summarizes each result page, returning
  // one finding per query. Stops early and reports what it has if a tab
  // step fails, rather than losing everything already gathered.
  function researchMultiTab(topic, opts) {
    opts = opts || {};
    var queries = (opts.queries && opts.queries.length) ? opts.queries : planSearch(topic).slice(0, opts.maxQueries || 3);
    var findings = [];

    return queries.reduce(function (chain, query) {
      return chain.then(function () {
        return BRIDGE.newTab()
          .then(function () { return BRIDGE.search(query); })
          .then(function () { return BRIDGE.summarizePage({}); })
          .then(function (summary) { findings.push({ query: query, summary: summary }); })
          .catch(function (err) { findings.push({ query: query, error: String(err && err.message || err) }); });
      });
    }, Promise.resolve()).then(function () { return findings; });
  }

  // Website automation: a named, ordered list of browser-bridge commands
  // ({ op, params }) saved to localStorage and replayed on demand — the
  // same lightweight persistence pattern the rest of this OS already uses
  // for bookmarks/history/plans, applied to "macros" instead.
  function loadMacros() {
    try { return JSON.parse(localStorage.getItem(MACRO_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveMacros(macros) {
    try { localStorage.setItem(MACRO_KEY, JSON.stringify(macros)); } catch (e) { /* storage unavailable */ }
  }

  function recordMacro(name, steps) {
    if (!name || !Array.isArray(steps) || !steps.length) throw new Error('[AxiomBrowserIntelligence] recordMacro needs a name and a non-empty steps array.');
    var macros = loadMacros();
    macros[name] = { name: name, steps: steps, savedAt: Date.now() };
    saveMacros(macros);
    return macros[name];
  }

  function runMacro(name) {
    var macros = loadMacros();
    var macro = macros[name];
    if (!macro) return Promise.reject(new Error('No macro named "' + name + '".'));
    var snapshots = [];
    return macro.steps.reduce(function (chain, step) {
      return chain.then(function () {
        return BRIDGE.command(step.op, step.params || {}).then(function (snap) { snapshots.push(snap); });
      });
    }, Promise.resolve()).then(function () { return snapshots; });
  }

  function listMacros() {
    var macros = loadMacros();
    return Object.keys(macros).map(function (k) { return macros[k]; });
  }

  return { planSearch: planSearch, researchMultiTab: researchMultiTab, recordMacro: recordMacro, runMacro: runMacro, listMacros: listMacros };
})();
