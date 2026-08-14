// ============================================================
// AXIOM — Application Manifest + Canonical Workspace Registry
// ------------------------------------------------------------
// The workspace registry is the single source of truth for workspace
// identity, availability, presentation and routing. Launchers must not
// maintain their own workspace maps.
// ============================================================
window.AxiomAppManifest = {
  version: 4,
  milestone: 'Phase 3 — Mobile OS Shell',

  pages: {
    'index.html': { role: 'standalone', reason: 'Pre-auth marketing/landing page.' },
    'login.html': { role: 'standalone', reason: 'Pre-auth authentication page.' },
    'register.html': { role: 'standalone', reason: 'Pre-auth registration page.' },
    'os-shell.html': { role: 'primary', reason: 'Canonical authenticated application shell.' },
    'playground.html': { role: 'workspace', workspaceId: 'chat', status: 'integrated', reason: 'Real Chat workspace page.' },
    'workspace.html': { role: 'workspace', workspaceId: 'files', status: 'pending', reason: 'Candidate Files page; no workspace module exists yet.' },
    'browser.html': { role: 'workspace', workspaceId: 'browser', status: 'integrated', reason: 'Real Browser workspace page.' },
    'analytics.html': { role: 'workspace', workspaceId: 'analytics', status: 'integrated', reason: 'Real Analytics workspace page.' },
    'automation.html': { role: 'workspace', workspaceId: 'automation', status: 'integrated', reason: 'Real Automation workspace page.' },
    'agent-library.html': { role: 'workspace', workspaceId: 'agents', status: 'integrated', reason: 'Real Agents workspace page.' },
    'settings.html': { role: 'workspace', workspaceId: 'settings', status: 'integrated', reason: 'Real Settings workspace page.' },
    'memory.html': { role: 'workspace', workspaceId: 'memory', status: 'needs-rework', reason: 'Module exists but currently contains placeholder data.' },
    'brain.html': { role: 'workspace', workspaceId: 'brain', status: 'needs-rework', reason: 'Module exists but currently contains placeholder data.' },
    'billing.html': { role: 'standalone-recommended', workspaceId: 'billing', status: 'flagged', reason: 'Razorpay checkout should remain direct navigation.' },
    'admin.html': { role: 'standalone', workspaceId: 'admin', status: 'standalone', reason: 'Admin console is intentionally outside the general-user dock.' },
    'studios.html': { role: 'unresolved', reason: 'Browser/Studios relationship still needs a product decision.' }
  },

  // Canonical workspace definitions. No launcher should maintain a second
  // list of workspace ids, labels, routes or availability decisions.
  // mobilePriority is presentation metadata on the canonical registry, not
  // a second mobile workspace list. null means launcher-only.
  workspaces: {
    dashboard: { id: 'dashboard', name: 'Mission Control', description: 'Axiom home and system overview.', icon: 'os', category: 'core', status: 'implemented', safeToOpen: true, presentation: 'shell', mobilePriority: 0 },
    chat: { id: 'chat', name: 'Chat', description: 'AI conversation workspace.', icon: 'chat', category: 'core', status: 'implemented', route: 'playground.html', modulePath: 'os/workspaces/chat.js', safeToOpen: true, presentation: 'window', mobilePriority: 10 },
    memory: { id: 'memory', name: 'Memory', description: 'Persistent Axiom memory.', icon: 'memory', category: 'core', status: 'partial', route: 'memory.html', modulePath: 'os/workspaces/memory.js', safeToOpen: true, presentation: 'window', mobilePriority: 30 },
    analytics: { id: 'analytics', name: 'Analytics', description: 'Analytics and reporting.', icon: 'analytics', category: 'core', status: 'implemented', route: 'analytics.html', modulePath: 'os/workspaces/analytics.js', safeToOpen: true, presentation: 'window' },
    browser: { id: 'browser', name: 'Browser', description: 'Integrated browser and research tools.', icon: 'browser', category: 'core', status: 'implemented', route: 'browser.html', modulePath: 'os/workspaces/browser.js', safeToOpen: true, presentation: 'window', mobilePriority: 40 },
    brain: { id: 'brain', name: 'AI Brain', description: 'Axiom reasoning and activity view.', icon: 'brain', category: 'core', status: 'partial', route: 'brain.html', modulePath: 'os/workspaces/brain.js', safeToOpen: true, presentation: 'window', mobilePriority: 20 },
    voice: { id: 'voice', name: 'Voice', description: 'Voice interaction workspace.', icon: 'voice', category: 'ai', status: 'pending', safeToOpen: true, presentation: 'window' },
    coding: { id: 'coding', name: 'Coding', description: 'Code-focused Chat workspace.', icon: 'coding', category: 'ai', status: 'implemented', route: 'playground.html?mode=code', safeToOpen: true, presentation: 'window' },
    files: { id: 'files', name: 'Files', description: 'File system workspace.', icon: 'files', category: 'tools', status: 'pending', route: 'workspace.html', safeToOpen: true, presentation: 'window' },
    image: { id: 'image', name: 'Image Studio', description: 'Image generation workspace.', icon: 'image', category: 'studios', status: 'pending', safeToOpen: true, presentation: 'window' },
    video: { id: 'video', name: 'Video Studio', description: 'Video generation workspace.', icon: 'video', category: 'studios', status: 'pending', safeToOpen: true, presentation: 'window' },
    audio: { id: 'audio', name: 'Audio Studio', description: 'Audio generation workspace.', icon: 'audio', category: 'studios', status: 'pending', safeToOpen: true, presentation: 'window' },
    agents: { id: 'agents', name: 'AI Agents', description: 'Agent library and orchestration.', icon: 'agents', category: 'ai', status: 'implemented', route: 'agent-library.html', modulePath: 'os/workspaces/agents.js', safeToOpen: true, presentation: 'window', mobilePriority: 60 },
    marketplace: { id: 'marketplace', name: 'Marketplace', description: 'Axiom marketplace.', icon: 'marketplace', category: 'tools', status: 'pending', safeToOpen: true, presentation: 'window' },
    knowledge: { id: 'knowledge', name: 'Knowledge Graph', description: 'Knowledge and relationships.', icon: 'knowledge', category: 'tools', status: 'pending', safeToOpen: true, presentation: 'window' },
    calendar: { id: 'calendar', name: 'Calendar', description: 'Calendar and scheduling.', icon: 'calendar', category: 'productivity', status: 'pending', safeToOpen: true, presentation: 'window' },
    projects: { id: 'projects', name: 'Projects', description: 'Project workspace.', icon: 'projects', category: 'productivity', status: 'pending', safeToOpen: true, presentation: 'window' },
    terminal: { id: 'terminal', name: 'Terminal', description: 'Terminal workspace.', icon: 'terminal', category: 'developer', status: 'pending', safeToOpen: true, presentation: 'window' },
    whiteboard: { id: 'whiteboard', name: 'Whiteboard', description: 'Visual whiteboard.', icon: 'whiteboard', category: 'tools', status: 'pending', safeToOpen: true, presentation: 'window' },
    mindmap: { id: 'mindmap', name: 'Mind Map', description: 'Mind mapping workspace.', icon: 'mindmap', category: 'tools', status: 'pending', safeToOpen: true, presentation: 'window' },
    automation: { id: 'automation', name: 'Automation', description: 'Automation workflows.', icon: 'automation', category: 'ai', status: 'implemented', route: 'automation.html', modulePath: 'os/workspaces/automation.js', safeToOpen: true, presentation: 'window', mobilePriority: 50 },
    settings: { id: 'settings', name: 'Settings', description: 'Axiom settings.', icon: 'settings', category: 'system', status: 'implemented', route: 'settings.html', modulePath: 'os/workspaces/settings.js', safeToOpen: true, presentation: 'window' },
    billing: { id: 'billing', name: 'Billing', description: 'Billing and checkout.', icon: 'billing', category: 'system', status: 'standalone', route: 'billing.html', safeToOpen: true, presentation: 'external' },
    admin: { id: 'admin', name: 'Admin', description: 'Administrative console.', icon: 'admin', category: 'system', status: 'standalone', route: 'admin.html', safeToOpen: true, presentation: 'external' }
  },

  getWorkspace(id) { return this.workspaces[id] || null; },
  listWorkspaces() { return Object.values(this.workspaces); },
  listMobileWorkspaces() {
    return Object.values(this.workspaces)
      .filter(ws => Number.isFinite(ws.mobilePriority) && (ws.status === 'implemented' || ws.status === 'partial'))
      .sort((a, b) => a.mobilePriority - b.mobilePriority);
  },
  resolveWorkspace(id) {
    const workspace = this.getWorkspace(id);
    if (!workspace) return { id, status: 'error', safeToOpen: false, reason: 'Unknown workspace.' };
    if (!workspace.safeToOpen) return { ...workspace, status: 'error' };
    return workspace;
  },
  openWorkspace(id, options) {
    const workspace = this.resolveWorkspace(id);
    if (!workspace || workspace.status === 'error') {
      if (window.AxiomWorkspaceManager?.showUnavailable) window.AxiomWorkspaceManager.showUnavailable(id, workspace?.reason || 'Workspace not found.');
      return false;
    }
    if (window.AxiomMobileWorkspaceNavigator?.isActive?.() && !options?.bypassMobile) {
      return window.AxiomMobileWorkspaceNavigator.open(id, options || {});
    }
    if (workspace.presentation === 'external') {
      window.open(workspace.route, '_blank', 'noopener');
      return true;
    }
    if (window.AxiomWorkspaceManager?.open) {
      window.AxiomWorkspaceManager.open(id, options || {});
      return true;
    }
    return false;
  }
};

