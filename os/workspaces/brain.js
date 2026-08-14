// ============================================================
// AXIOM AI OS X — AI Brain Workspace Module
// ------------------------------------------------------------
// Truthful view over AxiomBrain / AxiomAIState. No invented
// confidence, emotion, token speed, reasoning speed, or model data.
// ============================================================
if (!window.AxiomWorkspaces) window.AxiomWorkspaces = {};

function axiomEnsureBrainDependencies(done) {
  const needed = [];
  if (!window.AxiomBrain) needed.push('os/core/axiom-brain.js');
  if (!window.AxiomAIState) needed.push('js/core/ai-state-manager.js');
  if (!needed.length) { done(); return; }
  let remaining = needed.length;
  let failed = false;
  needed.forEach(src => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => { if (--remaining === 0) done(!failed); };
    script.onerror = () => { failed = true; if (--remaining === 0) done(false); };
    document.head.appendChild(script);
  });
}

window.AxiomWorkspaces.brain = {
  name: 'AI Brain',
  icon: 'brain',

  render: function (container) {
    axiomEnsureBrainDependencies((ready) => {
      if (!ready || !window.AxiomBrain) {
        container.innerHTML = `<div class="ax-workspace-window"><div class="ax-workspace-window-header"><span class="ax-workspace-window-title">AI Brain</span><button class="ax-workspace-window-close" onclick="AxiomOS.openWorkspace('dashboard')" aria-label="Close">×</button></div><div class="ax-workspace-window-body"><div class="ax-workspace-fallback"><h2>Brain unavailable</h2><p>The real Brain state could not be loaded.</p></div></div></div>`;
        return;
      }

      const brain = window.AxiomBrain;
      const aiState = window.AxiomAIState;
      container.innerHTML = `
        <div class="ax-workspace-window ax-brain-workspace" data-motion="fade-in">
          <div class="ax-workspace-window-header">
            <span class="ax-workspace-window-title">AI Brain</span>
            <button class="ax-workspace-window-close" onclick="AxiomOS.openWorkspace('dashboard')" aria-label="Close">×</button>
          </div>
          <div class="ax-workspace-window-body">
            <div style="max-width:1000px;margin:0 auto;padding:clamp(12px,2vw,28px);">
              <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-bottom:20px;">
                <div><h2 style="margin:0 0 6px;">AI Brain Activity</h2><p style="margin:0;color:var(--ax-text-3);max-width:650px;">Live state from Axiom's canonical AI state systems.</p></div>
                <span data-brain-live style="font-size:.72rem;color:var(--ax-text-3);">Live state</span>
              </div>
              <div data-brain-cards style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:20px;"></div>
              <div data-brain-details style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;"></div>
            </div>
          </div>
        </div>`;

      const cards = container.querySelector('[data-brain-cards]');
      const details = container.querySelector('[data-brain-details]');
      const live = container.querySelector('[data-brain-live]');
      function text(value, fallback) { return value === null || value === undefined || value === '' ? (fallback || 'Unavailable') : String(value); }
      function formatTime(ts) { if (!ts) return 'Unavailable'; try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch (_) { return 'Unavailable'; } }
      function render() {
        const brainState = typeof brain.getState === 'function' ? brain.getState() : null;
        const canonical = aiState && typeof aiState.getState === 'function' ? aiState.getState() : null;
        const activity = canonical || brainState?.activity || 'idle';
        const model = brainState?.activeModel;
        const tool = brainState?.toolActive ? brainState.activeTool : null;
        const conversation = brainState?.activeConversationId;
        const automation = brainState?.automation || null;
        cards.innerHTML = [
          ['Activity', text(activity, 'Unavailable'), 'Canonical AI state'],
          ['Model', text(model, 'Model information unavailable'), 'Active model state'],
          ['Tool', tool ? text(tool) : 'No active tool', tool ? 'Capability call in progress' : 'No tool currently active'],
          ['Conversation', conversation ? text(conversation) : 'None active', conversation ? 'Live conversation id' : 'No conversation in flight']
        ].map(card => `<div class="ax-widget"><div class="ax-widget-head"><span class="ax-widget-label">${card[0]}</span></div><div class="ax-widget-value" style="font-size:1rem;word-break:break-word;">${card[1]}</div><div class="ax-widget-sub">${card[2]}</div></div>`).join('');
        const automationText = automation && automation.status && automation.status !== 'idle' ? `${automation.status}${automation.workflowName ? ' · ' + automation.workflowName : ''}` : 'Idle / unavailable';
        details.innerHTML = `
          <div class="ax-metric-card" style="padding:16px;background:var(--ax-glass);border:1px solid var(--ax-border);border-radius:var(--ax-radius-sm);">
            <div style="font-size:.68rem;color:var(--ax-text-3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:10px;">Current state</div>
            <div style="display:grid;gap:8px;font-size:.82rem;">
              <div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:var(--ax-text-3);">Activity</span><strong style="color:var(--ax-text);">${text(brainState?.activity, 'Unavailable')}</strong></div>
              <div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:var(--ax-text-3);">Last interaction</span><strong style="color:var(--ax-text);">${formatTime(brainState?.lastInteraction)}</strong></div>
              <div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:var(--ax-text-3);">Day</span><strong style="color:var(--ax-text);">${text(brainState?.day, 'Unavailable')}</strong></div>
            </div>
          </div>
          <div class="ax-metric-card" style="padding:16px;background:var(--ax-glass);border:1px solid var(--ax-border);border-radius:var(--ax-radius-sm);">
            <div style="font-size:.68rem;color:var(--ax-text-3);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:10px;">Connected systems</div>
            <div style="display:grid;gap:8px;font-size:.82rem;">
              <div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:var(--ax-text-3);">Automation</span><strong style="color:var(--ax-text);">${automationText}</strong></div>
              <div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:var(--ax-text-3);">Time of day</span><strong style="color:var(--ax-text);">${text(brainState?.timeOfDay, 'Unavailable')}</strong></div>
              <div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:var(--ax-text-3);">AI state source</span><strong style="color:var(--ax-text);">${canonical ? 'AxiomAIState' : 'AxiomBrain'}</strong></div>
              <div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:var(--ax-text-3);">Telemetry</span><strong style="color:var(--ax-text);">Only available live signals shown</strong></div>
            </div>
          </div>`;
        live.textContent = `Live · ${text(activity, 'unavailable')}`;
      }
      const unsubs = [];
      if (typeof brain.on === 'function') { const listener = () => render(); brain.on('change', listener); unsubs.push(() => brain.off && brain.off('change', listener)); }
      if (aiState && typeof aiState.onChange === 'function') unsubs.push(aiState.onChange(() => render()));
      document.addEventListener('axiom:ai-state', render);
      document.addEventListener('axiom:brain', render);
      render();
      const observer = new MutationObserver(() => {
        if (!document.body.contains(container)) {
          unsubs.forEach(fn => { try { fn(); } catch (_) {} });
          document.removeEventListener('axiom:ai-state', render);
          document.removeEventListener('axiom:brain', render);
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
};
