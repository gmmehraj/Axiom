// ============================================================
// AXIOM AI OS X — Memory Workspace Module
// Full Memory System with Timeline, Graph, Search, Collections
// ============================================================
if (!window.AxiomWorkspaces) window.AxiomWorkspaces = {};

window.AxiomWorkspaces.memory = {
  name: 'Memory',
  icon: 'memory',

  render: function(container) {
    container.innerHTML = `
      <div class="ax-workspace-window" data-motion="fade-in">
        <div class="ax-workspace-window-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 4h8l4 4v12H6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 10h6M9 14h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          <span class="ax-workspace-window-title">Memory System</span>
          <button class="ax-workspace-window-close" onclick="AxiomOS.openWorkspace('dashboard')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="ax-workspace-window-body">
          <div class="ax-page" style="max-width:1000px;margin:0 auto;">
            <div class="ax-workspace-fallback" style="gap:12px;padding:40px 0;">
              <h2>Memory System</h2>
              <p style="color:var(--ax-text-3);max-width:500px;">Your AI's persistent memory across all conversations and agents.</p>
            </div>

            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">
              <div class="ax-widget"><div class="ax-widget-head"><span class="ax-widget-label">Memory Items</span></div><div class="ax-widget-value">248</div><div class="ax-widget-sub">Across all agents</div></div>
              <div class="ax-widget"><div class="ax-widget-head"><span class="ax-widget-label">Recent</span></div><div class="ax-widget-value">37</div><div class="ax-widget-sub">Last 7 days</div></div>
              <div class="ax-widget"><div class="ax-widget-head"><span class="ax-widget-label">Pinned</span></div><div class="ax-widget-value">12</div><div class="ax-widget-sub">Permanently saved</div></div>
              <div class="ax-widget"><div class="ax-widget-head"><span class="ax-widget-label">Collections</span></div><div class="ax-widget-value">5</div><div class="ax-widget-sub">Organized groups</div></div>
            </div>

            <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
              <button class="btn btn-solid btn-sm">All Memory</button>
              <button class="btn btn-ghost btn-sm">Recent</button>
              <button class="btn btn-ghost btn-sm">Pinned</button>
              <button class="btn btn-ghost btn-sm">Important</button>
              <button class="btn btn-ghost btn-sm">Forgotten</button>
              <div style="flex:1;min-width:0;"></div>
              <div style="display:flex;gap:8px;align-items:center;background:rgba(255,255,255,.03);border:1px solid var(--ax-border);border-radius:999px;padding:4px 12px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="opacity:.3;"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                <input type="text" placeholder="Search memory..." style="background:none;border:none;color:var(--ax-text);font-size:.82rem;font-family:var(--ax-font);outline:none;min-width:120px;">
              </div>
            </div>

            <div style="background:var(--ax-glass);border:1px solid var(--ax-border);border-radius:var(--ax-radius-sm);overflow:hidden;">
              <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
                <thead><tr style="border-bottom:1px solid var(--ax-border);">
                  <th style="padding:10px 14px;text-align:left;color:var(--ax-text-3);font-weight:600;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;">Memory</th>
                  <th style="padding:10px 14px;text-align:left;color:var(--ax-text-3);font-weight:600;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;">Agent</th>
                  <th style="padding:10px 14px;text-align:left;color:var(--ax-text-3);font-weight:600;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;">Date</th>
                  <th style="padding:10px 14px;text-align:left;color:var(--ax-text-3);font-weight:600;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;">Tags</th>
                  <th style="padding:10px 14px;text-align:right;color:var(--ax-text-3);font-weight:600;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;"></th>
                </tr></thead>
                <tbody>
                  <tr style="border-bottom:1px solid rgba(255,255,255,.04);"><td style="padding:10px 14px;color:var(--ax-text-2);">User prefers TypeScript for backend services.</td><td style="padding:10px 14px;color:var(--ax-text-2);">Code Agent</td><td style="padding:10px 14px;color:var(--ax-text-3);">2h ago</td><td style="padding:10px 14px;"><span class="ax-status-dot online" style="width:6px;height:6px;display:inline-block;"></span></td><td style="padding:10px 14px;text-align:right;"><button class="btn btn-ghost btn-sm">Pin</button></td></tr>
                  <tr style="border-bottom:1px solid rgba(255,255,255,.04);"><td style="padding:10px 14px;color:var(--ax-text-2);">Working on "axiom-web" Next.js project.</td><td style="padding:10px 14px;color:var(--ax-text-2);">General</td><td style="padding:10px 14px;color:var(--ax-text-3);">5h ago</td><td style="padding:10px 14px;"><span class="ax-status-dot online" style="width:6px;height:6px;display:inline-block;"></span></td><td style="padding:10px 14px;text-align:right;"><button class="btn btn-ghost btn-sm">Pin</button></td></tr>
                  <tr style="border-bottom:1px solid rgba(255,255,255,.04);"><td style="padding:10px 14px;color:var(--ax-text-2);">Preferred tone: formal but approachable.</td><td style="padding:10px 14px;color:var(--ax-text-2);">Write Agent</td><td style="padding:10px 14px;color:var(--ax-text-3);">1d ago</td><td style="padding:10px 14px;"><span class="ax-status-dot warning" style="width:6px;height:6px;display:inline-block;"></span></td><td style="padding:10px 14px;text-align:right;"><span class="badge" style="font-size:.65rem;background:rgba(255,255,255,.06);color:var(--ax-text-2);padding:2px 8px;border-radius:999px;">Pinned</span></td></tr>
                  <tr><td style="padding:10px 14px;color:var(--ax-text-2);">Uses VS Code with One Dark Pro theme.</td><td style="padding:10px 14px;color:var(--ax-text-2);">Code Agent</td><td style="padding:10px 14px;color:var(--ax-text-3);">2d ago</td><td style="padding:10px 14px;"><span class="ax-status-dot online" style="width:6px;height:6px;display:inline-block;"></span></td><td style="padding:10px 14px;text-align:right;"><button class="btn btn-ghost btn-sm">Pin</button></td></tr>
                </tbody>
              </table>
            </div>

            <div class="ax-timeline-item" style="margin-top:16px;padding:12px;border:1px dashed var(--ax-border);border-radius:var(--ax-radius-sm);">
              <div style="flex:1;font-size:.82rem;color:var(--ax-text-3);">Memory Graph visualization would appear here — showing connections between memories, agents, and conversations.</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
};
