// ============================================================
// AXIOM AI OS X — AI Brain Workspace Module
// Full AI state visualization: mood, reasoning, confidence, health
// ============================================================
if (!window.AxiomWorkspaces) window.AxiomWorkspaces = {};

window.AxiomWorkspaces.brain = {
  name: 'AI Brain',
  icon: 'brain',

  render: function(container) {
    container.innerHTML = `
      <div class="ax-workspace-window" data-motion="fade-in">
        <div class="ax-workspace-window-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M18.4 5.6l-2 2M7.6 16.4l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          <span class="ax-workspace-window-title">AI Brain</span>
          <button class="ax-workspace-window-close" onclick="AxiomOS.openWorkspace('dashboard')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="ax-workspace-window-body">
          <div style="max-width:900px;margin:0 auto;">
            <div class="ax-workspace-fallback" style="gap:8px;padding:20px 0;">
              <h2>AI Brain Activity</h2>
              <p style="color:var(--ax-text-3);">Real-time view into the AI's cognitive state.</p>
            </div>

            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">
              <div class="ax-widget"><div class="ax-widget-head"><span class="ax-widget-label">Mood</span></div><div class="ax-widget-value" style="font-size:1.1rem;display:flex;align-items:center;gap:8px;"><span style="font-size:1.3rem;">🧠</span> Focused</div><div class="ax-widget-sub">Stable cognitive state</div></div>
              <div class="ax-widget"><div class="ax-widget-head"><span class="ax-widget-label">Confidence</span></div><div class="ax-widget-value">98.2%</div><div class="ax-widget-bar"><div class="ax-widget-bar-fill" style="width:98%"></div></div><div class="ax-widget-sub">High certainty</div></div>
              <div class="ax-widget"><div class="ax-widget-head"><span class="ax-widget-label">Health</span></div><div class="ax-widget-value" style="color:#6EE7B7;">Optimal</div><div class="ax-widget-bar"><div class="ax-widget-bar-fill" style="width:100%;background:linear-gradient(90deg,#6EE7B7,#6EE7B7);"></div></div><div class="ax-widget-sub">All systems nominal</div></div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:20px;">
              <div class="ax-metric-card" style="padding:16px;background:var(--ax-glass);border:1px solid var(--ax-border);border-radius:var(--ax-radius-sm);">
                <div class="ax-metric-label" style="font-size:.68rem;color:var(--ax-text-3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:8px;">Reasoning</div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                  <div style="display:flex;justify-content:space-between;font-size:.78rem;"><span style="color:var(--ax-text-3);">Depth</span><span style="color:var(--ax-text);">Chain-of-thought</span></div>
                  <div style="display:flex;justify-content:space-between;font-size:.78rem;"><span style="color:var(--ax-text-3);">Speed</span><span style="color:var(--ax-text);">2.7 TB/s</span></div>
                  <div style="display:flex;justify-content:space-between;font-size:.78rem;"><span style="color:var(--ax-text-3);">Pattern</span><span style="color:var(--ax-text);">Active</span></div>
                </div>
              </div>
              <div class="ax-metric-card" style="padding:16px;background:var(--ax-glass);border:1px solid var(--ax-border);border-radius:var(--ax-radius-sm);">
                <div class="ax-metric-label" style="font-size:.68rem;color:var(--ax-text-3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:8px;">Context</div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                  <div style="display:flex;justify-content:space-between;font-size:.78rem;"><span style="color:var(--ax-text-3);">Usage</span><span style="color:var(--ax-text);">12%</span></div>
                  <div style="display:flex;justify-content:space-between;font-size:.78rem;"><span style="color:var(--ax-text-3);">Tokens</span><span style="color:var(--ax-text);">16,384 / 128K</span></div>
                  <div style="display:flex;justify-content:space-between;font-size:.78rem;"><span style="color:var(--ax-text-3);">Window</span><span style="color:var(--ax-text);">Full</span></div>
                </div>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:20px;">
              <div style="padding:12px;background:var(--ax-glass);border:1px solid var(--ax-border);border-radius:12px;text-align:center;">
                <div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;color:var(--ax-text-3);font-weight:600;">Model</div>
                <div style="font-size:.85rem;font-weight:600;color:var(--ax-text);margin-top:4px;">Claude 3.5</div>
              </div>
              <div style="padding:12px;background:var(--ax-glass);border:1px solid var(--ax-border);border-radius:12px;text-align:center;">
                <div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;color:var(--ax-text-3);font-weight:600;">Latency</div>
                <div style="font-size:.85rem;font-weight:600;color:var(--ax-text);margin-top:4px;">124ms</div>
              </div>
              <div style="padding:12px;background:var(--ax-glass);border:1px solid var(--ax-border);border-radius:12px;text-align:center;">
                <div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;color:var(--ax-text-3);font-weight:600;">Token Speed</div>
                <div style="font-size:.85rem;font-weight:600;color:var(--ax-text);margin-top:4px;">42/s</div>
              </div>
              <div style="padding:12px;background:var(--ax-glass);border:1px solid var(--ax-border);border-radius:12px;text-align:center;">
                <div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;color:var(--ax-text-3);font-weight:600;">Learning</div>
                <div style="font-size:.85rem;font-weight:600;color:var(--ax-text);margin-top:4px;">Active</div>
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:8px;padding:16px;background:var(--ax-glass);border:1px solid var(--ax-border);border-radius:var(--ax-radius-sm);">
              <h3 style="font-size:.85rem;font-weight:600;color:var(--ax-text);margin-bottom:4px;">Running Tasks</h3>
              <div class="ax-timeline-item"><span class="ax-timeline-dot"></span><span style="font-size:.78rem;color:var(--ax-text-2);">Context window monitoring</span></div>
              <div class="ax-timeline-item"><span class="ax-timeline-dot"></span><span style="font-size:.78rem;color:var(--ax-text-2);">Memory consolidation</span></div>
              <div class="ax-timeline-item"><span class="ax-timeline-dot"></span><span style="font-size:.78rem;color:var(--ax-text-2);">Background learning</span></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
};