(function installMobilePresentationAssets() {
  'use strict';
  const MOBILE_QUERY = '(max-width: 1024px)';
  const CSS_ID = 'ax-phase3-mobile-css';
  const SCRIPT_ID = 'ax-phase3-mobile-js';
  function active() { return window.matchMedia?.(MOBILE_QUERY).matches; }
  function loadAssets() {
    if (!active()) return;
    if (!document.getElementById(CSS_ID)) {
      const link = document.createElement('link');
      link.id = CSS_ID; link.rel = 'stylesheet'; link.href = 'styles/mobile-os.css';
      document.head.appendChild(link);
    }
    if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id = SCRIPT_ID; script.src = 'os/core/mobile-workspace-navigator.js'; script.async = true;
      document.head.appendChild(script);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadAssets, { once: true });
  else loadAssets();
  window.addEventListener('resize', loadAssets, { passive: true });
})();

(function installWorkspaceLaunchBridge() {
  'use strict';
  function sanitizeRememberedWorkspaces() {
    try {
      const ids = JSON.parse(localStorage.getItem('axiom-open-workspaces') || '[]');
      if (!Array.isArray(ids)) return;
      const safe = ids.filter(id => {
        const ws = window.AxiomAppManifest.resolveWorkspace(id);
        return ws.status === 'implemented' && ws.presentation === 'window';
      });
      localStorage.setItem('axiom-open-workspaces', JSON.stringify(safe));
    } catch (_) { /* storage is best effort */ }
  }
  function launchFromElement(target) {
    const dockItem = target.closest?.('.ax-dock-item');
    const searchItem = target.closest?.('.ax-search-item');
    const commandItem = target.closest?.('.ax-cmd-item');
    const quickAction = target.closest?.('.ax-qa-btn');
    const suggestion = target.closest?.('.ax-acc-suggestion');
    const avatar = target.closest?.('.ax-topbar-avatar');
    let id = dockItem?.dataset.workspace || suggestion?.dataset.workspace || quickAction?.dataset.action || (avatar ? 'settings' : null);
    const searchWorkspaceMap = {
      'cmd-new-chat': 'chat', 'cmd-new-memory': 'memory', 'cmd-generate-image': 'image',
      'cmd-analyze': 'analytics', 'cmd-browse': 'browser', 'cmd-settings': 'settings', 'cmd-billing': 'billing'
    };
    if (searchItem) id = searchItem.dataset.id?.startsWith('ws-') ? searchItem.dataset.id.slice(3) : searchWorkspaceMap[searchItem.dataset.id] || id;
    const commandWorkspaceMap = {
      'cmd-dashboard': 'dashboard', 'cmd-chat': 'chat', 'cmd-memory': 'memory', 'cmd-browser': 'browser',
      'cmd-coding': 'coding', 'cmd-analytics': 'analytics', 'cmd-voice': 'voice', 'cmd-image': 'image', 'cmd-settings': 'settings'
    };
    if (commandItem) id = commandWorkspaceMap[commandItem.dataset.id] || id;
    if (!id || !window.AxiomAppManifest.getWorkspace(id)) return false;
    window.AxiomAppManifest.openWorkspace(id);
    return true;
  }
  function install() {
    sanitizeRememberedWorkspaces();
    document.addEventListener('click', function (event) {
      if (launchFromElement(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    if (window.AxiomOS && typeof window.AxiomOS.openWorkspace === 'function') window.AxiomOS.openWorkspace = window.AxiomAppManifest.openWorkspace;
    if (window.AxiomWindowManager?.getAllWindows) window.AxiomWindowManager.getAllWindows().forEach(win => {
      const id = String(win.id || '').replace(/^ws-/, '');
      const ws = window.AxiomAppManifest.getWorkspace(id);
      if (ws && ws.status === 'pending' && win.element) {
        const body = win.element.querySelector('.ax-window-body');
        if (body) body.innerHTML = `<div class="ax-workspace-fallback" data-motion="fade-in"><div class="ax-workspace-fallback-icon">${window.AxiomIcons ? window.AxiomIcons.svg(ws.icon, 48) : ''}</div><h2>${ws.name}</h2><p>This workspace is not yet available in Axiom.</p><small>Coming soon</small></div>`;
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
