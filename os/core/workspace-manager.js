// ============================================================
// AXIOM AI OS X — Workspace Manager
// Loads workspaces as modules on demand
// ============================================================
window.AxiomWorkspaceManager = (function() {
  'use strict';

  const WORKSPACES = {
    dashboard: { name: 'Mission Control', icon: 'os', module: null, loaded: false },
    chat: { name: 'AI Chat', icon: 'chat', module: null, loaded: false },
    memory: { name: 'Memory', icon: 'memory', module: null, loaded: false },
    analytics: { name: 'Analytics', icon: 'analytics', module: null, loaded: false },
    browser: { name: 'Browser', icon: 'browser', module: null, loaded: false },
    brain: { name: 'AI Brain', icon: 'brain', module: null, loaded: false },
    voice: { name: 'Voice', icon: 'voice', module: null, loaded: false },
    coding: { name: 'Coding', icon: 'coding', module: null, loaded: false },
    files: { name: 'Files', icon: 'files', module: null, loaded: false },
    image: { name: 'Image Studio', icon: 'image', module: null, loaded: false },
    video: { name: 'Video Studio', icon: 'video', module: null, loaded: false },
    audio: { name: 'Audio Studio', icon: 'audio', module: null, loaded: false },
    agents: { name: 'AI Agents', icon: 'agents', module: null, loaded: false },
    marketplace: { name: 'Marketplace', icon: 'marketplace', module: null, loaded: false },
    knowledge: { name: 'Knowledge Graph', icon: 'knowledge', module: null, loaded: false },
    calendar: { name: 'Calendar', icon: 'calendar', module: null, loaded: false },
    projects: { name: 'Projects', icon: 'projects', module: null, loaded: false },
    terminal: { name: 'Terminal', icon: 'terminal', module: null, loaded: false },
    whiteboard: { name: 'Whiteboard', icon: 'whiteboard', module: null, loaded: false },
    mindmap: { name: 'Mind Map', icon: 'mindmap', module: null, loaded: false },
    automation: { name: 'Automation', icon: 'automation', module: null, loaded: false },
    settings: { name: 'Settings', icon: 'settings', module: null, loaded: false },
    billing: { name: 'Billing', icon: 'billing', module: null, loaded: false },
    admin: { name: 'Admin', icon: 'admin', module: null, loaded: false },
  };

  let currentWorkspace = null;
  let listeners = [];
  let container = null;

  function getWorkspaces() { return WORKSPACES; }
  function getCurrent() { return currentWorkspace; }
  function getWorkspace(id) { return WORKSPACES[id]; }

  function setContainer(el) {
    container = el;
  }

  function open(workspaceId, opts = {}) {
    if (!WORKSPACES[workspaceId]) return;
    if (workspaceId === currentWorkspace && !opts.force) return;

    const ws = WORKSPACES[workspaceId];
    currentWorkspace = workspaceId;

    listeners.forEach(fn => fn(workspaceId, ws));

    document.dispatchEvent(new CustomEvent('ax-workspace-open', {
      detail: { workspace: workspaceId, config: ws }
    }));

    if (!ws.module) {
      loadModule(workspaceId, opts);
    } else {
      renderModule(workspaceId, opts);
    }
  }

  function loadModule(workspaceId, opts = {}) {
    const ws = WORKSPACES[workspaceId];
    if (!ws) return;

    // Milestone 2: cross-check against the app manifest (additive/diagnostic
    // only — this does not change load behavior). If the manifest flags a
    // page 'unresolved', warn loudly instead of silently guessing.
    if (window.AxiomAppManifest) {
      const entry = Object.values(window.AxiomAppManifest.pages || {})
        .find(p => p.workspaceId === workspaceId);
      if (entry && entry.role === 'unresolved') {
        console.warn(`[WorkspaceManager] "${workspaceId}" is flagged 'unresolved' in ` +
          `the app manifest (${entry.reason}). Opening anyway, but this needs a human decision.`);
      }
    }

    // Milestone 2 — Step 1: loading state while the module script is fetched.
    renderLoading(workspaceId);

    // Try to load from workspace module
    const script = document.createElement('script');
    script.src = `os/workspaces/${workspaceId}.js`;
    script.onload = () => {
      ws.loaded = true;
      // Check if the module registered itself
      if (window.AxiomWorkspaces && window.AxiomWorkspaces[workspaceId]) {
        ws.module = window.AxiomWorkspaces[workspaceId];
      }
      if (ws.module) {
        renderModule(workspaceId, opts);
      } else {
        // Script loaded but never registered a module — treat as a real
        // error state rather than looping back into "being initialized".
        renderError(workspaceId, opts, 'This workspace didn\'t load correctly.');
      }
    };
    script.onerror = () => {
      // Milestone 2 — Step 1: real error state, not an indefinite spinner.
      renderError(workspaceId, opts, 'This workspace failed to load.');
    };
    document.head.appendChild(script);
  }

  function renderLoading(workspaceId) {
    if (!container) return;
    const ws = WORKSPACES[workspaceId];
    if (!ws) return;
    container.innerHTML = `
      <div class="ax-workspace-fallback" data-motion="fade-in">
        <div class="ax-workspace-fallback-icon">${window.AxiomIcons ? window.AxiomIcons.svg(ws.icon, 48) : ''}</div>
        <h2>${ws.name}</h2>
        <p>Loading…</p>
        <div class="ax-workspace-fallback-loader">
          <div class="ax-loader-ring"></div>
        </div>
      </div>
    `;
  }

  function renderError(workspaceId, opts, message) {
    if (!container) return;
    const ws = WORKSPACES[workspaceId];
    if (!ws) return;
    container.innerHTML = `
      <div class="ax-workspace-fallback" data-motion="fade-in">
        <div class="ax-workspace-fallback-icon">${window.AxiomIcons ? window.AxiomIcons.svg(ws.icon, 48) : ''}</div>
        <h2>${ws.name}</h2>
        <p>${message}</p>
        <button class="btn btn-sm" data-ws-retry>Retry</button>
      </div>
    `;
    const retryBtn = container.querySelector('[data-ws-retry]');
    if (retryBtn) retryBtn.addEventListener('click', () => {
      ws.module = null;
      ws.loaded = false;
      loadModule(workspaceId, opts);
    });
  }

  function renderModule(workspaceId, opts = {}) {
    if (!container) return;
    const ws = WORKSPACES[workspaceId];
    if (!ws) return;

    if (ws.module && typeof ws.module.render === 'function') {
      container.innerHTML = '';
      ws.module.render(container, opts);
    } else {
      renderFallback(workspaceId, opts);
    }
  }

  function renderFallback(workspaceId, opts = {}) {
    if (!container) return;
    const ws = WORKSPACES[workspaceId];
    if (!ws) return;

    // Generic fallback renderer
    container.innerHTML = `
      <div class="ax-workspace-fallback" data-motion="fade-in">
        <div class="ax-workspace-fallback-icon">${window.AxiomIcons ? window.AxiomIcons.svg(ws.icon, 48) : ''}</div>
        <h2>${ws.name}</h2>
        <p>This workspace is being initialized.</p>
        <div class="ax-workspace-fallback-loader">
          <div class="ax-loader-ring"></div>
        </div>
      </div>
    `;
  }

  function onChange(fn) {
    listeners.push(fn);
    return () => { listeners = listeners.filter(l => l !== fn); };
  }

  return {
    getWorkspaces,
    getCurrent,
    getWorkspace,
    setContainer,
    open,
    openApp: open,
    onChange,
  };
})();
