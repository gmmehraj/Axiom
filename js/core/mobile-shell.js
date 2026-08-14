/* Axiom Mobile Shell interaction layer.
 * Uses the canonical AxiomWorkspaceManager; it does not create a second registry.
 */
(function () {
  'use strict';

  const MOBILE_QUERY = '(max-width: 700px)';
  const SWIPE_THRESHOLD = 54;
  const VELOCITY_THRESHOLD = 0.35;

  function getManager() { return window.AxiomWorkspaceManager || null; }
  function getIds() {
    const manager = getManager();
    if (!manager) return [];
    return Object.keys(manager.getWorkspaces()).filter(id => !['billing', 'admin'].includes(id));
  }

  function openRelative(direction) {
    const manager = getManager();
    if (!manager) return;
    const ids = getIds();
    const current = manager.getCurrent() || document.body.dataset.workspace || 'dashboard';
    const index = Math.max(0, ids.indexOf(current));
    const next = (index + direction + ids.length) % ids.length;
    const target = ids[next];
    if (target && target !== current) manager.open(target, { source: 'mobile-swipe' });
  }

  function install() {
    const surface = document.getElementById('axWorkspaceInner');
    if (!surface || surface.dataset.mobileGesturesInstalled === 'true') return;
    surface.dataset.mobileGesturesInstalled = 'true';

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let tracking = false;

    surface.addEventListener('touchstart', (event) => {
      if (!window.matchMedia(MOBILE_QUERY).matches || event.touches.length !== 1) return;
      const t = event.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startTime = performance.now();
      tracking = true;
    }, { passive: true });

    surface.addEventListener('touchend', (event) => {
      if (!tracking || !window.matchMedia(MOBILE_QUERY).matches || event.changedTouches.length !== 1) return;
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
    window.addEventListener('resize', install, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
