// ============================================
// AXIOM — Agent Library page controller
// Renders the Built-in/My Agents/Favorites/Recent tabs, search, and the
// custom-agent create/edit + memory modal. All persistence goes through
// window.AxiomAgents (ai/agents.js) — this file is UI only.
// ============================================
(function () {
  'use strict';

  const grid = document.getElementById('agentGrid');
  const empty = document.getElementById('agentEmpty');
  const tabsBar = document.getElementById('agentTabs');
  const searchInput = document.getElementById('agentSearch');
  const newAgentBtn = document.getElementById('newAgentBtn');

  const modal = document.getElementById('agentEditor');
  const modalTitle = document.getElementById('agentEditorTitle');
  const closeBtn = document.getElementById('agentEditorClose');
  const cancelBtn = document.getElementById('agentEditorCancel');
  const saveBtn = document.getElementById('agentEditorSave');
  const deleteBtn = document.getElementById('agentDeleteBtn');

  const nameInput = document.getElementById('agentName');
  const iconInput = document.getElementById('agentIcon');
  const descInput = document.getElementById('agentDescription');
  const promptInput = document.getElementById('agentSystemPrompt');
  const instructionsInput = document.getElementById('agentInstructions');
  const modelSelect = document.getElementById('agentModel');
  const tempInput = document.getElementById('agentTemperature');
  const tempVal = document.getElementById('agentTemperatureVal');
  const toolList = document.getElementById('agentToolList');
  const memoryEnabledInput = document.getElementById('agentMemoryEnabled');
  const memorySection = document.getElementById('agentMemorySection');
  const memoryList = document.getElementById('agentMemoryList');
  const memoryCount = document.getElementById('agentMemoryCount');
  const memoryNewNote = document.getElementById('agentMemoryNewNote');
  const memoryAddBtn = document.getElementById('agentMemoryAddBtn');

  let activeTab = 'all';
  let searchQuery = '';
  let editingAgent = null; // the agent object currently open in the modal, or null (= creating new)
  let selectedTools = new Set();

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();

  async function init() {
    if (typeof AxiomAgents === 'undefined') return;
    renderToolChips();
    populateModelOptions();
    await renderGrid();

    tabsBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      tabsBar.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      renderGrid();
    });

    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      renderGrid();
    });

    newAgentBtn.addEventListener('click', () => openEditor(null));
    closeBtn.addEventListener('click', closeEditor);
    cancelBtn.addEventListener('click', closeEditor);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeEditor(); });
    tempInput.addEventListener('input', () => { tempVal.textContent = tempInput.value; });
    saveBtn.addEventListener('click', saveEditor);
    deleteBtn.addEventListener('click', deleteEditorAgent);
    memoryAddBtn.addEventListener('click', addMemoryNote);
  }

  function populateModelOptions() {
    const cfg = window.OpenRouterConfig;
    const models = (cfg && cfg.FALLBACK_MODELS) || [];
    modelSelect.innerHTML = models.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('');
    if (typeof OpenRouter !== 'undefined' && OpenRouter.fetchModels) {
      OpenRouter.fetchModels().then((live) => {
        if (Array.isArray(live) && live.length) {
          const current = modelSelect.value;
          modelSelect.innerHTML = live.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('');
          if (current) modelSelect.value = current;
        }
      }).catch(() => {});
    }
  }

  function renderToolChips() {
    const tools = AxiomAgents.toolCatalog();
    toolList.innerHTML = '';
    tools.forEach((t) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'agent-tool-chip';
      chip.dataset.tool = t.id;
      chip.title = t.description + (t.ready ? '' : ' (coming soon — configurable now, wired up later)');
      chip.textContent = t.ready ? t.label : `${t.label} \u00B7 soon`;
      chip.addEventListener('click', () => {
        if (selectedTools.has(t.id)) selectedTools.delete(t.id); else selectedTools.add(t.id);
        chip.classList.toggle('active', selectedTools.has(t.id));
      });
      toolList.appendChild(chip);
    });
  }

  // -------------------- Grid --------------------

  async function renderGrid() {
    let agents;
    if (activeTab === 'builtin') agents = (await AxiomAgents.listAll()).filter((a) => !a.isCustom);
    else if (activeTab === 'mine') agents = (await AxiomAgents.listAll()).filter((a) => a.isCustom);
    else if (activeTab === 'favorites') agents = await AxiomAgents.listFavorites();
    else if (activeTab === 'recent') agents = await AxiomAgents.listRecent();
    else agents = await AxiomAgents.listAll();

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      agents = agents.filter((a) => a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q));
    }

    grid.innerHTML = '';
    empty.style.display = agents.length ? 'none' : 'flex';

    for (const agent of agents) {
      grid.appendChild(await renderCard(agent));
    }
  }

  async function renderCard(agent) {
    const card = document.createElement('div');
    card.className = 'agent-card';
    const isFav = await AxiomAgents.isFavorite(agent.id);

    card.innerHTML = `
      <div class="agent-card-top">
        <div class="agent-card-icon" style="background:${agent.color}22; color:${agent.color};">${agent.icon}</div>
        <button type="button" class="agent-card-fav ${isFav ? 'active' : ''}" aria-label="Favorite" title="Favorite">${isFav ? '\u2605' : '\u2606'}</button>
      </div>
      <div class="agent-card-name">${escapeHtml(agent.name)}</div>
      <div class="agent-card-desc">${escapeHtml(agent.description || '')}</div>
      <div class="agent-card-meta">
        <span class="agent-card-tag">${agent.isCustom ? 'Custom' : 'Built-in'}</span>
        <span class="agent-card-tag">temp ${agent.temperature}</span>
      </div>
      <div class="agent-card-actions">
        <button type="button" class="btn btn-solid btn-sm" data-action="use">Use in chat</button>
        ${agent.isCustom ? '<button type="button" class="btn btn-outline btn-sm" data-action="edit">Edit</button>' : '<button type="button" class="btn btn-outline btn-sm" data-action="memory">Memory</button>'}
      </div>
    `;

    card.querySelector('[data-action="use"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      await AxiomAgents.setActive(agent.id);
      window.location.href = 'playground.html';
    });
    const editBtn = card.querySelector('[data-action="edit"]');
    if (editBtn) editBtn.addEventListener('click', (e) => { e.stopPropagation(); openEditor(agent); });
    const memBtn = card.querySelector('[data-action="memory"]');
    if (memBtn) memBtn.addEventListener('click', (e) => { e.stopPropagation(); openEditor(agent, { memoryOnly: true }); });

    card.querySelector('.agent-card-fav').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await AxiomAgents.toggleFavorite(agent.id);
        renderGrid();
      } catch (err) {
        if (typeof showToast === 'function') showToast(err.message);
      }
    });

    return card;
  }

  // -------------------- Editor modal --------------------

  async function openEditor(agent, { memoryOnly = false } = {}) {
    editingAgent = agent;
    const isBuiltin = agent && !agent.isCustom;
    modalTitle.textContent = agent ? (isBuiltin ? `${agent.icon} ${agent.name}` : `Edit ${agent.name}`) : 'New agent';

    nameInput.value = agent ? agent.name : '';
    iconInput.value = agent ? agent.icon : '\uD83E\uDD16';
    descInput.value = agent ? agent.description || '' : '';
    promptInput.value = agent ? agent.systemPrompt : '';
    instructionsInput.value = agent ? agent.instructions || '' : '';
    if (agent && agent.defaultModel) modelSelect.value = agent.defaultModel;
    tempInput.value = agent ? agent.temperature : 0.7;
    tempVal.textContent = tempInput.value;
    memoryEnabledInput.checked = agent ? agent.memoryEnabled : true;

    selectedTools = new Set(agent ? agent.tools || [] : []);
    toolList.querySelectorAll('.agent-tool-chip').forEach((chip) => {
      chip.classList.toggle('active', selectedTools.has(chip.dataset.tool));
    });

    const editableFields = [nameInput, iconInput, descInput, promptInput, instructionsInput, modelSelect, tempInput, memoryEnabledInput];
    const readOnly = isBuiltin; // built-in agents: memory only, everything else read-only
    editableFields.forEach((f) => { f.disabled = readOnly; });
    toolList.style.pointerEvents = readOnly ? 'none' : '';
    toolList.style.opacity = readOnly ? '0.6' : '';

    saveBtn.style.display = readOnly ? 'none' : '';
    deleteBtn.style.display = agent && agent.isCustom ? '' : 'none';

    // Memory section: shown whenever we're editing an *existing* agent
    // (built-in or custom); hidden when creating a brand-new custom agent
    // since it has no id / memory yet.
    if (agent) {
      memorySection.style.display = '';
      await renderMemory(agent.id);
    } else {
      memorySection.style.display = 'none';
    }

    modal.classList.add('open');
  }

  function closeEditor() {
    modal.classList.remove('open');
    editingAgent = null;
  }

  async function renderMemory(agentId) {
    const notes = await AxiomAgents.getMemoryNotes(agentId, 50);
    memoryCount.textContent = notes.length;
    memoryList.innerHTML = notes.length ? '' : '<div class="agent-form-hint">No memory saved yet.</div>';
    notes.forEach((n) => {
      const row = document.createElement('div');
      row.className = 'agent-memory-note';
      row.innerHTML = `<span>${escapeHtml(n.note)}</span>`;
      memoryList.appendChild(row);
    });
  }

  async function addMemoryNote() {
    if (!editingAgent) return;
    const note = memoryNewNote.value.trim();
    if (!note) return;
    await AxiomAgents.remember(editingAgent.id, note);
    memoryNewNote.value = '';
    await renderMemory(editingAgent.id);
  }

  async function saveEditor() {
    const input = {
      name: nameInput.value.trim() || 'Untitled Agent',
      icon: iconInput.value.trim() || '\uD83E\uDD16',
      description: descInput.value.trim(),
      systemPrompt: promptInput.value.trim() || 'You are a helpful assistant.',
      instructions: instructionsInput.value.trim(),
      defaultModel: modelSelect.value,
      temperature: parseFloat(tempInput.value),
      tools: Array.from(selectedTools),
      memoryEnabled: memoryEnabledInput.checked
    };
    if (!input.name || !input.systemPrompt) {
      if (typeof showToast === 'function') showToast('Name and system prompt are required.');
      return;
    }
    try {
      saveBtn.disabled = true;
      if (editingAgent && editingAgent.isCustom) {
        await AxiomAgents.updateAgent(editingAgent.id, input);
      } else {
        await AxiomAgents.createAgent(input);
      }
      closeEditor();
      await renderGrid();
      if (typeof showToast === 'function') showToast('Agent saved.');
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message || 'Could not save agent.');
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function deleteEditorAgent() {
    if (!editingAgent) return;
    const ok = await confirmDialog(`Delete "${editingAgent.name}"? This can't be undone.`, {
      title: 'Delete agent',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await AxiomAgents.deleteAgent(editingAgent.id);
      closeEditor();
      await renderGrid();
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message || 'Could not delete agent.');
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
