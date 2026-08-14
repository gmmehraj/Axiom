/* Axiom OS shell navigation layer.
 * Uses the canonical AxiomWorkspaceManager. The dock is the single navigation
 * surface on adaptive and desktop layouts; no separate workspace launcher is created.
 */
(function () {
  'use strict';

  const ADAPTIVE_QUERY = '(max-width: 1024px), (hover: none) and (pointer: coarse)';
  const SWIPE_THRESHOLD = 54;
  const VELOCITY_THRESHOLD = 0.35;

  // Exact compact dock vocabulary requested for the OS shell.
  const DOCK_ITEMS = [
    { id: 'dashboard', label: 'Home', icon: 'home' },
    { id: 'chat', label: 'Chat', icon: 'chat' },
    { id: 'memory', label: 'Memory', icon: 'document' },
    { id: 'studios', label: 'Studios', icon: 'sun' },
    { id: 'control-center', label: 'Control Center', icon: 'grid', control: 'control-center' },
    { id: 'brain', label: 'Brain', icon: 'brain' },
    { id: 'browser', label: 'Browser', icon: 'globe' },
    { id: 'automation', label: 'Automation', icon: 'chart' },
    { id: 'agents', label: 'Agents', icon: 'document' },
    { id: 'knowledge', label: 'Knowledge', icon: 'sun' },
    { id: 'settings', label: 'Settings', icon: 'settings' }
  ];

  function isAdaptive() { return window.matchMedia(ADAPTIVE_QUERY).matches; }
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
    return Object.keys(manager.getWorkspaces());
  }

  function openWorkspace(id, source) {
    const manager = getManager();
    if (!manager || typeof manager.open !== 'function') return false;
    if (!getIds().includes(id)) return false;
    manager.open(id, { source: source || 'dock' });
    return true;
  }

  function activateDockControl(control) {
    if (control === 'control-center') {
      const button = document.getElementById('axControlCenterBtn');
      if (button) button.click();
      return true;
    }
    return false;
  }

  function openRelative(direction) {
    const ids = getIds().filter(id => !['billing', 'admin', 'dashboard', 'home'].includes(id));
    if (!ids.length) return;
    const manager = getManager();
    const current = (manager && typeof manager.getCurrent === 'function' ? manager.getCurrent() : null) || document.body.dataset.workspace || 'dashboard';
    const index = Math.max(0, ids.indexOf(current));
    const next = (index + direction + ids.length) % ids.length;
    const target = ids[next];
    if (target && target !== current) openWorkspace(target, 'mobile-swipe');
  }

  function svgIcon(name) {
    const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    const paths = {
      home: `<svg ${common}><path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/></svg>`,
      chat: `<svg ${common}><path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-5.5 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"/></svg>`,
      document: `<svg ${common}><path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4M9.5 12h5M9.5 15.5h5"/></svg>`,
      sun: `<svg ${common}><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
      grid: `<svg ${common}><rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/></svg>`,
      brain: `<svg ${common}><path d="M9 4.5a3 3 0 0 0-3 3v.5a3 3 0 0 0-2.5 3 3 3 0 0 0 2.2 2.9A3 3 0 0 0 9 19.5"/><path d="M15 4.5a3 3 0 0 1 3 3v.5a3 3 0 0 1 2.5 3 3 3 0 0 1-2.2 2.9 3 3 0 0 1-3.3 5.6"/><path d="M9 4.5v15M15 4.5v15M9 9h3M12 15h3"/></svg>`,
      globe: `<svg ${common}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
      chart: `<svg ${common}><path d="M4 18V6M4 18h16"/><path d="m7 15 4-4 3 2 5-6"/></svg>`,
      settings: `<svg ${common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.06.06-2.12 2.12-.06-.06a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.08 1.65V21h-3v-.59a1.8 1.8 0 0 0-1.08-1.65 1.8 1.8 0 0 0-2 .36l-.06.06-2.12-2.12.06-.06a1.8 1.8 0 0 0 .36-2 1.8 1.8 0 0 0-1.65-1.08H4v-3h.59a1.8 1.8 0 0 0 1.65-1.08 1.8 1.8 0 0 0-.36-2l-.06-.06 2.12-2.12.06.06a1.8 1.8 0 0 0 2 .36A1.8 1.8 0 0 0 11.08 3.4V3h3v.59a1.8 1.8 0 0 0 1.08 1.65 1.8 1.8 0 0 0 2-.36l.06-.06 2.12 2.12-.06.06a1.8 1.8 0 0 0-.36 2A1.8 1.8 0 0 0 20.57 10H21v3h-.59A1.8 1.8 0 0 0 19.4 15Z"/></svg>`
    };
    return paths[name] || paths.grid;
  }

  function ensureDock() {
    const dock = document.getElementById('axDock');
    if (!dock) return;
    ensureDockStylesheet();
    const available = getIds();
    const visible = DOCK_ITEMS.filter(item => item.control || item.id === 'dashboard' || available.includes(item.id));
    const signature = visible.map(item => `${item.id}:${item.control || ''}`).join('|');
    if (dock.dataset.dockSignature === signature) { updateDockState(); return; }
    dock.dataset.dockSignature = signature;
    dock.innerHTML = '';
    visible.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ax-mobile-dock-item ax-shell-dock-item';
      button.dataset.dockId = item.id;
      if (item.id !== 'dashboard') button.dataset.workspace = item.id;
      button.setAttribute('aria-label', item.label);
      button.setAttribute('title', item.label);
      button.innerHTML = `<span class="ax-mobile-dock-icon ax-shell-dock-icon">${svgIcon(item.icon)}</span>`;
      button.addEventListener('click', () => {
        if (item.control) activateDockControl(item.control);
        else if (item.id === 'dashboard') openWorkspace('dashboard', 'dock-home');
        else openWorkspace(item.id, 'dock');
      });
      dock.appendChild(button);
    });
    updateDockState();
  }

  function updateDockState() {
    const dock = document.getElementById('axDock');
    if (!dock) return;
    const current = document.body.dataset.workspace || 'dashboard';
    dock.querySelectorAll('[data-dock-id]').forEach(button => button.classList.toggle('is-active', button.dataset.dockId === current));
  }

  function ensureMobileHome() {
    if (!isAdaptive()) return;
    const inner = document.getElementById('axWorkspaceInner');
    if (!inner) return;
    let home = inner.querySelector('.ax-mobile-home');
    if (!home) {
      home = document.createElement('section');
      home.className = 'ax-mobile-home';
      home.setAttribute('aria-label', 'Axiom mobile home');
      inner.appendChild(home);
    }
    if (home.dataset.mobileHomeBuilt === 'true') return;
    home.dataset.mobileHomeBuilt = 'true';
    home.innerHTML = `<div class="ax-mobile-home-hero"><div class="ax-mobile-home-eyebrow">AI Operating System</div><h2 class="ax-mobile-home-title">AXIOM</h2><p class="ax-mobile-home-subtitle">Your intelligence, workspace and automation layer — always at the center.</p><button type="button" class="ax-mobile-home-composer" data-mobile-home-chat aria-label="Open Axiom Chat"><span>Ask Axiom anything...</span><strong>→</strong></button></div>`;
    const chat = home.querySelector('[data-mobile-home-chat]');
    if (chat) chat.addEventListener('click', () => openWorkspace('chat', 'mobile-home-composer'));
  }

  function updateHomeVisibility() {
    const home = document.querySelector('.ax-mobile-home');
    if (home) {
      const current = document.body.dataset.workspace || 'dashboard';
      home.hidden = !isAdaptive() || (current !== 'dashboard' && current !== 'home');
    }
    updateDockState();
  }

  function installWorkspaceObserver() {
    const manager = getManager();
    if (!manager || manager.__axiomMobileDockObserverInstalled || typeof manager.open !== 'function') return;
    const originalOpen = manager.open.bind(manager);
    manager.__axiomMobileDockObserverInstalled = true;
    manager.open = function () {
      const result = originalOpen.apply(manager, arguments);
      window.requestAnimationFrame(() => { ensureDock(); updateHomeVisibility(); });
      return result;
    };
  }

  function installGestures() {
    const surface = document.getElementById('axWorkspaceInner');
    if (!surface || surface.dataset.mobileGesturesInstalled === 'true') return;
    surface.dataset.mobileGesturesInstalled = 'true';
    let startX = 0, startY = 0, startTime = 0, tracking = false;
    surface.addEventListener('touchstart', event => {
      if (!isAdaptive() || event.touches.length !== 1) return;
      const t = event.touches[0]; startX = t.clientX; startY = t.clientY; startTime = performance.now(); tracking = true;
    }, { passive: true });
    surface.addEventListener('touchend', event => {
      if (!tracking || !isAdaptive() || event.changedTouches.length !== 1) return;
      tracking = false;
      const t = event.changedTouches[0], dx = t.clientX - startX, dy = t.clientY - startY;
      const elapsed = Math.max(1, performance.now() - startTime), velocity = Math.abs(dx) / elapsed;
      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy) * 1.25) return;
      if (velocity < VELOCITY_THRESHOLD && Math.abs(dx) < 90) return;
      openRelative(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  function boot() {
    ensureDock(); ensureMobileHome(); installWorkspaceObserver(); installGestures(); updateHomeVisibility();
    window.addEventListener('resize', () => { ensureDock(); ensureMobileHome(); updateHomeVisibility(); }, { passive: true });
    window.addEventListener('workspacechange', () => { ensureDock(); updateHomeVisibility(); });
    window.setTimeout(() => { ensureDock(); ensureMobileHome(); installWorkspaceObserver(); updateHomeVisibility(); }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();