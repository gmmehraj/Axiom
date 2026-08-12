// ============================================================
// AXIOM — Block 2 / Step 3 / Part 2: Connect the Brain to Memory
// ------------------------------------------------------------
// The Brain (os/core/axiom-brain.js) already tracks live AI-pipeline
// state — activity, mood, activeModel, activeConversationId, toolActive/
// activeTool — driven only by real events (js/core/ai-state-manager.js,
// Block 2 · Step 2 · Part 2). The Memory Foundation (os/core/memory-
// engine.js, Block 2 · Step 3 · Part 1) already has a full session /
// conversation / message / lifecycle store. Before this file, NOTHING
// connected the two: Brain state changes went nowhere, and Memory only
// ever got writes from memory-ultimate.js's own page-local seed data.
//
// This module is the connector. Brain is the producer; Memory is the
// persistent store. It never invents data — every write here is a
// direct reflection of something the Brain (or the same real DOM/bus
// events the Brain itself listens to) already reported as having
// actually happened.
//
// What gets recorded, and where it comes from:
//   - User prompts / AI responses  <- 'axiom:message-appended' (dispatched
//                                     by js/core/app.js for every chat
//                                     bubble actually rendered — the
//                                     bubble's real textContent, not a
//                                     copy of the API payload)
//   - Active conversation           <- AxiomBrain.getState().activeConversationId
//                                     (already real, see Block 2 · Step 2 ·
//                                     Part 2) + 'conversation:*' events on
//                                     the Agent Event Bus mirror, for
//                                     explicit start/end with real timestamps
//   - Active model                  <- AxiomBrain.getState().activeModel,
//                                     attached to the conversation record
//   - Session state                 <- AxiomMemoryEngine.touchSession(),
//                                     called on every real Brain change so
//                                     the session heartbeat tracks actual
//                                     activity instead of only a fixed timer
//   - Conversation metadata         <- AxiomMemoryEngine.updateConversationMeta()
//                                     (new in this pass; see memory-engine.js)
//   - Timestamps                    <- Date.now(), taken at the moment each
//                                     real event is observed here (never
//                                     back-filled or estimated)
//   - AI lifecycle events           <- AxiomBrain.on('change'): activity
//                                     transitions (idle/listening/thinking/
//                                     responding/error/learning) and
//                                     toolActive/activeTool transitions,
//                                     recorded as short-lived ttl'd memory
//                                     records so the Memory page/API can
//                                     answer "what was the AI doing and
//                                     when" without the log growing forever
//
// Explicitly NOT done here (out of scope for "connect", not a new
// feature): no semantic summarization of conversations, no new UI, no
// change to AxiomBrain's or AxiomMemoryEngine's own existing behavior —
// only new listeners that call their existing, unchanged public APIs.
//
// De-duplication (per validation requirement "no duplicate memory
// entries"):
//   - Each rendered chat bubble carries a stable DOM message id
//     (js/core/app.js's nextMsgId()); a Set of already-recorded ids is
//     kept here so a bubble can never be written to Memory twice even if
//     the DOM event somehow re-fires.
//   - Conversation records are only ever created once per id — every
//     write path here checks AxiomMemoryEngine.hasConversation(id) first.
//   - Lifecycle events are only written on an actual state transition
//     (current signature !== last-recorded signature), not on every
//     Brain 'change' tick (Brain also emits on unrelated field changes,
//     e.g. mood/volume, which must not spam Memory with identical
//     lifecycle rows).
//
// Public API — window.AxiomBrainMemoryBridge (small, for tests/cleanup):
//   getStats()  -> { messagesRecorded, lifecycleEventsRecorded, conversationsSeen }
//   destroy()   -> removes listeners (page-teardown / test isolation)
// ============================================================
window.AxiomBrainMemoryBridge = (function () {
  'use strict';

  var Brain = window.AxiomBrain;
  var Memory = window.AxiomMemoryEngine;

  // Harmless no-op on any page that has one but not the other (mirrors
  // the "not mounted on this page" guard pattern already used by
  // ai-state-manager.js's driveAICore/driveBrain).
  if (!Brain || !Memory) {
    return { getStats: function () { return null; }, destroy: function () {} };
  }

  Memory.init(); // idempotent — safe even if a page already called this

  // ---- local de-dup / bookkeeping state ---------------------------------
  var recordedMessageIds = new Set();
  var seenConversationIds = new Set();
  var lastLifecycleSignature = null;
  var lastConversationMetaSignature = null;
  var stats = { messagesRecorded: 0, lifecycleEventsRecorded: 0, conversationsSeen: 0 };

  var LIFECYCLE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — an activity log, not a long-term memory

  // ---- helpers ------------------------------------------------------------
  function ensureConversation(conversationId, extra) {
    if (!conversationId) return null;
    if (!Memory.hasConversation(conversationId)) {
      Memory.startConversation(Object.assign({ id: conversationId }, extra || {}));
    }
    if (!seenConversationIds.has(conversationId)) {
      seenConversationIds.add(conversationId);
      stats.conversationsSeen++;
    }
    return conversationId;
  }

  // A conversation id to fall back on when the Brain hasn't been told
  // which conversation is active yet (e.g. a simple Playground chat with
  // no conversation-stream.js wired) — scoped to the current Memory
  // session so it's still a real, stable, non-fabricated grouping key
  // rather than a per-message random id.
  function fallbackConversationId() {
    var session = Memory.getSession();
    var id = 'conv_' + (session ? session.id : 'no-session');
    ensureConversation(id, { title: 'Session activity' });
    return id;
  }

  function activeConversationId() {
    var brainId = Brain.getState().activeConversationId;
    if (brainId) {
      ensureConversation(brainId);
      return brainId;
    }
    return fallbackConversationId();
  }

  // ---- Input A: real chat messages (user prompts + AI responses) --------
  // js/core/app.js dispatches this for EVERY bubble it actually renders,
  // with the real DOM node — never simulated, never a partial/streaming
  // frame (dispatched once the bubble exists, after streaming settles the
  // final assistant turn too, since the id is stable throughout).
  function onMessageAppended(e) {
    var d = e && e.detail;
    if (!d || !d.id || recordedMessageIds.has(d.id)) return; // already recorded — never duplicate

    var role = d.role === 'assistant' ? 'assistant' : (d.role === 'user' ? 'user' : d.role);
    var bubble = d.bubble || (d.el && d.el.querySelector && d.el.querySelector('.ax-msg-bubble'));
    var content = bubble && typeof bubble.textContent === 'string' ? bubble.textContent : '';
    if (!content) return; // an empty/typing placeholder bubble — nothing real to store yet

    var conversationId = activeConversationId();
    var state = Brain.getState();

    Memory.addMessage(conversationId, {
      id: 'brain_' + d.id, // namespaced so it can never collide with an id AxiomMemoryEngine generates itself
      role: role,
      content: content,
      ts: Date.now(),
      agent: state.activeModel || null,
      meta: { source: 'axiom:message-appended', domId: d.id }
    });

    recordedMessageIds.add(d.id);
    stats.messagesRecorded++;
  }
  document.addEventListener('axiom:message-appended', onMessageAppended);

  // ---- Input B: explicit conversation lifecycle (start/end + metadata) --
  // Same Agent Event Bus DOM mirror ai-state-manager.js already listens
  // to (Block 2 · Step 2 · Part 2) — 'conversation:*' carrying
  // conversationId. Used here only to record real conversation
  // start/end timestamps; message content still comes from Input A.
  function onAgentEvent(e) {
    var env = e && e.detail;
    if (!env || !env.type || env.type.indexOf('conversation:') !== 0) return;
    var cid = env.payload && env.payload.conversationId;
    if (!cid) return;

    if (env.type === 'conversation:done') {
      if (Memory.hasConversation(cid)) Memory.endConversation(cid);
      return;
    }
    ensureConversation(cid);
  }
  document.addEventListener('axiom:agent-event', onAgentEvent);

  // ---- Input C: Brain state changes -> session heartbeat, conversation
  //      metadata, and AI lifecycle events ---------------------------------
  function onBrainChange(state) {
    // Session state: every observed Brain change is real device activity,
    // so refresh the session heartbeat from it rather than relying solely
    // on Memory's own fixed 60s timer.
    Memory.touchSession();

    // Conversation metadata: keep the active conversation's record
    // pointing at the model actually driving it right now. Only writes
    // when something in the signature actually changed, so idle Brain
    // ticks (mood/volume) never touch Memory.
    var cid = state.activeConversationId;
    if (cid) {
      var metaSig = cid + '|' + (state.activeModel || '') + '|' + state.toolActive + '|' + (state.activeTool || '');
      if (metaSig !== lastConversationMetaSignature) {
        lastConversationMetaSignature = metaSig;
        ensureConversation(cid);
        Memory.updateConversationMeta(cid, {
          activeModel: state.activeModel || null,
          toolActive: !!state.toolActive,
          activeTool: state.activeTool || null,
          lastActivity: state.activity,
          updatedAt: Date.now()
        });
      }
    }

    // AI lifecycle events: one record per genuine transition, never per
    // Brain tick. Deliberately short-ttl (LIFECYCLE_TTL_MS) — this is an
    // activity log, not a long-term memory, so it ages out on its own via
    // AxiomMemoryEngine's existing cleanup() pass instead of growing
    // forever.
    var lifecycleSig = state.activity + '|' + state.toolActive + '|' + (state.activeTool || '');
    if (lifecycleSig !== lastLifecycleSignature) {
      lastLifecycleSignature = lifecycleSig;
      var text = 'AI activity -> ' + state.activity +
        (state.toolActive ? ' (tool: ' + state.activeTool + ')' : '');
      Memory.addMemory({
        text: text,
        agent: state.activeModel || 'AXIOM',
        project: 'general',
        type: 'lifecycle',
        tags: ['lifecycle', state.activity],
        importance: 0.1,
        confidence: 1,
        pinned: false,
        ttl: LIFECYCLE_TTL_MS
      });
      stats.lifecycleEventsRecorded++;
    }
  }
  Brain.on('change', onBrainChange);
  onBrainChange(Brain.getState()); // seed once with whatever state already exists on load

  // ---- cleanup (page teardown / test isolation) ---------------------------
  function destroy() {
    document.removeEventListener('axiom:message-appended', onMessageAppended);
    document.removeEventListener('axiom:agent-event', onAgentEvent);
    Brain.off('change', onBrainChange);
  }

  function getStats() {
    return Object.assign({}, stats);
  }

  return { getStats: getStats, destroy: destroy };
})();
