// ============================================================
// AXIOM AI OS X — OS Shell Kernel
// Single entry point. Manages: dock, topbar, search, command,
// control center, notifications, window system, themes, motion
// ============================================================
(function() {
  'use strict';

  // ---- OS State ----
  const OS = {
    initialized: false,
    currentWorkspace: 'dashboard',
    dockItems: [],
    commands: [],
    searchItems: [],
    notifications: [],
    clockInterval: null,
  };

  // ---- PROGRESS BARS (data-progress -> --ax-progress custom property) ----
  function applyProgressBars() {
    document.querySelectorAll('[data-progress]').forEach(el => {
      const pct = parseFloat(el.dataset.progress) || 0;
      el.style.setProperty('--ax-progress', pct + '%');
    });
  }

  // ---- INIT ----
  function init() {
    if (OS.initialized) return;
    OS.initialized = true;

    applyProgressBars();
    buildDock();
    setupSearch();
    setupCommandPalette();
    setupControlCenter();
    setupNotifications();
    setupClock();
    setupQuickActions();
    setupTopbarInteractions();
    setupKnowledgeGraphMini();
    setupWidgetSimulation();
    setupKeyboardShortcuts();

    // Initialize motion
    if (window.AxiomMotion) {
      window.AxiomMotion.init();
    }

    // Set workspace manager container
    if (window.AxiomWorkspaceManager) {
      window.AxiomWorkspaceManager.setContainer(document.getElementById('axWorkspaceInner'));
    }

    // Milestone 2 — Step 1: persistent state. Re-open whichever workspace
    // windows were open the last time the OS Shell was used. Best-effort —
    // wrapped so a corrupt/old localStorage value can never block boot.
    try {
      const remembered = JSON.parse(localStorage.getItem('axiom-open-workspaces') || '[]');
      remembered.forEach(id => openWorkspace(id));
    } catch (e) { /* ignore malformed persisted state */ }

    console.log('[AXIOM OS] Initialized');
  }

  // ---- PERSISTENT STATE (open workspace set) ----
  function rememberOpenWorkspaces() {
    try {
      const open = window.AxiomWindowManager
        ? window.AxiomWindowManager.getAllWindows()
            .map(w => w.id)
            .filter(id => id.startsWith('ws-') && !id.startsWith('ws-dashboard'))
            .map(id => id.slice(3))
        : [];
      localStorage.setItem('axiom-open-workspaces', JSON.stringify(open));
    } catch (e) { /* storage may be unavailable (private mode, quota, etc.) */ }
  }

  // ---- DOCK ----
  function buildDock() {
    const dock = document.getElementById('axDock');
    if (!dock) return;

    const items = [
      // Core workspaces
      { id: 'dashboard', label: 'Mission Control', icon: 'os' },
      { id: 'chat', label: 'Chat', icon: 'chat' },
      { id: 'memory', label: 'Memory', icon: 'memory' },
      { id: 'analytics', label: 'Analytics', icon: 'analytics' },
      { id: 'browser', label: 'Browser', icon: 'browser' },
      { id: 'brain', label: 'AI Brain', icon: 'brain' },
      { id: 'voice', label: 'Voice', icon: 'voice' },
      { id: 'coding', label: 'Coding', icon: 'coding' },
      // Divider
      null,
      // More workspaces
      { id: 'files', label: 'Files', icon: 'files' },
      { id: 'image', label: 'Image', icon: 'image' },
      { id: 'video', label: 'Video', icon: 'video' },
      { id: 'audio', label: 'Audio', icon: 'audio' },
      { id: 'agents', label: 'Agents', icon: 'agents' },
      { id: 'marketplace', label: 'Marketplace', icon: 'marketplace' },
      { id: 'knowledge', label: 'Knowledge', icon: 'knowledge' },
      null,
      // System
      { id: 'calendar', label: 'Calendar', icon: 'calendar' },
      { id: 'projects', label: 'Projects', icon: 'projects' },
      { id: 'terminal', label: 'Terminal', icon: 'terminal' },
      { id: 'automation', label: 'Automation', icon: 'automation' },
      null,
      { id: 'settings', label: 'Settings', icon: 'settings' },
      { id: 'billing', label: 'Billing', icon: 'billing' },
    ];

    OS.dockItems = items.filter(i => i !== null);

    let html = '';
    items.forEach(item => {
      if (item === null) {
        html += '<div class="ax-dock-divider"></div>';
      } else {
        const iconSvg = window.AxiomIcons ? window.AxiomIcons.svg(item.icon, 18) : '';
        const active = item.id === OS.currentWorkspace ? ' active' : '';
        html += `<a href="#" class="ax-dock-item${active}" data-workspace="${item.id}" title="${item.label}">
          ${iconSvg}<span class="ax-dock-label">${item.label}</span></a>`;
      }
    });

    dock.innerHTML = html;

    // Click handlers
    dock.querySelectorAll('.ax-dock-item').forEach(el => {
      el.addEventListener('click', function(e) {
        e.preventDefault();
        const ws = this.dataset.workspace;
        if (ws) openWorkspace(ws);
      });
    });
  }

  function updateDockActive(workspaceId) {
    document.querySelectorAll('.ax-dock-item').forEach(el => {
      el.classList.toggle('active', el.dataset.workspace === workspaceId);
    });
  }

// ---- WORKSPACE MANAGER (Window System Integration) ----
  function openWorkspace(workspaceId) {
    OS.currentWorkspace = workspaceId;
    document.body.dataset.workspace = workspaceId;
    updateDockActive(workspaceId);

    // Update AI Core state based on workspace.
    // Milestone 3: routed through the canonical AxiomAIState manager
    // (ai-state-manager.js) instead of calling AxiomAICore directly, so
    // the OS shell's workspace context becomes one input into the single
    // source of truth rather than a second, independent state producer.
    // The workspace->state mapping itself now lives in ai-state-manager.js
    // (CONTEXT_TO_CANONICAL) so there is exactly one place that defines it.
    if (window.AxiomAIState) {
      window.AxiomAIState.setContext(workspaceId);
    } else if (window.AxiomAICore) {
      // Fallback if ai-state-manager.js isn't loaded on this page for any
      // reason — preserves the exact old behavior so nothing regresses.
      const legacyStateMap = {
        'chat': 'thinking', 'memory': 'memory', 'browser': 'researching',
        'coding': 'coding', 'brain': 'thinking', 'voice': 'listening',
        'image': 'generating', 'video': 'generating', 'audio': 'listening',
        'agents': 'thinking', 'analytics': 'idle', 'automation': 'automation',
        'knowledge': 'learning',
      };
      window.AxiomAICore.setState(legacyStateMap[workspaceId] || 'idle');
    }

    // If dashboard, show Mission Control (no window needed).
    // Mission Control is already live inside #axWorkspaceInner from page
    // load and is never removed when other workspaces open (those open
    // as separate floating windows via AxiomWindowManager), so there is
    // nothing to rebuild here — doing so used to blow away bound event
    // listeners and leak a detached canvas animation loop. See git history
    // / audit notes for Milestone 7 if this needs to change again.
    if (workspaceId === 'dashboard') {
      return;
    }

    const wsInfo = OS.dockItems.find(i => i.id === workspaceId);
    if (!wsInfo) return;

    // Open as a native OS window using WindowManager
    if (window.AxiomWindowManager) {
      // Map workspace to URL if available
      const wsUrls = {
        'chat': 'playground.html',
        'memory': 'memory.html',
        'browser': 'browser.html',
        'analytics': 'analytics.html',
        'automation': 'automation.html',
        'settings': 'settings.html',
        'billing': 'billing.html',
        'agents': 'agent-library.html',
        'coding': 'playground.html?mode=code',
      };

      const iframeSrc = wsUrls[workspaceId] || null;
      const iconSvg = window.AxiomIcons ? window.AxiomIcons.svg(wsInfo.icon, 14) : '';

      window.AxiomWindowManager.createWindow({
        id: 'ws-' + workspaceId,
        title: wsInfo.label,
        icon: wsInfo.icon,
        width: 800,
        height: 550,
        x: 80 + Math.random() * 60,
        y: 50 + Math.random() * 50,
        iframeSrc: iframeSrc,
        content: iframeSrc ? '' : `
          <div class="ax-workspace-fallback" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;padding:40px;">
            <div style="opacity:.3;">${window.AxiomIcons ? window.AxiomIcons.svg(wsInfo.icon, 48) : ''}</div>
            <h2 style="font-size:1.2rem;font-weight:600;color:var(--ax-text-2);">${wsInfo.label}</h2>
            <p style="color:var(--ax-text-3);max-width:360px;text-align:center;">This workspace is ready. Content will load here.</p>
          </div>
        `,
        onClose: () => rememberOpenWorkspaces(),
      });
      rememberOpenWorkspaces();
    }
  }

  // ---- SEARCH ----
  function setupSearch() {
    const overlay = document.getElementById('axSearchOverlay');
    const input = document.getElementById('axSearchInput');
    const results = document.getElementById('axSearchResults');
    const searchTrigger = document.getElementById('axTopbarSearch');
    const topbarInput = document.getElementById('topbarSearchInput');

    if (!overlay || !input || !results) return;

    const searchableItems = [
      ...OS.dockItems.map(i => ({ id: `ws-${i.id}`, title: i.label, category: 'Workspaces', icon: i.icon, action: () => openWorkspace(i.id) })),
      { id: 'cmd-new-chat', title: 'New Chat', category: 'Actions', icon: 'chat', action: () => openWorkspace('chat') },
      { id: 'cmd-new-memory', title: 'Add Memory', category: 'Actions', icon: 'memory', action: () => openWorkspace('memory') },
      { id: 'cmd-generate-image', title: 'Generate Image', category: 'Actions', icon: 'image', action: () => openWorkspace('image') },
      { id: 'cmd-analyze', title: 'View Analytics', category: 'Actions', icon: 'analytics', action: () => openWorkspace('analytics') },
      { id: 'cmd-browse', title: 'Open Browser', category: 'Actions', icon: 'browser', action: () => openWorkspace('browser') },
      { id: 'cmd-settings', title: 'Open Settings', category: 'Actions', icon: 'settings', action: () => openWorkspace('settings') },
      { id: 'cmd-billing', title: 'Go to Billing', category: 'Actions', icon: 'billing', action: () => openWorkspace('billing') },
    ];

    function toggleSearch() {
      const isOpen = overlay.classList.contains('open');
      if (isOpen) {
        overlay.classList.remove('open');
      } else {
        overlay.classList.add('open');
        setTimeout(() => input.focus(), 100);
        input.value = '';
        renderResults('');
      }
    }

    function renderResults(query) {
      const q = query.toLowerCase().trim();
      const filtered = q ? searchableItems.filter(i => 
        i.title.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)
      ) : searchableItems;

      if (filtered.length === 0) {
        results.innerHTML = '<div class="ax-search-empty">No results found</div>';
        return;
      }

      const categories = {};
      filtered.forEach(item => {
        if (!categories[item.category]) categories[item.category] = [];
        categories[item.category].push(item);
      });

      let html = '';
      Object.entries(categories).forEach(([cat, items]) => {
        html += `<div class="ax-search-category">${cat}</div>`;
        items.forEach(item => {
          const iconSvg = window.AxiomIcons ? window.AxiomIcons.svg(item.icon, 14) : '';
          html += `<div class="ax-search-item" data-id="${item.id}">
            <div class="ax-search-item-icon">${iconSvg}</div>
            <div class="ax-search-item-title">${item.title}</div>
            <div class="ax-search-item-cat">${item.category}</div>
          </div>`;
        });
      });
      results.innerHTML = html;

      results.querySelectorAll('.ax-search-item').forEach(el => {
        el.addEventListener('click', function() {
          const id = this.dataset.id;
          const item = searchableItems.find(i => i.id === id);
          if (item && item.action) {
            overlay.classList.remove('open');
            item.action();
          }
        });
      });
    }

    input.addEventListener('input', () => renderResults(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') overlay.classList.remove('open');
      if (e.key === 'Enter') {
        const first = results.querySelector('.ax-search-item');
        if (first) first.click();
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });

    // Search trigger
    if (searchTrigger) {
      searchTrigger.addEventListener('click', toggleSearch);
    }
    if (topbarInput) {
      topbarInput.addEventListener('click', toggleSearch);
    }

    window.AxiomSearch = { toggle: toggleSearch, open: () => overlay.classList.add('open'), close: () => overlay.classList.remove('open') };
  }

  // ---- COMMAND PALETTE ----
  function setupCommandPalette() {
    const overlay = document.getElementById('axCmdOverlay');
    const input = document.getElementById('axCmdInput');
    const results = document.getElementById('axCmdResults');
    const cmdHint = document.getElementById('axCmdHint');

    if (!overlay || !input || !results) return;

    const commands = [
      { id: 'cmd-dashboard', title: 'Go to Mission Control', icon: 'os', shortcut: 'G D', action: () => openWorkspace('dashboard') },
      { id: 'cmd-chat', title: 'Open AI Chat', icon: 'chat', shortcut: 'G C', action: () => openWorkspace('chat') },
      { id: 'cmd-memory', title: 'Open Memory', icon: 'memory', shortcut: 'G M', action: () => openWorkspace('memory') },
      { id: 'cmd-browser', title: 'Open Browser', icon: 'browser', shortcut: 'G B', action: () => openWorkspace('browser') },
      { id: 'cmd-coding', title: 'Open Coding', icon: 'coding', shortcut: 'G O', action: () => openWorkspace('coding') },
      { id: 'cmd-analytics', title: 'View Analytics', icon: 'analytics', shortcut: 'G A', action: () => openWorkspace('analytics') },
      { id: 'cmd-voice', title: 'Voice Mode', icon: 'voice', shortcut: 'G V', action: () => openWorkspace('voice') },
      { id: 'cmd-image', title: 'Image Studio', icon: 'image', shortcut: 'G I', action: () => openWorkspace('image') },
      { id: 'cmd-settings', title: 'Settings', icon: 'settings', shortcut: 'G S', action: () => openWorkspace('settings') },
      { id: 'cmd-search', title: 'Universal Search', icon: 'search', shortcut: '⌘K', action: () => { if (window.AxiomSearch) window.AxiomSearch.open(); } },
      { id: 'cmd-theme', title: 'Cycle Theme', icon: 'moon', shortcut: 'T T', action: () => cycleTheme() },
    ];

    let selectedIndex = -1;

    function toggle() {
      const isOpen = overlay.classList.contains('open');
      if (isOpen) {
        overlay.classList.remove('open');
      } else {
        overlay.classList.add('open');
        setTimeout(() => input.focus(), 80);
        input.value = '';
        selectedIndex = -1;
        render('');
      }
    }

    function render(query) {
      const q = query.toLowerCase().trim();
      const filtered = q ? commands.filter(c => 
        c.title.toLowerCase().includes(q) || c.shortcut.toLowerCase().includes(q)
      ) : commands;

      selectedIndex = -1;
      if (filtered.length === 0) {
        results.innerHTML = '<div style="padding:24px;text-align:center;color:var(--ax-text-3);font-size:.8rem;">No commands found</div>';
        return;
      }

      let currentCat = '';
      let html = '';
      filtered.forEach(cmd => {
        const cat = cmd.id.startsWith('cmd-') ? 'Commands' : 'Actions';
        if (cat !== currentCat) {
          currentCat = cat;
          html += `<div class="ax-search-category">${cat}</div>`;
        }
        const iconSvg = window.AxiomIcons ? window.AxiomIcons.svg(cmd.icon, 13) : '';
        html += `<div class="ax-cmd-item" data-id="${cmd.id}">
          <div class="ax-cmd-item-icon">${iconSvg}</div>
          <span class="ax-cmd-item-title">${cmd.title}</span>
          <kbd class="ax-cmd-item-shortcut">${cmd.shortcut}</kbd>
        </div>`;
      });
      results.innerHTML = html;

      results.querySelectorAll('.ax-cmd-item').forEach(el => {
        el.addEventListener('mouseenter', function() {
          const all = results.querySelectorAll('.ax-cmd-item');
          all.forEach((e, i) => { e.classList.toggle('selected', e === this); if (e === this) selectedIndex = i; });
        });
        el.addEventListener('click', function() {
          const id = this.dataset.id;
          const cmd = commands.find(c => c.id === id);
          if (cmd && cmd.action) { overlay.classList.remove('open'); cmd.action(); }
        });
      });
    }

    input.addEventListener('input', () => render(input.value));
    input.addEventListener('keydown', (e) => {
      const items = results.querySelectorAll('.ax-cmd-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        items.forEach((el, i) => el.classList.toggle('selected', i === selectedIndex));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        items.forEach((el, i) => el.classList.toggle('selected', i === selectedIndex));
      } else if (e.key === 'Enter') {
        const item = items[selectedIndex];
        if (item) item.click();
      } else if (e.key === 'Escape') {
        overlay.classList.remove('open');
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });

    if (cmdHint) cmdHint.addEventListener('click', toggle);

    window.AxiomCommandPalette = { toggle, open: () => overlay.classList.add('open'), close: () => overlay.classList.remove('open') };
  }

  // ---- CONTROL CENTER ----
  function setupControlCenter() {
    const panel = document.getElementById('axControlCenter');
    const btn = document.getElementById('axControlCenterBtn');
    const themeSelect = document.getElementById('ccThemeSelect');

    if (!panel || !btn) return;

    btn.addEventListener('click', () => {
      const isOpen = panel.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(isOpen));
      document.getElementById('axNotifPanel')?.classList.remove('open');
      document.getElementById('axNotifTrigger')?.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        panel.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });

    // Theme selector
    if (themeSelect && window.AxiomThemeEngine) {
      themeSelect.value = window.AxiomThemeEngine.getTheme();
      themeSelect.addEventListener('change', () => {
        window.AxiomThemeEngine.applyTheme(themeSelect.value);
      });
    }

    // Volume + Brightness sliders. Previously only the first .ax-cc-slider
    // in the DOM (Volume) ever got a listener because querySelector()
    // returns a single element — Brightness was completely dead.
    panel.querySelectorAll('.ax-cc-slider').forEach(slider => {
      const labelId = slider.getAttribute('aria-labelledby');
      const label = labelId ? document.getElementById(labelId) : null;
      const baseName = label ? label.textContent.replace(/\s*\(\d+%\)$/, '') : '';
      slider.addEventListener('input', () => {
        if (label) label.textContent = `${baseName} (${slider.value}%)`;
      });
    });
  }

  // ---- NOTIFICATIONS ----
  function setupNotifications() {
    const panel = document.getElementById('axNotifPanel');
    const btn = document.getElementById('axNotifTrigger');
    const dot = document.getElementById('axNotifDot');
    const list = document.getElementById('axNotifList');
    const clearBtn = document.getElementById('axNotifClear');

    if (!panel || !btn || !list) return;

    const sampleNotifs = [
      { id: 1, icon: 'brain', title: 'AI Analysis Complete', msg: 'Your document analysis has finished.', time: '2m ago', read: false },
      { id: 2, icon: 'files', title: 'File Uploaded', msg: 'Project brief.pdf uploaded.', time: '8m ago', read: false },
      { id: 3, icon: 'automation', title: 'Workflow Complete', msg: 'Weekly report generated.', time: '15m ago', read: false },
      { id: 4, icon: 'chat', title: 'New Message', msg: 'Research Agent completed analysis.', time: '32m ago', read: true },
      { id: 5, icon: 'billing', title: 'Plan Renewed', msg: 'Studio Pro plan renewed.', time: '1d ago', read: true },
    ];

    OS.notifications = sampleNotifs;

    function render() {
      const unread = OS.notifications.filter(n => !n.read).length;
      if (dot) dot.classList.toggle('show', unread > 0);

      if (OS.notifications.length === 0) {
        list.innerHTML = '<div class="ax-notif-empty">No notifications</div>';
        return;
      }

      let html = '';
      OS.notifications.forEach(n => {
        const iconSvg = window.AxiomIcons ? window.AxiomIcons.svg(n.icon, 13) : '';
        html += `<div class="ax-notif-item${n.read ? '' : ' unread'}">
          <div class="ax-notif-icon">${iconSvg}</div>
          <div class="ax-notif-body">
            <div class="ax-notif-title">${n.title}</div>
            <div class="ax-notif-msg">${n.msg}</div>
          </div>
          <span class="ax-notif-time">${n.time}</span>
        </div>`;
      });
      list.innerHTML = html;
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = panel.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(isOpen));
      document.getElementById('axControlCenter')?.classList.remove('open');
      document.getElementById('axControlCenterBtn')?.setAttribute('aria-expanded', 'false');
      render();
    });

    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        panel.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        OS.notifications = [];
        render();
      });
    }

    render();
  }

  // ---- CLOCK ----
  function setupClock() {
    const display = document.getElementById('axTimeDisplay');
    const widgetClock = document.getElementById('widgetClock');
    const widgetDate = document.getElementById('widgetClockDate');
    const greeting = document.getElementById('axMcTimeGreeting');

    function update() {
      const now = new Date();
      const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const hour = now.getHours();
      let greet = 'Good Evening';
      if (hour < 12) greet = 'Good Morning';
      else if (hour < 17) greet = 'Good Afternoon';

      if (display) display.textContent = time;
      if (widgetClock) widgetClock.textContent = time;
      if (widgetDate) widgetDate.textContent = date;
      if (greeting) greeting.textContent = greet;
    }

    update();
    OS.clockInterval = setInterval(update, 30000);
  }

  // ---- QUICK ACTIONS ----
  const QA_LABELS = { chat: 'Chat', image: 'Image', memory: 'Memory', browser: 'Browser' };

  function setupQuickActions() {
    document.querySelectorAll('.ax-qa-btn').forEach(btn => {
      // Fill in icon + label (markup only carries data-action + aria-label).
      if (!btn.dataset.rendered) {
        const action = btn.dataset.action;
        const iconSvg = window.AxiomIcons ? window.AxiomIcons.svg(action, 18) : '';
        btn.innerHTML = `${iconSvg}<span>${QA_LABELS[action] || action}</span>`;
        btn.dataset.rendered = 'true';
      }
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        const action = this.dataset.action;
        if (action) openWorkspace(action);
      });
    });

    // "Suggested" buttons in the AI Companion panel — previously rendered
    // with no click handler at all (dead UI). Route them the same way as
    // every other navigation control on this page.
    document.querySelectorAll('.ax-acc-suggestion').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        const ws = this.dataset.workspace;
        if (ws) openWorkspace(ws);
      });
    });
  }

  // ---- TOPBAR INTERACTIONS ----
  function setupTopbarInteractions() {
    // Model badge click
    const modelBadge = document.querySelector('.ax-topbar-model');
    if (modelBadge) {
      modelBadge.addEventListener('click', () => {
        // Cycle through some AI states for demo — routed through the
        // canonical AxiomAIState manager (Milestone 3) so this demo
        // control exercises the same single source of truth as real
        // conversation/context signals, instead of poking AxiomAICore
        // directly.
        const states = ['idle', 'thinking', 'listening', 'researching', 'coding', 'vision'];
        const current = window.AxiomAIState ? window.AxiomAIState.getState() : (window.AxiomAICore ? window.AxiomAICore.getState() : 'idle');
        const idx = states.indexOf(current);
        const next = states[(idx + 1) % states.length];
        if (window.AxiomAIState) window.AxiomAIState.setState(next, { source: 'demo' });
        else if (window.AxiomAICore) window.AxiomAICore.setState(next);
      });
    }

    // Avatar click
    const avatar = document.getElementById('axProfileBtn');
    if (avatar) {
      avatar.addEventListener('click', () => openWorkspace('settings'));
    }
  }

  // ---- KNOWLEDGE GRAPH MINI ----
  function setupKnowledgeGraphMini() {
    const canvas = document.getElementById('axWidgetKnowledgeCanvas');
    if (!canvas) return;
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = 80 * 2;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = '80px';

    const nodes = [];
    for (let i = 0; i < 20; i++) {
      nodes.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        r: Math.random() * 3 + 2,
      });
    }

    let rafId = null;

    function drawGraph() {
      if (document.hidden) { rafId = null; return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw connections
      ctx.strokeStyle = 'rgba(255,255,255,.04)';
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw nodes
      nodes.forEach(n => {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > canvas.width) n.vx *= -1;
        if (n.y < 0 || n.y > canvas.height) n.vy *= -1;

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,.15)';
        ctx.fill();
      });

      rafId = requestAnimationFrame(drawGraph);
    }

    if (reduceMotion) {
      // One static frame — no continuous particle drift.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      nodes.forEach(n => {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,.15)';
        ctx.fill();
      });
      return;
    }

    drawGraph();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && rafId === null) drawGraph();
    });
  }

  // ---- WIDGET SIMULATION ----
  // NOTE: #axDbWidgets ("Widgets rendered by JS") previously stayed
  // permanently empty — this function only ever *updated* elements like
  // #widgetCpu / #widgetCpuBar, but nothing on the page ever created
  // them, so the whole right-hand System Widgets panel rendered blank.
  // renderWidgetShells() builds the actual .ax-widget cards (reusing the
  // existing .ax-widget/.ax-widget-bar design-system CSS) once, and the
  // interval below only ever touches text/width on those existing nodes.
  const WIDGET_DEFS = [
    { id: 'cpu', icon: 'cpu', label: 'CPU' },
    { id: 'ram', icon: 'memory', label: 'Memory' },
    { id: 'gpu', icon: 'gpu', label: 'GPU' },
    { id: 'storage', icon: 'storage', label: 'Storage' },
    { id: 'network', icon: 'network', label: 'Network' },
    { id: 'battery', icon: 'battery', label: 'Battery' },
    { id: 'brain', icon: 'brain', label: 'AI Brain' },
  ];

  function renderWidgetShells() {
    const container = document.getElementById('axDbWidgets');
    if (!container || container.dataset.rendered) return;

    container.innerHTML = WIDGET_DEFS.map(w => {
      const iconSvg = window.AxiomIcons ? window.AxiomIcons.svg(w.icon, 14) : '';
      const valueId = w.id === 'brain' ? 'widgetBrainState' : `widget${w.id[0].toUpperCase()}${w.id.slice(1)}`;
      const barId = w.id === 'brain' ? 'widgetBrainBar' : `widget${w.id[0].toUpperCase()}${w.id.slice(1)}Bar`;
      return `<div class="ax-widget">
        <div class="ax-widget-head">
          <div class="ax-widget-icon">${iconSvg}</div>
          <div class="ax-widget-label">${w.label}</div>
        </div>
        <div class="ax-widget-body">
          <div class="ax-widget-value" id="${valueId}">—</div>
          <div class="ax-widget-bar"><div class="ax-widget-bar-fill" id="${barId}" style="width:0%"></div></div>
        </div>
      </div>`;
    }).join('');
    container.dataset.rendered = 'true';
  }

  function setupWidgetSimulation() {
    renderWidgetShells();

    // Simulate changing values
    function updateWidget(id, value, barId, pct) {
      const el = document.getElementById(id);
      const bar = document.getElementById(barId);
      if (el) el.textContent = value;
      if (bar) bar.style.width = (pct != null ? pct : parseFloat(value)) + '%';
    }

    let simTimer = null;

    function tick() {
      const cpu = Math.floor(Math.random() * 60) + 15;
      const ram = Math.floor(Math.random() * 40) + 30;
      const gpu = Math.floor(Math.random() * 50) + 20;
      const storage = Math.floor(Math.random() * 20) + 30;
      const network = Math.floor(Math.random() * 50) + 10;
      const battery = Math.max(5, parseInt(document.getElementById('widgetBattery')?.textContent || '85') - Math.floor(Math.random() * 3));

      updateWidget('widgetCpu', cpu + '%', 'widgetCpuBar', cpu);
      updateWidget('widgetRam', (ram / 10).toFixed(1) + ' GB', 'widgetRamBar', ram);
      updateWidget('widgetGpu', gpu + '%', 'widgetGpuBar', gpu);
      updateWidget('widgetStorage', (storage * 10) + ' GB', 'widgetStorageBar', storage);
      updateWidget('widgetNetwork', (network + 5) + ' Mbps', 'widgetNetworkBar', network + 5 > 100 ? 100 : network + 5);
      updateWidget('widgetBattery', battery + '%', 'widgetBatteryBar', battery);

      // Brain state simulation
      const brainStates = ['Idle', 'Thinking', 'Processing', 'Learning'];
      const brainEl = document.getElementById('widgetBrainState');
      const brainPct = Math.floor(Math.random() * 60 + 20);
      if (brainEl) brainEl.textContent = brainStates[Math.floor(Math.random() * brainStates.length)];
      const brainBar = document.getElementById('widgetBrainBar');
      if (brainBar) brainBar.style.width = brainPct + '%';
    }

    function start() {
      if (simTimer) return;
      tick();
      simTimer = setInterval(tick, 3000);
    }
    function stop() {
      if (!simTimer) return;
      clearInterval(simTimer);
      simTimer = null;
    }

    // Perf: don't burn CPU updating a panel nobody can see (background tab).
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop(); else start();
    });

    start();
  }

  // ---- KEYBOARD SHORTCUTS ----
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Cmd+K or Ctrl+K: Search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (window.AxiomSearch) window.AxiomSearch.toggle();
      }
      // Cmd+Shift+K or Ctrl+Shift+K: Command Palette
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        if (window.AxiomCommandPalette) window.AxiomCommandPalette.toggle();
      }
      // Escape: close overlays
      if (e.key === 'Escape') {
        document.getElementById('axSearchOverlay')?.classList.remove('open');
        document.getElementById('axCmdOverlay')?.classList.remove('open');
        document.getElementById('axControlCenter')?.classList.remove('open');
        document.getElementById('axNotifPanel')?.classList.remove('open');
        document.getElementById('axControlCenterBtn')?.setAttribute('aria-expanded', 'false');
        document.getElementById('axNotifTrigger')?.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ---- THEME CYCLER ----
  function cycleTheme() {
    if (!window.AxiomThemeEngine) return;
    const themes = window.AxiomThemeEngine.getAllThemes();
    const current = window.AxiomThemeEngine.getTheme();
    const idx = themes.findIndex(t => t.id === current);
    const next = themes[(idx + 1) % themes.length];
    window.AxiomThemeEngine.applyTheme(next.id);
    const select = document.getElementById('ccThemeSelect');
    if (select) select.value = next.id;
  }

  // ---- EXPOSE ----
  window.AxiomOS = {
    init,
    openWorkspace,
    getCurrentWorkspace: () => OS.currentWorkspace,
    cycleTheme,
    dockItems: () => OS.dockItems,
  };

  // ---- AUTO-INIT ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
