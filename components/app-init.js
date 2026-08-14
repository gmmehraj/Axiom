// ============================================================
// AXIOM AI OS V8 — Shared Application Initialization Module
// ------------------------------------------------------------
// Loaded on EVERY authenticated page after all components.
// Handles: Universal Search, Quick Command, Notifications,
// Clock, Search bar wiring, Dock auto-hide, Theme consistency.
// ============================================================
(function () {
  'use strict';

  // ── Wait for DOM ──────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    ensureWorkspaceResponsiveStyles();
    initClock();
    initSearchBar();
    initQuickCommand();
    initNotifications();
    initDockAutoHide();
  }

  // ── Shared responsive presentation layer ─────────────────
  // Loaded here so every authenticated workspace receives the
  // same mobile/tablet safety rules without a second shell system.
  function ensureWorkspaceResponsiveStyles() {
    if (document.querySelector('link[data-axiom-workspace-responsive]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'styles/workspace-responsive.css';
    link.dataset.axiomWorkspaceResponsive = 'true';
    document.head.appendChild(link);
  }

  // ── Clock ─────────────────────────────────────────────────
  function initClock() {
    const el = document.getElementById('axTimeDisplay');
    if (!el) return;
    function update() {
      el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    update();
    setInterval(update, 10000);
  }

  // ── Universal Search Bar ──────────────────────────────────
  function initSearchBar() {
    const searchBar = document.getElementById('axTopbarSearch');
    const searchInput = document.getElementById('topbarSearchInput');

    if (searchBar) {
      searchBar.addEventListener('click', function (e) {
        e.preventDefault();
        if (window.AxiomSearch) window.AxiomSearch.open();
      });
    }

    if (searchInput) {
      searchInput.addEventListener('focus', function (e) {
        e.preventDefault();
        if (window.AxiomSearch) window.AxiomSearch.open();
        this.blur();
      });
    }
  }

  // ── Quick Command ─────────────────────────────────────────
  function initQuickCommand() {
    const btn = document.getElementById('axCmdBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        if (window.AxiomQuickCommand) window.AxiomQuickCommand.toggle();
      });
    }
  }

  // ── Notifications ─────────────────────────────────────────
  function initNotifications() {
    const trigger = document.getElementById('axNotifTrigger');
    if (trigger) {
      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        if (window.AxiomNotifications) window.AxiomNotifications.toggle();
      });
    }

    // Also handle older ID
    const triggerAlt = document.getElementById('axNotificationsTrigger');
    if (triggerAlt) {
      triggerAlt.addEventListener('click', function (e) {
        e.stopPropagation();
        if (window.AxiomNotifications) window.AxiomNotifications.toggle();
      });
    }
  }

  // ── Dock Auto-Hide on Scroll ──────────────────────────────
  function initDockAutoHide() {
    let dockTimer;
    window.addEventListener('scroll', function () {
      document.body.classList.add('ax-dock-auto-hide');
      clearTimeout(dockTimer);
      dockTimer = setTimeout(function () {
        document.body.classList.remove('ax-dock-auto-hide');
      }, 1500);
    }, { passive: true });
  }

})();
