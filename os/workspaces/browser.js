// ============================================================
// AXIOM AI OS X — Browser Workspace Module
// Milestone 2: Workspace Integration
// Reuses browser.html / browser-studio-ultimate.js as-is via
// iframe embed. Same pattern as os/workspaces/chat.js — no
// business logic is duplicated here.
// ============================================================
if (!window.AxiomWorkspaces) window.AxiomWorkspaces = {};

window.AxiomWorkspaces.browser = {
  name: 'Browser',
  icon: 'browser',

  render: function(container) {
    container.innerHTML = `
      <div class="ax-workspace-window" data-motion="fade-in">
        <div class="ax-workspace-window-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 00-10 10M12 2a15 15 0 0110 10" stroke="currentColor" stroke-width="1.6"/></svg>
          <span class="ax-workspace-window-title">Browser</span>
          <button class="ax-workspace-window-close" onclick="AxiomOS.openWorkspace('dashboard')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="ax-workspace-window-body" style="display:flex;flex-direction:column;padding:0;">
          <iframe src="browser.html" style="flex:1;border:none;width:100%;height:100%;border-radius:0;" title="Browser"></iframe>
        </div>
      </div>
    `;
  }
};
