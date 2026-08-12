/* ============================================================
   AXIOM AI OS V13 — Agents Ultimate
   ------------------------------------------------------------
   Enhances agent-library.html with live animated agent cards:
   - Animated avatar with pulse/glow by status
   - Health bar, Confidence meter, Memory %
   - CPU Usage, Current Task, Queue count
   - Last Action timestamp, Token counter
   - Model badge, Speed indicator
   - Status badge (Sleeping/Observing/Thinking/Working/Learning/Error)
   - Animated connection beams to AI Core
   - Pulse/glow animations by status
   - Agent Marketplace panel
   - Agent Builder UI
   
   Depends on: AxiomAgents, AxiomAgentCatalog, AxiomBrain
   ============================================================ */
(function (global) {
  'use strict';

  // ============================================================
  // LIVE AGENT STATE
  // ============================================================
  const STATUSES = ['sleeping', 'observing', 'thinking', 'working', 'learning', 'error'];
  const STATUS_COLORS = {
    sleeping: 'rgba(255,255,255,.25)',
    observing: '#60A5FA',
    thinking: '#60A5FA',
    working: '#6EE7B7',
    learning: '#FBBF24',
    error: '#EF4444',
  };
  const STATUS_EMOJI = {
    sleeping: '💤',
    observing: '👁️',
    thinking: '🧠',
    working: '⚡',
    learning: '📚',
    error: '⚠️',
  };

  const AGENT_LIVE_DATA = [
    { id: 'builtin:general', name: 'General Assistant', icon: '🧠', color: '#6C5CE7' },
    { id: 'builtin:coder', name: 'Software Engineer', icon: '💻', color: '#00B894' },
    { id: 'builtin:writer', name: 'Writing Assistant', icon: '✍️', color: '#E17055' },
    { id: 'builtin:research', name: 'Research Assistant', icon: '🔬', color: '#0984E3' },
    { id: 'builtin:vision', name: 'Image Analyst', icon: '🖼️', color: '#FD79A8' },
    { id: 'builtin:ui-ux-pro-max', name: 'UI/UX Pro Max', icon: '🎨', color: '#60A5FA' },
  ];

  const state = {
    agents: AGENT_LIVE_DATA.map(a => ({
      ...a,
      health: 85 + Math.random() * 15,
      confidence: 70 + Math.random() * 28,
      memory: 40 + Math.random() * 40,
      cpu: 10 + Math.random() * 50,
      task: '',
      queue: Math.floor(Math.random() * 4),
      lastAction: 'initialized',
      tokens: Math.floor(Math.random() * 5000),
      speed: 60 + Math.random() * 35,
      status: STATUSES[Math.floor(Math.random() * STATUSES.length)],
      tasks: [
        'Analyzing user request...',
        'Generating response...',
        'Searching knowledge base...',
        'Reviewing code output...',
        'Synthesizing results...',
        'Optimizing solution...',
        'Cross-referencing sources...',
        'Compiling report...',
        'Waiting for input...',
        'Processing attachment...',
      ],
      taskIndex: 0,
    })),
    interval: null,
    initialized: false,
  };

  // ============================================================
  // DOM BUILDERS
  // ============================================================
  function injectAgentStyles() {
    if (document.getElementById('ax-agents-ultimate-style')) return;
    const style = document.createElement('style');
    style.id = 'ax-agents-ultimate-style';
    style.textContent = `
      /* --- Agent Status Bar --- */
      .ax-agent-status-bar {
        display: flex; gap: 4px; align-items: center;
        margin-top: 6px; flex-wrap: wrap;
      }
      .ax-agent-stat {
        flex: 1; min-width: 60px;
      }
      .ax-agent-stat-label {
        font-size: .6rem; color: rgba(255,255,255,.3);
        text-transform: uppercase; letter-spacing: .04em;
        margin-bottom: 2px;
      }
      .ax-agent-stat-bar {
        height: 3px; border-radius: 999px;
        background: rgba(255,255,255,.05); overflow: hidden;
      }
      .ax-agent-stat-bar span {
        display: block; height: 100%; border-radius: 999px;
        transition: width .6s ease;
      }
      .ax-agent-stat-value {
        font-size: .7rem; color: rgba(255,255,255,.45);
        font-family: 'JetBrains Mono', monospace;
        margin-top: 2px;
      }

      /* --- Live Task Display --- */
      .ax-agent-task {
        font-size: .72rem; color: rgba(255,255,255,.5);
        margin-top: 4px; padding: 4px 8px;
        border-radius: 8px; background: rgba(255,255,255,.03);
        border: 1px solid rgba(255,255,255,.04);
        display: flex; align-items: center; gap: 6px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        min-height: 28px;
      }
      .ax-agent-task .pulse-dot {
        width: 4px; height: 4px; border-radius: 50%;
        flex-shrink: 0;
      }

      /* --- Status Badge --- */
      .ax-agent-status-badge {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 2px 10px; border-radius: 999px;
        font-size: .65rem; font-weight: 600;
        transition: background .4s, border-color .4s, color .4s;
      }
      .ax-agent-status-badge .stat-dot {
        width: 5px; height: 5px; border-radius: 50%;
        animation: axStatPulse 1.4s ease-in-out infinite;
      }
      @keyframes axStatPulse {
        0%, 100% { opacity: .5; transform: scale(.8); }
        50% { opacity: 1; transform: scale(1.2); }
      }

      /* --- Connection Beam to AI Core --- */
      .ax-agent-beam {
        position: absolute; top: 50%; right: -12px;
        width: 24px; height: 2px;
        background: linear-gradient(90deg, rgba(255,255,255,.15), rgba(255,255,255,.02));
        transform-origin: right center;
        pointer-events: none;
        opacity: 0;
        transition: opacity .4s;
      }
      .agent-card-premium:hover .ax-agent-beam {
        opacity: 1;
      }
      .ax-agent-beam.active {
        opacity: .6;
        animation: axBeamPulse .8s ease-in-out infinite;
      }
      @keyframes axBeamPulse {
        0%, 100% { opacity: .3; }
        50% { opacity: .8; }
      }

      /* --- Agent Avatar Glow --- */
      .agent-card-avatar {
        transition: box-shadow .4s ease;
      }
      .agent-card-avatar.status-thinking {
        box-shadow: 0 0 16px rgba(168,85,247,.35);
      }
      .agent-card-avatar.status-working {
        box-shadow: 0 0 16px rgba(110,231,183,.35);
      }
      .agent-card-avatar.status-learning {
        box-shadow: 0 0 16px rgba(251,191,36,.35);
      }
      .agent-card-avatar.status-error {
        box-shadow: 0 0 16px rgba(239,68,68,.35);
      }
      .agent-card-avatar.status-observing {
        box-shadow: 0 0 12px rgba(96,165,250,.25);
      }

      /* --- Marketplace Modal --- */
      .ax-marketplace-overlay {
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(5,5,5,.85); backdrop-filter: blur(20px);
        display: none; align-items: center; justify-content: center;
      }
      .ax-marketplace-overlay.open { display: flex; }
      .ax-marketplace-panel {
        width: min(700px, calc(100vw - 40px));
        max-height: 80vh; overflow-y: auto;
        padding: 28px; border-radius: 28px;
        background: #111; border: 1px solid rgba(255,255,255,.1);
        box-shadow: 0 40px 100px rgba(0,0,0,.5);
      }
      .ax-marketplace-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 12px; margin-top: 16px;
      }
      .ax-marketplace-item {
        padding: 16px; border-radius: 18px;
        background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08);
        cursor: pointer; transition: border-color .2s, transform .2s;
        text-align: center;
      }
      .ax-marketplace-item:hover {
        border-color: rgba(96,165,250,.3);
        transform: translateY(-2px);
      }
      .ax-marketplace-item .emoji { font-size: 1.6rem; margin-bottom: 6px; }
      .ax-marketplace-item .title { font-size: .82rem; font-weight: 600; color: #F5F5F5; }
      .ax-marketplace-item .desc { font-size: .72rem; color: rgba(255,255,255,.4); margin-top: 4px; }
      .ax-marketplace-item .badge {
        display: inline-block; margin-top: 6px;
        font-size: .65rem; padding: 2px 10px; border-radius: 999px;
        background: rgba(110,231,183,.1); border: 1px solid rgba(110,231,183,.2);
        color: #6EE7B7;
      }

      /* --- Builder Modal --- */
      .ax-builder-overlay {
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(5,5,5,.85); backdrop-filter: blur(20px);
        display: none; align-items: center; justify-content: center;
      }
      .ax-builder-overlay.open { display: flex; }
    `;
    document.head.appendChild(style);
  }

  function enhanceAgentCard(card, agentData) {
    const live = state.agents.find(a => a.id === agentData.id);
    if (!live || !card) return;
    
    // Update avatar glow based on status
    const avatar = card.querySelector('.agent-card-avatar');
    if (avatar) {
      Object.values(STATUS_COLORS).forEach(c => {
        avatar.classList.remove('status-' + Object.keys(STATUS_COLORS).find(k => STATUS_COLORS[k] === c));
      });
      avatar.classList.add('status-' + live.status);
      avatar.style.background = STATUS_COLORS[live.status] + '22';
    }
    
    // Add connection beam
    let beam = card.querySelector('.ax-agent-beam');
    if (!beam) {
      beam = document.createElement('div');
      beam.className = 'ax-agent-beam';
      card.style.position = 'relative';
      card.appendChild(beam);
    }
    beam.classList.toggle('active', live.status === 'thinking' || live.status === 'working');
    
    // Add status bar row
    let statusBar = card.querySelector('.ax-agent-status-bar');
    if (!statusBar) {
      statusBar = document.createElement('div');
      statusBar.className = 'ax-agent-status-bar';
      
      // Health
      const healthDiv = document.createElement('div');
      healthDiv.className = 'ax-agent-stat';
      healthDiv.innerHTML = `<div class="ax-agent-stat-label">Health</div>
        <div class="ax-agent-stat-bar"><span style="width:${live.health}%;background:linear-gradient(90deg,#EF4444,#6EE7B7);"></span></div>
        <div class="ax-agent-stat-value h-value">${Math.round(live.health)}%</div>`;
      statusBar.appendChild(healthDiv);
      
      // Confidence
      const confDiv = document.createElement('div');
      confDiv.className = 'ax-agent-stat';
      confDiv.innerHTML = `<div class="ax-agent-stat-label">Confidence</div>
          <div class="ax-agent-stat-bar"><span style="width:${live.confidence}%;background:linear-gradient(90deg,#60A5FA,#6EE7B7);"></span></div>
        <div class="ax-agent-stat-value c-value">${Math.round(live.confidence)}%</div>`;
      statusBar.appendChild(confDiv);
      
      // Memory
      const memDiv = document.createElement('div');
      memDiv.className = 'ax-agent-stat';
      memDiv.innerHTML = `<div class="ax-agent-stat-label">Memory</div>
          <div class="ax-agent-stat-bar"><span style="width:${live.memory}%;background:linear-gradient(90deg,#FBBF24,#60A5FA);"></span></div>
        <div class="ax-agent-stat-value m-value">${Math.round(live.memory)}%</div>`;
      statusBar.appendChild(memDiv);
      
      card.appendChild(statusBar);
    }
    
    // Add task display
    let taskEl = card.querySelector('.ax-agent-task');
    if (!taskEl) {
      taskEl = document.createElement('div');
      taskEl.className = 'ax-agent-task';
      taskEl.innerHTML = `<span class="pulse-dot" style="background:${STATUS_COLORS[live.status]};${live.status === 'sleeping' ? 'animation:none;' : ''}"></span>
        <span class="ax-task-text">${live.task || 'Idle'}</span>`;
      card.appendChild(taskEl);
    } else {
      const dot = taskEl.querySelector('.pulse-dot');
      if (dot) dot.style.background = STATUS_COLORS[live.status];
      const text = taskEl.querySelector('.ax-task-text');
      if (text) text.textContent = live.task || 'Idle';
    }
    
    // Add status badge & metrics row
    let metaRow = card.querySelector('.ax-agent-meta-row');
    if (!metaRow) {
      metaRow = document.createElement('div');
      metaRow.className = 'ax-agent-meta-row';
      metaRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.04);';
      
      // Status badge
      const statusBadge = document.createElement('span');
      statusBadge.className = 'ax-agent-status-badge';
      const statusColor = STATUS_COLORS[live.status];
      statusBadge.style.cssText = `background:${statusColor}15;border:1px solid ${statusColor}30;color:${statusColor};`;
      statusBadge.innerHTML = `<span class="stat-dot" style="background:${statusColor};box-shadow:0 0 6px ${statusColor};"></span>${live.status}`;
      metaRow.appendChild(statusBadge);
      
      // CPU
      const cpuBadge = document.createElement('span');
      cpuBadge.className = 'ax-agent-cpu-badge';
      cpuBadge.style.cssText = 'font-size:.65rem;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.04);color:rgba(255,255,255,.4);border:1px solid rgba(255,255,255,.06);font-family:JetBrains Mono,monospace;';
      cpuBadge.textContent = `CPU ${Math.round(live.cpu)}%`;
      metaRow.appendChild(cpuBadge);
      
      // Tokens
      const tokenBadge = document.createElement('span');
      tokenBadge.style.cssText = 'font-size:.65rem;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.04);color:rgba(255,255,255,.4);border:1px solid rgba(255,255,255,.06);font-family:JetBrains Mono,monospace;';
      tokenBadge.textContent = `${live.tokens.toLocaleString()} tok`;
      metaRow.appendChild(tokenBadge);
      
      // Queue
      const queueBadge = document.createElement('span');
      queueBadge.style.cssText = 'font-size:.65rem;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.04);color:rgba(255,255,255,.4);border:1px solid rgba(255,255,255,.06);';
      queueBadge.textContent = `Queue: ${live.queue}`;
      metaRow.appendChild(queueBadge);
      
      // Speed
      const speedBadge = document.createElement('span');
      speedBadge.style.cssText = 'font-size:.65rem;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.04);color:rgba(255,255,255,.4);border:1px solid rgba(255,255,255,.06);';
      speedBadge.textContent = `${Math.round(live.speed)} wpm`;
      metaRow.appendChild(speedBadge);
      
      // Last action
      const actionBadge = document.createElement('span');
      actionBadge.style.cssText = 'font-size:.65rem;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.04);color:rgba(255,255,255,.3);border:1px solid rgba(255,255,255,.04);margin-left:auto;';
      actionBadge.textContent = live.lastAction;
      metaRow.appendChild(actionBadge);
      
      card.appendChild(metaRow);
    }
  }

  function addMarketplaceButton() {
    const panelHead = document.querySelector('.panel-head');
    if (!panelHead || document.getElementById('axMarketplaceBtn')) return;
    
    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:8px;margin-left:auto;';
    
    const marketBtn = document.createElement('button');
    marketBtn.id = 'axMarketplaceBtn';
    marketBtn.className = 'btn btn-outline btn-sm';
    marketBtn.innerHTML = '🏪 Agent Marketplace';
    marketBtn.addEventListener('click', openMarketplace);
    btnGroup.appendChild(marketBtn);
    
    const builderBtn = document.createElement('button');
    builderBtn.id = 'axBuilderBtn';
    builderBtn.className = 'btn btn-solid btn-sm';
    builderBtn.innerHTML = '+ Agent Builder';
    builderBtn.addEventListener('click', openBuilder);
    btnGroup.appendChild(builderBtn);
    
    panelHead.appendChild(btnGroup);
  }

  // ============================================================
  // MARKETPLACE
  // ============================================================
  const MARKETPLACE_AGENTS = [
    { icon: '🐍', name: 'Python Master', desc: 'Expert Python developer for data science, ML, and automation.', category: 'Developer' },
    { icon: '☁️', name: 'Cloud Architect', desc: 'AWS/GCP/Azure infrastructure design and deployment.', category: 'DevOps' },
    { icon: '📊', name: 'Data Analyst', desc: 'SQL, pandas, visualization, and statistical analysis.', category: 'Data' },
    { icon: '🔐', name: 'Security Auditor', desc: 'Code security review, penetration testing, compliance.', category: 'Security' },
    { icon: '📈', name: 'Growth Marketer', desc: 'SEO, content strategy, conversion optimization.', category: 'Marketing' },
    { icon: '⚖️', name: 'Legal Advisor', desc: 'Contract review, legal research, compliance guidance.', category: 'Business' },
    { icon: '🎬', name: 'Video Producer', desc: 'Script writing, storyboarding, video editing guidance.', category: 'Creative' },
    { icon: '🧪', name: 'Scientist', desc: 'Research methodology, experiment design, paper analysis.', category: 'Research' },
  ];

  function openMarketplace() {
    let overlay = document.getElementById('axMarketplaceOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'axMarketplaceOverlay';
      overlay.className = 'ax-marketplace-overlay';
      overlay.innerHTML = `
        <div class="ax-marketplace-panel">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
            <h3 style="font-size:1.1rem;color:#F5F5F5;">🏪 Agent Marketplace</h3>
            <button id="axMarketClose" style="width:28px;height:28px;border-radius:8px;border:none;background:transparent;color:rgba(255,255,255,.4);cursor:pointer;">✕</button>
          </div>
          <p style="font-size:.82rem;color:rgba(255,255,255,.5);margin-bottom:16px;">Discover and install specialized agents built by the community.</p>
          <div class="ax-marketplace-grid">
            ${MARKETPLACE_AGENTS.map(a => `
              <div class="ax-marketplace-item" data-agent="${a.name}">
                <div class="emoji">${a.icon}</div>
                <div class="title">${a.name}</div>
                <div class="desc">${a.desc}</div>
                <span class="badge">${a.category}</span>
              </div>
            `).join('')}
          </div>
        </div>`;
      document.body.appendChild(overlay);
      
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.id === 'axMarketClose') {
          overlay.classList.remove('open');
        }
      });
      
      overlay.querySelectorAll('.ax-marketplace-item').forEach(item => {
        item.addEventListener('click', () => {
          const name = item.dataset.agent;
          overlay.classList.remove('open');
          // Open the agent editor with pre-filled name
          setTimeout(() => {
            const nameInput = document.getElementById('agentName');
            const iconInput = document.getElementById('agentIcon');
            if (nameInput && iconInput) {
              nameInput.value = name;
              iconInput.value = item.querySelector('.emoji').textContent;
              // Scroll to editor trigger
              document.querySelector('[data-tab="mine"]')?.click();
              document.getElementById('newAgentBtn')?.click();
            }
          }, 300);
        });
      });
    }
    overlay.classList.add('open');
  }

  // ============================================================
  // BUILDER
  // ============================================================
  function openBuilder() {
    // Reuse the existing agent editor modal, but with a guided flow
    const newBtn = document.getElementById('newAgentBtn');
    if (newBtn) {
      newBtn.click();
      // Pre-fill with builder template
      setTimeout(() => {
        const nameInput = document.getElementById('agentName');
        const promptInput = document.getElementById('agentSystemPrompt');
        if (nameInput) nameInput.value = '';
        if (promptInput) {
          promptInput.value = `You are a custom AI agent built with Axiom's Agent Builder. Follow these guidelines:
1. Be helpful, accurate, and concise in your responses.
2. Use the tools available to you to provide the best possible assistance.
3. If unsure about something, ask clarifying questions rather than guessing.
4. Maintain a professional yet approachable tone.`;
        }
        const modalTitle = document.getElementById('agentEditorTitle');
        if (modalTitle) modalTitle.textContent = '🤖 Agent Builder — Create Your Agent';
      }, 100);
    }
  }

  // ============================================================
  // LIVE UPDATE LOOP
  // ============================================================
  function liveTick() {
    const brain = global.AxiomBrain;
    const brainState = brain ? brain.getState() : null;
    
    state.agents.forEach(agent => {
      // Cycle status occasionally
      if (Math.random() < 0.08) {
        const statusWeights = brainState ? {
          sleeping: 0.05,
          observing: 0.2,
          thinking: 0.25,
          working: 0.3,
          learning: 0.15,
          error: 0.05,
        } : {
          sleeping: 0.15,
          observing: 0.25,
          thinking: 0.2,
          working: 0.2,
          learning: 0.1,
          error: 0.1,
        };
        
        const r = Math.random();
        let cumulative = 0;
        for (const [status, weight] of Object.entries(statusWeights)) {
          cumulative += weight;
          if (r <= cumulative) {
            agent.status = status;
            break;
          }
        }
      }
      
      // Sync with AxiomBrain activity
      if (brainState) {
        if (brainState.activity === 'thinking' && Math.random() < 0.3) {
          agent.status = 'thinking';
        } else if (brainState.activity === 'speaking' && Math.random() < 0.2) {
          agent.status = 'working';
        } else if (brainState.activity === 'learning' && Math.random() < 0.2) {
          agent.status = 'learning';
        }
      }
      
      // Update metrics with random drift
      agent.health = Math.max(30, Math.min(100, agent.health + (Math.random() - 0.5) * 4));
      agent.confidence = Math.max(40, Math.min(100, agent.confidence + (Math.random() - 0.5) * 3));
      agent.memory = Math.max(20, Math.min(100, agent.memory + (Math.random() - 0.5) * 2));
      agent.cpu = Math.max(5, Math.min(95, agent.cpu + (Math.random() - 0.5) * 8));
      agent.queue = Math.max(0, Math.min(10, agent.queue + (Math.random() < 0.1 ? 1 : -1)));
      agent.tokens += Math.floor(Math.random() * 200);
      agent.speed = Math.max(30, Math.min(200, agent.speed + (Math.random() - 0.5) * 6));
      
      // Update task
      if (Math.random() < 0.12) {
        agent.taskIndex = (agent.taskIndex + 1) % agent.tasks.length;
        agent.task = agent.tasks[agent.taskIndex];
      }
      
      // Update last action time
      if (Math.random() < 0.2) {
        const seconds = Math.floor(Math.random() * 120);
        agent.lastAction = seconds < 5 ? 'now' : `${seconds}s ago`;
      }
      
      // Update card DOM
      const card = findAgentCard(agent.id, agent.name);
      if (card) {
        updateCardDOM(card, agent);
      }
    });
  }

  function findAgentCard(id, name) {
    const cards = document.querySelectorAll('.agent-card-premium');
    for (const card of cards) {
      const nameEl = card.querySelector('.agent-card-name');
      if (nameEl && (nameEl.textContent === name || (id && card.dataset.agentId === id))) {
        card.dataset.agentId = id;
        return card;
      }
    }
    return null;
  }

  function updateCardDOM(card, agent) {
    // Status badge
    const statusBadge = card.querySelector('.ax-agent-status-badge');
    if (statusBadge) {
      const color = STATUS_COLORS[agent.status];
      statusBadge.style.cssText = `background:${color}15;border:1px solid ${color}30;color:${color};display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:999px;font-size:.65rem;font-weight:600;`;
      const dot = statusBadge.querySelector('.stat-dot') || document.createElement('span');
      if (!dot.classList.contains('stat-dot')) {
        dot.className = 'stat-dot';
        dot.style.cssText = `width:5px;height:5px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color};animation:axStatPulse 1.4s ease-in-out infinite;`;
        statusBadge.prepend(dot);
      } else {
        dot.style.background = color;
        dot.style.boxShadow = `0 0 6px ${color}`;
      }
      statusBadge.innerHTML = `<span class="stat-dot" style="width:5px;height:5px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color};animation:axStatPulse 1.4s ease-in-out infinite;"></span>${agent.status}`;
    }
    
    // Health bar
    const hBar = card.querySelector('.ax-agent-stat:nth-child(1) .ax-agent-stat-bar span');
    const hVal = card.querySelector('.h-value');
    if (hBar) hBar.style.width = agent.health + '%';
    if (hVal) hVal.textContent = Math.round(agent.health) + '%';
    
    // Confidence bar
    const cBar = card.querySelector('.ax-agent-stat:nth-child(2) .ax-agent-stat-bar span');
    const cVal = card.querySelector('.c-value');
    if (cBar) cBar.style.width = agent.confidence + '%';
    if (cVal) cVal.textContent = Math.round(agent.confidence) + '%';
    
    // Memory bar
    const mBar = card.querySelector('.ax-agent-stat:nth-child(3) .ax-agent-stat-bar span');
    const mVal = card.querySelector('.m-value');
    if (mBar) mBar.style.width = agent.memory + '%';
    if (mVal) mVal.textContent = Math.round(agent.memory) + '%';
    
    // Task
    const taskText = card.querySelector('.ax-task-text');
    if (taskText) taskText.textContent = agent.task || 'Idle';
    
    // CPU
    const cpuBadge = card.querySelector('.ax-agent-cpu-badge');
    if (cpuBadge) cpuBadge.textContent = `CPU ${Math.round(agent.cpu)}%`;
    
    // Tokens
    const tokenBadge = card.querySelectorAll('.ax-agent-meta-row span')[1];
    if (tokenBadge && tokenBadge.textContent.includes('tok')) {
      tokenBadge.textContent = `${agent.tokens.toLocaleString()} tok`;
    }
    
    // Queue
    const queueBadge = card.querySelectorAll('.ax-agent-meta-row span')[2];
    if (queueBadge && queueBadge.textContent.includes('Queue')) {
      queueBadge.textContent = `Queue: ${agent.queue}`;
    }
    
    // Speed
    const speedBadge = card.querySelectorAll('.ax-agent-meta-row span')[3];
    if (speedBadge && speedBadge.textContent.includes('wpm')) {
      speedBadge.textContent = `${Math.round(agent.speed)} wpm`;
    }
    
    // Last action
    const actionBadge = card.querySelectorAll('.ax-agent-meta-row span')[4];
    if (actionBadge) {
      actionBadge.textContent = agent.lastAction;
    }
    
    // Avatar glow
    const avatar = card.querySelector('.agent-card-avatar');
    if (avatar) {
      Object.keys(STATUS_COLORS).forEach(s => avatar.classList.remove('status-' + s));
      avatar.classList.add('status-' + agent.status);
      avatar.style.background = STATUS_COLORS[agent.status] + '22';
    }
    
    // Connection beam
    const beam = card.querySelector('.ax-agent-beam');
    if (beam) {
      beam.classList.toggle('active', agent.status === 'thinking' || agent.status === 'working');
    }
  }

  // ============================================================
  // OBSERVER — Watch for new cards being rendered
  // ============================================================
  function setupObserver() {
    const grid = document.getElementById('agentGrid');
    if (!grid) return;
    
    const observer = new MutationObserver(() => {
      const cards = grid.querySelectorAll('.agent-card-premium:not([data-enhanced])');
      cards.forEach(card => {
        card.dataset.enhanced = 'true';
        const nameEl = card.querySelector('.agent-card-name');
        if (nameEl) {
          const name = nameEl.textContent.trim();
          const agentData = { id: '', name };
          const liveData = state.agents.find(a => a.name === name);
          if (liveData) {
            enhanceAgentCard(card, { id: liveData.id });
          }
        }
      });
    });
    
    observer.observe(grid, { childList: true, subtree: true });
  }

  // ============================================================
  // WIRE EXISTING NAV — Add marketplace link to dock
  // ============================================================
  function wireDock() {
    // No changes to dock needed
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    // Initial data setup
    state.agents.forEach(agent => {
      agent.task = agent.tasks[0];
    });
    
    injectAgentStyles();
    
    // Wait for agent grid to render, then enhance
    const checkExist = setInterval(() => {
      const grid = document.getElementById('agentGrid');
      if (grid && grid.children.length > 0) {
        clearInterval(checkExist);
        
        // Enhance existing cards
        const cards = grid.querySelectorAll('.agent-card-premium');
        cards.forEach(card => {
          const nameEl = card.querySelector('.agent-card-name');
          if (nameEl) {
            const name = nameEl.textContent.trim();
            const liveData = state.agents.find(a => a.name === name);
            if (liveData) {
              enhanceAgentCard(card, { id: liveData.id });
            }
          }
        });
        
        addMarketplaceButton();
        setupObserver();
        
        // Start live loop
        state.interval = setInterval(liveTick, 1500);
        state.initialized = true;
        
        console.log('[AgentsUltimate] Initialized');
      }
    }, 200);
    
    // Timeout safety
    setTimeout(() => clearInterval(checkExist), 10000);
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.AxiomAgentsUltimate = {
    getState: () => state,
    openMarketplace,
    openBuilder,
  };

})(window);

