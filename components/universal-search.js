// ============================================================
// AXIOM AI OS V8 — Universal Search (Cmd/Ctrl + K)
// ------------------------------------------------------------
// Raycast-style command palette that searches everything:
// Chats, Files, Notes, Images, Settings, Commands, AI Memory, Models
// Floating glass panel with search + results.
// ============================================================

(function() {
  'use strict';

  const SEARCH_ITEMS = [
    // Pages
    { id: 'go-dashboard', category: 'Commands', icon: 'home', title: 'Go to OS Shell', action: () => window.location.href = 'os-shell.html' },
    { id: 'go-chat', category: 'Commands', icon: 'message-circle', title: 'Open AI Chat', action: () => window.location.href = 'playground.html' },
    { id: 'go-workspace', category: 'Commands', icon: 'file-text', title: 'Open Workspace', action: () => window.location.href = 'workspace.html' },
    { id: 'go-agents', category: 'Commands', icon: 'sparkle', title: 'Open AI Agents', action: () => window.location.href = 'agent-library.html' },
    { id: 'go-analytics', category: 'Commands', icon: 'bar-chart-2', title: 'View Analytics', action: () => window.location.href = 'analytics.html' },
    { id: 'go-memory', category: 'Commands', icon: 'database', title: 'Open Memory', action: () => window.location.href = 'memory.html' },
    { id: 'go-browser', category: 'Commands', icon: 'globe', title: 'Open Browser', action: () => window.location.href = 'browser.html' },
    { id: 'go-automation', category: 'Commands', icon: 'zap', title: 'Open Automation', action: () => window.location.href = 'automation.html' },
    { id: 'go-billing', category: 'Commands', icon: 'credit-card', title: 'Go to Billing', action: () => window.location.href = 'billing.html' },
    { id: 'go-settings', category: 'Commands', icon: 'settings', title: 'Open Settings', action: () => window.location.href = 'settings.html' },

    // Actions
    { id: 'new-chat', category: 'Actions', icon: 'plus', title: 'New Chat', action: () => window.location.href = 'playground.html' },
    { id: 'new-file', category: 'Actions', icon: 'upload', title: 'Upload File', action: () => window.location.href = 'workspace.html' },
    { id: 'new-agent', category: 'Actions', icon: 'user-plus', title: 'Create New Agent', action: () => window.location.href = 'agent-library.html' },
    { id: 'new-workflow', category: 'Actions', icon: 'zap', title: 'New Automation Workflow', action: () => window.location.href = 'automation.html' },
    { id: 'export', category: 'Actions', icon: 'download', title: 'Export Data', action: () => window.location.href = 'settings.html' },
    { id: 'dark-mode', category: 'Actions', icon: 'moon', title: 'Toggle Dark Mode', action: () => document.body.classList.toggle('dark-mode') },
  ];

  let isOpen = false;
  let searchPanel = null;

  function getIconSvg(name) {
    const icons = {
      home: '<path d="M3 11.5 12 4l9 7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
      'message-circle': '<path d="M21 11.5a8.5 8.5 0 01-8.9 8.49 8.63 8.63 0 01-3.9-.94L3 21l1.95-5.2a8.5 8.5 0 1116.05-4.3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
      'file-text': '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v5h5M9 13h6M9 17h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      sparkle: '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M18.4 5.6l-2 2M7.6 16.4l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      'bar-chart-2': '<path d="M4 18l5-5 4 3 7-8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 6v12h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      database: '<path d="M6 4h8l4 4v12H6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 10h6M9 14h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      globe: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 00-10 10M12 2a15 15 0 0110 10" stroke="currentColor" stroke-width="1.6"/>',
      zap: '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2 2m10.8 10.8l-2-2M18.4 5.6l-2 2M7.6 16.4l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/>',
      'credit-card': '<rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M2 9h20" stroke="currentColor" stroke-width="1.6"/>',
      settings: '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.04 1.56V21a2 2 0 01-4 0v-.09A1.7 1.7 0 008.9 19.7a1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.7 1.7 0 004.6 15a1.7 1.7 0 00-1.56-1.04H3a2 2 0 010-4h.09A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06A1.7 1.7 0 009 4.6a1.7 1.7 0 001.04-1.56V3a2 2 0 014 0v.09A1.7 1.7 0 0015.4 4.6a1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06A1.7 1.7 0 0019.4 9a1.7 1.7 0 001.56 1.04H21a2 2 0 010 4h-.09A1.7 1.7 0 0019.4 15z" stroke="currentColor" stroke-width="1.4"/>',
      plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      upload: '<path d="M12 16V4M12 4l-4 4M12 4l4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
      'user-plus': '<path d="M16 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="1.6"/><path d="M19 8v6M16 11h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
      moon: '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    };
    return icons[name] || icons.home;
  }

  function createPanel() {
    if (searchPanel) return;

    searchPanel = document.createElement('div');
    searchPanel.id = 'axUniversalSearch';
    searchPanel.style.cssText = `
      position:fixed; inset:0; z-index:99999;
      display:${isOpen ? 'flex' : 'none'};
      align-items:flex-start; justify-content:center;
      padding-top:15vh;
      background:rgba(5,5,5,.65);
      backdrop-filter:blur(8px);
      -webkit-backdrop-filter:blur(8px);
    `;

    searchPanel.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Universal search" style="width:min(620px, calc(100vw - 32px)); background:#111; border:1px solid rgba(255,255,255,.08); border-radius:28px; box-shadow:0 30px 80px rgba(0,0,0,.5), inset 0 1px rgba(255,255,255,.08); backdrop-filter:blur(40px) saturate(120%); -webkit-backdrop-filter:blur(40px) saturate(120%); overflow:hidden; animation:axSearchIn .2s cubic-bezier(.19,1,.22,1);">
        <style>
          @keyframes axSearchIn { from{opacity:0;transform:translateY(-12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)} }
          .ax-search-input-wrap { display:flex; align-items:center; gap:12px; padding:16px 20px; border-bottom:1px solid rgba(255,255,255,.06); }
          .ax-search-input { flex:1; background:transparent; border:none; color:#F5F5F5; font-size:1.05rem; font-family:Inter,sans-serif; outline:none; min-width:0; }
          .ax-search-input::placeholder { color:rgba(255,255,255,.25); }
          .ax-search-category { padding:8px 20px 4px; font-size:.66rem; text-transform:uppercase; letter-spacing:.12em; color:rgba(255,255,255,.2); font-weight:600; }
          .ax-search-item { display:flex; align-items:center; gap:12px; padding:10px 20px; cursor:pointer; transition:background .1s; margin:0 6px; border-radius:12px; }
          .ax-search-item:hover, .ax-search-item.selected { background:rgba(255,255,255,.04); }
          .ax-search-item-icon { width:32px; height:32px; border-radius:10px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,.04); color:rgba(255,255,255,.5); flex-shrink:0; }
          .ax-search-item-title { font-size:.88rem; color:#F5F5F5; font-weight:500; }
          .ax-search-item-cat { font-size:.72rem; color:rgba(255,255,255,.25); margin-left:auto; }
          .ax-search-empty { padding:32px 20px; text-align:center; color:rgba(255,255,255,.15); font-size:.85rem; }
        </style>
        <div class="ax-search-input-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" style="flex-shrink:0;opacity:.3;"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          <input class="ax-search-input" id="axSearchInput" type="text" placeholder="Search anything... (chats, files, commands, settings)" aria-label="Search anything" role="combobox" aria-expanded="true" aria-controls="axSearchResults" aria-autocomplete="list" autocomplete="off" autofocus>
          <kbd style="padding:4px 10px; border-radius:8px; border:1px solid rgba(255,255,255,.06); background:rgba(255,255,255,.02); font-size:.7rem; color:rgba(255,255,255,.25); font-family:Inter,sans-serif; flex-shrink:0;">ESC</kbd>
        </div>
        <div id="axSearchResults" role="listbox" aria-label="Search results" style="max-height:400px; overflow-y:auto; padding:6px 0;"></div>
      </div>
    `;

    document.body.appendChild(searchPanel);

    const input = document.getElementById('axSearchInput');
    const results = document.getElementById('axSearchResults');

    function filterItems(query) {
      const q = query.toLowerCase().trim();
      if (!q) return SEARCH_ITEMS;
      return SEARCH_ITEMS.filter(item =>
        item.title.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    }

    function renderResults(query) {
      const filtered = filterItems(query);
      const categories = {};
      filtered.forEach(item => {
        if (!categories[item.category]) categories[item.category] = [];
        categories[item.category].push(item);
      });

      if (Object.keys(categories).length === 0) {
        results.innerHTML = '<div class="ax-search-empty">No results found</div>';
        return;
      }

      let html = '';
      Object.entries(categories).forEach(([cat, items]) => {
        html += `<div class="ax-search-category">${cat}</div>`;
        items.forEach(item => {
          html += `
            <div class="ax-search-item" role="option" aria-selected="false" data-id="${item.id}">
              <div class="ax-search-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">${getIconSvg(item.icon)}</svg></div>
              <div class="ax-search-item-title">${item.title}</div>
              <div class="ax-search-item-cat">${item.category}</div>
            </div>
          `;
        });
      });
      results.innerHTML = html;

      results.querySelectorAll('.ax-search-item').forEach(el => {
        el.addEventListener('click', function() {
          const id = this.dataset.id;
          const item = SEARCH_ITEMS.find(i => i.id === id);
          if (item && item.action) {
            close();
            item.action();
          }
        });
      });
    }

    renderResults('');

    input.addEventListener('input', () => renderResults(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = results.querySelector('.ax-search-item');
        if (first) first.click();
      }
      if (e.key === 'Escape') close();
    });

    // clicking outside
    searchPanel.addEventListener('click', (e) => {
      if (e.target === searchPanel) close();
    });

    setTimeout(() => input.focus(), 100);
  }

  let releaseSearchFocusTrap = null;

  function open() {
    isOpen = true;
    createPanel();
    if (searchPanel) searchPanel.style.display = 'flex';
    if (window.AxiomA11y && searchPanel) releaseSearchFocusTrap = window.AxiomA11y.trapFocus(searchPanel.firstElementChild);
    const input = document.getElementById('axSearchInput');
    if (input) { input.value = ''; setTimeout(() => input.focus(), 100); }
    const results = document.getElementById('axSearchResults');
    if (results) {
      const filtered = filterItems('');
      // re-render
      const categories = {};
      filtered.forEach(item => {
        if (!categories[item.category]) categories[item.category] = [];
        categories[item.category].push(item);
      });
      let html = '';
      Object.entries(categories).forEach(([cat, items]) => {
        html += `<div class="ax-search-category">${cat}</div>`;
        items.forEach(item => {
          html += `<div class="ax-search-item" role="option" aria-selected="false" data-id="${item.id}"><div class="ax-search-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">${getIconSvg(item.icon)}</svg></div><div class="ax-search-item-title">${item.title}</div><div class="ax-search-item-cat">${item.category}</div></div>`;
        });
      });
      results.innerHTML = html;
      results.querySelectorAll('.ax-search-item').forEach(el => {
        el.addEventListener('click', function() {
          const id = this.dataset.id;
          const item = SEARCH_ITEMS.find(i => i.id === id);
          if (item && item.action) { close(); item.action(); }
        });
      });
    }
  }

  function close() {
    isOpen = false;
    if (searchPanel) searchPanel.style.display = 'none';
    if (releaseSearchFocusTrap) { releaseSearchFocusTrap(); releaseSearchFocusTrap = null; }
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  // keyboard shortcut: Cmd/Ctrl + K
  document.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      toggle();
    }
    if (e.key === 'Escape' && isOpen) {
      close();
    }
  });

  window.AxiomSearch = { open, close, toggle };
})();

