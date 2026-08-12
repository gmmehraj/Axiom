// ============================================================
// AXIOM AI OS — Milestone 10: Conversation Manager
// ------------------------------------------------------------
// This is the ONE new coordination layer Milestone 10 adds. It turns a
// sequence of natural-language turns into the same single-shot request
// Executive AI (Milestone 9) already knows how to run — it never plans,
// routes, dispatches, or executes anything itself. Every turn still
// goes through the unmodified Milestone 9 pipeline:
//
//   raw text -> [this module resolves "it"/"that"/"those"/follow-ups]
//            -> AxiomExecutiveAI.handle(resolvedText)   (unchanged)
//            -> ... Milestone 4/8/9 runtime, exactly as before ...
//
// State (conversation history, active topic, pending clarifications) is
// kept in a private closure Map, never on `window` or in a bare module-
// level variable a caller could reach in from outside — the only way in
// or out is the functions this IIFE returns. Each conversationId's
// history is also bounded (MAX_TURNS), so a long-running session cannot
// grow memory without limit (requirement 10).
//
// Public surface — window.AxiomConversationManager:
//   .start(conversationId?)                       -> conversationId
//   .send(conversationId, text, opts?)             -> { conversationId, turnId, status, executiveId, jobId, resolvedText, promise }
//   .resolveClarification(conversationId, turnId, answerText) -> same shape as send()
//   .history(conversationId, limit?)               -> turn[]
//   .state(conversationId)                         -> { activeTopic, activeWorkflow, ... } | null
//   .subscribe(conversationId, callback)           -> unsubscribe()   (passthrough to ConversationStream)
//   .reset(conversationId)                         -> boolean
// ============================================================
window.AxiomConversationManager = (function () {
  'use strict';

  var EXEC = window.AxiomExecutiveAI;
  var NLU = window.AxiomNLU;
  var STREAM = window.AxiomConversationStream;
  var CMEM = window.AxiomConversationMemory;

  if (!EXEC || !NLU || !STREAM) {
    AxLogger.error('[AxiomConversationManager] requires AxiomExecutiveAI (Milestone 9), nlu-resolver.js and ' +
      'conversation-stream.js loaded first.');
    return null;
  }

  var MAX_TURNS = 25;
  var conversations = new Map(); // conversationId -> record  (private — no window/global exposure)
  var turnSeq = 0;
  var convSeq = 0;

  function newConversationId() { return 'conv-' + Date.now().toString(36) + '-' + (++convSeq).toString(36); }
  function newTurnId() { return 'turn-' + Date.now().toString(36) + '-' + (++turnSeq).toString(36); }

  function ensure(conversationId) {
    var id = conversationId || newConversationId();
    if (!conversations.has(id)) {
      conversations.set(id, {
        conversationId: id,
        turns: [],
        activeTopic: null,
        activeTopicPlural: false,
        lastFullText: null,
        activeWorkflow: null, // { executiveId, jobId, status }
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }
    return conversations.get(id);
  }

  function start(conversationId) {
    return ensure(conversationId).conversationId;
  }

  function pushTurn(record, turn) {
    record.turns.push(turn);
    if (record.turns.length > MAX_TURNS) record.turns.shift();
    record.updatedAt = Date.now();
  }

  function findTurn(record, turnId) {
    for (var i = record.turns.length - 1; i >= 0; i--) {
      if (record.turns[i].turnId === turnId) return record.turns[i];
    }
    return null;
  }

  function nluSnapshot(record) {
    return { activeTopic: record.activeTopic, activeTopicPlural: record.activeTopicPlural, lastFullText: record.lastFullText };
  }

  // -------------------- Main entry point -----------------------------------
  function send(conversationId, text, opts) {
    opts = opts || {};
    var record = ensure(conversationId);
    var rawText = String(text || '');
    var turnId = newTurnId();

    // 1. Resolve cross-turn references ("it"/"that"/"those"/"the previous
    //    one") against THIS conversation's state — never a global one.
    var snapshot = nluSnapshot(record);
    var clarifyCheck = opts.skipReferenceCheck ? { required: false, reason: null } : NLU.needsReferenceClarification(rawText, snapshot);

    if (clarifyCheck.required) {
      var pendingTurn = {
        turnId: turnId, text: rawText, resolvedText: null, topic: null,
        status: 'needs-clarification', clarificationSource: 'nlu',
        executiveId: null, jobId: null, multiStep: false,
        startedAt: Date.now(), endedAt: null, durationMs: null, summary: null
      };
      pushTurn(record, pendingTurn);
      return {
        conversationId: record.conversationId, turnId: turnId, status: 'needs-clarification',
        executiveId: null, jobId: null, resolvedText: null,
        promise: Promise.resolve({ status: 'needs-clarification', reason: clarifyCheck.reason, conversationId: record.conversationId, turnId: turnId })
      };
    }

    var refResolution = NLU.resolveReferences(rawText, snapshot);
    var injected = NLU.injectImplicitObject(refResolution.resolvedText, snapshot);
    var resolvedText = injected.text;

    var turn = {
      turnId: turnId, text: rawText, resolvedText: resolvedText,
      topic: NLU.extractTopic(resolvedText), usedReference: refResolution.usedReference,
      injectedObject: injected.injected, status: 'running', clarificationSource: null,
      executiveId: null, jobId: null, multiStep: false,
      startedAt: Date.now(), endedAt: null, durationMs: null, summary: null
    };
    pushTurn(record, turn);

    var run = EXEC.handle(resolvedText, opts.executiveOpts);
    turn.executiveId = run.executiveId;
    turn.jobId = run.jobId;
    turn.status = run.status;

    record.activeWorkflow = { executiveId: run.executiveId, jobId: run.jobId, status: run.status };
    if (turn.topic) { record.activeTopic = turn.topic; record.activeTopicPlural = /s$/i.test(turn.topic); }
    record.lastFullText = resolvedText;

    STREAM.track(record.conversationId, turnId, { executiveId: run.executiveId, jobId: run.jobId });
    var offStreamEnrich = STREAM.subscribe(record.conversationId, function (evt) {
      if (evt.turnId !== turnId) return;
      if (evt.type === 'thinking' && evt.payload.stage === 'strategy-selected') {
        turn.multiStep = Array.isArray(evt.payload.agents) && evt.payload.agents.length > 1;
      }
    });

    var wrappedPromise = run.promise.then(function (outcome) {
      offStreamEnrich();
      turn.status = outcome.status;
      turn.summary = outcome.summary || outcome.error || null;
      turn.endedAt = Date.now();
      turn.durationMs = turn.endedAt - turn.startedAt;
      record.activeWorkflow = (outcome.status === 'completed') ? null : { executiveId: turn.executiveId, jobId: turn.jobId, status: outcome.status };

      if (outcome.status === 'needs-clarification') {
        turn.clarificationSource = 'executive';
      } else if (CMEM) {
        CMEM.remember(record.conversationId, turn, outcome);
      }
      return Object.assign({ conversationId: record.conversationId, turnId: turnId }, outcome);
    }, function (err) {
      offStreamEnrich();
      turn.status = 'error';
      turn.endedAt = Date.now();
      turn.durationMs = turn.endedAt - turn.startedAt;
      record.activeWorkflow = null;
      return Promise.reject(err);
    });

    return {
      conversationId: record.conversationId, turnId: turnId, status: run.status,
      executiveId: run.executiveId, jobId: run.jobId, resolvedText: resolvedText,
      promise: wrappedPromise
    };
  }

  // -------------------- Resume after clarification --------------------------
  function resolveClarification(conversationId, turnId, answerText) {
    var record = ensure(conversationId);
    var pending = findTurn(record, turnId);
    if (!pending || pending.status !== 'needs-clarification') return null;

    if (pending.clarificationSource === 'executive' && pending.executiveId) {
      // Executive itself already decomposed/planned once and asked to
      // clarify — resume through ITS OWN resume path so it doesn't
      // re-plan from scratch, exactly as Milestone 9 designed it.
      var resumed = EXEC.resolveClarification(pending.executiveId, answerText);
      if (!resumed) return null;
      pending.status = 'running';
      pending.executiveId = resumed.executiveId;
      pending.jobId = resumed.jobId;
      STREAM.track(record.conversationId, turnId, { executiveId: resumed.executiveId, jobId: resumed.jobId });
      var wrapped = resumed.promise.then(function (outcome) {
        pending.status = outcome.status;
        pending.summary = outcome.summary || outcome.error || null;
        pending.endedAt = Date.now();
        pending.durationMs = pending.endedAt - pending.startedAt;
        if (outcome.status === 'completed' && CMEM) CMEM.remember(record.conversationId, pending, outcome);
        return Object.assign({ conversationId: record.conversationId, turnId: turnId }, outcome);
      });
      return { conversationId: record.conversationId, turnId: turnId, status: 'running', executiveId: resumed.executiveId, jobId: resumed.jobId, resolvedText: null, promise: wrapped };
    }

    // NLU-sourced clarification: the answer itself supplies the missing
    // referent, so substitute it in for the dangling reference word and
    // re-run the normal send() pipeline — never a bare guess.
    var combined = NLU.hasReference(pending.text)
      ? pending.text.replace(/\b(it|that|those|them|these|the previous one|the last one)\b/gi, answerText)
      : (pending.text + ' ' + answerText).trim();
    return send(conversationId, combined, { skipReferenceCheck: true });
  }

  // -------------------- Read-only accessors ----------------------------------
  function history(conversationId, limit) {
    var record = conversations.get(conversationId);
    if (!record) return [];
    var turns = record.turns.slice();
    return limit ? turns.slice(-1 * limit) : turns;
  }

  function state(conversationId) {
    var record = conversations.get(conversationId);
    if (!record) return null;
    return {
      conversationId: record.conversationId,
      activeTopic: record.activeTopic,
      activeTopicPlural: record.activeTopicPlural,
      activeWorkflow: record.activeWorkflow,
      turnCount: record.turns.length,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  function subscribe(conversationId, callback) {
    return STREAM.subscribe(conversationId, callback);
  }

  function reset(conversationId) {
    return conversations.delete(conversationId);
  }

  return {
    start: start,
    send: send,
    resolveClarification: resolveClarification,
    history: history,
    state: state,
    subscribe: subscribe,
    reset: reset
  };
})();
