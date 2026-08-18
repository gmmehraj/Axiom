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

  // ---- Multimodal Intent & Context Understanding (Phase 1 & Phase 23) ----
  async function understand(input, options = {}) {
    options = options || {};
    const text = typeof input === 'string' ? input : (input && input.text) || '';
    const image = (input && input.image) || (typeof input === 'object' && input instanceof File && input.type.startsWith('image/') ? input : null);
    const video = (input && input.video) || (typeof input === 'object' && input instanceof File && input.type.startsWith('video/') ? input : null);
    const screenshot = (input && input.screenshot) || null;
    const toolResults = (input && input.toolResults) || options.toolResults || null;

    // 1. Gather context
    const user = global.AxiomVoiceGreeting && typeof global.AxiomVoiceGreeting.getUser === 'function' 
      ? await global.AxiomVoiceGreeting.getUser().catch(() => null) 
      : null;
    const currentPage = location.pathname.split('/').pop() || 'index.html';

    // 2. Resolve cross-turn references if text is present
    let resolvedText = text;
    if (global.AxiomNLU && typeof global.AxiomNLU.resolveReferences === 'function') {
      const convState = global.AxiomConversationManager && typeof global.AxiomConversationManager.state === 'function'
        ? global.AxiomConversationManager.state(options.conversationId) || {}
        : {};
      const refRes = global.AxiomNLU.resolveReferences(text, convState);
      if (refRes && refRes.resolvedText) resolvedText = refRes.resolvedText;
    }

    // 3. Recall relevant memories
    let memories = [];
    if (global.AxiomMemoryIntelligence && typeof global.AxiomMemoryIntelligence.rankedRecall === 'function') {
      try {
        memories = await global.AxiomMemoryIntelligence.rankedRecall(resolvedText || 'user preference context', 5);
      } catch (_) {}
    }

    // 4. Intent Classification
    const normalized = (resolvedText || '').toLowerCase().trim();
    let intent = 'general_assistance';
    let goal = resolvedText || 'Assist user';
    let requestedActions = [];
    let requiredTools = [];
    let confidence = 0.9;

    if (image || screenshot || /look at (this|my screen)|analyze (this|the) (image|screenshot|screen)|what('s| is) (wrong|this)|diagnose/i.test(normalized)) {
      intent = (image || screenshot) ? 'analyze_visual' : (/screen/i.test(normalized) ? 'analyze_screen' : 'analyze_visual');
      goal = 'Analyze visual input and diagnose any layout, UI, code, or functional issues';
      requestedActions = ['capture_or_load_visual', 'run_vision_model', 'generate_structured_report'];
      requiredTools = ['vision_analyze_image', 'vision_analyze_screen'];
      confidence = 0.95;
    } else if (video || /analyze (this|the) video|watch (this|the) video|video issue/i.test(normalized)) {
      intent = 'analyze_video';
      goal = 'Process video frames, perform temporal analysis, and detect anomalies';
      requestedActions = ['extract_keyframes', 'run_temporal_vision', 'build_timestamp_report'];
      requiredTools = ['vision_analyze_video'];
      confidence = 0.95;
    } else if (/^(build|create|make|design)\s+(me\s+)?(a\s+|an\s+)?(website|landing page|saas|portfolio|dashboard|app|page)/i.test(normalized) || /build this website/i.test(normalized)) {
      intent = 'build_website';
      goal = resolvedText;
      requestedActions = ['inspect_project', 'plan_components', 'generate_code', 'run_build', 'browser_test', 'screenshot', 'vision_qa', 'verify'];
      requiredTools = ['file_read', 'file_edit', 'file_create', 'terminal_build', 'browser_navigate', 'browser_screenshot', 'vision_analyze_image'];
      confidence = 0.96;
    } else if (/fix (it|them|the issue|the problem|the bug|this)|repair|solve this/i.test(normalized)) {
      intent = 'self_heal_fix';
      goal = 'Locate error cause in project files, apply code fix, re-test and verify';
      requestedActions = ['diagnose_root_cause', 'search_repo', 'modify_files', 'rebuild', 'retest_browser', 'verify_fix'];
      requiredTools = ['project_search', 'file_read', 'file_edit', 'terminal_build', 'browser_navigate'];
      confidence = 0.94;
    } else if (/^(deploy|ship|publish|push to prod)/i.test(normalized)) {
      intent = 'deploy_production';
      goal = 'Run pre-flight checks, commit, trigger Vercel deployment, and verify production smoke test';
      requestedActions = ['run_tests', 'run_build', 'check_git_diff', 'trigger_vercel', 'verify_production_url'];
      requiredTools = ['terminal_test', 'terminal_build', 'github_commit', 'vercel_deploy', 'vercel_verify'];
      confidence = 0.95;
    } else if (/^remember\s+(that\s+)?/i.test(normalized) || /^what\s+(color|setting|preference|did I choose)/i.test(normalized)) {
      intent = /^remember/i.test(normalized) ? 'store_memory' : 'recall_memory';
      goal = resolvedText;
      requestedActions = [intent === 'store_memory' ? 'persist_memory_item' : 'query_memory_graph'];
      requiredTools = [intent === 'store_memory' ? 'memory_store' : 'memory_recall'];
      confidence = 0.98;
    } else if (/^(open|go to|show|take me to)\s+/i.test(normalized) || /^(hide|show)\s+sidebar/i.test(normalized)) {
      intent = 'navigation_control';
      goal = resolvedText;
      requestedActions = ['execute_ui_navigation'];
      requiredTools = ['ui_navigation'];
      confidence = 0.99;
    }

    return {
      intent,
      goal,
      context: {
        page: currentPage,
        user: user ? { id: user.id, email: user.email, name: global.AxiomVoiceGreeting?.firstName(user) } : null,
        activeModel: state.activeModel,
        memories: memories || [],
        multimodal: {
          hasImage: !!image,
          hasVideo: !!video,
          hasScreenshot: !!screenshot,
          hasToolResults: !!toolResults
        }
      },
      requestedActions,
      requiredTools,
      confidence
    };
  }

  global.AxiomBrain = {
    getState, setState, on, off,
    dayCount, timeOfDay, understand
  };

  // Fire once on load so early widgets can render immediately.
  if (document.readyState !== 'loading') emit();
  else document.addEventListener('DOMContentLoaded', emit);
})(window);
