// ============================================================
// AXIOM — The Brain (Part 10: AXIOM ULTIMATE)
// One persistent AI state, shared by every page.
//
// - Tracks "Day N" since first launch (drives Core Evolution)
// - Tracks time-of-day (drives Living Environment)
// - Tracks AI state: idle / listening / thinking / speaking / learning / error
// - Tracks mood: neutral / focused / happy / curious
// - Tracks live AI-pipeline metadata: activeModel / activeConversationId /
//   toolActive / activeTool (Block 2 · Step 2 · Part 2 — driven by real
//   events via js/core/ai-state-manager.js, never simulated)
// - Tracks live automation-workflow metadata: automation.status/runId/
//   workflowId/workflowName/queue (Block 2 · Step 4 · Part 2 — driven only
//   by real events via os/core/brain-automation-bridge.js, never simulated)
// - Syncs across tabs instantly via BroadcastChannel + localStorage
// - Every widget on every page reads from ONE source of truth
//
// Usage:
//   AxiomBrain.getState()
//   AxiomBrain.setState({ activity: 'listening' })
//   AxiomBrain.on('change', state => { ... })
//   AxiomBrain.dayCount()
//   AxiomBrain.timeOfDay()
// ============================================================
(function (global) {
  'use strict';

  const FIRST_LAUNCH_KEY = 'axiom:first-launch';
  const STATE_KEY = 'axiom:brain-state';
  const CHANNEL_NAME = 'axiom-brain';

  const DEFAULT_STATE = {
    activity: 'idle',       // idle | listening | thinking | speaking | learning | error
    mood: 'neutral',        // neutral | focused | happy | curious
    volume: 0,              // 0-1 live mic/speech amplitude, for reactive UI
    lastInteraction: Date.now(),
    memoryCount: 0,
    agentCount: 4,
    // ---- Block 2 · Step 2 · Part 2: real AI-pipeline metadata ----
    // Written only by js/core/ai-state-manager.js from real bus/DOM events
    // (capability:*, conversation:*, axiom:model-changed) — never by a timer.
    activeModel: null,          // e.g. 'openai/gpt-4o-mini', or null when unknown
    activeConversationId: null, // the conversation currently in flight, or null
    toolActive: false,          // true while a capability/tool call is in flight
    activeTool: null,           // capability name of the in-flight tool, or null
    // ---- Block 2 · Step 4 · Part 2: live automation-workflow metadata ----
    // Written only by os/core/brain-automation-bridge.js from real
    // AxiomAutomationBuilderEngine.onChange() events — never by a timer.
    automation: {
      status: 'idle',        // idle | queued | running | paused | success | failed | cancelled
      runId: null,           // id of the most recently observed run, or null
      workflowId: null,      // the run's workflow id, or null
      workflowName: null,    // the run's workflow name, or null
      queue: { pending: 0, running: 0, concurrency: 0 }
    }
  };

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* noop */ }
  }

  // ---- First launch / day counter ----
  let firstLaunch = readJSON(FIRST_LAUNCH_KEY, null);
  if (!firstLaunch) {
    firstLaunch = Date.now();
    writeJSON(FIRST_LAUNCH_KEY, firstLaunch);
  }

  function dayCount() {
    const days = Math.floor((Date.now() - firstLaunch) / 86400000) + 1;
    return Math.max(1, days);
  }

  // ---- Time of day ----
  function timeOfDay() {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return 'morning';
    if (h >= 11 && h < 17) return 'day';
    if (h >= 17 && h < 21) return 'evening';
    return 'night';
  }

  // ---- State ----
  let state = Object.assign({}, DEFAULT_STATE, readJSON(STATE_KEY, {}));
  const listeners = { change: [] };

  let channel = null;
  try { channel = 'BroadcastChannel' in global ? new BroadcastChannel(CHANNEL_NAME) : null; } catch (e) { channel = null; }

  function emit() {
    listeners.change.forEach(fn => {
      try { fn(getState()); } catch (e) { /* noop */ }
    });
    global.dispatchEvent(new CustomEvent('axiom:brain', { detail: getState() }));
  }

  function persistAndBroadcast(fromRemote) {
    writeJSON(STATE_KEY, state);
    if (!fromRemote && channel) {
      try { channel.postMessage({ type: 'state', state }); } catch (e) { /* noop */ }
    }
    emit();
  }

  function setState(patch, fromRemote) {
    state = Object.assign({}, state, patch, { lastInteraction: fromRemote ? state.lastInteraction : Date.now() });
    persistAndBroadcast(fromRemote);
  }

  function getState() {
    return Object.assign({}, state, { day: dayCount(), timeOfDay: timeOfDay() });
  }

  if (channel) {
    channel.onmessage = ev => {
      if (ev && ev.data && ev.data.type === 'state') {
        state = Object.assign({}, state, ev.data.state);
        emit();
      }
    };
  }

  // Cross-tab fallback via storage event (covers browsers w/o BroadcastChannel)
  global.addEventListener('storage', e => {
    if (e.key === STATE_KEY && e.newValue) {
      try {
        state = Object.assign({}, state, JSON.parse(e.newValue));
        emit();
      } catch (err) { /* noop */ }
    }
  });

  // Re-evaluate time-of-day every few minutes so Living Environment stays fresh
  setInterval(emit, 3 * 60 * 1000);

  function on(evt, fn) {
    if (!listeners[evt]) listeners[evt] = [];
    listeners[evt].push(fn);
  }
  function off(evt, fn) {
    if (!listeners[evt]) return;
    listeners[evt] = listeners[evt].filter(f => f !== fn);
  }

  global.AxiomBrain = {
    getState, setState, on, off,
    dayCount, timeOfDay
  };

  // Fire once on load so early widgets can render immediately.
  if (document.readyState !== 'loading') emit();
  else document.addEventListener('DOMContentLoaded', emit);
})(window);
