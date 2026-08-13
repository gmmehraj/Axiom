// AXIOM — Global Dock. Exact dock structure copied from workspace.html.
(function (global) {
  'use strict';
  const ITEMS = [
    { href:'os-shell.html', label:'OS Shell', icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 11.5 12 4l9 7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>' },
    { href:'playground.html', label:'AI Chat', icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.5 8.5 0 01-8.9 8.49 8.63 8.63 0 01-3.9-.94L3 21l1.95-5.2a8.5 8.5 0 1116.05-4.3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>' },
    { href:'workspace.html', label:'Workspace', icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v5h5M9 13h6M9 17h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' },
    { href:'agent-library.html', label:'Agents', icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M18.4 5.6l-2 2M7.6 16.4l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' },
    { href:'studios.html', label:'AI Studios', icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="3" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="13" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.6"/></svg>' },
    { href:'brain.html', label:'Brain', icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 3a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M15 3a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-3 3 3 3 0 01-3-3V6a3 3 0 013-3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 8h6M8 12h8M9 16h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' },
    { href:'browser.html', label:'Browser', icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 00-10 10M12 2a15 15 0 0110 10" stroke="currentColor" stroke-width="1.6"/></svg>' },
    null,
    { href:'analytics.html', label:'Analytics', icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 18l5-5 4 3 7-8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 6v12h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' },
    { href:'memory.html', label:'Memory', icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 4h8l4 4v12H6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 10h6M9 14h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' },
    { href:'automation.html', label:'Automation', icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2 2m10.8 10.8l-2-2M18.4 5.6l-2 2M7.6 16.4l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/></svg>' },
    null,
    { href:'settings.html', label:'Settings', icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.04 1.56V21a2 2 0 01-4 0v-.09A1.7 1.7 0 008.9 19.7a1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.7 1.7 0 004.6 15a1.7 1.7 0 00-1.56-1.04H3a2 2 0 010-4h.09A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06A1.7 1.7 0 009 4.6a1.7 1.7 0 001.04-1.56V3a2 2 0 014 0v.09A1.7 1.7 0 0015.4 4.6a1.7 1.7 0 001.87-.34l-.06-.06a2 2 0 112.83 2.83l-.06.06A1.7 1.7 0 0019.4 9a1.7 1.7 0 001.56 1.04H21a2 2 0 010 4h-.09A1.7 1.7 0 0019.4 15z" stroke="currentColor" stroke-width="1.4"/></svg>' }
  ];

  function mount() {
    const dock = document.getElementById('axDock');
    if (!dock) return;
    if (!document.querySelector('link[data-axiom-global-dock-style]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'styles/ax-dock.css';
      link.dataset.axiomGlobalDockStyle = 'true';
      document.head.appendChild(link);
    }
    const current = location.pathname.split('/').pop() || 'os-shell.html';
    dock.innerHTML = ITEMS.map(item => item
      ? `<a href="${item.href}" class="ax-dock-item${current === item.href ? ' active' : ''}" title="${item.label}">${item.icon}<span class="ax-dock-label">${item.label}</span></a>`
      : '<div class="ax-dock-divider"></div>'
    ).join('');
    dock.setAttribute('data-global-dock', 'true');
  }

  global.AxiomGlobalDock = { mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  else mount();
})(window);
