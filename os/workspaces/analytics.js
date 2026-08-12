// ============================================================
// AXIOM AI OS X — Analytics Workspace Module
// Milestone 2: Workspace Integration
// Reuses analytics.html / analytics-automation-ultimate.js as-is
// via iframe embed. Same pattern as os/workspaces/chat.js — no
// business logic is duplicated here.
// ============================================================
if (!window.AxiomWorkspaces) window.AxiomWorkspaces = {};

window.AxiomWorkspaces.analytics = {
  name: 'Analytics',
  icon: 'analytics',

  render: function(container) {
    container.innerHTML = `
      <div class="ax-workspace-window" data-motion="fade-in">
        <div class="ax-workspace-window-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 18l5-5 4 3 7-8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 6v12h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          <span class="ax-workspace-window-title">Analytics</span>
          <button class="ax-workspace-window-close" onclick="AxiomOS.openWorkspace('dashboard')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="ax-workspace-window-body" style="display:flex;flex-direction:column;padding:0;">
          <iframe src="analytics.html" style="flex:1;border:none;width:100%;height:100%;border-radius:0;" title="Analytics"></iframe>
        </div>
      </div>
    `;
  }
};
