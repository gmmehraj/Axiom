// ============================================================
// AXIOM AI OS X — Part 6 Bootstrap
// Wires Mission Control, Wallpaper Engine and Show-Desktop into
// the existing topbar, and centralizes the new keyboard shortcuts.
// ============================================================
(function () {
  'use strict';

  function icon(name, size) {
    return window.AxiomIcons ? window.AxiomIcons.svg(name, size || 16) : '';
  }

  function injectTopbarButtons() {
    const right = document.querySelector('.ax-topbar-right');
    if (!right) return;

    const wallpaperBtn = document.createElement('div');
    wallpaperBtn.className = 'ax-topbar-item';
    wallpaperBtn.id = 'axWallpaperBtn';
    wallpaperBtn.title = 'Wallpaper Engine';
    wallpaperBtn.innerHTML = icon('wallpaper', 16);
    wallpaperBtn.addEventListener('click', () => {
      window.AxiomWallpaperEngine && window.AxiomWallpaperEngine.openPicker();
    });

    const missionBtn = document.createElement('div');
    missionBtn.className = 'ax-topbar-item';
    missionBtn.id = 'axMissionBtn';
    missionBtn.title = 'Mission Control (F3)';
    missionBtn.innerHTML = icon('grid', 16);
    missionBtn.addEventListener('click', () => {
      window.AxiomMissionControl && window.AxiomMissionControl.open('mission');
    });

    const desktopBtn = document.createElement('div');
    desktopBtn.className = 'ax-topbar-item';
    desktopBtn.id = 'axShowDesktopBtn';
    desktopBtn.title = 'Show Desktop (⌘D)';
    desktopBtn.innerHTML = icon('desktop', 16);
    desktopBtn.addEventListener('click', () => {
      window.AxiomWindowManager && window.AxiomWindowManager.toggleShowDesktop();
    });

    const spacesPill = document.createElement('div');
    spacesPill.className = 'ax-topbar-item ax-topbar-spaces';
    spacesPill.id = 'axSpacesPill';
    spacesPill.title = 'Switch virtual desktop (⌘⇧←/→)';
    function renderSpaces() {
      const wm = window.AxiomWindowManager;
      const mc = window.AxiomMissionControl;
      if (!wm || !mc) return;
      const active = wm.getActiveDesktop();
      spacesPill.innerHTML = `${icon('spaces', 14)}<span>${active}</span>`;
    }
    spacesPill.addEventListener('click', () => {
      window.AxiomMissionControl && window.AxiomMissionControl.switchDesktop(1);
    });
    document.addEventListener('axwm:desktopchange', renderSpaces);

    right.insertBefore(spacesPill, right.firstChild);
    right.insertBefore(desktopBtn, right.firstChild);
    right.insertBefore(missionBtn, right.firstChild);
    right.insertBefore(wallpaperBtn, right.firstChild);
    renderSpaces();
  }

  function bindGlobalShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Cmd/Ctrl+D -> Show Desktop
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && !e.shiftKey) {
        e.preventDefault();
        window.AxiomWindowManager && window.AxiomWindowManager.toggleShowDesktop();
      }
    });
  }

  function init() {
    injectTopbarButtons();
    bindGlobalShortcuts();
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
