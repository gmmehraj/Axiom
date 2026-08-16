// ============================================================
// AXIOM AI OS V8 — Shared Application Initialization Module
// ------------------------------------------------------------
// Loaded on EVERY authenticated page after all components.
// Handles shared UI bootstrapping plus cloud voice providers.
// ============================================================
(function () {
  'use strict';
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  function init() {
    ensureWorkspaceResponsiveStyles();
    initClock();
    initSearchBar();
    initQuickCommand();
    initNotifications();
    initDockAutoHide();
    initCloudVoice();
  }

  function ensureWorkspaceResponsiveStyles() {
    if (document.querySelector('link[data-axiom-workspace-responsive]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'styles/workspace-responsive.css';
    link.dataset.axiomWorkspaceResponsive = 'true';
    document.head.appendChild(link);
  }

  function initClock() {
    const el = document.getElementById('axTimeDisplay');
    if (!el) return;
    const update = () => { el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
    update();
    setInterval(update, 10000);
  }

  function initSearchBar() {
    const searchBar = document.getElementById('axTopbarSearch');
    const searchInput = document.getElementById('topbarSearchInput');
    if (searchBar) searchBar.addEventListener('click', function (e) { e.preventDefault(); if (window.AxiomSearch) window.AxiomSearch.open(); });
    if (searchInput) searchInput.addEventListener('focus', function (e) { e.preventDefault(); if (window.AxiomSearch) window.AxiomSearch.open(); this.blur(); });
  }

  function initQuickCommand() {
    const btn = document.getElementById('axCmdBtn');
    if (btn) btn.addEventListener('click', function () { if (window.AxiomQuickCommand) window.AxiomQuickCommand.toggle(); });
  }

  function initNotifications() {
    const trigger = document.getElementById('axNotifTrigger');
    const triggerAlt = document.getElementById('axNotificationsTrigger');
    [trigger, triggerAlt].forEach(function (el) {
      if (el) el.addEventListener('click', function (e) { e.stopPropagation(); if (window.AxiomNotifications) window.AxiomNotifications.toggle(); });
    });
  }

  function initDockAutoHide() {
    let dockTimer;
    window.addEventListener('scroll', function () {
      document.body.classList.add('ax-dock-auto-hide');
      clearTimeout(dockTimer);
      dockTimer = setTimeout(function () { document.body.classList.remove('ax-dock-auto-hide'); }, 1500);
    }, { passive: true });
  }

  // Dependency order: provider registry -> ElevenLabs adapter -> controller bridge.
  function initCloudVoice() {
    loadScriptOnce('os/runtime/capabilities/voice-adapter-kit.js', function () {
      loadScriptOnce('js/core/elevenlabs-voice.js', function () {
        loadScriptOnce('js/core/elevenlabs-voice-controller.js');
      });
    });
  }

  function loadScriptOnce(src, onload) {
    if (document.querySelector('script[data-axiom-cloud-voice="' + src + '"]')) { if (onload) onload(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.axiomCloudVoice = src;
    script.onload = function () { if (onload) onload(); };
    script.onerror = function () { try { console.warn('[Axiom] Optional cloud voice failed to load:', src); } catch (_) {} };
    document.head.appendChild(script);
  }
})();
