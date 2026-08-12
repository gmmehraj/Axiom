/* ============================================================
   AXIOM AI OS V13 — Chat Core Engine
   ------------------------------------------------------------
   Manages:
   - Conversation history (CRUD + localStorage persistence)
   - Chat search with real-time filtering
   - Folder/groups (collapsible)
   - Pin/star conversations
   - Artifact panel controller
   - Math/LaTeX rendering via KaTeX
   - Image generation modal
   - Memory display from AxiomBrain
   - Sidebar toggle
   ============================================================ */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'axiom:conversations';
  const MAX_CONVOS = 50;

  // ---- State ----
  let conversations = [];
  let currentId = null;
  let filters = { tab: 'all', search: '', folder: null };

  // ---- DOM refs (cached) ----
  let els = {};

  function cacheEls() {
    els = {
      sidebar: document.getElementById('axChatSidebar'),
      sidebarToggle: document.getElementById('axSidebarToggle'),
      convoList: document.getElementById('axConvoList'),
      searchInput: document.getElementById('axChatSearchInput'),
      searchClear: document.getElementById('axSearchClear'),
      tabBtns: document.querySelectorAll('.ax-chat-tab'),
      folders: document.querySelectorAll('.ax-chat-folder'),
      newChatBtn: document.getElementById('axNewChatBtn'),
      artifactPanel: document.getElementById('axArtifactPanel'),
      artifactToggle: document.getElementById('axArtifactToggle'),
      artifactClose: document.getElementById('axArtifactClose'),
      artifactBody: document.getElementById('axArtifactBody'),
      artifactScrim: document.getElementById('axArtifactScrim'),
      memoryList: document.getElementById('axChatMemoryList'),
      memoryCount: document.getElementById('axChatMemoryCount'),
      imageGenModal: document.getElementById('axImageGenModal'),
      imageGenBtn: document.getElementById('axImageGenBtn'),
      imageGenClose: document.getElementById('axImageGenClose'),
      imageGenForm: document.getElementById('axImageGenForm'),
      imageGenResults: document.getElementById('axImageGenResults'),
    };
  }

  // ============================================================
  // CONVERSATION PERSISTENCE
  // ============================================================
  function loadConversations() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      conversations = raw ? JSON.parse(raw) : [];
    } catch (e) {
      conversations = [];
    }
    // Migrate old format
    conversations = conversations.filter(c => c && c.id && c.title);
  }

  function saveConversations() {
    try {
      // Trim to max
      if (conversations.length > MAX_CONVOS) {
        conversations = conversations.slice(0, MAX_CONVOS);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    } catch (e) { /* quota exceeded or private mode */ }
  }

  function generateId() {
    return 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  }

  // ============================================================
  // CRUD
  // ============================================================
  function createConversation(title) {
    const convo = {
      id: generateId(),
      title: title || 'New chat',
      messages: [],
      model: 'Claude 3.5 Sonnet',
      agent: 'General Assistant',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      folder: null,
    };
    conversations.unshift(convo);
    currentId = convo.id;
    saveConversations();
    renderSidebar();
    return convo;
  }

  function deleteConversation(id) {
    conversations = conversations.filter(c => c.id !== id);
    if (currentId === id) {
      currentId = conversations.length > 0 ? conversations[0].id : null;
    }
    saveConversations();
    renderSidebar();
  }

  function pinConversation(id) {
    const convo = conversations.find(c => c.id === id);
    if (convo) {
      convo.pinned = !convo.pinned;
      saveConversations();
      renderSidebar();
    }
  }

  function setConversationFolder(id, folder) {
    const convo = conversations.find(c => c.id === id);
    if (convo) {
      convo.folder = folder;
      saveConversations();
      renderSidebar();
    }
  }

  function updateConversation(id, patch) {
    const convo = conversations.find(c => c.id === id);
    if (convo) {
      Object.assign(convo, patch, { updatedAt: Date.now() });
      saveConversations();
      renderSidebar();
    }
  }

  function getConversation(id) {
    return conversations.find(c => c.id === id);
  }

  function getCurrentConversation() {
    return conversations.find(c => c.id === currentId);
  }

  function setCurrentConversation(id) {
    currentId = id;
    renderSidebar();
  }

  // ============================================================
  // RENDER SIDEBAR
  // ============================================================
  function renderSidebar() {
    if (!els.convoList) return;

    // Filter conversations
    let filtered = [...conversations];

    // Tab filter
    if (filters.tab === 'pinned') {
      filtered = filtered.filter(c => c.pinned);
    }

    // Search filter
    if (filters.search.trim()) {
      const q = filters.search.toLowerCase().trim();
      filtered = filtered.filter(c =>
        c.title.toLowerCase().includes(q) ||
        (c.messages && c.messages.some(m =>
          typeof m.content === 'string' && m.content.toLowerCase().includes(q)
        ))
      );
    }

    // Folder filter
    if (filters.folder) {
      filtered = filtered.filter(c => c.folder === filters.folder);
    }

    // Sort: pinned first, then by updatedAt desc
    filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    });

    // Build HTML
    if (filtered.length === 0) {
      els.convoList.innerHTML = `
        <div class="ax-sidebar-empty">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.4"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          <p>${filters.search ? 'No conversations match your search.' : filters.tab === 'pinned' ? 'No pinned conversations yet.' : 'Start a new conversation.'}</p>
        </div>`;
      return;
    }

    // Group by folder if no specific filter
    const grouped = {};
    const ungrouped = [];

    if (!filters.folder && !filters.search && filters.tab === 'all') {
      filtered.forEach(c => {
        if (c.folder) {
          if (!grouped[c.folder]) grouped[c.folder] = [];
          grouped[c.folder].push(c);
        } else {
          ungrouped.push(c);
        }
      });
    } else {
      ungrouped.push(...filtered);
    }

    let html = '';

    // Ungrouped items
    ungrouped.forEach(c => {
      html += renderConvoItem(c);
    });

    // Grouped items
    Object.keys(grouped).forEach(folderName => {
      const items = grouped[folderName];
      html += `<div class="ax-chat-folder">
        <div class="ax-chat-folder-header" data-folder="${folderName}">
          <svg class="folder-arrow open" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          ${folderName}
          <span class="folder-count">${items.length}</span>
        </div>
        <div class="ax-chat-folder-items">`;
      items.forEach(c => {
        html += renderConvoItem(c);
      });
      html += `</div></div>`;
    });

    els.convoList.innerHTML = html;

    // Re-bind click events
    els.convoList.querySelectorAll('.ax-convo-item').forEach(el => {
      const id = el.dataset.convoId;
      el.addEventListener('click', (e) => {
        // Don't trigger if clicking pin or delete
        if (e.target.closest('.convo-pin') || e.target.closest('.convo-delete')) return;
        setCurrentConversation(id);
        // Update active state
        els.convoList.querySelectorAll('.ax-convo-item').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
        // Dispatch event for playground to load messages
        global.dispatchEvent(new CustomEvent('ax-convo-select', { detail: { id } }));
      });
    });

    // Pin buttons
    els.convoList.querySelectorAll('.convo-pin').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        pinConversation(el.dataset.convoId);
      });
    });

    // Delete buttons
    els.convoList.querySelectorAll('.convo-delete').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = typeof confirmDialog === 'function'
          ? await confirmDialog('Delete this conversation?', { title: 'Delete conversation', confirmLabel: 'Delete', destructive: true })
          : confirm('Delete this conversation?');
        if (ok) {
          deleteConversation(el.dataset.convoId);
        }
      });
    });

    // Folder toggle
    els.convoList.querySelectorAll('.ax-chat-folder-header').forEach(el => {
      el.addEventListener('click', () => {
        const items = el.nextElementSibling;
        const arrow = el.querySelector('.folder-arrow');
        if (items) {
          items.classList.toggle('collapsed');
          if (arrow) arrow.classList.toggle('open');
        }
      });
    });
  }

  function renderConvoItem(c) {
    const isActive = c.id === currentId;
    const timeAgo = formatTimeAgo(c.updatedAt);
    return `<button class="ax-convo-item ${isActive ? 'active' : ''}" data-convo-id="${c.id}">
      <span class="convo-icon"><svg viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.5 8.5 0 01-8.9 8.49 8.63 8.63 0 01-3.9-.94L3 21l1.95-5.2a8.5 8.5 0 1116.05-4.3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span>
      <span class="convo-title">${highlightSearch(c.title)}</span>
      <span class="convo-meta">
        <span class="convo-pin ${c.pinned ? 'pinned' : ''}" data-convo-id="${c.id}">
          <svg viewBox="0 0 24 24" fill="${c.pinned ? '#FBBF24' : 'none'}"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        </span>
        <span class="convo-time">${timeAgo}</span>
      </span>
    </button>`;
  }

  function highlightSearch(text) {
    if (!filters.search.trim()) return escapeHtml(text);
    const q = filters.search.trim();
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    const before = escapeHtml(text.slice(0, idx));
    const match = escapeHtml(text.slice(idx, idx + q.length));
    const after = escapeHtml(text.slice(idx + q.length));
    return `${before}<span class="ax-search-highlight">${match}</span>${after}`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatTimeAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return mins + 'm';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h';
    const days = Math.floor(hours / 24);
    return days + 'd';
  }

  // ============================================================
  // MEMORY DISPLAY
  // ============================================================
  function renderMemory() {
    if (!els.memoryList) return;
    const brain = global.AxiomBrain;
    if (!brain) {
      els.memoryList.innerHTML = '<div class="ax-chat-memory-item"><span class="memory-text" style="color:rgba(255,255,255,.25);">Memory system inactive</span></div>';
      return;
    }
    const state = brain.getState();
    const count = state.memoryCount || 0;
    if (els.memoryCount) els.memoryCount.textContent = count;

    // Placeholder memory items
    const memories = [
      'User prefers concise responses',
      'Working on Axiom AI OS V13',
      'Uses VS Code with dark theme',
    ];
    let html = '';
    memories.slice(0, 3).forEach(m => {
      html += `<div class="ax-chat-memory-item">
        <span class="memory-dot"></span>
        <span class="memory-text">${m}</span>
      </div>`;
    });
    els.memoryList.innerHTML = html;
  }

  // ============================================================
  // ARTIFACT PANEL
  // ============================================================
  function openArtifact() {
    if (els.artifactPanel) els.artifactPanel.classList.add('open');
    if (els.artifactScrim) els.artifactScrim.classList.add('open');
  }

  function closeArtifact() {
    if (els.artifactPanel) els.artifactPanel.classList.remove('open');
    if (els.artifactScrim) els.artifactScrim.classList.remove('open');
  }

  function addArtifact(type, content, label) {
    if (!els.artifactBody) return;
    const card = document.createElement('div');
    card.className = 'ax-artifact-card';
    card.innerHTML = `
      <div class="artifact-card-head">
        <span class="artifact-type">${escapeHtml(type)}</span>
        <span class="artifact-actions">
          <button data-action="copy">Copy</button>
          <button data-action="download">Download</button>
        </span>
      </div>
      <div class="artifact-card-preview">${escapeHtml(content)}</div>`;
    els.artifactBody.appendChild(card);
    openArtifact();

    // Bind copy
    card.querySelector('[data-action="copy"]').addEventListener('click', () => {
      navigator.clipboard.writeText(content).catch(() => {});
    });
  }

  // ============================================================
  // IMAGE GENERATION MODAL
  // ============================================================
  function openImageGen() {
    if (els.imageGenModal) els.imageGenModal.classList.add('open');
  }

  function closeImageGen() {
    if (els.imageGenModal) els.imageGenModal.classList.remove('open');
  }

  // ============================================================
  // MATH / LATEX RENDERING
  // ============================================================
  function renderMathInElement(el) {
    if (global.renderMathInElement && global.katex) {
      try {
        global.renderMathInElement(el, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
            { left: '\\[', right: '\\]', display: true },
          ],
          throwOnError: false,
        });
      } catch (e) { /* ignore rendering errors */ }
    }
  }

  // ============================================================
  // SIDEBAR TOGGLE
  // ============================================================
  function toggleSidebar() {
    if (els.sidebar) {
      const isOpen = els.sidebar.classList.toggle('open');
      els.sidebar.classList.toggle('collapsed', !isOpen);
    }
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    cacheEls();
    loadConversations();

    // Ensure at least one conversation exists
    if (conversations.length === 0) {
      createConversation('Welcome to Axiom AI');
    } else {
      currentId = conversations[0].id;
    }

    renderSidebar();
    renderMemory();

    // ---- Event Bindings ----

    // Sidebar toggle
    if (els.sidebarToggle) {
      els.sidebarToggle.addEventListener('click', toggleSidebar);
    }

    // New chat button
    if (els.newChatBtn) {
      els.newChatBtn.addEventListener('click', () => {
        const convo = createConversation();
        global.dispatchEvent(new CustomEvent('ax-convo-select', { detail: { id: convo.id } }));
      });
    }

    // Search
    if (els.searchInput) {
      els.searchInput.addEventListener('input', () => {
        filters.search = els.searchInput.value;
        if (els.searchClear) {
          els.searchClear.classList.toggle('visible', filters.search.length > 0);
        }
        renderSidebar();
      });
    }

    if (els.searchClear) {
      els.searchClear.addEventListener('click', () => {
        if (els.searchInput) {
          els.searchInput.value = '';
          filters.search = '';
          els.searchClear.classList.remove('visible');
          renderSidebar();
        }
      });
    }

    // Tabs
    if (els.tabBtns) {
      els.tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          els.tabBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          filters.tab = btn.dataset.tab || 'all';
          renderSidebar();
        });
      });
    }

    // Artifact panel
    if (els.artifactToggle) {
      els.artifactToggle.addEventListener('click', () => {
        if (els.artifactPanel && els.artifactPanel.classList.contains('open')) {
          closeArtifact();
        } else {
          openArtifact();
        }
      });
    }

    if (els.artifactClose) {
      els.artifactClose.addEventListener('click', closeArtifact);
    }

    if (els.artifactScrim) {
      els.artifactScrim.addEventListener('click', closeArtifact);
    }

    // Image generation
    if (els.imageGenBtn) {
      els.imageGenBtn.addEventListener('click', openImageGen);
    }

    if (els.imageGenClose) {
      els.imageGenClose.addEventListener('click', closeImageGen);
    }

    if (els.imageGenForm) {
      els.imageGenForm.addEventListener('submit', (e) => {
        e.preventDefault();
        // Simulate generation
        if (els.imageGenResults) {
          els.imageGenResults.innerHTML = `
            <div class="gen-result-img generating">Generating...</div>
            <div class="gen-result-img generating">Generating...</div>`;
          setTimeout(() => {
            els.imageGenResults.innerHTML = '';
          }, 2000);
        }
      });
    }

    // Listen for AxiomBrain changes to update memory
    if (global.AxiomBrain) {
      global.AxiomBrain.on('change', renderMemory);
    }

    // Listen for artifact additions from chat
    global.addEventListener('ax-add-artifact', (e) => {
      if (e.detail) {
        addArtifact(e.detail.type || 'Code', e.detail.content || '', e.detail.label || '');
      }
    });

    global.addEventListener('ax-close-artifact', () => closeArtifact());

    console.log('[ChatCore] Initialized with', conversations.length, 'conversations');
  }

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Public API
  global.AxiomChatCore = {
    getConversations: () => conversations,
    getCurrent: getCurrentConversation,
    setCurrent: setCurrentConversation,
    create: createConversation,
    delete: deleteConversation,
    pin: pinConversation,
    update: updateConversation,
    getById: getConversation,
    setFolder: setConversationFolder,
    isSidebarOpen: () => els.sidebar ? els.sidebar.classList.contains('open') : false,
    toggleSidebar,
    openArtifact,
    closeArtifact,
    addArtifact,
    openImageGen,
    closeImageGen,
    renderMathInElement,
    save: saveConversations,
  };

})(window);

