// ============================================================
// AXIOM AI OS X — Part 6: Mission Control, Exposé & Virtual Desktops
// ============================================================
window.AxiomMissionControl = (function () {
  'use strict';

  const STORAGE_KEY = 'axiom.desktops';
  let desktops = [1, 2];
  let overlay = null;
  let mode = null; // 'mission' | 'expose'

  function loadDesktops() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) desktops = JSON.parse(raw);
    } catch (e) {}
  }
  function saveDesktops() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(desktops)); } catch (e) {}
  }

  function icon(name, size) {
    return window.AxiomIcons ? window.AxiomIcons.svg(name, size || 16) : '';
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'ax-mc-overlay';
    overlay.innerHTML = `
      <div class="ax-mc-desktops" id="axMcDesktops"></div>
      <div class="ax-mc-grid" id="axMcGrid"></div>
      <div class="ax-mc-hint">Click a window to jump to it &middot; Esc to cancel</div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    return overlay;
  }

  function renderDesktopStrip() {
    const wm = window.AxiomWindowManager;
    const active = wm ? wm.getActiveDesktop() : 1;
    const strip = overlay.querySelector('#axMcDesktops');
    strip.innerHTML = desktops.map(n => `
      <div class="ax-mc-desktop-pill ${n === active ? 'active' : ''}" data-desktop="${n}">
        ${icon('spaces', 14)}<span>Desktop ${n}</span>
      </div>
    `).join('') + `<div class="ax-mc-desktop-add" id="axMcAddDesktop">${icon('plus', 14)}</div>`;

    strip.querySelectorAll('.ax-mc-desktop-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const n = parseInt(pill.dataset.desktop, 10);
        wm.setActiveDesktop(n);
        renderDesktopStrip();
        renderGrid();
      });
      pill.addEventListener('dragover', (e) => e.preventDefault());
      pill.addEventListener('drop', (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/ax-window-id');
        if (id) {
          wm.moveWindowToDesktop(id, parseInt(pill.dataset.desktop, 10));
          renderGrid();
        }
      });
    });

    const addBtn = strip.querySelector('#axMcAddDesktop');
    if (addBtn) addBtn.addEventListener('click', () => {
      const next = (desktops[desktops.length - 1] || 0) + 1;
      if (desktops.length >= 6) return;
      desktops.push(next);
      saveDesktops();
      renderDesktopStrip();
    });
  }

  function renderGrid() {
    const wm = window.AxiomWindowManager;
    const grid = overlay.querySelector('#axMcGrid');
    if (!wm) { grid.innerHTML = ''; return; }

    let list = wm.getWindowsByDesktop();
    if (mode === 'expose') {
      const activeWin = wm.getActiveWindow();
      const appId = activeWin ? activeWin.appId : null;
      list = list.filter(w => w.appId === appId);
    }
    list = list.filter(w => !w.closed);

    if (!list.length) {
      grid.innerHTML = `<div class="ax-mc-empty">${mode === 'expose' ? 'No windows for this app' : 'No open windows on this desktop'}</div>`;
      return;
    }

    grid.innerHTML = list.map(w => `
      <div class="ax-mc-card" data-id="${w.id}" draggable="true" style="aspect-ratio:${(w.width / w.height).toFixed(2)}">
        <div class="ax-mc-card-preview">
          <div class="ax-mc-card-icon">${icon(w.icon, 30)}</div>
        </div>
        <div class="ax-mc-card-title">${icon(w.icon, 12)}<span>${w.title}</span></div>
      </div>
    `).join('');

    grid.querySelectorAll('.ax-mc-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const w = wm.getWindow(id);
        if (w && w.minimized) wm.restoreWindow(id);
        wm.focusWindow(id);
        close();
      });
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/ax-window-id', card.dataset.id);
      });
    });
  }

  function open(m) {
    mode = m || 'mission';
    ensureOverlay();
    overlay.classList.add('active');
    overlay.classList.toggle('ax-mc-expose', mode === 'expose');
    renderDesktopStrip();
    renderGrid();
  }

  function close() {
    if (overlay) overlay.classList.remove('active');
    mode = null;
  }

  function isOpen() { return !!(overlay && overlay.classList.contains('active')); }

  function switchDesktop(dir) {
    const wm = window.AxiomWindowManager;
    if (!wm) return;
    const active = wm.getActiveDesktop();
    const idx = desktops.indexOf(active);
    let next = idx + dir;
    if (next < 0) next = desktops.length - 1;
    if (next >= desktops.length) next = 0;
    wm.setActiveDesktop(desktops[next]);
    if (isOpen()) { renderDesktopStrip(); renderGrid(); }
  }

  function init() {
    loadDesktops();
    ensureOverlay();

    document.addEventListener('keydown', (e) => {
      // F3 -> Mission Control (all windows on this desktop)
      if (e.key === 'F3') {
        e.preventDefault();
        isOpen() ? close() : open('mission');
      }
      // F10 -> Exposé (current app's windows only)
      if (e.key === 'F10') {
        e.preventDefault();
        isOpen() ? close() : open('expose');
      }
      // Ctrl/Cmd+Left/Right -> switch virtual desktop (when not resizing a window via snap)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'ArrowRight') {
        e.preventDefault(); switchDesktop(1);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'ArrowLeft') {
        e.preventDefault(); switchDesktop(-1);
      }
      if (e.key === 'Escape' && isOpen()) close();
    });
  }

  return { init, open, close, isOpen, switchDesktop, get desktops() { return desktops; } };
})();

if (document.readyState !== 'loading') window.AxiomMissionControl.init();
else document.addEventListener('DOMContentLoaded', () => window.AxiomMissionControl.init());
