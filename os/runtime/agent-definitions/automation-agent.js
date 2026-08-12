// ============================================================
// AXIOM AI OS — Agent Definition: Automation Agent
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
  id: 'agent.automation',
  name: 'Automation Agent',
  description: 'Runs multi-step automations and scheduled workflows, coordinating other agents to complete a recipe end to end.',
  icon: '\u26A1',
  canonicalState: 'automation',
  capabilities: ['run-workflow', 'schedule', 'trigger', 'chain'],
  tools: ['automation'],
  subscriptions: ['task:assign', 'automation:trigger'],
  handler: async function (task, ctx) {
    var recipe = Array.isArray(task.recipe) ? task.recipe : [];
    // A workflow is executed by routing each step — the Automation Agent
    // orchestrates, it does not re-implement each capability.
    if (recipe.length && ctx.manager && typeof ctx.manager.route === 'function') {
      recipe.forEach(function (step) { ctx.manager.route(step.intent || step, { via: 'automation' }); });
    }
    await tick(180);
    return { ok: true, steps: recipe.length, note: 'Automation "' + (task.name || 'workflow') + '" dispatched.' };
  }
}
  );
})(window);
