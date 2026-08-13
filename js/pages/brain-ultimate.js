/* ============================================================
   AXIOM — Truthful Brain Page
   ------------------------------------------------------------
   The Brain page is a view over AxiomBrain + AxiomAIState. It does
   not simulate confidence, reasoning depth, emotion, token speed,
   latency, branches, predictions, or a model name.
   ============================================================ */
(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>\"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[ch]));
  }

  function valueOrUnavailable(value, fallback) {
    return value === null || value === undefined || value === '' ? (fallback || 'Unavailable') : String(value);
  }

  function formatTime(ts) {
    if (!ts) return 'Unavailable';
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
    catch (_) { return 'Unavailable'; }
  }

  function init() {
    const brain = global.AxiomBrain;
    const aiState = global.AxiomAIState;
    const modeSections = document.getElementById('mode-sections');
    const heroBadge = document.querySelector('.brain-core-live');
    const modelDisplay = document.getElementById('topbarModelDisplay');
    if (!modeSections) return;

    const navHtml = `
      <div class="brain-nav" id="truthfulBrainNav">
        <button type="button" class="brain-nav-card active" data-truth-section="state"><div class="brain-nav-label">Live State</div><div class="brain-nav-sub">Canonical activity</div></button>
        <button type="button" class="brain-nav-card" data-truth-section="model"><div class="brain-nav-label">Model</div><div class="brain-nav-sub">Active model state</div></button>
        <button type="button" class="brain-nav-card" data-truth-section="tools"><div class="brain-nav-label">Tools</div><div class="brain-nav-sub">Live capability activity</div></button>
        <button type="button" class="brain-nav-card" data-truth-section="conversation"><div class="brain-nav-label">Conversation</div><div class="brain-nav-sub">Current conversation</div></button>
        <button type="button" class="brain-nav-card" data-truth-section="memory"><div class="brain-nav-label">Memory</div><div class="brain-nav-sub">Real memory state</div></button>
        <button type="button" class="brain-nav-card" data-truth-section="system"><div class="brain-nav-label">System</div><div class="brain-nav-sub">Connected state</div></button>
      </div>
      <div id="truthfulBrainContent"></div>`;

    modeSections.innerHTML = navHtml;
    const nav = modeSections.querySelector('#truthfulBrainNav');
    const content = modeSections.querySelector('#truthfulBrainContent');
    let selected = 'state';

    function getSnapshot() {
      const state = brain && typeof brain.getState === 'function' ? brain.getState() : {};
      const canonical = aiState && typeof aiState.getState === 'function' ? aiState.getState() : null;
      const memoryEngine = global.AxiomMemoryEngine;
      const memoryStats = memoryEngine && typeof memoryEngine.getStats === 'function' ? memoryEngine.getStats() : null;
      return {
        brain: state,
        activity: canonical || state.activity || 'idle',
        memory: memoryStats
      };
    }

    function card(label, value, sub) {
      return `<div class="brain-metric-card"><div class="brain-metric-label">${escapeHtml(label)}</div><div class="brain-metric-value" style="font-size:1rem;word-break:break-word;">${escapeHtml(value)}</div><div style="color:var(--ax-text-3);font-size:.72rem;margin-top:6px;">${escapeHtml(sub)}</div></div>`;
    }

    function render() {
      const s = getSnapshot();
      const b = s.brain;
      const model = valueOrUnavailable(b.activeModel, 'Model information unavailable');
      const tool = b.toolActive ? valueOrUnavailable(b.activeTool, 'Tool active') : 'No active tool';
      const conversation = b.activeConversationId || 'No conversation in flight';
      const automation = b.automation && b.automation.status !== 'idle'
        ? `${b.automation.status}${b.automation.workflowName ? ' · ' + b.automation.workflowName : ''}`
        : 'Idle / unavailable';

      if (modelDisplay) modelDisplay.textContent = model;
      if (heroBadge) heroBadge.innerHTML = `<span class="pulse-dot"></span> ${escapeHtml(s.activity)}`;

      const views = {
        state: {
          title: 'Live AI State',
          description: 'Only state emitted by Axiom\'s real AI state systems is shown here.',
          cards: [
            card('Activity', s.activity, 'AxiomAIState / AxiomBrain'),
            card('Mood', valueOrUnavailable(b.mood), 'Persisted Brain state'),
            card('Last interaction', formatTime(b.lastInteraction), 'Persisted Brain timestamp'),
            card('Day', valueOrUnavailable(b.day), 'Derived from first launch')
          ]
        },
        model: {
          title: 'Active Model',
          description: 'The model shown is the model reported by the existing model-selection state. Unknown stays unknown.',
          cards: [card('Current model', model, 'No hardcoded provider/model'), card('Model state', b.activeModel ? 'Available' : 'Unavailable', 'Source: AxiomBrain.activeModel')]
        },
        tools: {
          title: 'Tool Activity',
          description: 'Capability state comes from the existing agent event stream.',
          cards: [card('Tool status', tool, b.toolActive ? 'Live capability call' : 'No active capability'), card('Automation', automation, 'Existing automation bridge state')]
        },
        conversation: {
          title: 'Conversation State',
          description: 'The Brain follows the conversation lifecycle instead of inventing reasoning telemetry.',
          cards: [card('Conversation', conversation, b.activeConversationId ? 'Active conversation id' : 'No active conversation'), card('Activity', s.activity, 'Canonical live state')]
        },
        memory: {
          title: 'Memory State',
          description: 'Memory numbers come from the same persisted Memory Engine used by the Memory page.',
          cards: s.memory ? [
            card('Memory items', s.memory.memoryCount, 'AxiomMemoryEngine.getStats()'),
            card('Pinned', s.memory.pinnedCount, 'Persisted pinned memories'),
            card('Conversations', s.memory.conversationCount, 'Memory Engine conversation records'),
            card('Working memory', `${Math.round(s.memory.shortTermCacheLoad * 100)}%`, 'Derived from real working-memory items')
          ] : [card('Memory Engine', 'Unavailable', 'No Memory Engine loaded on this page')]
        },
        system: {
          title: 'Connected Systems',
          description: 'No synthetic health or performance score is displayed.',
          cards: [
            card('AI state source', aiState ? 'AxiomAIState' : 'AxiomBrain', 'Canonical activity source'),
            card('Brain source', brain ? 'AxiomBrain' : 'Unavailable', 'Persistent cross-page state'),
            card('Automation', automation, 'Real workflow state when available'),
            card('Telemetry', 'Only verified signals', 'Latency, token speed and confidence are not fabricated')
          ]
        }
      };

      const view = views[selected] || views.state;
      content.innerHTML = `
        <div class="brain-section active">
          <div class="brain-section-head"><div><h2>${escapeHtml(view.title)}</h2><p>${escapeHtml(view.description)}</p></div></div>
          <div class="brain-metrics-grid">${view.cards.join('')}</div>
        </div>`;

      nav.querySelectorAll('[data-truth-section]').forEach(btn => btn.classList.toggle('active', btn.dataset.truthSection === selected));
    }

    nav.querySelectorAll('[data-truth-section]').forEach(btn => btn.addEventListener('click', () => {
      selected = btn.dataset.truthSection || 'state';
      render();
    }));

    if (brain && typeof brain.on === 'function') brain.on('change', render);
    if (aiState && typeof aiState.onChange === 'function') aiState.onChange(render);
    document.addEventListener('axiom:ai-state', render);
    document.addEventListener('axiom:brain', render);

    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
