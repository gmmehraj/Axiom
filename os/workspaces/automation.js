// ============================================================
// AXIOM AI OS X — Automation Workspace Module
// Milestone 2: Workspace Integration
// Reuses automation.html / automation-part9.js as-is via iframe
// embed. Same pattern as os/workspaces/chat.js — no business
// logic is duplicated here.
// ============================================================
if (!window.AxiomWorkspaces) window.AxiomWorkspaces = {};

window.AxiomWorkspaces.automation = {
  name: 'Automation',
  icon: 'automation',

  render: function(container) {
    container.innerHTML = `
      <div class="ax-workspace-window" data-motion="fade-in">
        <div class="ax-workspace-window-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2 2m10.8 10.8l-2-2M18.4 5.6l-2 2M7.6 16.4l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/></svg>
          <span class="ax-workspace-window-title">Automation</span>
          <button class="ax-workspace-window-close" onclick="AxiomOS.openWorkspace('dashboard')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="ax-workspace-window-body" style="display:flex;flex-direction:column;padding:0;">
          <iframe src="automation.html" style="flex:1;border:none;width:100%;height:100%;border-radius:0;" title="Automation"></iframe>
        </div>
      </div>
    `;
  }
};
