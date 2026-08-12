// ============================================================
// AXIOM — Module 4: AI Conversation Bridge
// ------------------------------------------------------------
// A centralized, event-driven orchestration layer that keeps the
// AI Reactor Core and the Dashboard's status indicator in sync with
// whatever the "conversation" (chat, voice, or a heavy background
// workspace task) is doing right now — without any of those systems
// knowing about each other.
//
// It talks to the Reactor ONLY through its existing public API
// (window.AxiomReactorCore.setState — unchanged, from Module 1), and
// to the rest of the app ONLY through DOM CustomEvents:
//
//   Listens for (already dispatched elsewhere, zero changes required):
//     - 'axiom:chat-state'   — app.js's Playground chat (thinking/answering/idle/error/listening)
//     - 'axiom:voice-state'  — voice-controller.js's mic/speaker state
//     - 'axiom:heavy-task'   — workspace.js's OCR/caption/transcribe ops (start/end)
//
//   Dispatches (new, for anything future code wants to subscribe to):
//     - 'axiom:bridge-state'  — normalized state changes: idle/listening/thinking/speaking/heavy/error
//     - 'axiom:bridge-typing' — user is actively composing a message
//
// Cross-tab: this app is a classic multi-page site — the Reactor
// only lives on dashboard.html, while chat happens on playground.html.
// A BroadcastChannel (with a localStorage-event fallback for older
// browsers) relays state across tabs/pages so that, e.g., sending a
// message from the Playground tab lights up the Reactor and the
// Dashboard's status pill in a Dashboard tab open alongside it.
//
// Public API — window.AxiomConversationBridge — is intentionally the
// only new surface this module introduces; nothing exported by any
// other file is renamed, wrapped, or removed.
// ============================================================
window.AxiomConversationBridge = (function () {
  'use strict';

  const VALID_STATES = ['idle', 'listening', 'thinking', 'speaking', 'heavy', 'error'];
  const DEFAULT_STATE = 'idle';
  const STREAM_TIMEOUT_MS = 45000;   // watchdog: no chunk/heartbeat in this long => treat as timed out
  const ERROR_SETTLE_MS = 2600;      // how long the 'error' state is shown before settling back
  const CHANNEL_NAME = 'axiom-conversation-bridge';
  const STORAGE_KEY = 'axiom:bridge-broadcast';
  const TAB_ID = (Date.now().toString(36) + Math.random().toString(36).slice(2));

  // ---- Internal state -----------------------------------------------------
  let state = DEFAULT_STATE;
  let activeStreamId = null;   // only this stream's events may drive global state
  let streamWatchdog = null;
  let heavyCount = 0;          // reference count for concurrent heavy tasks
  const listeners = new Set(); // onStateChange subscribers

  // ---- Cross-tab relay ------------------------------------------------------
  let channel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL_NAME);
  } catch (e) { channel = null; }

  function broadcast(payload) {
    try {
      const withOrigin = Object.assign({}, payload, { origin: TAB_ID });
      if (channel) {
        channel.postMessage(withOrigin);
      } else if (window.localStorage) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign({}, withOrigin, { _t: Date.now() })));
      }
    } catch (e) { /* storage/BroadcastChannel unavailable (private mode etc.) — non-fatal */ }
  }

  function handleRemoteMessage(payload) {
    if (!payload || payload.origin === TAB_ID) return; // ignore our own echoes
    if (payload.type === 'state' && payload.state) {
      applyState(payload.state, { remote: true });
    } else if (payload.type === 'typing') {
      dispatchTypingEvent(!!payload.typing);
    }
  }

  if (channel) {
    channel.addEventListener('message', (e) => handleRemoteMessage(e.data));
  }
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try { handleRemoteMessage(JSON.parse(e.newValue)); } catch (err) { /* malformed payload, ignore */ }
  });

  // ---- Drive the Reactor through its existing public API only ----
  const REACTOR_STATE_MAP = { idle: 'idle', listening: 'active', thinking: 'thinking', speaking: 'active', heavy: 'heavy', error: 'error' };

  function driveReactor(next) {
    try {
      if (window.AxiomReactorCore && typeof window.AxiomReactorCore.setState === 'function') {
        window.AxiomReactorCore.setState(REACTOR_STATE_MAP[next] || 'active');
      }
    } catch (e) { /* Reactor not mounted on this page — harmless */ }
  }

  // ---- Dashboard status pill (existing element, text/dot only — no layout change) ----
  const STATUS_LABEL = {
    idle: 'ACTIVE',
    listening: 'LISTENING',
    thinking: 'THINKING',
    speaking: 'RESPONDING',
    heavy: 'PROCESSING',
    error: 'ATTENTION NEEDED',
  };

  function driveDashboardIndicator(next) {
    try {
      document.querySelectorAll('.core-hero-status').forEach((el) => {
        el.setAttribute('data-bridge-state', next);
        let textNode = null;
        el.childNodes.forEach((n) => { if (n.nodeType === Node.TEXT_NODE) textNode = n; });
        const label = STATUS_LABEL[next] || 'ACTIVE';
        if (textNode) textNode.textContent = label;
        else el.appendChild(document.createTextNode(label));
      });
    } catch (e) { /* status pill not present on this page — harmless */ }
  }

  function dispatchTypingEvent(isTyping) {
    try { document.dispatchEvent(new CustomEvent('axiom:bridge-typing', { detail: { typing: isTyping } })); } catch (e) { /* isolated */ }
  }

  // ---- Core state application ----------------------------------------------
  function applyState(next, opts) {
    opts = opts || {};
    if (VALID_STATES.indexOf(next) === -1) return;
    const changed = next !== state;
    state = next;

    driveReactor(next);
    driveDashboardIndicator(next);

    if (changed) {
      listeners.forEach((fn) => { try { fn(next, opts); } catch (e) { /* isolated listener failure */ } });
      try { document.dispatchEvent(new CustomEvent('axiom:bridge-state', { detail: Object.assign({ state: next }, opts) })); } catch (e) { /* isolated */ }
    }
    if (!opts.remote && !opts.silent) broadcast({ type: 'state', state: next });
  }

  function settleState() {
    // Where the bridge lands after a stream/error/etc. resolves — 'heavy'
    // if a background task is still running, otherwise 'idle'.
    return heavyCount > 0 ? 'heavy' : 'idle';
  }

  // ---- Public: direct state control -----------------------------------------
  function setState(next, opts) { applyState(next, opts); }
  function getState() { return state; }
  function onStateChange(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // ---- Streaming lifecycle: start / chunk / completion / interruption / cancellation / retry ----
  function clearWatchdog() {
    if (streamWatchdog) { clearTimeout(streamWatchdog); streamWatchdog = null; }
  }
  function armWatchdog(id) {
    clearWatchdog();
    streamWatchdog = setTimeout(() => {
      if (activeStreamId === id) errorStream(id, new Error('Response timed out.'));
    }, STREAM_TIMEOUT_MS);
  }

  function startStream(meta) {
    const id = TAB_ID + '-' + Math.random().toString(36).slice(2);
    activeStreamId = id;
    armWatchdog(id);
    applyState('thinking', { meta: meta });
    return id;
  }

  function chunkStream(id, delta, fullText) {
    if (id !== activeStreamId) return; // stale/cancelled stream — ignore
    armWatchdog(id);
    applyState('speaking', { delta: delta, fullText: fullText });
  }

  function completeStream(id, fullText) {
    if (id !== activeStreamId) return;
    clearWatchdog();
    activeStreamId = null;
    applyState(settleState(), { fullText: fullText });
  }

  function interruptStream(id) {
    if (id !== activeStreamId) return;
    clearWatchdog();
    activeStreamId = null;
    applyState(settleState(), { interrupted: true });
  }

  function cancelStream(id) {
    if (id !== activeStreamId) return;
    clearWatchdog();
    activeStreamId = null;
    applyState(settleState(), { cancelled: true });
  }

  function errorStream(id, err) {
    // Allow a null id (used by the legacy event bridges below, which have
    // no structured stream id) as long as there's no other managed stream
    // actively in flight that this would otherwise incorrectly cancel.
    if (id !== activeStreamId && !(id === null && activeStreamId === null)) return;
    clearWatchdog();
    activeStreamId = null;
    applyState('error', { error: err && err.message ? err.message : String(err || 'Unknown error') });
    setTimeout(() => { if (state === 'error') applyState(settleState()); }, ERROR_SETTLE_MS);
  }

  function retryStream(fn) {
    // Convenience wrapper: resets the bridge to 'thinking' and clears any
    // stale watchdog before the caller re-issues the request (e.g. calling
    // OpenRouter.streamChat again). The caller is responsible for creating
    // a fresh stream id via startStream() as part of `fn`.
    clearWatchdog();
    activeStreamId = null;
    applyState('thinking');
    try {
      return fn();
    } catch (e) {
      errorStream(null, e);
      return undefined;
    }
  }

  // ---- Heavy task reference counting (Workspace OCR/transcribe/etc.) --------
  function startHeavyTask() {
    heavyCount += 1;
    if (activeStreamId === null) applyState('heavy');
  }
  function endHeavyTask() {
    heavyCount = Math.max(0, heavyCount - 1);
    if (heavyCount === 0 && activeStreamId === null && state === 'heavy') applyState('idle');
  }

  // ---- Legacy event bridges (zero-touch backward compatibility) -------------

  // app.js already dispatches this around the Playground chat's streamed
  // reply — thinking / answering / idle / error / listening.
  const CHAT_STATE_MAP = { thinking: 'thinking', answering: 'speaking', idle: 'idle', error: 'error', listening: 'listening' };
  function onChatState(e) {
    const raw = e && e.detail && e.detail.state;
    const mapped = CHAT_STATE_MAP[raw];
    if (!mapped) return;
    if (mapped === 'error') { errorStream(null, new Error('Chat request failed.')); return; }
    if (mapped === 'idle') { activeStreamId = null; clearWatchdog(); applyState(settleState()); return; }
    applyState(mapped);
  }
  document.addEventListener('axiom:chat-state', onChatState);

  // voice-controller.js's shared mic/speaker state — idle / listening / thinking / speaking / error.
  const VOICE_STATE_MAP = { idle: 'idle', listening: 'listening', thinking: 'thinking', speaking: 'speaking', error: 'error' };
  function onVoiceState(e) {
    const raw = e && e.detail && e.detail.state;
    const mapped = VOICE_STATE_MAP[raw];
    if (!mapped) return;
    if (mapped === 'error') { errorStream(null, new Error('Voice input failed.')); return; }
    applyState(mapped);
  }
  document.addEventListener('axiom:voice-state', onVoiceState);

  // workspace.js's minimal opt-in hook around OCR / captioning / transcription.
  function onHeavyTaskEvent(e) {
    const phase = e && e.detail && e.detail.state;
    if (phase === 'start') startHeavyTask();
    else if (phase === 'end') endHeavyTask();
  }
  document.addEventListener('axiom:heavy-task', onHeavyTaskEvent);

  // ---- Typing detection (self-contained; binds only if the element exists) ----
  function wireTypingDetection() {
    ['chatInput', 'dashboardPromptInput'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      let typingTimer = null;
      el.addEventListener('input', () => {
        dispatchTypingEvent(true);
        broadcast({ type: 'typing', typing: true });
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
          dispatchTypingEvent(false);
          broadcast({ type: 'typing', typing: false });
        }, 1200);
      });
    });
  }
  wireTypingDetection();

  // ---- Cleanup ---------------------------------------------------------------
  // Exposed for completeness / future SPA adoption — an MPA page teardown
  // doesn't strictly need this (the page unload reclaims everything), but
  // calling it leaves no dangling timers, channels, or listeners behind.
  function destroy() {
    clearWatchdog();
    document.removeEventListener('axiom:chat-state', onChatState);
    document.removeEventListener('axiom:voice-state', onVoiceState);
    document.removeEventListener('axiom:heavy-task', onHeavyTaskEvent);
    if (channel) { try { channel.close(); } catch (e) { /* isolated */ } }
    listeners.clear();
    activeStreamId = null;
    heavyCount = 0;
    state = DEFAULT_STATE;
  }

  // Sync whatever Reactor happens to be mounted on THIS page to the
  // bridge's current (default) state on load — keeps a freshly-opened
  // Dashboard tab visually consistent even before any cross-tab message
  // arrives.
  driveReactor(state);
  driveDashboardIndicator(state);

  return {
    // state
    setState: setState,
    getState: getState,
    onStateChange: onStateChange,
    // streaming
    startStream: startStream,
    chunkStream: chunkStream,
    completeStream: completeStream,
    interruptStream: interruptStream,
    cancelStream: cancelStream,
    errorStream: errorStream,
    retryStream: retryStream,
    // heavy tasks
    startHeavyTask: startHeavyTask,
    endHeavyTask: endHeavyTask,
    // lifecycle
    destroy: destroy,
  };
})();
