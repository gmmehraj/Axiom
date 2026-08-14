/* Axiom Mobile Shell interaction layer.
 * Uses the canonical AxiomWorkspaceManager; it does not create a second registry.
 * Mobile Home uses the same OS dock/navigation model as desktop instead of a
 * separate "Workspaces" launcher.
 */
(function () {
  'use strict';

  const MOBILE_QUERY = '(max-width: 1024px), (hover: none) and (pointer: coarse)';
  const SWIPE_THRESHOLD = 54;
  const VELOCITY_THRESHOLD = 0.35;
  const MOBILE_WORKSPACES = ['chat', 'brain', 'memory', 'browser', 'automation', 'agents', 'studios', 'settings'];

  function isMobile() { return window.matchMedia(MOBILE_QUERY).matches; }
  function getManager() { return window.AxiomWorkspaceManager || null; }

  function ensureDockStylesheet() {
    if (document.querySelector('link[data-axiom-mobile-dock]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'styles/mobile-dock.css';
    link.dataset.axiomMobileDock = 'true';
    document.head.appendChild(link);
  }

  function getIds() {
    const manager = getManager();
    if (!manager || typeof manager.getWorkspaces !== 'function') return [];
    return Object.keys(manager.getWorkspaces()).filter(id => !['billing', 'admin', 'dashboard', 'home'].includes(id));
  }

  function openWorkspace(id, source) {
    const manager = getManager();
    if (!manager || typeof manager.open !== 'function') return false;
    if (!getIds().includes(id)) return false;
    manager.open(id, { source: source || 'mobile' });
    return true;
  }

  function openRelative(direction) {
    const ids = getIds();
    if (!ids.length) return;
    const manager = getManager();
    const current = (manager && typeof manager.getCurrent === 'function' ? manager.getCurrent() : null) || document.body.dataset.workspace || 'dashboard';
    const index = Math.max(0, ids.indexOf(current));
    const next = (index + direction + ids.length) % ids.length;
    const target = ids[next];
    if (target && target !== current) openWorkspace(target, 'mobile-swipe');
  }

  function workspaceLabel(id) {
    const labels = { chat:'Chat', brain:'Brain', memory:'Memory', browser:'Browser', automation:'Automation', agents:'Agents', studios:'Studios', settings:'Settings', coding:'Coding', knowledge:'Knowledge' };
    return labels[id] || id.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function workspaceIcon(id) {
    const icons = { chat:'◌', brain:'♧', memory:'◇', browser:'◎', automation:'ϟ', agents:'✦', studios:'◈', settings:'⚙', coding:'</>', knowledge:'⌘' };
    return icons[id] || '•';
  }

  function ensureMobileDock() {
    if (!isMobile()) return;
    const dock = document.getElementById('axDock');
    if (!dock) return;

    const ids = MOBILE_WORKSPACES.filter(id => getIds().includes(id)).slice(0, 8);
    const signature = ids.join('|');
    if (dock.dataset.mobileDockSignature === signature) {
      updateMobileDockState();
      return;
    }
    dock.dataset.mobileDockSignature = signature;
    dock.innerHTML = '';

    ids.forEach(id => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ax-mobile-dock-item';
      button.dataset.workspace = id;
      button.setAttribute('aria-label', `Open ${workspaceLabel(id)}`);
      button.innerHTML = `<span class="ax-mobile-dock-icon" aria-hidden="true">${workspaceIcon(id)}</span><span class="ax-mobile-dock-label">${workspaceLabel(id)}</span>`;
      button.addEventListener('click', () => openWorkspace(id, 'mobile-dock'));
      dock.appendChild(button);
    });

    updateMobileDockState();
  }

  function updateMobileDockState() {
    const dock = document.getElementById('axDock');
    if (!dock) return;
    const current = document.body.dataset.workspace || 'dashboard';
    dock.querySelectorAll('[data-workspace]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.workspace === current);
    });
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

    if (home.dataset.mobileHomeBuilt === 'true') return;
    home.dataset.mobileHomeBuilt = 'true';
    home.innerHTML = `
      <div class="ax-mobile-home-hero">
        <div class="ax-mobile-home-eyebrow">AI Operating System</div>
        <h2 class="ax-mobile-home-title">AXIOM</h2>
        <p class="ax-mobile-home-subtitle">Your intelligence, workspace and automation layer — always at the center.</p>
        <button type="button" class="ax-mobile-home-composer" data-mobile-home-chat aria-label="Open Axiom Chat">
          <span>Ask Axiom anything...</span><strong>→</strong>
        </button>
      </div>
      <div class="ax-mobile-home-hint" aria-hidden="true"><span>←</span><span>Swipe to navigate</span><span>→</span></div>
    `;

    const chat = home.querySelector('[data-mobile-home-chat]');
    if (chat) chat.addEventListener('click', () => openWorkspace('chat', 'mobile-home-composer'));
  }

  function updateHomeVisibility() {
    const home = document.querySelector('.ax-mobile-home');
    if (!home) return;
    const current = document.body.dataset.workspace || 'dashboard';
    home.hidden = !isMobile() || (current !== 'dashboard' && current !== 'home');
    updateMobileDockState();
  }

  function installWorkspaceObserver() {
    const manager = getManager();
    if (!manager || manager.__axiomMobileHomeObserverInstalled) return;
    const originalOpen = typeof manager.open === 'function' ? manager.open.bind(manager) : null;
    if (!originalOpen) return;
    manager.__axiomMobileHomeObserverInstalled = true;
    manager.open = function () {
      const result = originalOpen.apply(manager, arguments);
      window.requestAnimationFrame(() => {
        updateHomeVisibility();
        if (isMobile()) { ensureMobileHome(); ensureMobileDock(); }
      });
      return result;
    };
  }

  function install() {
    const surface = document.getElementById('axWorkspaceInner');
    if (!surface) return;

    if (isMobile()) {
      ensureDockStylesheet();
      ensureMobileHome();
      ensureMobileDock();
      installWorkspaceObserver();
    }

    if (surface.dataset.mobileGesturesInstalled === 'true') return;
    surface.dataset.mobileGesturesInstalled = 'true';

    let startX = 0, startY = 0, startTime = 0, tracking = false;
    surface.addEventListener('touchstart', event => {
      if (!isMobile() || event.touches.length !== 1) return;
      const t = event.touches[0];
      startX = t.clientX; startY = t.clientY; startTime = performance.now(); tracking = true;
    }, { passive: true });

    surface.addEventListener('touchend', event => {
      if (!tracking || !isMobile() || event.changedTouches.length !== 1) return;
      tracking = false;
      const t = event.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const elapsed = Math.max(1, performance.now() - startTime);
      const velocity = Math.abs(dx) / elapsed;
      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy) * 1.25) return;
      if (velocity < VELOCITY_THRESHOLD && Math.abs(dx) < 90) return;
      openRelative(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  function boot() {
    install();
    window.addEventListener('resize', () => {
      if (isMobile()) { ensureDockStylesheet(); ensureMobileHome(); ensureMobileDock(); installWorkspaceObserver(); }
      updateHomeVisibility();
    }, { passive: true });
    window.addEventListener('workspacechange', () => {
      updateHomeVisibility();
      if (isMobile()) { ensureMobileHome(); ensureMobileDock(); }
    });
    window.setTimeout(() => {
      if (isMobile()) { ensureDockStylesheet(); ensureMobileHome(); ensureMobileDock(); installWorkspaceObserver(); updateHomeVisibility(); }
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();