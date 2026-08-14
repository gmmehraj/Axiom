/* Axiom OS — adaptive navigation layer
 *
 * Mobile/tablet presentation uses the canonical AxiomWorkspaceManager and
 * the existing #axDock. This file deliberately does NOT create a second
 * mobile home, workspace launcher, dock, or workspace registry.
 */
(function () {
  'use strict';

  const ADAPTIVE_QUERY = '(max-width: 1024px), (hover: none) and (pointer: coarse)';
  const SWIPE_THRESHOLD = 60;
  const MAX_VERTICAL_RATIO = 1.15;
  const SWIPE_MAX_DURATION = 900;

  function ensureResponsiveStyles() {
    if (document.querySelector('link[data-axiom-responsive-production]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'styles/responsive-production.css';
    link.dataset.axiomResponsiveProduction = 'true';
    document.head.appendChild(link);
  }

  function isAdaptive() {
    return window.matchMedia(ADAPTIVE_QUERY).matches;
  }

  function getManager() {
    return window.AxiomWorkspaceManager || null;
  }

  function getWorkspaceIds() {
    const manager = getManager();
    if (!manager || typeof manager.getWorkspaces !== 'function') return [];
    return Object.keys(manager.getWorkspaces()).filter(id => !['billing', 'admin'].includes(id));
  }

  function openWorkspace(id, source) {
    const manager = getManager();
    if (!manager || typeof manager.open !== 'function') return false;
    if (!getWorkspaceIds().includes(id)) return false;
    manager.open(id, { source: source || 'mobile' });
    return true;
  }

  function openRelative(direction) {
    const ids = getWorkspaceIds();
    if (!ids.length) return;

    const manager = getManager();
    const current = (manager && typeof manager.getCurrent === 'function' && manager.getCurrent())
      || document.body.dataset.workspace
      || 'dashboard';

    const index = ids.indexOf(current);
    const base = index >= 0 ? index : 0;
    const next = (base + direction + ids.length) % ids.length;
    const target = ids[next];

    if (target && target !== current) openWorkspace(target, 'mobile-swipe');
  }

  function isTextInput(target) {
    if (!target || !(target instanceof Element)) return false;
    return !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
  }

  function isHorizontallyScrollable(target, dx) {
    if (!target || !(target instanceof Element)) return false;
    let node = target;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      const canScrollX = /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 2;
      if (canScrollX) {
        const atStart = node.scrollLeft <= 0;
        const atEnd = node.scrollLeft + node.clientWidth >= node.scrollWidth - 2;
        if ((dx > 0 && !atStart) || (dx < 0 && !atEnd)) return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function isDragTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    return !!target.closest('[draggable="true"], .dragging, .ax-window-titlebar, .ax-window-resize-handle');
  }

  function installGestures() {
    const surface = document.getElementById('axWorkspaceContainer') || document.body;
    if (!surface || surface.dataset.axiomSwipeInstalled === 'true') return;
    surface.dataset.axiomSwipeInstalled = 'true';

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let startTarget = null;
    let tracking = false;

    surface.addEventListener('touchstart', event => {
      if (!isAdaptive() || event.touches.length !== 1) return;
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = performance.now();
      startTarget = event.target;
      tracking = !isTextInput(startTarget) && !isDragTarget(startTarget);
    }, { passive: true });

    surface.addEventListener('touchend', event => {
      if (!tracking || !isAdaptive() || event.changedTouches.length !== 1) {
        tracking = false;
        return;
      }

      tracking = false;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const elapsed = performance.now() - startTime;

      if (elapsed > SWIPE_MAX_DURATION) return;
      if (Math.abs(dx) < SWIPE_THRESHOLD) return;
      if (Math.abs(dx) <= Math.abs(dy) * MAX_VERTICAL_RATIO) return;
      if (isHorizontallyScrollable(startTarget, dx)) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      openRelative(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  function syncWorkspaceState() {
    const manager = getManager();
    const current = manager && typeof manager.getCurrent === 'function'
      ? manager.getCurrent()
      : document.body.dataset.workspace || 'dashboard';

    if (current) document.body.dataset.workspace = current;

    document.querySelectorAll('#axDock .ax-dock-item').forEach(item => {
      item.classList.toggle('active', item.dataset.workspace === current);
    });
  }

  function installWorkspaceObserver() {
    const manager = getManager();
    if (!manager || manager.__axiomAdaptiveObserverInstalled) return;
    manager.__axiomAdaptiveObserverInstalled = true;

    if (typeof manager.onChange === 'function') {
      manager.onChange(() => requestAnimationFrame(syncWorkspaceState));
    }

    document.addEventListener('ax-workspace-open', () => requestAnimationFrame(syncWorkspaceState));
    document.addEventListener('workspacechange', () => requestAnimationFrame(syncWorkspaceState));
  }

  function boot() {
    ensureResponsiveStyles();
    installGestures();
    installWorkspaceObserver();
    syncWorkspaceState();
    window.addEventListener('resize', syncWorkspaceState, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();