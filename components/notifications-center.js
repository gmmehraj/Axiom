// ============================================================
// AXIOM AI OS V8 — Notifications Center
// ------------------------------------------------------------
// Modern notification center with grouping, priority, clear all,
// and history. Floating glass panel.
// ============================================================

(function() {
  'use strict';

  const NOTIFICATIONS = [
    { id: 1, icon: 'sparkle', title: 'AI Analysis Complete', message: 'Your document analysis has finished processing.', time: '2m ago', priority: 'high', group: 'ai', read: false },
    { id: 2, icon: 'upload', title: 'File Uploaded', message: 'Project brief.pdf has been uploaded to Workspace.', time: '8m ago', priority: 'normal', group: 'files', read: false },
    { id: 3, icon: 'zap', title: 'Automation Triggered', message: 'Weekly report generation workflow started.', time: '15m ago', priority: 'normal', group: 'automation', read: false },
    { id: 4, icon: 'message-circle', title: 'New Chat Message', message: 'Research Agent has completed its analysis.', time: '32m ago', priority: 'low', group: 'chat', read: true },
    { id: 5, icon: 'alert-triangle', title: 'API Rate Limit Warning', message: 'You\'ve reached 80% of your hourly limit.', time: '1h ago', priority: 'high', group: 'system', read: false },
    { id: 6, icon: 'check-circle', title: 'Memory Updated', message: 'New memory saved from recent conversation.', time: '2h ago', priority: 'low', group: 'memory', read: true },
    { id: 7, icon: 'credit-card', title: 'Billing Renewed', message: 'Your Studio Pro plan has been renewed.', time: '1d ago', priority: 'normal', group: 'billing', read: true },
  ];

  let isOpen = false;

  function getPriorityColor(priority) {
    switch (priority) {
      case 'high': return 'rgba(239, 68, 68, .6)';
      case 'normal': return 'rgba(251, 191, 36, .6)';
      case 'low': return 'rgba(110, 231, 183, .6)';
      default: return 'rgba(255,255,255,.45)'; /* Phase 7 Pt.2: was .3 (2.22:1) — 3.97:1 meets WCAG 1.4.11 (3:1 for UI components) against the #111 panel */
    }
  }

  function getGroupIcon(group) {
    const icons = {
      ai: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
      files: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
      automation: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2 2m10.8 10.8l-2-2M18.4 5.6l-2 2M7.6 16.4l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/></svg>',
      chat: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.5 8.5 0 01-8.9 8.49 8.63 8.63 0 01-3.9-.94L3 21l1.95-5.2a8.5 8.5 0 1116.05-4.3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
      system: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
      memory: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 4h8l4 4v12H6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 10h6M9 14h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
      billing: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M2 9h20" stroke="currentColor" stroke-width="1.6"/></svg>',
    };
    return icons[group] || icons.system;
  }

  function render() {
    const unread = NOTIFICATIONS.filter(n => !n.read).length;
    const container = document.getElementById('axNotificationsContainer');
    if (!container) return;

    container.innerHTML = `
      <style>
        .ax-notif-trigger { position: relative; cursor: pointer; }
        .ax-notif-dot {
          position: absolute; top: 4px; right: 5px;
          width: 8px; height: 8px; border-radius: 50%;
          background: #EF4444; box-shadow: 0 0 8px rgba(239,68,68,.4);
          display: ${unread > 0 ? 'block' : 'none'};
        }
        .ax-notif-panel {
          position: absolute; top: calc(100% + 8px); right: 0;
          width: 380px; max-height: 520px;
          background: #111; border: 1px solid rgba(255,255,255,.08);
          border-radius: 24px; box-shadow: 0 24px 80px rgba(0,0,0,.5), inset 0 1px rgba(255,255,255,.08);
          backdrop-filter: blur(40px) saturate(120%);
          -webkit-backdrop-filter: blur(40px) saturate(120%);
          display: ${isOpen ? 'flex' : 'none'};
          flex-direction: column;
          overflow: hidden;
          z-index: 9999;
          animation: axNotifIn .2s cubic-bezier(.19,1,.22,1);
        }
        @keyframes axNotifIn {
          from { opacity: 0; transform: translateY(-8px) scale(.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .ax-notif-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 16px 10px; border-bottom: 1px solid rgba(255,255,255,.06);
        }
        .ax-notif-header h3 { font-size: .92rem; font-weight: 600; color: #F5F5F5; }
        .ax-notif-header .unread-count {
          font-size: .72rem; color: rgba(255,255,255,.62);
          background: rgba(255,255,255,.04); padding: 2px 10px;
          border-radius: 999px; border: 1px solid rgba(255,255,255,.06);
        }
        .ax-notif-actions { display: flex; gap: 6px; }
        .ax-notif-actions button {
          background: none; border: none; color: rgba(255,255,255,.62);
          font-size: .74rem; cursor: pointer; padding: 4px 8px;
          border-radius: 8px; transition: color .15s, background .15s;
        }
        .ax-notif-actions button:hover { color: #F5F5F5; background: rgba(255,255,255,.04); }
        .ax-notif-tabs {
          display: flex; gap: 4px; padding: 8px 16px;
          border-bottom: 1px solid rgba(255,255,255,.04);
        }
        .ax-notif-tab {
          padding: 4px 14px; border-radius: 999px; font-size: .78rem;
          color: rgba(255,255,255,.62); cursor: pointer; transition: all .15s;
          border: 1px solid transparent; background: transparent;
        }
        .ax-notif-tab.active { color: #F5F5F5; background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.1); }
        .ax-notif-tab:hover { color: rgba(255,255,255,.6); }
        .ax-notif-list {
          flex: 1; overflow-y: auto; padding: 8px;
          display: flex; flex-direction: column; gap: 2px;
        }
        .ax-notif-item {
          display: grid; grid-template-columns: 32px 1fr auto;
          gap: 10px; align-items: start;
          padding: 10px 12px; border-radius: 14px;
          cursor: pointer; transition: background .15s;
          position: relative;
        }
        .ax-notif-item:hover { background: rgba(255,255,255,.03); }
        .ax-notif-item.unread { background: rgba(255,255,255,.02); }
        .ax-notif-item.unread::before {
          content: ''; position: absolute; left: 4px; top: 14px;
          width: 5px; height: 5px; border-radius: 50%;
          background: rgba(255,255,255,.5);
        }
        .ax-notif-icon {
          width: 32px; height: 32px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,.04); color: rgba(255,255,255,.5);
          flex-shrink: 0;
        }
        .ax-notif-body { min-width: 0; }
        .ax-notif-title { font-size: .82rem; font-weight: 600; color: #F5F5F5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ax-notif-msg { font-size: .76rem; color: rgba(255,255,255,.65); margin-top: 2px; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .ax-notif-time { font-size: .68rem; color: rgba(255,255,255,.55); white-space: nowrap; padding-top: 2px; }
        .ax-notif-bar {
          width: 3px; border-radius: 999px; height: 100%;
          margin-left: auto; flex-shrink: 0;
        }
        .ax-notif-empty {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 8px; padding: 40px 20px; text-align: center; color: rgba(255,255,255,.55);
        }
        .ax-notif-empty svg { opacity: .3; }
        .ax-notif-footer {
          padding: 10px 16px; border-top: 1px solid rgba(255,255,255,.04);
          text-align: center;
        }
        .ax-notif-footer a {
          font-size: .78rem; color: rgba(255,255,255,.62); text-decoration: none;
          transition: color .15s;
        }
        .ax-notif-footer a:hover { color: rgba(255,255,255,.6); }
      </style>
    `;

    const trigger = container.querySelector('.ax-notif-trigger');
    // NOTE (Phase 7, Part 2 accessibility pass): render() currently only
    // injects the <style> block above — it never builds the trigger
    // button or panel/list markup into `container`, so `trigger` here is
    // always null and no notification DOM (and therefore no ARIA
    // attributes) actually exists to attach to. Left as-is: building out
    // that markup is a feature/business-logic change, outside this
    // pass's scope. The color-contrast fixes above are safe regardless,
    // since they'll apply correctly once that markup is added.
  }

  function toggle() {
    isOpen = !isOpen;
    render();
  }

  function open() { isOpen = true; render(); }
  function close() { isOpen = false; render(); }

  window.AxiomNotifications = { open, close, toggle };
})();

