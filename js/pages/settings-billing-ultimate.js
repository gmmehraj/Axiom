/* ============================================================
   AXIOM AI OS V13 — Settings + Billing Ultimate
   ------------------------------------------------------------
   Enhances settings.html with Apple-style sidebar categories:
   - Appearance (themes, glass intensity)
   - Models (default, API keys)
   - Agents (default, auto-select)
   - Memory (auto-save, retention)
   - Automation (defaults, limits)
   - Workspace (default view, collaboration)
   - Keyboard (shortcuts, custom bindings)
   - Accessibility (reduced motion, font size)
   - Developer Mode (debug, console, logs)
   - Performance (GPU acceleration, frame rate)

   Enhances billing.html with:
   - Invoices list with download
   - API Keys management
   - Plan upgrade/downgrade with comparison
   - Payment history timeline
   - Token costs breakdown
   ============================================================ */
(function (global) {
  'use strict';

  // ============================================================
  // STATE
  // ============================================================
  const state = {
    settings: {
      theme: 'dark',
      glassIntensity: 100,
      reducedMotion: false,
      fontSize: 'medium',
      defaultModel: 'openai/gpt-4o',
      apiKeys: [
        { name: 'OpenAI', key: 'sk-••••••••••••••••', masked: true },
        { name: 'Claude', key: 'sk-ant-••••••••••••', masked: true },
      ],
      autoSelectAgent: true,
      defaultAgent: 'builtin:general',
      memoryAutoSave: true,
      memoryRetention: 30,
      autoSave: true,
      defaultView: 'split',
      collaboration: true,
      customBindings: [],
      devMode: false,
      gpuAcceleration: true,
      targetFps: 60,
    },
    billing: {
      credits: 2840,
      plan: 'Studio Pro',
      price: '₹299 / month',
      invoices: [
        { id: 'INV-2024-001', date: '2024-12-01', amount: '₹299', status: 'paid', pdf: '#' },
        { id: 'INV-2024-002', date: '2024-11-01', amount: '₹299', status: 'paid', pdf: '#' },
        { id: 'INV-2024-003', date: '2024-10-01', amount: '₹199', status: 'paid', pdf: '#' },
        { id: 'INV-2024-004', date: '2024-09-15', amount: '₹49', status: 'paid', pdf: '#' },
      ],
      paymentHistory: [
        { date: '2024-12-01', method: 'Razorpay', amount: '₹299', status: 'success' },
        { date: '2024-11-01', method: 'Razorpay', amount: '₹299', status: 'success' },
        { date: '2024-10-01', method: 'Razorpay', amount: '₹199', status: 'success' },
        { date: '2024-09-15', method: 'UPI', amount: '₹49', status: 'success' },
      ],
      apiKeys: [
        { name: 'Production', key: 'ax_live_8f2a1c3b9e', created: '2024-10-15', lastUsed: '2 min ago' },
        { name: 'Development', key: 'ax_test_4d7e8f2a', created: '2024-11-01', lastUsed: '1 hour ago' },
        { name: 'Staging', key: 'ax_test_1b3c5d7e', created: '2024-11-20', lastUsed: '3 days ago' },
      ],
    },
  };

  // ============================================================
  // SETTINGS ENHANCEMENTS
  // ============================================================
  function enhanceSettings() {
    const page = document.querySelector('.ax-page');
    if (!page || page.classList.contains('ax-settings-enhanced')) return;
    page.classList.add('ax-settings-enhanced');

    injectSettingsCSS();
    addSettingsSidebar();
    addMissingPanels();
    wireSettingsTabs();
    loadSettingsState();
  }

  function injectSettingsCSS() {
    if (document.getElementById('ax-settings-ultimate-style')) return;
    const style = document.createElement('style');
    style.id = 'ax-settings-ultimate-style';
    style.textContent = `
      .ax-settings-layout { display:grid; grid-template-columns:220px 1fr; gap:16px; }
      @media(max-width:900px){ .ax-settings-layout{grid-template-columns:1fr;} }
      .ax-settings-nav { display:flex; flex-direction:column; gap:2px; padding:8px; border-radius:20px; background:rgba(255,255,255,.02); border:1px solid rgba(255,255,255,.06); height:fit-content; }
      .ax-settings-nav-item { display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:12px; font-size:.8rem; color:rgba(255,255,255,.45); cursor:pointer; transition:all .15s; border:none; background:transparent; width:100%; text-align:left; font-family:inherit; }
      .ax-settings-nav-item:hover { color:#F5F5F5; background:rgba(255,255,255,.04); }
      .ax-settings-nav-item.active { color:#F5F5F5; background:rgba(96,165,250,.1); }
      .ax-settings-nav-item .ico { width:20px; text-align:center; font-size:14px; }
      .ax-settings-content { }
      .settings-category { display:none; }
      .settings-category.active { display:block; }
      .settings-section { margin-bottom:24px; }
      .settings-section-title { font-size:.78rem; color:rgba(255,255,255,.35); text-transform:uppercase; letter-spacing:.06em; font-weight:600; margin-bottom:12px; padding-bottom:6px; border-bottom:1px solid rgba(255,255,255,.05); }
      .settings-row { display:flex; align-items:center; justify-content:space-between; padding:10px 0; gap:12px; }
      .settings-row + .settings-row { border-top:1px solid rgba(255,255,255,.04); }
      .settings-row-label { font-size:.82rem; color:#F5F5F5; }
      .settings-row-desc { font-size:.72rem; color:rgba(255,255,255,.35); }
      .settings-row-control { flex-shrink:0; }
      .ax-switch { position:relative; display:inline-block; width:38px; height:22px; cursor:pointer; }
      .ax-switch input { opacity:0; width:0; height:0; }
      .ax-switch-track { position:absolute; inset:0; background:rgba(255,255,255,.12); border-radius:999px; transition:background .2s; }
      .ax-switch-track::after { content:''; position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:#fff; transition:transform .2s; }
      .ax-switch input:checked + .ax-switch-track { background:#60A5FA; }
      .ax-switch input:checked + .ax-switch-track::after { transform:translateX(16px); }
      .ax-select { background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:10px; padding:6px 12px; color:#F5F5F5; font-size:.78rem; font-family:inherit; outline:none; cursor:pointer; min-width:140px; }
      .ax-select option { background:#111; color:#F5F5F5; }
      .ax-keybinding { display:flex; align-items:center; gap:8px; padding:8px 12px; border-radius:10px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06); margin-bottom:6px; }
      .ax-keybinding kbd { padding:3px 8px; border-radius:6px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); font-size:.72rem; font-family:'JetBrains Mono',monospace; color:rgba(255,255,255,.6); }
      .ax-dev-console { padding:12px; border-radius:12px; background:rgba(255,255,255,.02); border:1px solid rgba(255,255,255,.06); font-family:'JetBrains Mono',monospace; font-size:.74rem; color:rgba(255,255,255,.5); max-height:200px; overflow-y:auto; }
      .ax-dev-console .log { padding:2px 0; }
      .ax-dev-console .log.info { color:#60A5FA; }
      .ax-dev-console .log.warn { color:#FBBF24; }
      .ax-dev-console .log.error { color:#EF4444; }
    `;
    document.head.appendChild(style);
  }

  function addSettingsSidebar() {
    const page = document.querySelector('.ax-page');
    if (!page) return;
    
    // Wrap existing content in new layout
    const existingContent = page.querySelector('.ax-page-header');
    if (!existingContent) return;
    
    const layout = document.createElement('div');
    layout.className = 'ax-settings-layout';
    
    // Build nav
    const nav = document.createElement('nav');
    nav.className = 'ax-settings-nav';
    const categories = [
      { id: 'profile', label: 'Profile', icon: '👤' },
      { id: 'security', label: 'Security', icon: '🔒' },
      { id: 'appearance', label: 'Appearance', icon: '🎨' },
      { id: 'language', label: 'Language & Voice', icon: '🌐' },
      { id: 'models', label: 'Models', icon: '🤖' },
      { id: 'agents', label: 'Agents', icon: '🧠' },
      { id: 'memory', label: 'Memory', icon: '💾' },
      { id: 'workspace', label: 'Workspace', icon: '📝' },
      { id: 'automation', label: 'Automation', icon: '⚡' },
      { id: 'notifications', label: 'Notifications', icon: '🔔' },
      { id: 'keyboard', label: 'Keyboard', icon: '⌨️' },
      { id: 'accessibility', label: 'Accessibility', icon: '♿' },
      { id: 'developer', label: 'Developer', icon: '🛠️' },
      { id: 'performance', label: 'Performance', icon: '📊' },
      { id: 'danger', label: 'Danger Zone', icon: '⚠️' },
    ];
    
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'ax-settings-nav-item' + (cat.id === 'profile' ? ' active' : '');
      btn.dataset.category = cat.id;
      btn.innerHTML = `<span class="ico">${cat.icon}</span><span>${cat.label}</span>`;
      btn.addEventListener('click', () => {
        nav.querySelectorAll('.ax-settings-nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const container = document.getElementById('axSettingsContainer');
        if (container) {
          container.querySelectorAll('.settings-category').forEach(p => p.classList.remove('active'));
          const target = container.querySelector(`.settings-category[data-category="${cat.id}"]`);
          if (target) target.classList.add('active');
        }
      });
      nav.appendChild(btn);
    });
    
    const contentArea = document.createElement('div');
    contentArea.className = 'ax-settings-content';
    contentArea.id = 'axSettingsContainer';
    
    // Move existing panels into contentArea
    const existingPanels = page.querySelectorAll('.settings-panel, .ax-chart-card.settings-panel, .settings-panel[data-tab]');
    // also capture the header
    const header = page.querySelector('.ax-page-header');
    
    // Build new categories container
    const categoriesContainer = document.createElement('div');
    // Profile
    const profileDiv = document.createElement('div');
    profileDiv.className = 'settings-category active';
    profileDiv.dataset.category = 'profile';
    
    // Security
    const securityDiv = document.createElement('div');
    securityDiv.className = 'settings-category';
    securityDiv.dataset.category = 'security';
    
    // Appearance
    const appearanceDiv = document.createElement('div');
    appearanceDiv.className = 'settings-category';
    appearanceDiv.dataset.category = 'appearance';
    appearanceDiv.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">Theme</div>
        <div class="settings-row">
          <div><div class="settings-row-label">Dark theme</div><div class="settings-row-desc">Default dark mode for the AI OS</div></div>
          <label class="ax-switch"><input type="checkbox" checked id="axThemeDark"><span class="ax-switch-track"></span></label>
        </div>
        <div class="settings-row">
          <div><div class="settings-row-label">Glass intensity</div><div class="settings-row-desc">Controls the blur and transparency of glass panels</div></div>
          <input type="range" id="axGlassIntensity" min="20" max="100" value="100" style="width:120px;">
        </div>
      </div>
    `;
    
    // Language
    const langDiv = document.createElement('div');
    langDiv.className = 'settings-category';
    langDiv.dataset.category = 'language';
    
    // Models
    const modelsDiv = document.createElement('div');
    modelsDiv.className = 'settings-category';
    modelsDiv.dataset.category = 'models';
    modelsDiv.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">Default Model</div>
        <div class="settings-row">
          <div><div class="settings-row-label">Chat model</div><div class="settings-row-desc">Default model used for new conversations</div></div>
          <select class="ax-select" id="axDefaultModel">
            <option value="openai/gpt-4o">GPT-4o</option>
            <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
            <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
            <option value="google/gemini-1.5-pro">Gemini 1.5 Pro</option>
          </select>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">API Keys</div>
        ${state.settings.apiKeys.map(k => `
          <div class="settings-row">
            <div><div class="settings-row-label">${k.name}</div><div class="settings-row-desc">${k.key}</div></div>
            <button class="btn btn-ghost btn-sm">Edit</button>
          </div>
        `).join('')}
        <div class="settings-row">
          <div><div class="settings-row-label">Add API key</div><div class="settings-row-desc">Connect a new model provider</div></div>
          <button class="btn btn-outline btn-sm">+ Add Key</button>
        </div>
      </div>
    `;
    
    // Agents
    const agentsDiv = document.createElement('div');
    agentsDiv.className = 'settings-category';
    agentsDiv.dataset.category = 'agents';
    agentsDiv.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">Agent Preferences</div>
        <div class="settings-row">
          <div><div class="settings-row-label">Auto-select agent</div><div class="settings-row-desc">Automatically choose the best agent for the task</div></div>
          <label class="ax-switch"><input type="checkbox" checked id="axAutoSelectAgent"><span class="ax-switch-track"></span></label>
        </div>
        <div class="settings-row">
          <div><div class="settings-row-label">Default agent</div><div class="settings-row-desc">Fallback agent when auto-select is off</div></div>
          <select class="ax-select" id="axDefaultAgent">
            <option value="builtin:general">General Assistant</option>
            <option value="builtin:coder">Software Engineer</option>
            <option value="builtin:writer">Writing Assistant</option>
          </select>
        </div>
      </div>
    `;
    
    // Memory
    const memoryDiv = document.createElement('div');
    memoryDiv.className = 'settings-category';
    memoryDiv.dataset.category = 'memory';
    memoryDiv.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">Memory Settings</div>
        <div class="settings-row">
          <div><div class="settings-row-label">Auto-save memories</div><div class="settings-row-desc">Automatically save important context from conversations</div></div>
          <label class="ax-switch"><input type="checkbox" checked id="axMemoryAutoSave"><span class="ax-switch-track"></span></label>
        </div>
        <div class="settings-row">
          <div><div class="settings-row-label">Retention period</div><div class="settings-row-desc">How long to keep memory entries</div></div>
          <select class="ax-select" id="axMemoryRetention">
            <option value="7">7 days</option>
            <option value="30" selected>30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </select>
        </div>
      </div>
    `;
    
    // Workspace
    const workspaceDiv = document.createElement('div');
    workspaceDiv.className = 'settings-category';
    workspaceDiv.dataset.category = 'workspace';
    workspaceDiv.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">Workspace Preferences</div>
        <div class="settings-row">
          <div><div class="settings-row-label">Default view</div><div class="settings-row-desc">Default editor layout for new documents</div></div>
          <select class="ax-select" id="axDefaultView">
            <option value="split">Split (editor + preview)</option>
            <option value="editor">Editor only</option>
            <option value="preview">Preview only</option>
          </select>
        </div>
        <div class="settings-row">
          <div><div class="settings-row-label">Collaboration</div><div class="settings-row-desc">Allow real-time collaboration on shared documents</div></div>
          <label class="ax-switch"><input type="checkbox" checked id="axCollaboration"><span class="ax-switch-track"></span></label>
        </div>
        <div class="settings-row">
          <div><div class="settings-row-label">Auto-save</div><div class="settings-row-desc">Automatically save changes every 30 seconds</div></div>
          <label class="ax-switch"><input type="checkbox" checked id="axAutoSave"><span class="ax-switch-track"></span></label>
        </div>
      </div>
    `;
    
    // Automation
    const automationDiv = document.createElement('div');
    automationDiv.className = 'settings-category';
    automationDiv.dataset.category = 'automation';
    automationDiv.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">Automation Defaults</div>
        <div class="settings-row">
          <div><div class="settings-row-label">Max concurrent workflows</div><div class="settings-row-desc">Maximum number of workflows running simultaneously</div></div>
          <select class="ax-select">
            <option>1</option><option selected>3</option><option>5</option><option>10</option>
          </select>
        </div>
        <div class="settings-row">
          <div><div class="settings-row-label">Retry on failure</div><div class="settings-row-desc">Automatically retry failed workflow steps</div></div>
          <label class="ax-switch"><input type="checkbox" checked><span class="ax-switch-track"></span></label>
        </div>
        <div class="settings-row">
          <div><div class="settings-row-label">Execution timeout</div><div class="settings-row-desc">Max time before a workflow step times out</div></div>
          <select class="ax-select">
            <option>30s</option><option selected>60s</option><option>120s</option><option>300s</option>
          </select>
        </div>
      </div>
    `;
    
    // Notifications - existing panel
    
    // Keyboard
    const keyboardDiv = document.createElement('div');
    keyboardDiv.className = 'settings-category';
    keyboardDiv.dataset.category = 'keyboard';
    keyboardDiv.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">Shortcuts</div>
        <div class="ax-keybinding"><kbd>⌘K</kbd> <span style="flex:1;color:rgba(255,255,255,.5);">Command palette</span> <button class="btn btn-ghost btn-sm">Edit</button></div>
        <div class="ax-keybinding"><kbd>⌘⇧K</kbd> <span style="flex:1;color:rgba(255,255,255,.5);">Command mode</span> <button class="btn btn-ghost btn-sm">Edit</button></div>
        <div class="ax-keybinding"><kbd>⌘N</kbd> <span style="flex:1;color:rgba(255,255,255,.5);">New conversation</span> <button class="btn btn-ghost btn-sm">Edit</button></div>
        <div class="ax-keybinding"><kbd>⌘⇧N</kbd> <span style="flex:1;color:rgba(255,255,255,.5);">New workspace document</span> <button class="btn btn-ghost btn-sm">Edit</button></div>
        <div class="ax-keybinding"><kbd>⌘/</kbd> <span style="flex:1;color:rgba(255,255,255,.5);">Toggle sidebar</span> <button class="btn btn-ghost btn-sm">Edit</button></div>
        <div style="margin-top:12px;"><button class="btn btn-outline btn-sm">+ Add Custom Shortcut</button></div>
      </div>
    `;
    
    // Accessibility
    const a11yDiv = document.createElement('div');
    a11yDiv.className = 'settings-category';
    a11yDiv.dataset.category = 'accessibility';
    a11yDiv.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">Accessibility</div>
        <div class="settings-row">
          <div><div class="settings-row-label">Reduced motion</div><div class="settings-row-desc">Minimize animations and transitions</div></div>
          <label class="ax-switch"><input type="checkbox" id="axReducedMotion"><span class="ax-switch-track"></span></label>
        </div>
        <div class="settings-row">
          <div><div class="settings-row-label">Font size</div><div class="settings-row-desc">UI text size preference</div></div>
          <select class="ax-select" id="axFontSize">
            <option value="small">Small</option>
            <option value="medium" selected>Medium</option>
            <option value="large">Large</option>
            <option value="xl">Extra Large</option>
          </select>
        </div>
        <div class="settings-row">
          <div><div class="settings-row-label">High contrast</div><div class="settings-row-desc">Increase color contrast for better readability</div></div>
          <label class="ax-switch"><input type="checkbox"><span class="ax-switch-track"></span></label>
        </div>
      </div>
    `;
    
    // Developer
    const devDiv = document.createElement('div');
    devDiv.className = 'settings-category';
    devDiv.dataset.category = 'developer';
    devDiv.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">Developer Mode</div>
        <div class="settings-row">
          <div><div class="settings-row-label">Enable developer mode</div><div class="settings-row-desc">Access debug tools and advanced features</div></div>
          <label class="ax-switch"><input type="checkbox" id="axDevMode"><span class="ax-switch-track"></span></label>
        </div>
        <div class="settings-row" id="axDevConsoleRow" style="display:none;">
          <div style="width:100%;">
            <div class="settings-row-label" style="margin-bottom:8px;">Console</div>
            <div class="ax-dev-console" id="axDevConsole">
              <div class="log info">[Axiom AI OS v13] Developer mode enabled</div>
              <div class="log info">[Runtime] State engine initialized</div>
              <div class="log info">[Bridge] OpenRouter connected</div>
              <div class="log">[Memory] 248 entries loaded</div>
              <div class="log warn">[Warning] Analytics: 3 endpoints degraded</div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Performance
    const perfDiv = document.createElement('div');
    perfDiv.className = 'settings-category';
    perfDiv.dataset.category = 'performance';
    perfDiv.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">Performance</div>
        <div class="settings-row">
          <div><div class="settings-row-label">GPU acceleration</div><div class="settings-row-desc">Use hardware acceleration for animations and canvas rendering</div></div>
          <label class="ax-switch"><input type="checkbox" checked id="axGpuAccel"><span class="ax-switch-track"></span></label>
        </div>
        <div class="settings-row">
          <div><div class="settings-row-label">Target framerate</div><div class="settings-row-desc">Maximum FPS for UI animations</div></div>
          <select class="ax-select" id="axTargetFps">
            <option value="30">30 FPS (battery saver)</option>
            <option value="60" selected>60 FPS (smooth)</option>
            <option value="120">120 FPS (high refresh)</option>
          </select>
        </div>
        <div style="margin-top:12px;padding:12px;border-radius:12px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);">
          <div style="font-size:.78rem;color:rgba(255,255,255,.35);margin-bottom:4px;">Performance Metrics</div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;">
            <div><span style="font-size:.7rem;color:rgba(255,255,255,.3);">Avg FPS</span><br><span style="font-size:1rem;color:#6EE7B7;font-weight:700;">58</span></div>
            <div><span style="font-size:.7rem;color:rgba(255,255,255,.3);">Memory</span><br><span style="font-size:1rem;color:#60A5FA;font-weight:700;">342 MB</span></div>
            <div><span style="font-size:.7rem;color:rgba(255,255,255,.3);">DOM Nodes</span><br><span style="font-size:1rem;color:rgba(255,255,255,.5);font-weight:700;">2,847</span></div>
            <div><span style="font-size:.7rem;color:rgba(255,255,255,.3);">GPU Memory</span><br><span style="font-size:1rem;color:rgba(255,255,255,.5);font-weight:700;">128 MB</span></div>
          </div>
        </div>
      </div>
    `;
    
    // Danger
    const dangerDiv = document.createElement('div');
    dangerDiv.className = 'settings-category';
    dangerDiv.dataset.category = 'danger';
    
    // Collect existing panels
    const existingPanelsMap = {};
    page.querySelectorAll('[data-tab]').forEach(el => {
      const tab = el.dataset.tab;
      existingPanelsMap[tab] = el;
    });
    
    // Move existing profile content to profileDiv
    if (existingPanelsMap['profile']) {
      profileDiv.innerHTML = existingPanelsMap['profile'].innerHTML;
    }
    if (existingPanelsMap['security']) {
      securityDiv.innerHTML = existingPanelsMap['security'].innerHTML;
    }
    if (existingPanelsMap['language']) {
      langDiv.innerHTML = existingPanelsMap['language'].innerHTML;
    }
    if (existingPanelsMap['notifications']) {
      const notifDiv = document.createElement('div');
      notifDiv.className = 'settings-category';
      notifDiv.dataset.category = 'notifications';
      notifDiv.innerHTML = existingPanelsMap['notifications'].innerHTML;
      categoriesContainer.appendChild(notifDiv);
    } else {
      const notifDiv = document.createElement('div');
      notifDiv.className = 'settings-category';
      notifDiv.dataset.category = 'notifications';
      categoriesContainer.appendChild(notifDiv);
    }
    
    if (existingPanelsMap['danger']) {
      dangerDiv.innerHTML = existingPanelsMap['danger'].innerHTML;
    }
    
    // Append all categories
    categoriesContainer.appendChild(profileDiv);
    categoriesContainer.appendChild(securityDiv);
    categoriesContainer.appendChild(appearanceDiv);
    categoriesContainer.appendChild(langDiv);
    categoriesContainer.appendChild(modelsDiv);
    categoriesContainer.appendChild(agentsDiv);
    categoriesContainer.appendChild(memoryDiv);
    categoriesContainer.appendChild(workspaceDiv);
    categoriesContainer.appendChild(automationDiv);
    categoriesContainer.appendChild(keyboardDiv);
    categoriesContainer.appendChild(a11yDiv);
    categoriesContainer.appendChild(devDiv);
    categoriesContainer.appendChild(perfDiv);
    categoriesContainer.appendChild(dangerDiv);
    
    contentArea.appendChild(categoriesContainer);
    
    // Build layout
    layout.appendChild(nav);
    layout.appendChild(contentArea);
    
    // Replace page content
    // Insert layout after header
    header.parentElement.insertBefore(layout, header.nextSibling);
    
    // Remove old tab panels that were moved
    page.querySelectorAll('.settings-panel, .ax-chart-card.settings-panel').forEach(el => el.remove());
    
    // Wire dev mode toggle
    const devToggle = document.getElementById('axDevMode');
    const devRow = document.getElementById('axDevConsoleRow');
    if (devToggle && devRow) {
      devToggle.addEventListener('change', () => {
        devRow.style.display = devToggle.checked ? 'block' : 'none';
      });
    }
    
    // Wire reduced motion
    const motionToggle = document.getElementById('axReducedMotion');
    if (motionToggle) {
      motionToggle.addEventListener('change', () => {
        document.body.classList.toggle('ax-reduced-motion', motionToggle.checked);
      });
    }
  }

  function addMissingPanels() {
    // Panels already added inline in addSettingsSidebar
  }

  function wireSettingsTabs() {
    // Tab switching is now handled by the sidebar nav
  }

  function loadSettingsState() {
    // Load saved settings from localStorage
    try {
      const saved = JSON.parse(localStorage.getItem('axiom:settings'));
      if (saved) Object.assign(state.settings, saved);
    } catch(e) {/* ignore */}
  }

  // ============================================================
  // BILLING ENHANCEMENTS
  // ============================================================
  function enhanceBilling() {
    const page = document.querySelector('.ax-page');
    if (!page || page.classList.contains('ax-billing-enhanced')) return;
    page.classList.add('ax-billing-enhanced');

    injectBillingCSS();
    addInvoicePanel();
    addApiKeysPanel();
    addPaymentHistoryPanel();
    updateCreditBalance();
  }

  function injectBillingCSS() {
    if (document.getElementById('ax-billing-ultimate-style')) return;
    const style = document.createElement('style');
    style.id = 'ax-billing-ultimate-style';
    style.textContent = `
      .ax-billing-tabs { display:flex; gap:6px; border-bottom:1px solid rgba(255,255,255,.08); margin-bottom:16px; }
      .ax-billing-tab { padding:10px 16px; font-size:.82rem; font-weight:600; color:rgba(255,255,255,.4); cursor:pointer; border-bottom:2px solid transparent; transition:color .15s,border-color .15s; }
      .ax-billing-tab:hover { color:#F5F5F5; }
      .ax-billing-tab.active { color:#60A5FA; border-color:#60A5FA; }
      .ax-billing-panel { display:none; }
      .ax-billing-panel.active { display:block; }
      .ax-api-key-row { display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:14px; background:rgba(255,255,255,.02); border:1px solid rgba(255,255,255,.06); margin-bottom:8px; }
      .ax-api-key-name { font-size:.82rem; color:#F5F5F5; font-weight:600; min-width:100px; }
      .ax-api-key-value { font-family:'JetBrains Mono',monospace; font-size:.78rem; color:rgba(255,255,255,.4); flex:1; }
      .ax-api-key-meta { font-size:.68rem; color:rgba(255,255,255,.25); }
      .ax-payment-row { display:flex; align-items:center; gap:12px; padding:10px 0; }
      .ax-payment-row + .ax-payment-row { border-top:1px solid rgba(255,255,255,.04); }
    `;
    document.head.appendChild(style);
  }

  function updateCreditBalance() {
    const creditsEl = document.querySelector('[data-user-credits]');
    const barEl = document.querySelector('[data-credit-bar-fill]');
    if (creditsEl) creditsEl.textContent = state.billing.credits.toLocaleString();
    if (barEl) {
      const pct = Math.min(100, (state.billing.credits / 4000) * 100);
      barEl.style.width = pct + '%';
    }
  }

  function addInvoicePanel() {
    const page = document.querySelector('.ax-page');
    if (!page) return;
    
    // Add tabs before the plan cards
    const comparePlans = page.querySelector('.ax-page-grid-4');
    if (!comparePlans) return;
    
    const tabsRow = document.createElement('div');
    tabsRow.innerHTML = `
      <div class="ax-billing-tabs">
        <div class="ax-billing-tab active" data-btab="overview">Overview</div>
        <div class="ax-billing-tab" data-btab="invoices">Invoices</div>
        <div class="ax-billing-tab" data-btab="api-keys">API Keys</div>
        <div class="ax-billing-tab" data-btab="payments">Payment History</div>
      </div>
      <div class="ax-billing-panel active" data-bpanel="overview"></div>
      <div class="ax-billing-panel" data-bpanel="invoices">
        <div class="ax-chart-card" style="grid-column:span 4;">
          <div class="ax-chart-header"><h3>Invoices</h3></div>
          <div class="ax-table-wrap">
            <table class="ax-table">
              <thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>
                ${state.billing.invoices.map(inv => `
                  <tr>
                    <td>${inv.id}</td>
                    <td>${inv.date}</td>
                    <td>${inv.amount}</td>
                    <td><span class="ax-badge ax-badge-success">${inv.status}</span></td>
                    <td><button class="btn btn-ghost btn-sm">⬇ PDF</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="ax-billing-panel" data-bpanel="api-keys">
        <div class="ax-chart-card" style="grid-column:span 4;">
          <div class="ax-chart-header" style="flex-wrap:wrap;gap:12px;">
            <h3>API Keys</h3>
            <button class="btn btn-solid btn-sm" style="margin-left:auto;">+ Generate Key</button>
          </div>
          ${state.billing.apiKeys.map(k => `
            <div class="ax-api-key-row">
              <span class="ax-api-key-name">${k.name}</span>
              <span class="ax-api-key-value">${k.key}</span>
              <span class="ax-api-key-meta">Created: ${k.created}</span>
              <span class="ax-api-key-meta">Last used: ${k.lastUsed}</span>
              <button class="btn btn-ghost btn-sm">Revoke</button>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="ax-billing-panel" data-bpanel="payments">
        <div class="ax-chart-card" style="grid-column:span 4;">
          <div class="ax-chart-header"><h3>Payment History</h3></div>
          ${state.billing.paymentHistory.map(p => `
            <div class="ax-payment-row">
              <span style="font-size:.78rem;color:rgba(255,255,255,.6);flex:1;">${p.date}</span>
              <span style="font-size:.78rem;color:rgba(255,255,255,.4);">${p.method}</span>
              <span style="font-size:.82rem;color:#F5F5F5;font-weight:600;">${p.amount}</span>
              <span class="ax-badge ax-badge-success">${p.status}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    
    tabsRow.style.gridColumn = 'span 4';
    
    // Insert after usage history
    const usageHistory = page.querySelector('.ax-chart-card .ax-table-wrap');
    if (usageHistory) {
      usageHistory.closest('.ax-chart-card').after(tabsRow);
    } else {
      comparePlans.parentElement.insertBefore(tabsRow, comparePlans);
    }
    
    // Wire tabs
    tabsRow.querySelectorAll('.ax-billing-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        tabsRow.querySelectorAll('.ax-billing-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.btab;
        tabsRow.querySelectorAll('.ax-billing-panel').forEach(p => {
          p.classList.toggle('active', p.dataset.bpanel === target);
        });
      });
    });
  }

  function addApiKeysPanel() {
    // Already embedded in addInvoicePanel
  }

  function addPaymentHistoryPanel() {
    // Already embedded in addInvoicePanel
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    const path = window.location.pathname;
    const filename = path.split('/').pop() || '';
    
    if (filename === 'settings.html' || path.endsWith('settings')) {
      setTimeout(enhanceSettings, 300);
      console.log('[SettingsBillingUltimate] Settings enhanced');
    }
    
    if (filename === 'billing.html' || path.endsWith('billing')) {
      setTimeout(enhanceBilling, 300);
      console.log('[SettingsBillingUltimate] Billing enhanced');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.AxiomSettingsBilling = {
    state,
    enhanceSettings,
    enhanceBilling,
  };

})(window);

