// ============================================================
// AXIOM — Module 10: Dashboard Aliveness + Camera
// ------------------------------------------------------------
// Two small, independent, purely-presentational behaviors:
//
//   1. Cursor-follow sheen — inserts one .ax-sheen child into
//      each glass panel (see styles/os-interface.css) and updates
//      --ax-mx/--ax-my on pointermove. Never touches panel content,
//      never intercepts clicks (the sheen is pointer-events:none).
//
//   2. Camera parallax — tiny, capped pointer-driven + idle-float
//      offset published as --ax-parallax-x/-y on <html>, consumed
//      by the holographic environment (os-environment.css) and the
//      dashboard's HUD corners (os-interface.css). Amplitude is
//      deliberately small (a few px) so it reads as "alive," never
//      as motion sickness territory.
//
// Both are skipped under prefers-reduced-motion, and both no-op
// gracefully outside the app shell.
// ============================================================
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function isShellPage() {
    return document.body.classList.contains('premium-app-page') ||
           document.body.classList.contains('dashboard-page');
  }

  var PANEL_SELECTOR = [
    '.app-user-shell', '.ax-side-card', '.panel', '.dash-stat', '.recent-card',
    '.quick-tile', '.pg-tool-btn', '.gen-output', '.plan-card', '.lang-option',
    '.price-card', '.workspace-card', '.ax-panel'
  ].join(',');

  ready(function () {
    if (!isShellPage()) return;
    var reduced = window.AxiomOSState && window.AxiomOSState.isReducedMotion();
    wireSheens(reduced);
    if (!reduced) wireParallax();
  });

  // ---- 1. Cursor-follow sheen ---------------------------------------
  function wireSheens(reduced) {
    document.querySelectorAll(PANEL_SELECTOR).forEach(function (panel) {
      if (panel.querySelector(':scope > .ax-sheen')) return;
      var sheen = document.createElement('div');
      sheen.className = 'ax-sheen';
      sheen.setAttribute('aria-hidden', 'true');
      panel.appendChild(sheen);
      if (reduced) return; // keep the element (harmless, opacity:0) but skip tracking

      panel.addEventListener('pointermove', function (e) {
        var rect = panel.getBoundingClientRect();
        var mx = ((e.clientX - rect.left) / rect.width) * 100;
        var my = ((e.clientY - rect.top) / rect.height) * 100;
        panel.style.setProperty('--ax-mx', mx + '%');
        panel.style.setProperty('--ax-my', my + '%');
        sheen.classList.add('is-active');
      });
      panel.addEventListener('pointerleave', function () {
        sheen.classList.remove('is-active');
      });
    });
  }

  // ---- 2. Camera parallax ---------------------------------------------
  function wireParallax() {
    var root = document.documentElement;
    var targetX = 0, targetY = 0, curX = 0, curY = 0;
    var raf = null;
    var t = 0;
    var MAX_PX = 8;

    function onPointer(e) {
      var nx = (e.clientX / window.innerWidth) * 2 - 1;   // -1..1
      var ny = (e.clientY / window.innerHeight) * 2 - 1;  // -1..1
      targetX = nx * MAX_PX;
      targetY = ny * MAX_PX;
    }
    window.addEventListener('pointermove', onPointer, { passive: true });

    function tick() {
      t += 0.01;
      var idleFloatX = Math.sin(t) * 1.6;
      var idleFloatY = Math.cos(t * 0.8) * 1.6;
      // Ease toward the pointer target and blend in a slow idle float
      // so the environment never sits perfectly still even if the
      // pointer hasn't moved (touch devices, tab not focused, etc).
      curX += ((targetX + idleFloatX) - curX) * 0.04;
      curY += ((targetY + idleFloatY) - curY) * 0.04;
      root.style.setProperty('--ax-parallax-x', curX.toFixed(2) + 'px');
      root.style.setProperty('--ax-parallax-y', curY.toFixed(2) + 'px');
      raf = requestAnimationFrame(tick);
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; }
      else if (!raf) tick();
    });

    tick();
    window.addEventListener('pagehide', function () {
      if (raf) cancelAnimationFrame(raf);
    });
  }
})();
