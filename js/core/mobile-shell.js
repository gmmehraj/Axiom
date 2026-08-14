/* Axiom Mobile Shell interaction layer.
 * Uses the canonical AxiomWorkspaceManager; it does not create a second registry.
 */
(function () {
  'use strict';

  const MOBILE_QUERY = '(max-width: 700px)';
  const SWIPE_THRESHOLD = 54;
  const VELOCITY_THRESHOLD = 0.35;
  const MOBILE_WORKSPACES = ['chat', 'brain', 'memory', 'browser', 'automation', 'agents', 'studios', 'settings'];

  function isMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  function getManager() { return window.AxiomWorkspaceManager || null; }

  function getIds() {
    const manager = getManager();
    if (!manager || typeof manager.getWorkspaces !== 'function') return [];
    return Object.keys(manager.getWorkspaces()).filter(id => !['billing', 'admin'].includes(id));
  }

  function openWorkspace(id, source) {
    const manager = getManager();
    if (!manager || typeof manager.open !== 'function') return false;
    if (!getIds().includes(id)) return false;
    manager.open(id, { source: source || 'mobile' });
    return true;
  }

  function openRelative(direction) {
    const manager = getManager();
    if (!manager) return;
    const ids = getIds();
    if (!ids.length) return;
    const current = (typeof manager.getCurrent === 'function' ? manager.getCurrent() : null) || document.body.dataset.workspace || 'dashboard';
    const index = Math.max(0, ids.indexOf(current));
    const next = (index + direction + ids.length) % ids.length;
    const target = ids[next];
    if (target && target !== current) manager.open(target, { source: 'mobile-swipe' });
  }

  function workspaceLabel(id) {
    const labels = {
      chat: 'Chat',
      brain: 'Brain',
      memory: 'Memory',
      browser: 'Browser',
      automation: 'Automation',
      agents: 'Agents',
      studios: 'Studios',
      settings: 'Settings',
      coding: 'Coding',
      knowledge: 'Knowledge'
    };
    return labels[id] || id.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function workspaceIcon(id) {
    const icons = {
      chat: '◌',
      brain: '♧',
      memory: '◇',
      browser: '◎',
      automation: 'ϟ',
      agents: '✦',
      studios: '◈',
      settings: '⚙',
      coding: '</>',
      knowledge: '⌘'
    };
    return icons[id] || '•';
  }

  function ensureMobileHome() {
    const inner = document.getElementById('axWorkspaceInner');
    if (!inner || !isMobile()) return;

    let home = inner.querySelector('.ax-mobile-home');
    if (!home) {
      home = document.createElement('section');
      home.className = 'ax-mobile-home';
      home.setAttribute('aria-label', 'Axiom mobile home');
      inner.appendChild(home);
    }

    const ids = getIds();
    const available = MOBILE_WORKSPACES.filter(id => ids.includes(id)).slice(0, 8);
    const existing = home.dataset.workspaceSignature;
    const signature = available.join('|');
    if (existing === signature) return;
    home.dataset.workspaceSignature = signature;

    home.innerHTML = `
      <div class="ax-mobile-home-hero">
        <div class="ax-mobile-home-eyebrow">AI Operating System</div>
        <h2 class="ax-mobile-home-title">AXIOM</h2>
        <p class="ax-mobile-home-subtitle">Your intelligence, workspace and automation layer — always at the center.</p>
        <button type="button" class="ax-mobile-home-composer" data-mobile-home-chat aria-label="Open Axiom Chat">
          <span>Ask Axiom anything...</span><strong>→</strong>
        </button>
      </div>
      <div class="ax-mobile-home-section">
        <div class="ax-mobile-home-section-label">Workspaces</div>
        <div class="ax-mobile-workspaces" data-mobile-workspaces></div>
      </div>
      <div class="ax-mobile-home-hint" aria-hidden="true">
        <span>←</span><span>Swipe to navigate workspaces</span><span>→</span>
      </div>
    `;

    const grid = home.querySelector('[data-mobile-workspaces]');
    available.forEach(id => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ax-mobile-workspace-btn';
      button.dataset.workspace = id;
      button.setAttribute('aria-label', `Open ${workspaceLabel(id)}`);
      button.innerHTML = `<span class="ax-mobile-workspace-icon" aria-hidden="true">${workspaceIcon(id)}</span><span class="ax-mobile-workspace-name">${workspaceLabel(id)}</span>`;
      button.addEventListener('click', () => openWorkspace(id, 'mobile-home'));
      grid.appendChild(button);
    });

    const chat = home.querySelector('[data-mobile-home-chat]');
    if (chat) chat.addEventListener('click', () => openWorkspace('chat', 'mobile-home-composer'));
  }

  function updateHomeVisibility() {
    const home = document.querySelector('.ax-mobile-home');
    if (!home) return;
    const current = document.body.dataset.workspace || 'dashboard';
    home.hidden = !isMobile() || (current !== 'dashboard' && current !== 'home');
  }

  function installWorkspaceObserver() {
    const manager = getManager();
    if (!manager || manager.__axiomMobileHomeObserverInstalled) return;
    manager.__axiomMobileHomeObserverInstalled = true;

    const originalOpen = typeof manager.open === 'function' ? manager.open.bind(manager) : null;
    if (!originalOpen) return;

    manager.open = function () {
      const result = originalOpen.apply(manager, arguments);
      window.requestAnimationFrame(() => {
        updateHomeVisibility();
        if (isMobile()) ensureMobileHome();
      });
      return result;
    };
  }

  function install() {
    const surface = document.getElementById('axWorkspaceInner');
    if (!surface) return;

    if (isMobile()) {
      ensureMobileHome();
      installWorkspaceObserver();
    }

    if (surface.dataset.mobileGesturesInstalled === 'true') return;
    surface.dataset.mobileGesturesInstalled = 'true';

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let tracking = false;

    surface.addEventListener('touchstart', (event) => {
      if (!isMobile() || event.touches.length !== 1) return;
      const t = event.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startTime = performance.now();
      tracking = true;
    }, { passive: true });

    surface.addEventListener('touchend', (event) => {
      if (!tracking || !isMobile() || event.changedTouches.length !== 1) return;
      tracking = false;
      const t = event.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const elapsed = Math.max(1, performance.now() - startTime);
      const velocity = Math.abs(dx) / elapsed;

      // Horizontal intent only: vertical scrolling stays native.
      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy) * 1.25) return;
      if (velocity < VELOCITY_THRESHOLD && Math.abs(dx) < 90) return;

      openRelative(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  function boot() {
    install();
    window.addEventListener('resize', () => {
      if (isMobile()) {
        ensureMobileHome();
        installWorkspaceObserver();
      }
      updateHomeVisibility();
    }, { passive: true });
    window.addEventListener('workspacechange', () => {
      updateHomeVisibility();
      if (isMobile()) ensureMobileHome();
    });
    window.setTimeout(() => {
      if (isMobile()) {
        ensureMobileHome();
        installWorkspaceObserver();
        updateHomeVisibility();
      }
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
