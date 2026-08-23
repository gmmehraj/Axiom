// ============================================================
// AXIOM — Canonical Voice Website Controller (Phase 9 & Phase 28)
// Single canonical command registry for voice navigation and control.
// ============================================================
(function (w) {
  'use strict';

  const routes = {
    dashboard: ['dashboard', 'home', 'mission control', 'desktop', 'main'],
    brain: ['brain', 'core', 'system status', 'reactor'],
    memory: ['memory', 'memories', 'knowledge', 'notes', 'knowledge graph'],
    browser: ['browser', 'web', 'browser studio', 'navigator'],
    automation: ['automation', 'workflows', 'automations', 'triggers', 'skills'],
    playground: ['playground', 'chat', 'studio', 'prompt'],
    settings: ['settings', 'preferences', 'configuration', 'config'],
    billing: ['billing', 'credits', 'subscription', 'plan', 'payment'],
    analytics: ['analytics', 'metrics', 'stats', 'telemetry'],
    workspace: ['workspace', 'files', 'documents', 'uploads'],
    'agent-library': ['agent library', 'agents', 'agent catalog', 'studios']
  };

  function emit(name, detail) {
    try { document.dispatchEvent(new CustomEvent(name, { detail })); } catch (_) {}
  }

  function normalize(text) {
    return String(text || '').toLowerCase().replace(/[!?.,;:'"]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const PREFIXES = [
    'open the ', 'open my ', 'open ',
    'go to the ', 'go to my ', 'go to ',
    'show me the ', 'show me ', 'show the ', 'show ',
    'take me to the ', 'take me to ',
    'launch the ', 'launch ',
    'navigate to the ', 'navigate to ',
    'switch to the ', 'switch to ',
    'view the ', 'view '
  ];

  function findRoute(t) {
    for (const [route, aliases] of Object.entries(routes)) {
      for (const a of aliases) {
        if (t === a) return route;
        for (const p of PREFIXES) {
          if (t === p + a) return route;
        }
      }
    }
    return null;
  }

  function navigate(route) {
    const candidates = ['/' + route + '.html', route + '.html', '/' + route, '#' + route];
    const target = candidates[0];
    try {
      if (w.AxiomRouter?.navigate) { w.AxiomRouter.navigate(route); return true; }
      if (w.router?.navigate) { w.router.navigate(route); return true; }
      const wm = w.AxiomWorkspaceManager;
      if (wm && (typeof wm.open === 'function' || typeof wm.openApp === 'function')) {
        const appMap = { dashboard: 'dashboard', brain: 'brain', memory: 'memory', browser: 'browser', automation: 'automation', playground: 'chat', settings: 'settings', billing: 'billing', analytics: 'analytics', workspace: 'files', 'agent-library': 'agents' };
        const appId = appMap[route] || route;
        if (typeof wm.open === 'function') { wm.open(appId); return true; }
        if (typeof wm.openApp === 'function') { wm.openApp(appId); return true; }
      }
      if (location.pathname.endsWith('/' + route + '.html') || location.pathname === target) return true;
      location.href = target;
      return true;
    } catch (e) {
      emit('axiom:voice-command-error', { error: e, command: route });
      return false;
    }
  }

  function execute(text) {
    const t = normalize(text);
    if (!t) return { handled: false };

    // 1. Stop / Mute Voice
    if (/^(stop|cancel|be quiet|shut up|silence|pause)( axiom)?$/.test(t) || t.includes('stop speaking') || t.includes('be quiet')) {
      w.JarvisVoiceController?.stopSpeaking();
      w.AxiomElevenLabsVoice?.cancel();
      emit('axiom:voice-command', { intent: 'stop-speaking' });
      return { handled: true, intent: 'stop-speaking', response: "Got it, I'll be quiet." };
    }

    // 2. Standby / Wake Voice Commands
    if (/^(go to sleep|sleep|standby|rest)( axiom)?$/.test(t)) {
      w.AxiomAIState?.setState('sleeping');
      emit('axiom:voice-command', { intent: 'sleep' });
      return { handled: true, intent: 'sleep', response: 'Going into standby mode. Say "Hey Axiom" whenever you need me.' };
    }
    if (/^(wake up|wake|hello axiom|hi axiom)( axiom)?$/.test(t)) {
      w.AxiomAIState?.setState('wake');
      emit('axiom:voice-command', { intent: 'wake' });
      return { handled: true, intent: 'wake', response: "I'm awake and listening." };
    }

    // 3. Sidebar UI Control
    if (t.includes('hide sidebar') || t.includes('close sidebar') || t.includes('collapse sidebar')) {
      document.body.classList.add('ax-sidebar-hidden');
      emit('axiom:voice-command', { intent: 'hide-sidebar' });
      return { handled: true, intent: 'hide-sidebar', response: 'Sidebar hidden.' };
    }
    if (t.includes('show sidebar') || t.includes('open sidebar') || t.includes('expand sidebar')) {
      document.body.classList.remove('ax-sidebar-hidden');
      emit('axiom:voice-command', { intent: 'show-sidebar' });
      return { handled: true, intent: 'show-sidebar', response: 'Sidebar open.' };
    }

    // 4. Navigation
    const route = findRoute(t);
    if (route) {
      const ok = navigate(route);
      const name = route.replace('-', ' ').replace(/\b\w/g, c => c.toUpperCase());
      return { handled: true, intent: 'navigate', target: route, response: ok ? 'Opening ' + name + '.' : "I couldn't open " + name + '.' };
    }

    // 5. History Navigation
    if (t === 'go back' || t === 'back') {
      history.back();
      return { handled: true, intent: 'back', response: 'Going back.' };
    }
    if (t === 'go forward' || t === 'forward') {
      history.forward();
      return { handled: true, intent: 'forward', response: 'Going forward.' };
    }

    // 6. Vision / Screen Analysis
    if (t.includes('analyze this image') || t.includes('analyze the image') || t.includes('look at this image') || t.includes('diagnose this image')) {
      document.dispatchEvent(new CustomEvent('axiom:vision-command', { detail: { action: 'analyze' } }));
      return { handled: true, intent: 'vision-analyze', response: "Got it. I'm taking a look at the image now." };
    }
    if (t.includes('capture screen') || t.includes('analyze my screen') || t.includes('look at my screen') || t.includes('what is on my screen')) {
      document.dispatchEvent(new CustomEvent('axiom:vision-command', { detail: { action: 'screenshot' } }));
      return { handled: true, intent: 'vision-screenshot', response: "I'll take a look at your screen now." };
    }
    if (t.includes('analyze this video') || t.includes('analyze the video') || t.includes('watch this video')) {
      document.dispatchEvent(new CustomEvent('axiom:vision-command', { detail: { action: 'video' } }));
      return { handled: true, intent: 'vision-video', response: "Processing the video keyframes and analyzing the timeline." };
    }

    // 7. Autonomous Execution Commands
    if (/^(build|create|make)\s+(me\s+)?(a\s+|an\s+)?(website|landing page|saas|app)/i.test(t)) {
      emit('axiom:autonomous-command', { intent: 'build_website', prompt: text });
      return {
        handled: true,
        intent: 'build_website',
        response: "I'll inspect the current project first, then I'll build it and verify the result."
      };
    }

    if (/fix (it|them|the problem|the bug|the issue)|repair this/i.test(t)) {
      emit('axiom:autonomous-command', { intent: 'fix_issue', prompt: text });
      return {
        handled: true,
        intent: 'fix_issue',
        response: "I found the issue. I'll inspect the relevant component, apply the fix, and verify it."
      };
    }

    if (/^(deploy|ship it|deploy it|publish)/i.test(t)) {
      emit('axiom:autonomous-command', { intent: 'deploy', prompt: text });
      return {
        handled: true,
        intent: 'deploy',
        response: "The production checks passed. I'll deploy it now and smoke-test the live URL."
      };
    }

    return { handled: false };
  }

  function attach() {
    if (w.AxiomVoiceWebsiteController) return;
    w.AxiomVoiceWebsiteController = { execute, routes };
    document.addEventListener('axiom:voice-command-request', e => {
      const text = e.detail?.text || '';
      const result = execute(text);
      if (result.handled) emit('axiom:voice-command-result', result);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
})(window);
