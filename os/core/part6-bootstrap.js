// ============================================================
// AXIOM AI OS X — Part 6 Bootstrap
// Wires Mission Control, Wallpaper Engine, Control Center,
// Profile menu and Show-Desktop into the existing shell.
// ============================================================
(function () {
  'use strict';

  function icon(name, size) {
    return window.AxiomIcons ? window.AxiomIcons.svg(name, size || 16) : '';
  }

  function injectStyles() {
    if (document.getElementById('axPart6EnhancementStyles')) return;
    const style = document.createElement('style');
    style.id = 'axPart6EnhancementStyles';
    style.textContent = `
      .ax-profile-menu { position:fixed; top:68px; right:18px; width:260px; z-index:10000; padding:10px; border:1px solid var(--ax-border-strong,rgba(255,255,255,.14)); border-radius:18px; background:rgba(15,15,17,.92); color:var(--ax-text,#fff); box-shadow:0 24px 70px rgba(0,0,0,.55); backdrop-filter:blur(28px) saturate(140%); opacity:0; transform:translateY(-8px) scale(.98); pointer-events:none; transition:opacity .18s ease,transform .18s ease; }
      .ax-profile-menu.open { opacity:1; transform:translateY(0) scale(1); pointer-events:auto; }
      .ax-profile-head { display:flex; gap:10px; align-items:center; padding:10px; margin-bottom:6px; }
      .ax-profile-avatar { width:38px; height:38px; border-radius:12px; display:grid; place-items:center; background:var(--ax-surface-3,#181818); border:1px solid var(--ax-border,#ffffff14); font-weight:800; }
      .ax-profile-name { font-size:.82rem; font-weight:700; }
      .ax-profile-status { font-size:.68rem; color:var(--ax-text-3,#888); margin-top:2px; }
      .ax-profile-action { width:100%; display:flex; align-items:center; gap:10px; border:0; background:transparent; color:var(--ax-text-2,#aaa); padding:10px; border-radius:11px; cursor:pointer; text-align:left; font:inherit; }
      .ax-profile-action:hover { background:var(--ax-glass-hover,rgba(255,255,255,.08)); color:var(--ax-text,#fff); }
      .ax-profile-sep { height:1px; background:var(--ax-border,rgba(255,255,255,.08)); margin:6px 4px; }
      .ax-cc-wallpaper-btn { width:100%; display:flex; align-items:center; justify-content:space-between; gap:10px; border:1px solid var(--ax-border,rgba(255,255,255,.08)); background:var(--ax-glass,rgba(255,255,255,.04)); color:var(--ax-text,#fff); border-radius:11px; padding:9px 10px; cursor:pointer; font:inherit; }
      .ax-cc-wallpaper-btn:hover { background:var(--ax-glass-hover,rgba(255,255,255,.08)); }
      .ax-cc-wallpaper-current { color:var(--ax-text-3,#888); font-size:.68rem; }
      .ax-cc-clickable { cursor:pointer; }
      .ax-cc-clickable:hover { background:var(--ax-glass-hover,rgba(255,255,255,.05)); border-radius:10px; }
    `;
    document.head.appendChild(style);
  }

  function injectTopbarButtons() {
    const right = document.querySelector('.ax-topbar-right');
    if (!right || document.getElementById('axWallpaperBtn')) return;

    const wallpaperBtn = document.createElement('div');
    wallpaperBtn.className = 'ax-topbar-item';
    wallpaperBtn.id = 'axWallpaperBtn';
    wallpaperBtn.title = 'Wallpaper Engine';
    wallpaperBtn.setAttribute('role', 'button');
    wallpaperBtn.setAttribute('tabindex', '0');
    wallpaperBtn.innerHTML = icon('wallpaper', 16);
    const openWallpaper = () => window.AxiomWallpaperEngine && window.AxiomWallpaperEngine.openPicker();
    wallpaperBtn.addEventListener('click', openWallpaper);
    wallpaperBtn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWallpaper(); } });

    const missionBtn = document.createElement('div');
    missionBtn.className = 'ax-topbar-item';
    missionBtn.id = 'axMissionBtn';
    missionBtn.title = 'Mission Control (F3)';
    missionBtn.innerHTML = icon('grid', 16);
    missionBtn.addEventListener('click', () => window.AxiomMissionControl && window.AxiomMissionControl.open('mission'));

    const desktopBtn = document.createElement('div');
    desktopBtn.className = 'ax-topbar-item';
    desktopBtn.id = 'axShowDesktopBtn';
    desktopBtn.title = 'Show Desktop (⌘D)';
    desktopBtn.innerHTML = icon('desktop', 16);
    desktopBtn.addEventListener('click', () => window.AxiomWindowManager && window.AxiomWindowManager.toggleShowDesktop());

    const spacesPill = document.createElement('div');
    spacesPill.className = 'ax-topbar-item ax-topbar-spaces';
    spacesPill.id = 'axSpacesPill';
    spacesPill.title = 'Switch virtual desktop (⌘⇧←/→)';
    function renderSpaces() {
      const wm = window.AxiomWindowManager;
      const mc = window.AxiomMissionControl;
      if (!wm || !mc) return;
      spacesPill.innerHTML = `${icon('spaces',14)}<span>${wm.getActiveDesktop()}</span>`;
    }
    spacesPill.addEventListener('click', () => window.AxiomMissionControl && window.AxiomMissionControl.switchDesktop(1));
    document.addEventListener('axwm:desktopchange', renderSpaces);

    right.insertBefore(spacesPill, right.firstChild);
    right.insertBefore(desktopBtn, right.firstChild);
    right.insertBefore(missionBtn, right.firstChild);
    right.insertBefore(wallpaperBtn, right.firstChild);
    renderSpaces();
  }

  function injectControlCenterWallpaper() {
    const panel = document.getElementById('axControlCenter');
    if (!panel || document.getElementById('axCCWallpaperRow')) return;
    const body = panel.querySelector('.ax-cc-body');
    if (!body) return;

    const row = document.createElement('div');
    row.className = 'ax-cc-row';
    row.id = 'axCCWallpaperRow';
    row.innerHTML = `
      <div class="ax-cc-row-icon">${icon('wallpaper',14)}</div>
      <div class="ax-cc-row-content">
        <span>Wallpaper</span>
        <button type="button" class="ax-cc-wallpaper-btn" id="axCCWallpaperBtn"><span>Wallpaper Engine</span><span class="ax-cc-wallpaper-current">Open</span></button>
      </div>`;
    body.appendChild(row);
    document.getElementById('axCCWallpaperBtn')?.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      window.AxiomWallpaperEngine && window.AxiomWallpaperEngine.openPicker();
    });
  }

  function setupProfileMenu() {
    const avatar = document.getElementById('axProfileBtn');
    if (!avatar || document.getElementById('axProfileMenu')) return;

    const menu = document.createElement('div');
    menu.id = 'axProfileMenu';
    menu.className = 'ax-profile-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
      <div class="ax-profile-head"><div class="ax-profile-avatar">AX</div><div><div class="ax-profile-name">AXIOM User</div><div class="ax-profile-status">Account & preferences</div></div></div>
      <button type="button" class="ax-profile-action" data-profile-action="settings">${icon('settings',15)}<span>Settings</span></button>
      <button type="button" class="ax-profile-action" data-profile-action="theme">${icon('moon',15)}<span>Cycle Theme</span></button>
      <button type="button" class="ax-profile-action" data-profile-action="wallpaper">${icon('wallpaper',15)}<span>Wallpaper Engine</span></button>
      <div class="ax-profile-sep"></div>
      <button type="button" class="ax-profile-action" data-profile-action="close">${icon('plus',15)}<span>Close</span></button>`;
    document.body.appendChild(menu);

    const close = () => { menu.classList.remove('open'); avatar.setAttribute('aria-expanded','false'); };
    avatar.setAttribute('aria-haspopup','menu');
    avatar.setAttribute('aria-expanded','false');
    avatar.addEventListener('click', e => {
      e.stopPropagation();
      const open = menu.classList.toggle('open');
      avatar.setAttribute('aria-expanded', String(open));
      document.getElementById('axControlCenter')?.classList.remove('open');
      document.getElementById('axNotifPanel')?.classList.remove('open');
    });

    menu.querySelectorAll('[data-profile-action]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const action = btn.dataset.profileAction;
      close();
      if (action === 'settings') {
        if (window.AxiomOS?.openWorkspace) window.AxiomOS.openWorkspace('settings'); else location.href = 'settings.html';
      } else if (action === 'theme') {
        window.AxiomOS?.cycleTheme();
      } else if (action === 'wallpaper') {
        window.AxiomWallpaperEngine?.openPicker();
      }
    }));

    document.addEventListener('click', e => { if (!menu.contains(e.target) && e.target !== avatar && !avatar.contains(e.target)) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  function setupControlCenterInteractions() {
    const cc = document.getElementById('axControlCenter');
    if (!cc || cc.dataset.enhanced === 'true') return;
    cc.dataset.enhanced = 'true';

    const rows = Array.from(cc.querySelectorAll('.ax-cc-row'));
    const status = { wifi:true, bluetooth:false, aiMode:0, performance:0 };
    try { Object.assign(status, JSON.parse(localStorage.getItem('axiom-cc-state') || '{}')); } catch (_) {}
    const save = () => { try { localStorage.setItem('axiom-cc-state', JSON.stringify(status)); } catch (_) {} };
    const wifi = document.getElementById('ccWiFi');
    const bluetooth = document.getElementById('ccBluetooth');
    const aiMode = document.getElementById('ccAIMode');
    const performance = document.getElementById('ccPerformance');
    const render = () => {
      if (wifi) wifi.textContent = status.wifi ? 'Connected' : 'Off';
      if (bluetooth) bluetooth.textContent = status.bluetooth ? 'On' : 'Off';
      if (aiMode) aiMode.textContent = ['Auto','Focus','Fast'][status.aiMode % 3];
      if (performance) performance.textContent = ['Balanced','Performance','Efficiency'][status.performance % 3];
    };
    const wifiRow = rows.find(r => r.querySelector('#ccWiFi'));
    const btRow = rows.find(r => r.querySelector('#ccBluetooth'));
    const aiRow = rows.find(r => r.querySelector('#ccAIMode'));
    const perfRow = rows.find(r => r.querySelector('#ccPerformance'));
    [wifiRow,btRow,aiRow,perfRow].forEach(row => row?.classList.add('ax-cc-clickable'));
    wifiRow?.addEventListener('click', () => { status.wifi=!status.wifi; save(); render(); });
    btRow?.addEventListener('click', () => { status.bluetooth=!status.bluetooth; save(); render(); });
    aiRow?.addEventListener('click', () => { status.aiMode=(status.aiMode+1)%3; save(); render(); });
    perfRow?.addEventListener('click', () => { status.performance=(status.performance+1)%3; save(); render(); });
    render();
  }

  function bindGlobalShortcuts() {
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==='d' && !e.shiftKey) { e.preventDefault(); window.AxiomWindowManager?.toggleShowDesktop(); }
      if (e.key==='F3') { e.preventDefault(); window.AxiomMissionControl?.open('mission'); }
    });
  }

  function init() {
    injectStyles();
    injectTopbarButtons();
    injectControlCenterWallpaper();
    setupProfileMenu();
    setupControlCenterInteractions();
    bindGlobalShortcuts();
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
