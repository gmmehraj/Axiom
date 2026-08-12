// ============================================================
// AXIOM AI OS X — Part 6: Desktop (icons, folders, files,
// widgets, shortcuts) — the classic OS desktop layer.
// ============================================================
window.AxiomDesktop = (function () {
  'use strict';

  const STORAGE_KEY = 'axiom.desktop.items';
  const GRID = 96; // icon slot size

  let layer = null;
  let items = [];
  let dragging = null;
  let contextMenuEl = null;

  function icon(name, size) {
    return window.AxiomIcons ? window.AxiomIcons.svg(name, size || 22) : '';
  }

  function uid() { return 'di-' + Math.random().toString(36).slice(2, 9); }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      items = raw ? JSON.parse(raw) : defaultItems();
    } catch (e) { items = defaultItems(); }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (e) {}
  }

  function defaultItems() {
    return [
      { id: uid(), type: 'folder', name: 'Projects', x: 24, y: 24, children: [] },
      { id: uid(), type: 'folder', name: 'Documents', x: 24, y: 24 + GRID, children: [] },
      { id: uid(), type: 'shortcut', name: 'AI Chat', workspace: 'chat', x: 24, y: 24 + GRID * 2 },
      { id: uid(), type: 'shortcut', name: 'File System', workspace: 'files', x: 24, y: 24 + GRID * 3 },
      { id: uid(), type: 'widget', name: 'Clock', widget: 'clock', x: window.innerWidth - 220, y: 24, w: 200, h: 200 },
      { id: uid(), type: 'widget', name: 'Notes', widget: 'notes', x: window.innerWidth - 220, y: 240, w: 200, h: 220, content: '' },
    ];
  }

  function ensureLayer() {
    if (layer) return layer;
    layer = document.createElement('div');
    layer.className = 'ax-desktop-layer';
    layer.id = 'axDesktopLayer';
    const host = document.getElementById('axWorkspaceContainer') || document.body;
    host.insertBefore(layer, host.firstChild);

    layer.addEventListener('contextmenu', (e) => {
      if (e.target !== layer) return; // empty space only
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, null);
    });
    layer.addEventListener('click', (e) => {
      if (e.target === layer) hideContextMenu();
    });
    document.addEventListener('axwm:desktopchange', render);
    return layer;
  }

  // ---- ICON DRAG ----
  function makeDraggable(el, itemEl) {
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const rect = el.getBoundingClientRect();
      dragging = { id: itemEl.id, offX: e.clientX - rect.left, offY: e.clientY - rect.top, el };
      el.classList.add('dragging');
      document.addEventListener('mousemove', onIconDrag);
      document.addEventListener('mouseup', onIconDrop);
    });
  }

  function onIconDrag(e) {
    if (!dragging) return;
    const x = e.clientX - dragging.offX;
    const y = e.clientY - dragging.offY;
    dragging.el.style.left = Math.max(0, x) + 'px';
    dragging.el.style.top = Math.max(0, y) + 'px';
  }

  function onIconDrop() {
    if (!dragging) return;
    const item = items.find(i => i.id === dragging.id);
    if (item) {
      item.x = parseInt(dragging.el.style.left, 10);
      item.y = parseInt(dragging.el.style.top, 10);
      save();
    }
    dragging.el.classList.remove('dragging');
    dragging = null;
    document.removeEventListener('mousemove', onIconDrag);
    document.removeEventListener('mouseup', onIconDrop);
  }

  // ---- ACTIONS ----
  function openFolder(item) {
    const wm = window.AxiomWindowManager;
    if (!wm) return;
    const win = wm.createWindow({
      title: item.name, icon: 'folder', width: 520, height: 380, appId: 'finder',
    });
    renderFolderContents(win, item);
  }

  function renderFolderContents(win, item) {
    const body = win.element ? win.element.querySelector('.ax-window-body') : null;
    if (!body) return;
    body.innerHTML = `
      <div class="ax-finder">
        <div class="ax-finder-toolbar">
          <button data-act="new-file">${icon('plus', 12)} New File</button>
          <button data-act="new-folder">${icon('folder', 12)} New Folder</button>
        </div>
        <div class="ax-finder-grid">
          ${item.children.map(c => `
            <div class="ax-finder-item" data-id="${c.id}">
              ${icon(c.type === 'folder' ? 'folder' : 'files', 26)}
              <span>${c.name}</span>
            </div>`).join('') || '<div class="ax-finder-empty">This folder is empty</div>'}
        </div>
      </div>`;
    body.querySelector('[data-act="new-file"]').onclick = () => {
      const name = prompt('File name:', 'Untitled.txt');
      if (!name) return;
      item.children.push({ id: uid(), type: 'file', name, content: '' });
      save(); renderFolderContents(win, item);
    };
    body.querySelector('[data-act="new-folder"]').onclick = () => {
      const name = prompt('Folder name:', 'New Folder');
      if (!name) return;
      item.children.push({ id: uid(), type: 'folder', name, children: [] });
      save(); renderFolderContents(win, item);
    };
    body.querySelectorAll('.ax-finder-item').forEach(el => {
      el.addEventListener('dblclick', () => {
        const child = item.children.find(c => c.id === el.dataset.id);
        if (!child) return;
        if (child.type === 'folder') {
          const w2 = window.AxiomWindowManager.createWindow({ title: child.name, icon: 'folder', width: 480, height: 340, appId: 'finder' });
          renderFolderContents(w2, child);
        } else {
          openFile(child);
        }
      });
    });
  }

  function openFile(item) {
    const wm = window.AxiomWindowManager;
    if (!wm) return;
    const win = wm.createWindow({ title: item.name, icon: 'files', width: 460, height: 360, appId: 'texteditor' });
    const body = win.element ? win.element.querySelector('.ax-window-body') : null;
    if (!body) return;
    body.innerHTML = `<textarea class="ax-text-editor" placeholder="Start typing...">${item.content || ''}</textarea>`;
    body.querySelector('textarea').addEventListener('input', (e) => {
      item.content = e.target.value;
      save();
    });
  }

  function openShortcut(item) {
    if (window.AxiomWorkspaceManager && window.AxiomWorkspaceManager.getWorkspace(item.workspace)) {
      window.AxiomWorkspaceManager.open(item.workspace);
    } else if (window.AxiomWindowManager) {
      window.AxiomWindowManager.createWindow({ title: item.name, icon: 'shortcut', iframeSrc: item.href || null });
    }
  }

  // ---- WIDGETS (live content, not opened — they sit on the desktop) ----
  function mountWidget(el, item) {
    if (item.widget === 'clock') {
      const tick = () => {
        const now = new Date();
        el.querySelector('.ax-widget-clock-time').textContent =
          now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        el.querySelector('.ax-widget-clock-date').textContent =
          now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
      };
      tick();
      setInterval(tick, 1000 * 15);
    }
    if (item.widget === 'notes') {
      const ta = el.querySelector('textarea');
      ta.value = item.content || '';
      ta.addEventListener('input', () => { item.content = ta.value; save(); });
      // stop icon-drag from stealing focus while typing
      ta.addEventListener('mousedown', (e) => e.stopPropagation());
    }
  }

  function widgetInner(item) {
    if (item.widget === 'clock') {
      return `<div class="ax-widget ax-widget-clock">
        <div class="ax-widget-clock-time">--:--</div>
        <div class="ax-widget-clock-date"></div>
      </div>`;
    }
    if (item.widget === 'notes') {
      return `<div class="ax-widget ax-widget-notes">
        <div class="ax-widget-notes-title">${icon('files', 12)} Notes</div>
        <textarea placeholder="Jot something down..."></textarea>
      </div>`;
    }
    if (item.widget === 'weather') {
      return `<div class="ax-widget ax-widget-weather">
        ${icon('brain', 22)}<div>Weather widget</div>
      </div>`;
    }
    return `<div class="ax-widget">${icon('widget', 20)}</div>`;
  }

  // ---- CONTEXT MENUS ----
  function hideContextMenu() {
    if (contextMenuEl) { contextMenuEl.remove(); contextMenuEl = null; }
  }

  function showContextMenu(x, y, item) {
    hideContextMenu();
    const menu = document.createElement('div');
    menu.className = 'ax-ctx-menu';
    let rows = [];
    if (!item) {
      rows = [
        ['New Folder', () => addItem({ type: 'folder', name: 'New Folder', children: [] }, x, y)],
        ['New File', () => addItem({ type: 'file', name: 'Untitled.txt', content: '' }, x, y)],
        ['Add Widget: Clock', () => addItem({ type: 'widget', name: 'Clock', widget: 'clock', w: 200, h: 200 }, x, y)],
        ['Add Widget: Notes', () => addItem({ type: 'widget', name: 'Notes', widget: 'notes', w: 200, h: 220, content: '' }, x, y)],
        ['Change Wallpaper…', () => window.AxiomWallpaperEngine && window.AxiomWallpaperEngine.openPicker()],
        ['Sort Icons', () => sortIcons()],
      ];
    } else {
      rows = [
        ['Open', () => activate(item)],
        ['Rename', () => renameItem(item)],
        ['Delete', () => deleteItem(item)],
      ];
    }
    menu.innerHTML = rows.map((r, i) => `<div class="ax-ctx-row" data-i="${i}">${r[0]}</div>`).join('');
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    document.body.appendChild(menu);
    contextMenuEl = menu;
    menu.querySelectorAll('.ax-ctx-row').forEach((row, i) => {
      row.addEventListener('click', () => { rows[i][1](); hideContextMenu(); });
    });
    setTimeout(() => document.addEventListener('click', hideContextMenu, { once: true }), 0);
  }

  function addItem(partial, x, y) {
    const item = Object.assign({ id: uid(), x: x - 32, y: y - 32 }, partial);
    items.push(item);
    save();
    render();
  }

  function renameItem(item) {
    const name = prompt('Rename:', item.name);
    if (name) { item.name = name; save(); render(); }
  }

  function deleteItem(item) {
    items = items.filter(i => i.id !== item.id);
    save();
    render();
  }

  function sortIcons() {
    let col = 0, row = 0;
    const perCol = Math.floor((window.innerHeight - 80) / GRID);
    items.forEach(item => {
      if (item.type === 'widget') return;
      item.x = 24 + col * GRID;
      item.y = 24 + row * GRID;
      row++;
      if (row >= perCol) { row = 0; col++; }
    });
    save();
    render();
  }

  function activate(item) {
    if (item.type === 'folder') openFolder(item);
    else if (item.type === 'file') openFile(item);
    else if (item.type === 'shortcut') openShortcut(item);
  }

  // ---- RENDER ----
  function render() {
    ensureLayer();
    layer.innerHTML = '';
    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'ax-desktop-icon ' + (item.type === 'widget' ? 'is-widget' : '');
      el.style.left = (item.x || 24) + 'px';
      el.style.top = (item.y || 24) + 'px';
      if (item.type === 'widget') {
        el.style.width = (item.w || 200) + 'px';
        el.style.height = (item.h || 200) + 'px';
        el.innerHTML = widgetInner(item);
        mountWidget(el, item);
      } else {
        const kind = item.type === 'folder' ? 'folder' : item.type === 'shortcut' ? 'shortcut' : 'files';
        el.innerHTML = `<div class="ax-desktop-icon-glyph">${icon(kind, 30)}</div><div class="ax-desktop-icon-label">${item.name}</div>`;
        el.addEventListener('dblclick', () => activate(item));
      }
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, item);
      });
      makeDraggable(el, item);
      layer.appendChild(el);
    });
  }

  function init() {
    load();
    render();
  }

  return { init, render, addItem, get items() { return items; } };
})();

if (document.readyState !== 'loading') window.AxiomDesktop.init();
else document.addEventListener('DOMContentLoaded', () => window.AxiomDesktop.init());
