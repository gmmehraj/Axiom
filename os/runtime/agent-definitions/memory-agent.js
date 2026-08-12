// ============================================================
// AXIOM AI OS — Agent Definition: Memory Agent
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
  id: 'agent.memory',
  name: 'Memory Agent',
  description: 'The long-term memory keeper. Stores durable notes and recalls relevant context on request, backed by the existing agent-memory store.',
  icon: '\uD83E\uDDE0',
  canonicalState: 'memory',
  capabilities: ['remember', 'recall', 'forget', 'search', 'update', 'tag', 'recent',
    'pin', 'categorize', 'semantic-recall', 'short-term'],
  tools: ['memory'],
  subscriptions: ['task:assign', 'memory:write'],
  // Milestone 1-2 memory API (Supabase-backed, agent_memory table),
  // extended in agents.js for Milestone 5 with search/update/tag/
  // delete/recent — all on the SAME table, no second memory system.
  handler: async function (task, ctx) {
    var mem = global.AxiomAgents;
    var scope = task.agentId || 'builtin:general';
    var op = task.op || 'recall';

    if (!mem) {
      await tick(120);
      return { ok: true, op: op, note: 'Memory op "' + op + '" acknowledged (no backend on this page).' };
    }

    var run = function () {
      switch (op) {
        case 'remember':
          if (!task.note) throw new Error('"remember" requires a note.');
          return mem.remember(scope, task.note, task.tags);
        case 'recall':
          return mem.getMemoryNotes(scope, task.limit || 8);
        case 'recent':
          return mem.recentMemories(scope, task.limit || 8);
        case 'search':
          if (!task.query) throw new Error('"search" requires a query.');
          return mem.searchMemories(scope, task.query, task.limit);
        case 'update':
          if (!task.id) throw new Error('"update" requires an id.');
          return mem.updateMemory(task.id, { note: task.note, tags: task.tags });
        case 'tag':
          if (!task.id) throw new Error('"tag" requires an id.');
          return mem.tagMemory(task.id, task.tags || []);
        case 'delete':
          if (!task.id) throw new Error('"delete" requires an id.');
          return mem.deleteMemory(task.id).then(function () { return { deleted: task.id }; });
        case 'forget-all':
          return mem.forgetAll(scope).then(function () { return { forgotAll: scope }; });
        // -------------------- Milestone 6 --------------------
        case 'pin':
          if (!task.id) throw new Error('"pin" requires an id.');
          return mem.pinMemory(task.id, true);
        case 'unpin':
          if (!task.id) throw new Error('"unpin" requires an id.');
          return mem.unpinMemory(task.id);
        case 'list-pinned':
          return mem.listPinned(scope, task.limit);
        case 'categorize':
          if (!task.id) throw new Error('"categorize" requires an id.');
          return mem.setCategory(task.id, task.category);
        case 'list-categories':
          return mem.listCategories(scope);
        case 'semantic-recall':
          if (!task.query) throw new Error('"semantic-recall" requires a query.');
          return mem.semanticRecall(scope, task.query, task.limit);
        case 'short-term-remember':
          if (!task.note) throw new Error('"short-term-remember" requires a note.');
          return mem.rememberShortTerm(scope, task.note, task.tags);
        case 'short-term-recall':
          return mem.recallShortTerm(scope, task.limit);
        case 'short-term-clear':
          return mem.clearShortTerm(scope).then(function () { return { cleared: scope }; });
        default:
          throw new Error('Unsupported memory op "' + op + '".');
      }
    };

    var kit = global.AxiomCapabilityKit;
    try {
      var result = kit
        ? await kit.withCapability('memory:' + op, task, ctx, run, { timeoutMs: 6000, retries: 2 })
        : await run();
      return { ok: true, op: op, result: result };
    } catch (e) {
      return { ok: false, op: op, error: String(e && e.message || e) };
    }
  }
}
  );
})(window);
