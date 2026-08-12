// ============================================================
// AXIOM AI OS X — Agent Library Workspace Module
// Milestone 2: Workspace Integration
// Reuses agent-library.html / agent-library.js /
// agents-catalog.js as-is via iframe embed. Same pattern as
// os/workspaces/chat.js — no business logic is duplicated here.
// ============================================================
if (!window.AxiomWorkspaces) window.AxiomWorkspaces = {};

window.AxiomWorkspaces.agents = {
  name: 'AI Agents',
  icon: 'agents',

  render: function(container) {
    container.innerHTML = `
      <div class="ax-workspace-window" data-motion="fade-in">
        <div class="ax-workspace-window-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M16 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="1.6"/></svg>
          <span class="ax-workspace-window-title">AI Agents</span>
          <button class="ax-workspace-window-close" onclick="AxiomOS.openWorkspace('dashboard')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="ax-workspace-window-body" style="display:flex;flex-direction:column;padding:0;">
          <iframe src="agent-library.html" style="flex:1;border:none;width:100%;height:100%;border-radius:0;" title="AI Agents"></iframe>
        </div>
      </div>
    `;
  }
};
