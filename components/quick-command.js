// ============================================================
// AXIOM AI OS V8 — Quick Command Palette
// ------------------------------------------------------------
// Raycast-inspired quick command. Opens with Ctrl+K.
// Lightweight version with actions, apps, and search.
// ============================================================

(function() {
  'use strict';

  const COMMANDS = [
    // Navigation
    { id: 'nav-dashboard', icon: 'grid', title: 'OS Shell', shortcut: 'G D', action: () => window.location.href = 'os-shell.html' },
    { id: 'nav-chat', icon: 'message-square', title: 'AI Chat', shortcut: 'G C', action: () => window.location.href = 'playground.html' },
    { id: 'nav-workspace', icon: 'file', title: 'Workspace', shortcut: 'G W', action: () => window.location.href = 'workspace.html' },
    { id: 'nav-agents', icon: 'zap', title: 'AI Agents', shortcut: 'G A', action: () => window.location.href = 'agent-library.html' },
    { id: 'nav-analytics', icon: 'bar-chart', title: 'Analytics', shortcut: 'G N', action: () => window.location.href = 'analytics.html' },
    { id: 'nav-memory', icon: 'database', title: 'Memory', shortcut: 'G M', action: () => window.location.href = 'memory.html' },
    { id: 'nav-browser', icon: 'globe', title: 'Browser', shortcut: 'G B', action: () => window.location.href = 'browser.html' },
    { id: 'nav-automation', icon: 'activity', title: 'Automation', shortcut: 'G U', action: () => window.location.href = 'automation.html' },
    { id: 'nav-settings', icon: 'settings', title: 'Settings', shortcut: 'G S', action: () => window.location.href = 'settings.html' },

    // Quick Actions
    { id: 'action-new-chat', icon: 'plus-circle', title: 'New Conversation', shortcut: 'N C', action: () => window.location.href = 'playground.html' },
    { id: 'action-upload', icon: 'upload', title: 'Upload File', shortcut: 'U F', action: () => window.location.href = 'workspace.html' },
    { id: 'action-search', icon: 'search', title: 'Universal Search', shortcut: 'Ctrl+K', action: () => window.AxiomSearch && window.AxiomSearch.open() },
    { id: 'action-theme', icon: 'moon', title: 'Toggle Dark/Light', shortcut: 'T T', action: () => document.body.classList.toggle('light-mode') },
  ];

  let isOpen = false;
  let panel = null;

  const icons = {
    'grid': '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    'message-square': '<path d="M21 11.5a8.5 8.5 0 01-8.9 8.49 8.63 8.63 0 01-3.9-.94L3 21l1.95-5.2a8.5 8.5 0 1116.05-4.3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    'file': '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    'zap': '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2 2m10.8 10.8l-2-2M18.4 5.6l-2 2M7.6 16.4l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/>',
    'bar-chart': '<path d="M4 18l5-5 4 3 7-8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 6v12h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    'database': '<path d="M6 4h8l4 4v12H6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 10h6M9 14h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    'globe': '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 00-10 10M12 2a15 15 0 0110 10" stroke="currentColor" stroke-width="1.6"/>',
    'activity': '<path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    'settings': '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.04 1.56V21a2 2 0 01-4 0v-.09A1.7 1.7 0 008.9 19.7a1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.7 1.7 0 004.6 15a1.7 1.7 0 00-1.56-1.04H3a2 2 0 010-4h.09A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06A1.7 1.7 0 009 4.6a1.7 1.7 0 001.04-1.56V3a2 2 0 014 0v.09A1.7 1.7 0 0015.4 4.6a1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06A1.7 1.7 0 0019.4 9a1.7 1.7 0 001.56 1.04H21a2 2 0 010 4h-.09A1.7 1.7 0 0019.4 15z" stroke="currentColor" stroke-width="1.4"/>',
    'plus-circle': '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    'upload': '<path d="M12 16V4M12 4l-4 4M12 4l4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    'search': '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    'moon': '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  };

  function build() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'axQuickCommand';
    panel.style.cssText = `
      position:fixed; inset:0; z-index:99998;
      display:none; align-items:flex-start; justify-content:center;
      padding-top:14vh;
      background:rgba(5,5,5,.5);
      backdrop-filter:blur(4px);
    `;
    panel.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Command palette" style="width:min(520px, calc(100vw - 24px)); background:#111; border:1px solid rgba(255,255,255,.08); border-radius:24px; box-shadow:0 30px 80px rgba(0,0,0,.5), inset 0 1px rgba(255,255,255,.08); backdrop-filter:blur(40px) saturate(120%); overflow:hidden;">
        <div style="display:flex; align-items:center; gap:10px; padding:14px 16px; border-bottom:1px solid rgba(255,255,255,.06);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" style="flex-shrink:0;opacity:.3;"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          <input id="qcInput" type="text" placeholder="Run a command..." aria-label="Run a command" role="combobox" aria-expanded="true" aria-controls="qcResults" aria-autocomplete="list" autocomplete="off" style="flex:1; background:transparent; border:none; color:#F5F5F5; font-size:.92rem; font-family:Inter,sans-serif; outline:none;">
          <kbd style="padding:3px 8px; border-radius:6px; border:1px solid rgba(255,255,255,.06); background:rgba(255,255,255,.02); font-size:.65rem; color:rgba(255,255,255,.25); font-family:Inter,sans-serif;">ESC</kbd>
        </div>
        <div id="qcResults" role="listbox" aria-label="Commands" style="max-height:360px; overflow-y:auto; padding:6px;"></div>
        <div style="padding:8px 16px; border-top:1px solid rgba(255,255,255,.04); display:flex; gap:16px; font-size:.68rem; color:rgba(255,255,255,.15);">
          <span>↑↓ Navigate</span>
          <span>↵ Open</span>
          <span>Esc Close</span>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    bindEvents();
  }

  let selectedIndex = -1;

  function bindEvents() {
    const input = document.getElementById('qcInput');
    const results = document.getElementById('qcResults');

    input.addEventListener('input', () => render(input.value));
    input.addEventListener('keydown', (e) => {
      const items = results.querySelectorAll('.qc-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        highlight(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        highlight(items);
      } else if (e.key === 'Enter') {
        const item = items[selectedIndex];
        if (item) item.click();
      } else if (e.key === 'Escape') {
        close();
      }
    });

    panel.addEventListener('click', (e) => {
      if (e.target === panel) close();
    });
  }

  function highlight(items) {
    const input = document.getElementById('qcInput');
    items.forEach((el, i) => {
      const selected = i === selectedIndex;
      el.style.background = selected ? 'rgba(255,255,255,.04)' : '';
      el.setAttribute('aria-selected', selected ? 'true' : 'false');
      if (selected && input) input.setAttribute('aria-activedescendant', el.id);
    });
  }

  function render(query) {
    const q = query.toLowerCase().trim();
    const results = document.getElementById('qcResults');
    const filtered = q
      ? COMMANDS.filter(c => c.title.toLowerCase().includes(q) || c.id.includes(q))
      : COMMANDS;

    selectedIndex = -1;
    if (filtered.length === 0) {
      results.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,.15);font-size:.82rem;">No commands found</div>';
      return;
    }

    let html = '';
    let currentCat = '';
    filtered.forEach(cmd => {
      const cat = cmd.id.startsWith('nav-') ? 'Navigation' : 'Actions';
      if (cat !== currentCat) {
        currentCat = cat;
        html += `<div style="padding:8px 16px 4px;font-size:.62rem;text-transform:uppercase;letter-spacing:.12em;color:rgba(255,255,255,.2);font-weight:600;">${cat}</div>`;
      }
      html += `
        <div class="qc-item" id="qc-item-${cmd.id}" role="option" aria-selected="false" data-id="${cmd.id}" style="display:flex;align-items:center;gap:10px;padding:8px 16px;cursor:pointer;border-radius:10px;margin:0 6px;transition:background .1s;">
          <div style="width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.04);color:rgba(255,255,255,.5);flex-shrink:0;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false">${icons[cmd.icon] || icons.grid}</svg></div>
          <span style="font-size:.84rem;color:#F5F5F5;font-weight:500;flex:1;">${cmd.title}</span>
          <kbd style="padding:2px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.06);font-size:.62rem;color:rgba(255,255,255,.2);font-family:Inter,sans-serif;">${cmd.shortcut}</kbd>
        </div>
      `;
    });
    results.innerHTML = html;

    results.querySelectorAll('.qc-item').forEach(el => {
      el.addEventListener('mouseenter', () => {
        const all = results.querySelectorAll('.qc-item');
        all.forEach((e, i) => {
          e.style.background = e === el ? 'rgba(255,255,255,.04)' : '';
          if (e === el) selectedIndex = i;
        });
      });
      el.addEventListener('click', function() {
        const id = this.dataset.id;
        const cmd = COMMANDS.find(c => c.id === id);
        if (cmd && cmd.action) {
          close();
          cmd.action();
        }
      });
    });
  }

  let releaseFocusTrap = null;

  function open() {
    isOpen = true;
    build();
    panel.style.display = 'flex';
    const input = document.getElementById('qcInput');
    if (input) { input.value = ''; setTimeout(() => input.focus(), 80); }
    render('');
    if (window.AxiomA11y) releaseFocusTrap = window.AxiomA11y.trapFocus(panel.firstElementChild);
  }

  function close() {
    isOpen = false;
    if (panel) panel.style.display = 'none';
    if (releaseFocusTrap) { releaseFocusTrap(); releaseFocusTrap = null; }
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'K') {
      e.preventDefault();
      toggle();
    }
    if (e.key === 'Escape' && isOpen) close();
  });

  window.AxiomQuickCommand = { open, close, toggle };
})();

