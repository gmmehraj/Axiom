// ============================================================
// AXIOM AI OS — Milestone 10: Conversation Memory
// ------------------------------------------------------------
// Requirement 8 asks for automatic memory of "important conversations,
// decisions, workflow outcomes, long-running tasks" while explicitly
// NOT storing unnecessary chat. Executive AI (Milestone 9) already
// writes a one-line outcome note per run through the existing, public
// AxiomAgentManager.route({ agentId: 'agent.memory', ... }) path — this
// module reuses that exact path (never storage directly) and adds only
// the missing piece: a filter that decides whether a given conversation
// turn is WORTH that write at all, so casual back-and-forth doesn't
// flood the same memory store Milestone 6's Memory Agent already
// serves to the rest of the OS.
//
// Public surface — window.AxiomConversationMemory:
//   .isWorthRemembering(turn, outcome) -> { worth, reason }
//   .remember(conversationId, turn, outcome) -> boolean (attempted write)
// ============================================================
window.AxiomConversationMemory = (function () {
  'use strict';

  var MGR = window.AxiomAgentManager;
  if (!MGR) {
    AxLogger.error('[AxiomConversationMemory] requires os/runtime/agent-manager.js loaded first.');
    return null;
  }

  var MEMORY_SCOPE = 'agent.memory';

  // Signals that a turn represents a decision, a saved artifact, or a
  // long-running/multi-step outcome — the things requirement 8 actually
  // asks to keep — rather than small talk or a pure clarifying answer.
  var DECISION_WORDS = /\b(save|remember|keep|decide|decided|choose|chose|pick|selected|final|approve|approved|roadmap|plan|schedule)\b/i;
  var LONG_RUNNING_MS = 8000;

  function isWorthRemembering(turn, outcome) {
    if (!turn || !outcome) return { worth: false, reason: 'missing turn/outcome' };
    if (outcome.status !== 'completed') return { worth: false, reason: 'turn did not complete' };

    if (turn.multiStep) return { worth: true, reason: 'multi-step workflow outcome' };
    if (DECISION_WORDS.test(turn.resolvedText || turn.text || '')) return { worth: true, reason: 'decision/save language' };
    if (typeof turn.durationMs === 'number' && turn.durationMs >= LONG_RUNNING_MS) return { worth: true, reason: 'long-running task' };

    return { worth: false, reason: 'ordinary single-step chat' };
  }

  function remember(conversationId, turn, outcome) {
    var verdict = isWorthRemembering(turn, outcome);
    if (!verdict.worth) return false;

    var note = 'Conversation ' + conversationId + ': "' + (turn.text || '') + '"' +
      (turn.resolvedText && turn.resolvedText !== turn.text ? ' (resolved: "' + turn.resolvedText + '")' : '') +
      ' -> completed (' + verdict.reason + ').';

    try {
      // Same public entry point Executive AI itself uses to write
      // memory — resolved through the Task Router, dispatched through
      // the Agent Manager. This module never touches storage.
      MGR.route({ agentId: MEMORY_SCOPE, intent: 'memory', op: 'remember', note: note });
      return true;
    } catch (e) {
      return false; // a memory-write failure must never break the conversation
    }
  }

  return {
    isWorthRemembering: isWorthRemembering,
    remember: remember
  };
})();
