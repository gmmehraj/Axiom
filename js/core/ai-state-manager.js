// ============================================================
// AXIOM — Milestone 3: Canonical AI State Manager
// ------------------------------------------------------------
// ONE source of truth for "what is the AI doing right now",
// unifying the two silos that grew up independently in
// Milestone 1/2:
//
//   Silo 1 (per-conversation, real-time):
//     app.js / voice-controller.js / workspace.js
//       -> window.AxiomConversationBridge (conversation-bridge.js)
//       -> drives the Reactor + Dashboard pill; consumed by
//          window.AxiomOSState (os-state-engine.js) for ambient FX.
//     Present only where a live conversation exists
//     (playground.html, workspace.html).
//
//   Silo 2 (ambient / cross-tab / OS-shell context):
//     os-shell.js's "which workspace is focused" inference
//       -> window.AxiomAICore (os/core/ai-core.js, the OS desktop's
//          Living AI Core orb) — shell page only, no Bridge present.
//     window.AxiomBrain (os/core/axiom-brain.js) — a persisted,
//       cross-tab "activity/mood/day" store read by ai-avatar.js,
//       living-environment.js, agents-ultimate.js, ax-chat-core.js,
//       brain-ultimate.js, memory-ultimate.js on EVERY tool page —
//       previously written to directly by ai-avatar.js listening
//       for raw 'axiom:voice-state' events, independently of the
//       Bridge.
//
// Neither silo knew the other existed, so e.g. opening Browser from
// the OS shell lit up the AI Core orb as "researching" while an
// actual chat response streaming in a Playground window somewhere
// else had no effect on it, and vice versa.
//
// This module does not replace, rewrite, or change the visuals of
// any existing system. It is a thin coordination layer that:
//   1. Reads the existing producers (Bridge, and a new setContext()
//      entry point for OS-shell workspace context) as INPUTS.
//   2. Resolves ONE canonical state.
//   3. Drives the existing consumers (AxiomAICore, AxiomBrain)
//      through their existing, unchanged public APIs as OUTPUTS —
//      exactly the way AxiomConversationBridge already drives the
//      Reactor only through window.AxiomReactorCore.setState.
//   4. Relays that canonical state across tabs/OS-windows via a new
//      BroadcastChannel, the same pattern already proven by
//      conversation-bridge.js and axiom-brain.js — so the shell's
//      AI Core and a tool page's Avatar/Living Environment can, for
//      the first time, reflect the SAME real activity.
//
// Public API — window.AxiomAIState — the one new surface:
//   AxiomAIState.STATES              -> canonical state list
//   AxiomAIState.getState()          -> current canonical state
//   AxiomAIState.onChange(fn)        -> subscribe; returns unsubscribe fn
//   AxiomAIState.setContext(ctxId)   -> ambient workspace-context input
//                                       (used by os-shell.js instead of
//                                       calling AxiomAICore directly)
//   AxiomAIState.setState(state,opt) -> escape hatch for direct/manual
//                                       drivers (e.g. a demo toggle)
//
// Also dispatches a single canonical DOM event for any future
// consumer that prefers events over the callback API:
//   document event 'axiom:ai-state' — detail: { state, source }
//
// ---- Block 2 · Step 2 · Part 2: Connect the Brain to the AI --------------
// Three more REAL inputs are wired in, none of them simulated:
//   Input 3 — tool/capability execution: every agent's live capability call
//     already emits 'capability:loading/success/failure/cancelled/timeout'
//     on the shared Agent Event Bus (capability-kit.js), which the bus also
//     mirrors onto the DOM as 'axiom:agent-event'. Listened to here and
//     written straight to AxiomBrain.toolActive/activeTool — no new event
//     vocabulary invented, just observing what already fires.
//   Input 4 — active model: model-selector.js now dispatches
//     'axiom:model-changed' whenever the selected model actually changes
//     (manual or programmatic). Written to AxiomBrain.activeModel.
//   Input 5 — active conversation: conversation-stream.js already re-emits
//     every conversation lifecycle signal as 'conversation:*' on the same
//     bus, carrying conversationId. Written to AxiomBrain.activeConversationId,
//     cleared back to null when that conversation's 'conversation:done' fires.
// Also fixes a documented gap from Milestone 3: 'error' previously had no
// representation in AxiomBrain (forced to 'idle'). AxiomBrain now models
// 'error' directly, so CANONICAL_TO_BRAIN_ACTIVITY maps it there instead of
// masking it.
// ============================================================
window.AxiomAIState = (function () {
  'use strict';

  // ---- Canonical vocabulary --------------------------------------------
  // Superset: every state any existing consumer already understands,
  // plus the states this milestone's brief calls for (researching,
  // browsing, coding, voice, vision) that no single existing system
  // previously modeled on its own.
  var STATES = [
    'idle', 'listening', 'thinking', 'responding', 'researching',
    'browsing', 'coding', 'voice', 'vision', 'automation', 'memory',
    'learning', 'heavy', 'warning', 'error', 'offline', 'sleeping'
  ];

  var root = document.documentElement;
  var listeners = new Set();

  // Two independent input layers, resolved into one canonical state:
  //   - activityState: momentary, conversation-driven (from the Bridge).
  //     Wins whenever it is anything other than 'idle', because an
  //     active conversation is always more "true" than ambient context
  //     (you can be sitting in the Automation workspace while actively
  //     chatting in a window elsewhere).
  //   - contextState: ambient, workspace/OS-shell-driven. Falls back to
  //     this when there is no live activity.
  var activityState = 'idle';
  var contextState = 'idle';

  function resolve() {
    return activityState !== 'idle' ? activityState : contextState;
  }

  var current = null; // null so the first apply() always runs

  function apply(source) {
    var next = resolve();
    if (next === current) return;
    current = next;
    root.setAttribute('data-axiom-ai-state', current);
    listeners.forEach(function (fn) {
      try { fn(current, { source: source }); } catch (e) { /* isolated */ }
    });
    try {
      document.dispatchEvent(new CustomEvent('axiom:ai-state', { detail: { state: current, source: source } }));
    } catch (e) { /* isolated */ }
    driveAICore(current);
    driveBrain(current);
  }

  // ---- Cross-context relay (shell <-> tool windows) ---------------------
  // Mirrors the pattern already used by conversation-bridge.js and
  // axiom-brain.js so the three systems behave consistently.
  var CHANNEL_NAME = 'axiom-ai-state';
  var STORAGE_KEY = 'axiom:ai-state-broadcast';
  var TAB_ID = (Date.now().toString(36) + Math.random().toString(36).slice(2));
  var channel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL_NAME);
  } catch (e) { channel = null; }

  function broadcast(payload) {
    try {
      var withOrigin = Object.assign({}, payload, { origin: TAB_ID });
      if (channel) {
        channel.postMessage(withOrigin);
      } else if (window.localStorage) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign({}, withOrigin, { _t: Date.now() })));
      }
    } catch (e) { /* storage/BroadcastChannel unavailable — non-fatal */ }
  }

  function handleRemoteMessage(payload) {
    if (!payload || payload.origin === TAB_ID) return;
    if (payload.type === 'activity') { activityState = payload.state || 'idle'; apply('remote-activity'); }
    else if (payload.type === 'context') { contextState = payload.state || 'idle'; apply('remote-context'); }
  }

  if (channel) channel.addEventListener('message', function (e) { handleRemoteMessage(e.data); });
  window.addEventListener('storage', function (e) {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try { handleRemoteMessage(JSON.parse(e.newValue)); } catch (err) { /* malformed, ignore */ }
  });

  // ---- Input 1: AxiomConversationBridge (existing, unchanged API) -------
  // Present only on pages with a live conversation (playground, workspace).
  var BRIDGE_TO_CANONICAL = {
    idle: 'idle', listening: 'listening', thinking: 'thinking',
    speaking: 'responding', heavy: 'heavy', error: 'error'
  };
  function fromBridge(bridgeState) {
    activityState = BRIDGE_TO_CANONICAL[bridgeState] || 'idle';
    apply('bridge');
    broadcast({ type: 'activity', state: activityState });
  }
  if (window.AxiomConversationBridge && typeof window.AxiomConversationBridge.onStateChange === 'function') {
    activityState = BRIDGE_TO_CANONICAL[window.AxiomConversationBridge.getState()] || 'idle';
    window.AxiomConversationBridge.onStateChange(fromBridge);
  }

  // ---- Input 2: ambient workspace context (new; os-shell.js calls this
  // instead of driving AxiomAICore directly) -----------------------------
  // Kept as a single, explicit mapping table (moved verbatim from
  // os-shell.js's previous inline stateMap) so there is exactly one
  // place that decides what a workspace "means" for AI state.
  var CONTEXT_TO_CANONICAL = {
    dashboard: 'idle', chat: 'thinking', memory: 'memory', browser: 'browsing',
    coding: 'coding', brain: 'thinking', voice: 'voice', image: 'vision',
    video: 'vision', audio: 'voice', agents: 'thinking', analytics: 'idle',
    automation: 'automation', knowledge: 'learning', settings: 'idle', billing: 'idle'
  };
  function setContext(workspaceId) {
    contextState = CONTEXT_TO_CANONICAL[workspaceId] || 'idle';
    apply('context');
    broadcast({ type: 'context', state: contextState });
  }

  // ---- Escape hatch for direct control (e.g. a demo/manual toggle) ------
  function setState(next, opts) {
    if (STATES.indexOf(next) === -1) return;
    activityState = next;
    apply((opts && opts.source) || 'manual');
    broadcast({ type: 'activity', state: activityState });
  }

  // ---- Output A: drive AxiomAICore (OS shell's Living AI Core orb) ------
  // Visuals/animations of AxiomAICore itself are NOT touched — only who
  // calls its existing, unchanged setState() API changes (previously
  // os-shell.js called this directly).
  var CANONICAL_TO_AICORE = {
    idle: 'idle', listening: 'listening', thinking: 'thinking', responding: 'speaking',
    researching: 'researching', browsing: 'researching', coding: 'coding', voice: 'listening',
    vision: 'generating', automation: 'automation', memory: 'memory', learning: 'learning',
    heavy: 'thinking', warning: 'warning', error: 'error', offline: 'offline', sleeping: 'sleep'
  };
  function driveAICore(canonicalState) {
    try {
      if (window.AxiomAICore && typeof window.AxiomAICore.setState === 'function') {
        window.AxiomAICore.setState(CANONICAL_TO_AICORE[canonicalState] || 'idle');
      }
    } catch (e) { /* AI Core not mounted on this page — harmless */ }
  }

  // ---- Output B: drive AxiomBrain (persisted cross-tab activity/mood) ---
  // AxiomBrain's own fields (mood, day, memoryCount, agentCount) are NOT
  // touched — only its narrower 'activity' vocabulary is kept in sync,
  // replacing the direct write ai-avatar.js used to perform on raw
  // 'axiom:voice-state' events.
  var CANONICAL_TO_BRAIN_ACTIVITY = {
    idle: 'idle', offline: 'idle', sleeping: 'idle',
    listening: 'listening', voice: 'listening',
    responding: 'speaking',
    learning: 'learning',
    thinking: 'thinking', researching: 'thinking', browsing: 'thinking',
    coding: 'thinking', automation: 'thinking', memory: 'thinking',
    vision: 'thinking', heavy: 'thinking',
    // 'error' now maps to Brain's own 'error' activity (Block 2 · Step 2 ·
    // Part 2 — previously forced to 'idle' because Brain had no error
    // concept; see AI_PIPELINE_REPORT.md / BRAIN_INTEGRATION_REPORT.md).
    // 'warning' is a lesser, still-recoverable signal with no dedicated
    // Brain activity of its own, so it intentionally falls back to 'idle'
    // rather than being conflated with a real error.
    warning: 'idle', error: 'error'
  };
  function driveBrain(canonicalState) {
    try {
      if (window.AxiomBrain && typeof window.AxiomBrain.setState === 'function') {
        window.AxiomBrain.setState({ activity: CANONICAL_TO_BRAIN_ACTIVITY[canonicalState] || 'idle' });
      }
    } catch (e) { /* Brain not present on this page — harmless */ }
  }

  // ---- Output C: drive AxiomBrain's AI-pipeline metadata (Part 2) -------
  // Unlike driveBrain() above (which only ever touches `activity`), these
  // never touch `activity` — they patch the narrower metadata fields
  // AxiomBrain gained in Part 2, so they can't fight with the activity
  // resolution happening in apply()/driveBrain().
  function driveBrainTool(active, toolName) {
    try {
      if (window.AxiomBrain && typeof window.AxiomBrain.setState === 'function') {
        window.AxiomBrain.setState({ toolActive: !!active, activeTool: active ? (toolName || null) : null });
      }
    } catch (e) { /* Brain not present on this page — harmless */ }
  }
  function driveBrainModel(modelId) {
    try {
      if (window.AxiomBrain && typeof window.AxiomBrain.setState === 'function') {
        window.AxiomBrain.setState({ activeModel: modelId || null });
      }
    } catch (e) { /* Brain not present on this page — harmless */ }
  }
  function driveBrainConversation(conversationId) {
    try {
      if (window.AxiomBrain && typeof window.AxiomBrain.setState === 'function') {
        window.AxiomBrain.setState({ activeConversationId: conversationId || null });
      }
    } catch (e) { /* Brain not present on this page — harmless */ }
  }

  // ---- Input 3: tool/capability execution --------------------------------
  // The Agent Event Bus (agent-runtime.js) already mirrors every event it
  // delivers onto the DOM as 'axiom:agent-event' (detail = the full
  // envelope: {type, source, payload, ts, id}) specifically so code that
  // isn't the runtime itself doesn't need a direct bus reference. Listened
  // to here rather than requiring window.AxiomAgentRuntime.bus directly, so
  // this keeps working regardless of script load order on a given page.
  var TOOL_START_EVENTS = { 'capability:loading': true };
  var TOOL_END_EVENTS = { 'capability:success': true, 'capability:failure': true, 'capability:cancelled': true, 'capability:timeout': true };
  function onAgentEvent(e) {
    var env = e && e.detail;
    if (!env || !env.type) return;

    if (TOOL_START_EVENTS[env.type]) {
      driveBrainTool(true, env.payload && env.payload.capability);
      return;
    }
    if (TOOL_END_EVENTS[env.type]) {
      // capability-kit.js emits 'capability:retry' (not in TOOL_END_EVENTS)
      // when a failure will be retried, followed by a fresh
      // 'capability:loading' for the next attempt — so a bare
      // 'capability:failure' reaching here always means retries are
      // exhausted (or retries were disabled), never a mid-retry blip.
      driveBrainTool(false, null);
      return;
    }

    // ---- Input 5: active conversation --------------------------------
    if (env.type.indexOf('conversation:') === 0) {
      var cid = env.payload && env.payload.conversationId;
      if (env.type === 'conversation:done') {
        driveBrainConversation(null);
      } else if (cid) {
        driveBrainConversation(cid);
      }
    }
  }
  document.addEventListener('axiom:agent-event', onAgentEvent);

  // ---- Input 4: active model ---------------------------------------------
  // model-selector.js dispatches this on every real selection change
  // (manual dropdown or programmatic setSelectedModel), so Brain only ever
  // reflects a model the user/agent actually selected — never a guess.
  function onModelChanged(e) {
    driveBrainModel(e && e.detail && e.detail.modelId);
  }
  document.addEventListener('axiom:model-changed', onModelChanged);
  // Seed with whatever is already selected on load, if ModelSelector is
  // already initialized by the time this module runs.
  try {
    if (window.ModelSelector && typeof window.ModelSelector.getSelectedModel === 'function') {
      driveBrainModel(window.ModelSelector.getSelectedModel());
    }
  } catch (e) { /* ModelSelector not present/initialized on this page — harmless */ }

  apply('init');

  return {
    STATES: STATES.slice(),
    getState: function () { return current; },
    onChange: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },
    setContext: setContext,
    setState: setState
  };
})();
