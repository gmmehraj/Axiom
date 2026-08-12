// ============================================================
// AXIOM AI OS — Milestone 6: Research Agent Toolkit
// ------------------------------------------------------------
// The Research Agent's capabilities, factored out of its handler
// so they're independently testable/reusable — but every one of
// them is a thin composition over tools that already exist:
//
//   collectSources()  -> AxiomBrowserBridge.search / AxiomAgents
//                         .runTool('document_search', …)  (NOT a
//                         second web-search or file-search path)
//   groupFindings()   -> pure client-side clustering, no new store
//   summarizeFindings()-> extractive summary over the collected text
//   storeInMemory()   -> AxiomAgents.remember (the SAME agent_memory
//                         table the Memory Agent already uses)
//   passActionItems()  -> AxiomPlanner.createPlan (the SAME planner
//                         store the Planner Agent already uses)
//
// Public surface — window.AxiomResearchToolkit:
//   .collectSources(query, opts)   -> Promise<{ webResults, docResults }>
//   .groupFindings(sources)        -> { byDomain, byKind }
//   .summarizeFindings(sources)    -> { summary, count }
//   .storeInMemory(agentId, topic, sources) -> Promise<memoryRow>
//   .passActionItems(topic, items) -> plan
// ============================================================
window.AxiomResearchToolkit = (function () {
  'use strict';

  function hostnameOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return String(url || 'unknown'); }
  }

  // Gathers candidate sources from the two search surfaces that already
  // exist in this OS: the live Browser Workspace (web) and the workspace's
  // own document index (files already uploaded/indexed). Never invents a
  // third search backend.
  async function collectSources(query, opts) {
    opts = opts || {};
    var out = { query: query, webResults: [], docResults: [] };

    var bridge = window.AxiomBrowserBridge;
    if (bridge && opts.includeWeb !== false) {
      try {
        var snap = await bridge.search(query);
        if (snap && snap.url) out.webResults.push({ url: snap.url, title: snap.title || hostnameOf(snap.url), source: 'browser' });
      } catch (e) { /* browser workspace unavailable — proceed with whatever else we have */ }
    }

    var mem = window.AxiomAgents;
    if (mem && typeof mem.runTool === 'function' && opts.includeDocs !== false) {
      try {
        var docs = await mem.runTool('document_search', { query: query, limit: opts.limit || 8 });
        out.docResults = docs || [];
      } catch (e) { /* document search unavailable — proceed with whatever else we have */ }
    }

    return out;
  }

  // "Group findings": cluster the collected sources by domain (web) and by
  // kind (docs) — a light client-side pass, not a new persisted structure.
  function groupFindings(collected) {
    collected = collected || {};
    var byDomain = {};
    (collected.webResults || []).forEach(function (r) {
      var d = hostnameOf(r.url);
      (byDomain[d] = byDomain[d] || []).push(r);
    });
    var byKind = {};
    (collected.docResults || []).forEach(function (r) {
      var k = r.kind || 'document';
      (byKind[k] = byKind[k] || []).push(r);
    });
    return { byDomain: byDomain, byKind: byKind };
  }

  // "Summarize": an honest extractive summary over titles/filenames of
  // what was found (no fabricated content) — a real prose summarization of
  // page bodies would require the Browser Agent's reading-mode/File Agent
  // extraction first; this composes with those rather than re-implementing
  // text extraction here.
  function summarizeFindings(collected) {
    collected = collected || {};
    var webBits = (collected.webResults || []).map(function (r) { return r.title || hostnameOf(r.url); });
    var docBits = (collected.docResults || []).map(function (r) { return r.filename || r.title || r.id; });
    var count = webBits.length + docBits.length;
    var parts = [];
    if (webBits.length) parts.push(webBits.length + ' web source(s): ' + webBits.slice(0, 5).join(', '));
    if (docBits.length) parts.push(docBits.length + ' workspace document(s): ' + docBits.slice(0, 5).join(', '));
    var summary = parts.length
      ? ('Found ' + parts.join('; ') + '.')
      : ('No sources found for "' + (collected.query || 'the query') + '".');
    return { summary: summary, count: count };
  }

  // "Store results in Memory": reuses AxiomAgents.remember — the SAME
  // table/API the Memory Agent's "remember" op already writes to.
  async function storeInMemory(agentId, topic, collected) {
    var mem = window.AxiomAgents;
    if (!mem || typeof mem.remember !== 'function') throw new Error('Memory storage is unavailable on this page.');
    var s = summarizeFindings(collected);
    return mem.remember(agentId || 'builtin:general', 'Research on "' + topic + '": ' + s.summary, ['research', topic]);
  }

  // "Pass action items to Planner": reuses AxiomPlanner.createPlan — the
  // SAME store the Planner Agent's "create-plan" op already writes to.
  function passActionItems(topic, items) {
    var planner = window.AxiomPlanner;
    if (!planner || typeof planner.createPlan !== 'function') throw new Error('Planner storage is unavailable on this page.');
    var steps = (Array.isArray(items) && items.length) ? items : [
      'Review the findings on ' + topic,
      'Decide whether deeper research is needed',
      'Apply what was learned about ' + topic
    ];
    return planner.createPlan({ goal: 'Act on research: ' + topic, steps: steps });
  }

  return {
    collectSources: collectSources,
    groupFindings: groupFindings,
    summarizeFindings: summarizeFindings,
    storeInMemory: storeInMemory,
    passActionItems: passActionItems
  };
})();
