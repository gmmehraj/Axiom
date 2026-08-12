// ============================================================
// AXIOM AI OS X — Part 6: Split Screen / Snap Assist
// Shows edge/corner drop zones while dragging a window and
// snaps it into half/quarter layouts, macOS/Windows-style.
// ============================================================
window.AxiomSnapZones = (function () {
  'use strict';

  const EDGE = 24;        // px from viewport edge that counts as "at the edge"
  const CORNER = 90;      // px square in each corner that counts as a corner zone
  let overlay = null;
  let zoneEls = {};
  let currentZone = null;
  let draggingId = null;

  function build() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'ax-snap-overlay';
    overlay.innerHTML = `
      <div class="ax-snap-zone" data-zone="tl"></div>
      <div class="ax-snap-zone" data-zone="top"></div>
      <div class="ax-snap-zone" data-zone="tr"></div>
      <div class="ax-snap-zone" data-zone="left"></div>
      <div class="ax-snap-zone" data-zone="right"></div>
      <div class="ax-snap-zone" data-zone="bl"></div>
      <div class="ax-snap-zone" data-zone="bottom"></div>
      <div class="ax-snap-zone" data-zone="br"></div>
      <div class="ax-snap-highlight"></div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('.ax-snap-zone').forEach(el => {
      zoneEls[el.dataset.zone] = el;
    });
  }

  function detectZone(x, y) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const nearLeft = x < EDGE;
    const nearRight = x > vw - EDGE;
    const nearTop = y < EDGE;
    const nearBottom = y > vh - EDGE;

    if (x < CORNER && y < CORNER) return 'tl';
    if (x > vw - CORNER && y < CORNER) return 'tr';
    if (x < CORNER && y > vh - CORNER) return 'bl';
    if (x > vw - CORNER && y > vh - CORNER) return 'br';
    if (nearLeft) return 'left';
    if (nearRight) return 'right';
    if (nearTop) return 'top';
    if (nearBottom) return 'bottom';
    return null;
  }

  const RECTS = {
    left:   { x: 0, y: 0, w: 0.5, h: 1 },
    right:  { x: 0.5, y: 0, w: 0.5, h: 1 },
    top:    { x: 0, y: 0, w: 1, h: 0.5 },
    bottom: { x: 0, y: 0.5, w: 1, h: 0.5 },
    tl: { x: 0, y: 0, w: 0.5, h: 0.5 },
    tr: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    bl: { x: 0, y: 0.5, w: 0.5, h: 0.5 },
    br: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
  };

  function showZone(zone) {
    if (zone === currentZone) return;
    currentZone = zone;
    build();
    overlay.classList.toggle('active', !!zone);
    const hl = overlay.querySelector('.ax-snap-highlight');
    if (!zone) { hl.style.opacity = 0; return; }
    const r = RECTS[zone];
    const vw = window.innerWidth, vh = window.innerHeight;
    hl.style.opacity = 1;
    hl.style.left = (r.x * vw) + 'px';
    hl.style.top = (r.y * vh) + 'px';
    hl.style.width = (r.w * vw) + 'px';
    hl.style.height = (r.h * vh) + 'px';
  }

  function onDragStart(e) {
    draggingId = e.detail.id;
    build();
  }

  function onDragMove(e) {
    if (!draggingId) return;
    const zone = detectZone(e.detail.clientX, e.detail.clientY);
    showZone(zone);
  }

  function onDragEnd() {
    if (currentZone && draggingId && window.AxiomWindowManager) {
      window.AxiomWindowManager.snapToZone(draggingId, currentZone);
    }
    showZone(null);
    draggingId = null;
  }

  function init() {
    document.addEventListener('axwm:dragstart', onDragStart);
    document.addEventListener('axwm:dragmove', onDragMove);
    document.addEventListener('axwm:dragend', onDragEnd);

    // Keyboard split-screen shortcuts for the focused window (Win/Ctrl+Arrow)
    document.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const wm = window.AxiomWindowManager;
      if (!wm) return;
      const active = wm.getActiveWindow && wm.getActiveWindow();
      if (!active) return;
      const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'full', ArrowDown: 'bottom' };
      if (map[e.key]) {
        e.preventDefault();
        wm.snapToZone(active.id, map[e.key]);
      }
    });
  }

  return { init };
})();

if (document.readyState !== 'loading') window.AxiomSnapZones.init();
else document.addEventListener('DOMContentLoaded', () => window.AxiomSnapZones.init());
