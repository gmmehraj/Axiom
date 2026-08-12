// ============================================
// AXIOM — Agent chat bridge (Playground)
// Renders the agent picker, the "Current Agent / Model / Memory" status
// chip, and per-agent quick actions in the chat panel head. Reads/writes
// state through window.AxiomAgents only — app.js's own submit handler
// (see the Phase 6 hook there) is what actually folds the active agent
// into the outgoing request; this file is purely the UI layer around it,
// same relationship workspace-chat-bridge.js has to the base chat pipeline.
//
// No-ops entirely if AxiomAgents / the #agentSelect element aren't present.
// ============================================
(function () {
  'use strict';

  const select = document.getElementById('agentSelect');
  const statusBar = document.getElementById('agentStatusBar');
  const quickActionsBar = document.getElementById('agentQuickActions');

  if (!select || typeof AxiomAgents === 'undefined') return;

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();

  let _initialized = false;

  async function init() {
    if (_initialized) return;
    _initialized = true;

    await renderOptions();
    select.value = AxiomAgents.getActiveId();
    await applyAgentModel();
    await renderStatus();
    await renderQuickActions();

    select.addEventListener('change', async () => {
      await AxiomAgents.setActive(select.value);
      await applyAgentModel();
      await renderStatus();
      await renderQuickActions();
    });
  }

  // Points the existing #modelSelect at the newly-active agent's
  // preferred model. Best-effort: if the model isn't in the catalog yet
  // (still loading live models) or ModelSelector isn't present, the
  // dropdown just keeps whatever it already had — never blocks agent
  // switching.
  async function applyAgentModel() {
    if (typeof ModelSelector === 'undefined' || typeof ModelSelector.setSelectedModel !== 'function') return;
    const agent = await AxiomAgents.getActive();
    if (agent && agent.defaultModel) ModelSelector.setSelectedModel(agent.defaultModel);
  }

  async function renderOptions() {
    const all = await AxiomAgents.listAll();
    const groups = { 'Built-in Agents': [], 'My Agents': [] };
    all.forEach((a) => (a.isCustom ? groups['My Agents'] : groups['Built-in Agents']).push(a));

    select.innerHTML = '';
    Object.keys(groups).forEach((groupName) => {
      if (!groups[groupName].length) return;
      const og = document.createElement('optgroup');
      og.label = groupName;
      groups[groupName].forEach((a) => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = `${a.icon} ${a.name}`;
        og.appendChild(opt);
      });
      select.appendChild(og);
    });
  }

  async function renderStatus() {
    if (!statusBar) return;
    const agent = await AxiomAgents.getActive();
    const memNotes = agent.memoryEnabled ? await AxiomAgents.getMemoryNotes(agent.id, 1) : [];
    const memoryStatus = !agent.memoryEnabled
      ? 'Memory off'
      : memNotes.length ? 'Memory active' : 'No memory yet';

    statusBar.style.display = 'flex';
    statusBar.innerHTML =
      `<span title="${escapeHtml(agent.description || '')}">${agent.icon} Agent: <b>${escapeHtml(agent.name)}</b></span>` +
      `<span style="margin-left:0.75em; opacity:0.7;">\u00B7 ${memoryStatus}</span>`;
  }

  async function renderQuickActions() {
    if (!quickActionsBar) return;
    const agent = await AxiomAgents.getActive();
    const actions = agent.quickActions || [];
    if (!actions.length) {
      quickActionsBar.style.display = 'none';
      quickActionsBar.innerHTML = '';
      return;
    }
    quickActionsBar.style.display = 'flex';
    quickActionsBar.innerHTML = '';
    actions.forEach((qa) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline';
      btn.style.padding = '0.35em 0.8em';
      btn.style.fontSize = '0.85em';
      btn.textContent = qa.label;
      btn.addEventListener('click', () => {
        if (typeof chatInput === 'undefined') return;
        chatInput.value = qa.prompt || '';
        chatInput.dispatchEvent(new Event('input'));
        chatInput.focus();
        chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
      });
      quickActionsBar.appendChild(btn);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // If the Agent Library (a different tab/page) changes/creates/deletes an
  // agent, pick that up next time this page becomes visible rather than
  // requiring a manual refresh.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && _initialized) {
      AxiomAgents.invalidateCache();
      renderOptions().then(() => { select.value = AxiomAgents.getActiveId(); });
    }
  });
})();
