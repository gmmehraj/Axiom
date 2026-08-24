// ============================================
// AXIOM — Shared UI glue + premium motion layer
// Presentational only: no auth, billing, chat, or backend logic.
// ============================================
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(init);

  function init() {
    if (!document.querySelector('.app-body')) return;
    loadDesktopPolish();
    loadMotionLayer();
    loadKokonutLayer();
    wireMotionTargets();
    wireKokonutTargets();
    wireSidebarCollapse();
    injectMobileNav();
    wirePlaygroundDeepLink();
  }

  function loadStylesheet(href, marker) {
    if (document.querySelector(`link[data-${marker}]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset[marker] = 'true';
    document.head.appendChild(link);
  }

  function loadScript(src, marker) {
    if (document.querySelector(`script[data-${marker}]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.setAttribute(`data-${marker}`, 'true');
    script.defer = true;
    document.head.appendChild(script);
  }

  // Shared desktop visual system. Root-safe for nested pages.
  function loadDesktopPolish() {
    loadStylesheet('/styles/desktop-ui-entry.css', 'axiomDesktopPolish');
  }

  // Anime.js + Motion integration. Both are optional at runtime and have fallbacks.
  function loadMotionLayer() {
    loadStylesheet('/styles/axiom-motion.css', 'axiomMotionStyles');
    loadScript('/js/core/axiom-motion.js', 'axiom-motion');
  }

  // Kokonut-inspired primitives adapted to the existing vanilla HTML architecture.
  function loadKokonutLayer() {
    loadStylesheet('/styles/kokonut-ui.css', 'axiomKokonutStyles');
    loadScript('/js/core/kokonut-ui.js', 'axiom-kokonut');
  }

  function wireMotionTargets() {
    document.querySelectorAll('button, .btn, .ax-btn, .icon-btn, [role="button"]').forEach(el => {
      if (!el.hasAttribute('data-backlit')) el.setAttribute('data-backlit', '');
    });

    document.querySelectorAll('.panel, .card, .workspace-card, .dash-stat, .recent-card, .quick-tile, .tool-card').forEach(el => {
      if (!el.hasAttribute('data-axiom-motion')) el.setAttribute('data-axiom-motion', 'reveal');
    });

    document.querySelectorAll('.chat-input, .chat-composer, .composer').forEach(el => el.classList.add('kokonut-ai-input'));
  }

  function wireKokonutTargets() {
    document.querySelectorAll('textarea').forEach(el => el.dataset.kokonutAiInput = 'true');
    document.querySelectorAll('.hero-title, .page-title, .workspace-title').forEach(el => {
      if (!el.hasAttribute('data-kokonut-shimmer')) el.setAttribute('data-kokonut-shimmer', '');
    });
    document.querySelectorAll('.primary-btn, .btn-primary, .ax-btn-primary').forEach(el => {
      el.setAttribute('data-kokonut-particles', '');
      el.setAttribute('data-kokonut-magnetic', '');
    });
  }

  // ---- Desktop sidebar collapse ----
  function wireSidebarCollapse() {
    const sidebar = document.querySelector('.app-sidebar');
    const logo = sidebar && sidebar.querySelector('.logo');
    if (!sidebar || !logo) return;
    if (sidebar.querySelector('.sidebar-collapse')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sidebar-collapse';
    btn.setAttribute('aria-label', 'Collapse sidebar');
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    logo.after(btn);

    const collapsed = localStorage.getItem('axiom:sidebar-collapsed') === '1';
    if (collapsed) sidebar.classList.add('collapsed');

    btn.addEventListener('click', () => {
      const now = sidebar.classList.toggle('collapsed');
      localStorage.setItem('axiom:sidebar-collapsed', now ? '1' : '0');
    });
  }

  // ---- Mobile bottom navigation ----
  function injectMobileNav() {
    if (document.querySelector('.mobile-nav')) return;
    const page = (location.pathname.split('/').pop() || 'os-shell.html');

    const items = [
      { href: 'os-shell.html', match: ['os-shell.html', ''], label: 'Home', icon: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="14" width="8" height="7" rx="1.5"/>' },
      { href: 'playground.html', match: ['playground.html'], label: 'Chats', icon: '<path d="M21 11.5a8.5 8.5 0 01-8.9 8.49 8.63 8.63 0 01-3.9-.94L3 21l1.95-5.2a8.5 8.5 0 1116.05-4.3z" stroke-linejoin="round"/>' },
      { href: 'playground.html?tool=voice', match: [], label: 'Voice', icon: '<path d="M9 2h6v11a3 3 0 01-6 0V2Z"/><path d="M5 11a7 7 0 0014 0M12 18v4M9 22h6" stroke-linecap="round"/>' },
      { href: '#', match: [], label: 'Files', icon: '<path d="M5 3h10l4 4v14H5z" stroke-linejoin="round"/><path d="M8 11h8M8 15h8M8 7h4" stroke-linecap="round"/>' },
      { href: 'settings.html', match: ['settings.html'], label: 'Settings', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.04 1.56V21a2 2 0 01-4 0v-.09A1.7 1.7 0 008.9 19.7a1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.7 1.7 0 004.6 15a1.7 1.7 0 00-1.56-1.04H3a2 2 0 010-4h.09A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06A1.7 1.7 0 0015.4 4.6a1.7 1.7 0 001.87-.34l-.06-.06a2 2 0 112.83 2.83l.06.06A1.7 1.7 0 0019.4 9a1.7 1.7 0 001.56 1.04H21a2 2 0 010 4h-.09A1.7 1.7 0 0019.4 15z" stroke-width="1.4"/>' }
    ];

    const nav = document.createElement('nav');
    nav.className = 'mobile-nav';
    nav.setAttribute('aria-label', 'Primary');
    items.forEach(it => {
      const active = it.match.includes(page);
      const a = document.createElement('a');
      a.href = it.href;
      a.className = 'mobile-nav-item' + (active ? ' active' : '');
      a.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">${it.icon}</svg><span>${it.label}</span>`;
      nav.appendChild(a);
    });
    document.body.appendChild(nav);
  }

  function wirePlaygroundDeepLink() {
    if (!document.querySelector('.pg-tools')) return;
    const params = new URLSearchParams(location.search);
    const tool = params.get('tool');
    if (!tool) return;
    const btn = document.querySelector(`.pg-tool-btn[data-tool="${CSS.escape(tool)}"]`);
    if (btn) btn.click();
  }
})();
