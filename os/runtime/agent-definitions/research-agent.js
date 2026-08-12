// ============================================================
// AXIOM AI OS — Agent Definition: Research Agent
// ------------------------------------------------------------
// Split out of the former monolithic os/runtime/agent-definitions.js
// as part of Phase 8 Part 2 (Code Quality & Maintainability). Behavior
// is unchanged — this is the exact same spec object, just given its
// own file. See os/runtime/agent-definitions/_shared.js for the
// `tick`/`has` helpers and os/runtime/agent-definitions/_assemble.js
// for how every agent file's spec is collected into the same
// window.AxiomAgentDefinitions / window.AxiomAgentDefinitionsById
// globals the rest of the runtime already depends on.
// ============================================================
(function (global) {
  'use strict';
  var tick = global.AxiomAgentDefHelpers.tick;
  var has = global.AxiomAgentDefHelpers.has;

  (global.__axiomAgentDefs = global.__axiomAgentDefs || []).push(
{
  id: 'agent.research',
  name: 'Research Agent',
  description: 'Gathers and synthesizes information from provided sources and workspace documents into structured findings.',
  icon: '\uD83D\uDD0E',
  canonicalState: 'researching',
  capabilities: ['research', 'synthesize', 'compare', 'cite',
    'collect-sources', 'group-findings', 'store-findings', 'action-items'],
  tools: ['document_search', 'internet_search', 'summarization'],
  subscriptions: ['task:assign'],
  // Milestone 6: the default op keeps the original Milestone 5
  // behaviour (workspace document search only, unchanged for callers
  // that never opted in). New ops delegate to research-toolkit.js,
  // which itself only composes the Browser Bridge / Memory / Planner
  // APIs that already exist — no second search, memory, or plan store.
  handler: async function (task, ctx) {
    var mem = global.AxiomAgents;
    var kit = global.AxiomResearchToolkit;
    var query = task.query || task.text || '';
    var op = task.op || 'research';

    if (op === 'research') {
      var docs = [];
      if (query && mem && typeof mem.runTool === 'function') {
        try { docs = await mem.runTool('document_search', { query: query, limit: 5 }); }
        catch (e) { /* search backend absent — continue with empty set */ }
      }
      await tick(200);
      return { ok: true, op: op, query: query, sources: docs.length, findings: docs };
    }

    if (!kit) return { ok: false, op: op, error: 'Research toolkit unavailable on this page.' };

    try {
      switch (op) {
        case 'collect-sources': {
          var collected = await kit.collectSources(query, task.opts);
          return { ok: true, op: op, result: collected };
        }
        case 'group-findings': {
          var group = kit.groupFindings(task.collected || await kit.collectSources(query, task.opts));
          return { ok: true, op: op, result: group };
        }
        case 'summarize-findings': {
          var toSummarize = task.collected || await kit.collectSources(query, task.opts);
          return { ok: true, op: op, result: kit.summarizeFindings(toSummarize) };
        }
        case 'store-findings': {
          var toStore = task.collected || await kit.collectSources(query, task.opts);
          var stored = await kit.storeInMemory(task.agentId, task.topic || query, toStore);
          return { ok: true, op: op, result: stored };
        }
        case 'action-items': {
          var plan = kit.passActionItems(task.topic || query, task.items);
          if (task.dispatch && ctx.manager && typeof ctx.manager.route === 'function') {
            plan.steps.forEach(function (s) { ctx.manager.route(s.title, { via: 'research' }); });
          }
          return { ok: true, op: op, result: plan };
        }
        default:
          return { ok: false, op: op, error: 'Unsupported research op "' + op + '".' };
      }
    } catch (e) {
      return { ok: false, op: op, error: String(e && e.message || e) };
    }
  }
}
  );
})(window);
