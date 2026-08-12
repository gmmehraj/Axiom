// ============================================================
// AXIOM AI OS X — Chat Workspace Module
// Loaded on demand by WorkspaceManager
// ============================================================
if (!window.AxiomWorkspaces) window.AxiomWorkspaces = {};

window.AxiomWorkspaces.chat = {
  name: 'AI Chat',
  icon: 'chat',
  
  render: function(container, opts) {
    container.innerHTML = `
      <div class="ax-workspace-window" data-motion="fade-in">
        <div class="ax-workspace-window-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.5 8.5 0 01-8.9 8.49 8.63 8.63 0 01-3.9-.94L3 21l1.95-5.2a8.5 8.5 0 1116.05-4.3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          <span class="ax-workspace-window-title">AI Chat</span>
          <button class="ax-workspace-window-close" onclick="AxiomOS.openWorkspace('dashboard')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="ax-workspace-window-body" style="display:flex;flex-direction:column;padding:0;">
          <iframe src="playground.html" style="flex:1;border:none;width:100%;height:100%;border-radius:0;" title="AI Chat"></iframe>
        </div>
      </div>
    `;
  }
};
