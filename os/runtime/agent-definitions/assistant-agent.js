// ============================================================
// AXIOM AI OS — Agent Definition: Assistant Agent
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
  id: 'agent.assistant',
  name: 'Assistant Agent',
  description: 'The conversational front door. Understands general requests, replies directly, and delegates specialised work to other agents.',
  icon: '\u2728',
  canonicalState: 'responding',
  capabilities: ['converse', 'delegate', 'summarize', 'clarify'],
  tools: ['chat', 'memory'],
  subscriptions: ['task:assign', 'agent:handoff'],
  handler: async function (task, ctx) {
    // Delegation is modelled as a structured handoff event rather than a
    // direct method call, so collaboration stays event-driven.
    if (task.delegateTo) {
      ctx.bus.emit('agent:handoff', ctx.agent.id, { task: task }, { target: task.delegateTo });
      return { ok: true, delegatedTo: task.delegateTo };
    }
    await tick(120);
    return { ok: true, reply: 'Assistant acknowledged: ' + (task.text || task.intent || 'request') };
  }
}
  );
})(window);
