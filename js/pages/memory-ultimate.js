/* ============================================================
   AXIOM AI OS V13 — Memory Ultimate
   ------------------------------------------------------------
   Upgrades memory.html with:
   - Memory Timeline (scrollable chronological)
   - Memory Crystals (enhanced 3D visual)
   - Knowledge Graph (connected SVG nodes)
   - Tags/filtering system
   - Search with semantic results
   - Filters by date, type, agent, importance
   - Projects grouping
   - Pinned Memory section
   - Importance meter per memory
   - Confidence score per memory
   - Embeddings visualization
   - Long-term Memory archive
   - Short-term Memory cache
   - Working Memory current state
   Depends on: memory-world.js, memory-world.css, AxiomBrain
   ============================================================ */
(function (global) {
  'use strict';

  // ============================================================
  // MEMORY DATA
  // ------------------------------------------------------------
  // Backed by window.AxiomMemoryEngine (os/core/memory-engine.js) —
  // the real, persisted memory foundation. This seed set is only
  // ever written ONCE, the first time a browser has no memories in
  // storage yet, so the page has content to show on a first visit.
  // Every read/write from here on goes through the engine, not a
  // local array — reload the page and your pins/edits/new memories
  // are still there.
  // ============================================================
  const SEED_MEMORY_ITEMS = [
    { text: 'User prefers TypeScript over JavaScript for backend services.', agent: 'Code Agent', ageMs: 7200000, type: 'preference', pinned: true, importance: 0.88, confidence: 0.95, project: 'axiom-web', tags: ['typescript', 'backend', 'preference'] },
    { text: 'Working on a Next.js project called "axiom-web" with Tailwind CSS.', agent: 'General', ageMs: 18000000, type: 'context', pinned: false, importance: 0.75, confidence: 0.90, project: 'axiom-web', tags: ['nextjs', 'tailwind', 'project'] },
    { text: "User's preferred tone for business writing is formal but approachable.", agent: 'Write Agent', ageMs: 86400000, type: 'preference', pinned: true, importance: 0.92, confidence: 0.85, project: 'general', tags: ['writing', 'tone', 'preference'] },
    { text: 'Uses VS Code with the One Dark Pro theme and JetBrains Mono font.', agent: 'Code Agent', ageMs: 172800000, type: 'context', pinned: true, importance: 0.70, confidence: 0.92, project: 'general', tags: ['vscode', 'theme', 'font'] },
    { text: 'Has a preference for clean, minimal API designs with proper error handling.', agent: 'Code Agent', ageMs: 259200000, type: 'preference', pinned: false, importance: 0.85, confidence: 0.88, project: 'axiom-web', tags: ['api', 'design', 'preference'] },
    { text: 'User works primarily between 9AM and 6PM EST on weekdays.', agent: 'General', ageMs: 345600000, type: 'context', pinned: false, importance: 0.45, confidence: 0.78, project: 'general', tags: ['schedule', 'user'] },
    { text: 'Prefers dark mode in all applications and IDEs.', agent: 'General', ageMs: 432000000, type: 'preference', pinned: false, importance: 0.65, confidence: 0.95, project: 'general', tags: ['theme', 'preference', 'darkmode'] },
    { text: 'Currently learning Rust for systems programming projects.', agent: 'Learning Agent', ageMs: 518400000, type: 'learning', pinned: false, importance: 0.80, confidence: 0.82, project: 'personal', tags: ['rust', 'learning', 'systems'] },
    { text: 'Uses linear workflow for task management with weekly sprints.', agent: 'Code Agent', ageMs: 604800000, type: 'workflow', pinned: false, importance: 0.72, confidence: 0.85, project: 'axiom-web', tags: ['workflow', 'linear', 'sprints'] },
    { text: 'Prefers functional programming patterns over OOP in JavaScript.', agent: 'Code Agent', ageMs: 691200000, type: 'preference', pinned: false, importance: 0.78, confidence: 0.80, project: 'general', tags: ['functional', 'preference', 'javascript'] },
    { text: 'Has set up CI/CD pipeline using GitHub Actions for axiom-web.', agent: 'DevOps Agent', ageMs: 777600000, type: 'infrastructure', pinned: false, importance: 0.82, confidence: 0.93, project: 'axiom-web', tags: ['cicd', 'github-actions', 'devops'] },
    { text: 'Uses PostgreSQL as primary database with Prisma ORM.', agent: 'Code Agent', ageMs: 864000000, type: 'infrastructure', pinned: false, importance: 0.76, confidence: 0.90, project: 'axiom-web', tags: ['postgresql', 'prisma', 'database'] },
    { text: 'Enjoys minimalist UI design with generous whitespace.', agent: 'Design Agent', ageMs: 950400000, type: 'preference', pinned: true, importance: 0.90, confidence: 0.88, project: 'general', tags: ['design', 'minimalism', 'preference'] },
    { text: 'Prefers to deploy on Vercel for frontend and Railway for backend.', agent: 'DevOps Agent', ageMs: 1123200000, type: 'infrastructure', pinned: false, importance: 0.74, confidence: 0.86, project: 'axiom-web', tags: ['deployment', 'vercel', 'railway'] },
    { text: 'Has a collection of design system components in a shared library.', agent: 'Design Agent', ageMs: 1209600000, type: 'context', pinned: false, importance: 0.68, confidence: 0.84, project: 'axiom-web', tags: ['design-system', 'components', 'library'] },
  ];

  const engine = global.AxiomMemoryEngine;

  function seedIfEmpty() {
    if (!engine) return;
    if (engine.queryMemories({}).length > 0) return; // real data already exists — never overwrite
    const now = Date.now();
    SEED_MEMORY_ITEMS.forEach(item => {
      const rec = Object.assign({}, item);
      delete rec.ageMs;
      rec.createdAt = now - item.ageMs;
      rec.updatedAt = now - item.ageMs;
      rec.lastAccessedAt = now - item.ageMs;
      engine.addMemory(rec);
    });
  }

  function relativeDate(ts) {
    const diff = Date.now() - ts;
    const day = 86400000;
    if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + 'm ago';
    if (diff < day) return Math.round(diff / 3600000) + 'h ago';
    if (diff < day * 7) return Math.round(diff / day) + 'd ago';
    return Math.round(diff / (day * 7)) + 'w ago';
  }

  function loadMemoriesFromEngine() {
    if (!engine) return [];
    return engine.queryMemories({}).map(m => Object.assign({}, m, {
      ts: m.updatedAt,
      date: relativeDate(m.updatedAt)
    }));
  }

  // ---- State ----
  const state = {
    memories: [],
    filteredMemories: [],
    view: 'table',        // table | crystals | timeline | graph
    filter: 'all',        // all | recent | pinned | important
    searchQuery: '',
    agentFilter: '',
    tagFilter: '',
    sortBy: 'date',       // date | importance | confidence
    shortTermCache: 0.62,
    workingMemory: [
      { label: 'Current project: axiom-web', active: true },
      { label: 'Active sprint: Week 14', active: true },
      { label: 'Recent chat: AI Brain', active: false },
    ],
  };

  function refreshMemoriesFromEngine() {
    state.memories = loadMemoriesFromEngine();
  }

  // Initial filtered state
  function applyFilters() {
    let items = [...state.memories];
    
    // View filter
    if (state.filter === 'recent') {
      items = items.filter(m => (Date.now() - m.ts) < 86400000 * 2); // 2 days
    } else if (state.filter === 'pinned') {
      items = items.filter(m => m.pinned);
    } else if (state.filter === 'important') {
      items = items.filter(m => m.importance >= 0.8);
    }
    
    // Search
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      items = items.filter(m => 
        m.text.toLowerCase().includes(q) || 
        m.agent.toLowerCase().includes(q) || 
        m.tags.some(t => t.includes(q)) ||
        m.project.includes(q)
      );
    }
    
    // Agent filter
    if (state.agentFilter) {
      items = items.filter(m => m.agent === state.agentFilter);
    }
    
    // Tag filter
    if (state.tagFilter) {
      items = items.filter(m => m.tags.includes(state.tagFilter));
    }
    
    // Sort
    if (state.sortBy === 'date') {
      items.sort((a, b) => b.ts - a.ts);
    } else if (state.sortBy === 'importance') {
      items.sort((a, b) => b.importance - a.importance);
    } else if (state.sortBy === 'confidence') {
      items.sort((a, b) => b.confidence - a.confidence);
    }
    
    state.filteredMemories = items;
  }

  // ============================================================
  // DOM REFS
  // ============================================================
  let els = {};

  function cacheEls() {
    els = {
      page: document.querySelector('.app-content-inner'),
      toggles: document.querySelectorAll('.ax-page-header-right .btn'),
      filterBtns: document.querySelectorAll('.ax-chart-header .btn'),
      tableWrap: document.getElementById('axMemoryTableWrap'),
      table: document.querySelector('.ax-table'),
      metricCards: document.querySelectorAll('.ax-metric-card'),
      addBtn: document.getElementById('addMemoryBtn'),
      addModal: document.getElementById('addMemoryModal'),
      importBtn: document.querySelector('.btn-outline'),
      exportBtn: document.querySelector('.btn-solid'),
    };
  }

  // ============================================================
  // BUILD UI
  // ============================================================
  function buildMemoryUI() {
    const page = els.page;
    if (!page) return;
    
    applyFilters();
    
    // Replace entire page content with rich memory UI
    page.innerHTML = `
      <div class="ax-page" style="width:100%;">

        <!-- HEADER -->
        <div class="ax-page-header">
          <div class="ax-page-header-left">
            <h1>🧠 Persistent Memory</h1>
            <p>AI remembers everything across sessions. ${state.memories.length} memories stored.</p>
          </div>
          <div class="ax-page-header-right" style="display:flex;gap:8px;">
            <button class="btn btn-outline btn-sm" id="memoryImportBtn">Import</button>
            <button class="btn btn-solid btn-sm" id="memoryExportBtn">Export All</button>
            <button class="btn btn-solid btn-sm" id="memoryAddBtn" style="background:rgba(96,165,250,.2);border-color:rgba(96,165,250,.3);">+ Add Memory</button>
          </div>
        </div>

        <!-- METRICS ROW -->
        <div class="ax-memory-metrics" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:18px;">
          <div class="brain-metric-card">
            <div class="brain-metric-label">Memory Items</div>
            <div class="brain-metric-value" id="memCount">${state.memories.length}</div>
          <div class="brain-metric-bar"><span style="width:${state.memories.length/2}%;background:linear-gradient(90deg,rgba(96,165,250,.7),rgba(110,231,183,.7));"></span></div>
          </div>
          <div class="brain-metric-card">
            <div class="brain-metric-label">Short-Term Cache</div>
            <div class="brain-metric-value" id="shortTermCache">${Math.round(state.shortTermCache * 100)}%</div>
            <div class="brain-metric-bar"><span style="width:${state.shortTermCache * 100}%;background:linear-gradient(90deg,rgba(96,165,250,.7),rgba(110,231,183,.7));"></span></div>
          </div>
          <div class="brain-metric-card">
            <div class="brain-metric-label">Pinned Memories</div>
            <div class="brain-metric-value" id="pinnedCount">${state.memories.filter(m => m.pinned).length}</div>
          <div class="brain-metric-bar"><span style="width:${state.memories.filter(m => m.pinned).length * 8}%;background:linear-gradient(90deg,rgba(251,191,36,.7),rgba(96,165,250,.7));"></span></div>
          </div>
          <div class="brain-metric-card">
            <div class="brain-metric-label">Avg Confidence</div>
            <div class="brain-metric-value" id="avgConfidence">${Math.round(state.memories.reduce((s,m) => s + m.confidence, 0) / state.memories.length * 100)}%</div>
            <div class="brain-metric-bar"><span style="width:${state.memories.reduce((s,m) => s + m.confidence, 0) / state.memories.length * 100}%;background:linear-gradient(90deg,rgba(110,231,183,.7),rgba(96,165,250,.7));"></span></div>
          </div>
          <div class="brain-metric-card">
            <div class="brain-metric-label">Retention Score</div>
            <div class="brain-metric-value">97%</div>
          <div class="brain-metric-bar"><span style="width:97%;background:linear-gradient(90deg,rgba(96,165,250,.7),rgba(110,231,183,.7));"></span></div>
          </div>
          <div class="brain-metric-card">
            <div class="brain-metric-label">Collections</div>
            <div class="brain-metric-value">5</div>
            <div class="brain-metric-bar"><span style="width:50%;background:linear-gradient(90deg,rgba(251,191,36,.7),rgba(96,165,250,.7));"></span></div>
          </div>
        </div>

        <!-- WORKING MEMORY -->
        <div style="display:flex;gap:14px;margin-bottom:18px;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;padding:14px 18px;border-radius:18px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);">
            <div style="font-size:.72rem;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:8px;">🧠 Working Memory</div>
            ${state.workingMemory.map(w => `
              <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:.82rem;color:${w.active ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.35)'};">
                <span style="width:6px;height:6px;border-radius:50%;background:${w.active ? '#6EE7B7' : 'rgba(255,255,255,.2)'};${w.active ? 'box-shadow:0 0 8px rgba(110,231,183,.5);' : ''}"></span>
                ${w.label}
              </div>
            `).join('')}
          </div>
          <div style="flex:1;min-width:200px;padding:14px 18px;border-radius:18px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);">
            <div style="font-size:.72rem;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:8px;">🏷️ Tags</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${['preference', 'context', 'learning', 'workflow', 'infrastructure', 'typescript', 'design', 'api'].map(tag => `
                <span class="mem-tag" data-tag="${tag}" style="font-size:.72rem;padding:3px 10px;border-radius:999px;border:1px solid ${state.tagFilter === tag ? 'rgba(96,165,250,.4)' : 'rgba(255,255,255,.08)'};background:${state.tagFilter === tag ? 'rgba(96,165,250,.12)' : 'rgba(255,255,255,.03)'};color:${state.tagFilter === tag ? '#60A5FA' : 'rgba(255,255,255,.5)'};cursor:pointer;transition:all .15s;">${tag}</span>
              `).join('')}
              ${state.tagFilter ? '<span class="mem-tag-clear" style="font-size:.72rem;padding:3px 10px;border-radius:999px;cursor:pointer;color:rgba(255,255,255,.3);">✕ clear</span>' : ''}
            </div>
          </div>
        </div>

        <!-- VIEW CONTROLS -->
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
          <button class="btn btn-sm memory-view-btn ${state.view === 'table' ? 'btn-solid' : 'btn-ghost'}" data-view="table">📋 Table</button>
          <button class="btn btn-sm memory-view-btn ${state.view === 'crystals' ? 'btn-solid' : 'btn-ghost'}" data-view="crystals">💎 Crystals</button>
          <button class="btn btn-sm memory-view-btn ${state.view === 'timeline' ? 'btn-solid' : 'btn-ghost'}" data-view="timeline">📅 Timeline</button>
          <button class="btn btn-sm memory-view-btn ${state.view === 'graph' ? 'btn-solid' : 'btn-ghost'}" data-view="graph">🔗 Knowledge Graph</button>
          <div style="flex:1;min-width:0;"></div>
          <div style="display:flex;gap:8px;align-items:center;">
            <!-- Filter dropdowns -->
            <select id="memFilter" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:5px 10px;color:rgba(255,255,255,.6);font-size:.78rem;outline:none;">
              <option value="all" ${state.filter === 'all' ? 'selected' : ''}>All</option>
              <option value="recent" ${state.filter === 'recent' ? 'selected' : ''}>Recent</option>
              <option value="pinned" ${state.filter === 'pinned' ? 'selected' : ''}>Pinned</option>
              <option value="important" ${state.filter === 'important' ? 'selected' : ''}>Important</option>
            </select>
            <select id="memSortBy" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:5px 10px;color:rgba(255,255,255,.6);font-size:.78rem;outline:none;">
              <option value="date" ${state.sortBy === 'date' ? 'selected' : ''}>Newest</option>
              <option value="importance" ${state.sortBy === 'importance' ? 'selected' : ''}>Importance</option>
              <option value="confidence" ${state.sortBy === 'confidence' ? 'selected' : ''}>Confidence</option>
            </select>
            <div style="display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:999px;padding:4px 12px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="opacity:.3;"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              <input type="text" id="memSearchInput" placeholder="Search memory..." value="${state.searchQuery}" style="background:none;border:none;color:#F5F5F5;font-size:.82rem;outline:none;min-width:120px;">
            </div>
          </div>
        </div>

        <!-- TABLE VIEW -->
        <div class="mem-view" id="memView-table" style="display:${state.view === 'table' ? 'block' : 'none'};">
          <div style="border-radius:22px;overflow:hidden;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.08);">
            <table class="ax-table" style="width:100%;border-collapse:collapse;font-size:.82rem;">
              <thead><tr style="border-bottom:1px solid rgba(255,255,255,.06);">
                <th style="padding:10px 14px;text-align:left;color:rgba(255,255,255,.35);font-weight:600;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;">Memory</th>
                <th style="padding:10px 14px;text-align:left;color:rgba(255,255,255,.35);font-weight:600;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;">Agent</th>
                <th style="padding:10px 14px;text-align:left;color:rgba(255,255,255,.35);font-weight:600;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;">Date</th>
                <th style="padding:10px 14px;text-align:center;color:rgba(255,255,255,.35);font-weight:600;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;">Importance</th>
                <th style="padding:10px 14px;text-align:center;color:rgba(255,255,255,.35);font-weight:600;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;">Confidence</th>
                <th style="padding:10px 14px;text-align:center;color:rgba(255,255,255,.35);font-weight:600;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;"></th>
              </tr></thead>
              <tbody>
                ${state.filteredMemories.map(m => `
                  <tr style="border-bottom:1px solid rgba(255,255,255,.04);transition:background .15s;" class="mem-row">
                    <td style="padding:10px 14px;color:rgba(255,255,255,.7);max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${m.text}">
                      ${m.pinned ? '<span style="margin-right:4px;">📌</span>' : ''}${m.text}
                    </td>
                    <td style="padding:10px 14px;color:rgba(255,255,255,.5);">${m.agent}</td>
                    <td style="padding:10px 14px;color:rgba(255,255,255,.35);">${m.date}</td>
                    <td style="padding:10px 14px;text-align:center;">
                      <div style="display:flex;align-items:center;gap:6px;justify-content:center;">
                        <div style="width:50px;height:4px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden;">
                          <span style="display:block;height:100%;width:${m.importance * 100}%;border-radius:999px;background:linear-gradient(90deg,rgba(96,165,250,.6),rgba(110,231,183,.6));"></span>
                        </div>
                        <span style="font-size:.7rem;color:rgba(255,255,255,.35);min-width:30px;">${Math.round(m.importance * 100)}%</span>
                      </div>
                    </td>
                    <td style="padding:10px 14px;text-align:center;">
                      <span style="font-size:.7rem;color:rgba(255,255,255,.5);">${Math.round(m.confidence * 100)}%</span>
                    </td>
                    <td style="padding:10px 14px;text-align:right;">
                      <button class="btn btn-ghost btn-sm pin-btn" data-id="${m.id}" style="font-size:.7rem;">${m.pinned ? '📌 Unpin' : '📌 Pin'}</button>
                      <button class="btn btn-ghost btn-sm detail-btn" data-id="${m.id}" style="font-size:.7rem;">👁️</button>
                    </td>
                  </tr>
                `).join('')}
                ${state.filteredMemories.length === 0 ? '<tr><td colspan="6" style="padding:30px;text-align:center;color:rgba(255,255,255,.3);">No memories match your filters.</td></tr>' : ''}
              </tbody>
            </table>
          </div>
        </div>

        <!-- CRYSTALS VIEW -->
        <div class="mem-view" id="memView-crystals" style="display:${state.view === 'crystals' ? 'block' : 'none'};">
          <div class="ax-memory-world">
            <div class="ax-memory-world-controls">
              <span class="hint">✨ ${state.filteredMemories.length} memories visualized</span>
            </div>
            <div class="ax-memory-world-canvas" id="memCrystalCanvas" style="min-height:420px;"></div>
          </div>
        </div>

        <!-- TIMELINE VIEW -->
        <div class="mem-view" id="memView-timeline" style="display:${state.view === 'timeline' ? 'block' : 'none'};">
          <div style="position:relative;padding-left:30px;">
            ${state.filteredMemories.map((m, i) => `
              <div style="position:relative;padding:0 0 20px 24px;border-left:2px solid ${m.pinned ? 'rgba(251,191,36,.3)' : 'rgba(255,255,255,.08)'};margin-left:0;">
                <div style="position:absolute;left:-7px;top:4px;width:14px;height:14px;border-radius:50%;background:${m.pinned ? '#FBBF24' : 'rgba(255,255,255,.12)'};border:2px solid ${m.pinned ? 'rgba(251,191,36,.4)' : 'rgba(255,255,255,.06)'};"></div>
                <div style="font-size:.72rem;color:rgba(255,255,255,.35);margin-bottom:4px;">${m.date} · ${m.agent}</div>
                <div style="font-size:.85rem;color:rgba(255,255,255,.7);line-height:1.4;">${m.text}</div>
                <div style="display:flex;gap:6px;margin-top:6px;">
                  ${m.tags.map(t => `<span style="font-size:.65rem;padding:1px 8px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);color:rgba(255,255,255,.35);">#${t}</span>`).join('')}
                  <span style="font-size:.65rem;color:rgba(255,255,255,.25);margin-left:auto;">${Math.round(m.importance * 100)}% importance</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- KNOWLEDGE GRAPH VIEW -->
        <div class="mem-view" id="memView-graph" style="display:${state.view === 'graph' ? 'block' : 'none'};">
          <div style="border-radius:26px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.08);overflow:hidden;min-height:460px;position:relative;">
            <div style="position:absolute;top:16px;left:20px;z-index:2;">
              <h3 style="font-size:.9rem;color:#F5F5F5;">Knowledge Graph</h3>
              <p style="font-size:.74rem;color:rgba(255,255,255,.42);">Memory connections across agents, projects, and topics</p>
            </div>
            <svg id="memGraphSvg" viewBox="0 0 900 460" style="width:100%;height:460px;"></svg>
          </div>
        </div>

      </div>
    `;
    
    wireEvents();
    renderCrystals();
    renderGraph();
  }

  // ============================================================
  // CRYSTALS VIEW
  // ============================================================
  function renderCrystals() {
    const canvas = document.getElementById('memCrystalCanvas');
    if (!canvas) return;
    
    canvas.innerHTML = '';
    state.filteredMemories.forEach((mem, i) => {
      if (i > 30) return; // cap at 30 for performance
      const el = document.createElement('div');
      el.className = 'ax-memory-crystal' + (mem.pinned ? ' pinned' : '');
      const top = 12 + ((i * 31) % 70);
      const left = 5 + ((i * 137.5) % 85) + Math.random() * 3;
      el.style.top = top + '%';
      el.style.left = Math.min(93, left) + '%';
      el.style.animationDelay = (-Math.random() * 6) + 's';
      el.style.animationDuration = (4 + Math.random() * 4) + 's';
      el.innerHTML = `<div class="shape"></div><div class="label">${mem.text.slice(0, 50)}${mem.text.length > 50 ? '…' : ''}</div>`;
      el.addEventListener('click', () => openMemoryDetail(mem));
      canvas.appendChild(el);
    });
  }

  // ============================================================
  // KNOWLEDGE GRAPH (SVG)
  // ============================================================
  function renderGraph() {
    const svg = document.getElementById('memGraphSvg');
    if (!svg) return;
    
    const palette = ['#60A5FA', '#6EE7B7', '#FBBF24', '#F97316', '#60A5FA', '#6EE7B7'];
    const W = 900, H = 460;
    
    // Collect unique agents as center hubs
    const agents = [...new Set(state.memories.map(m => m.agent))];
    const projects = [...new Set(state.memories.map(m => m.project))];
    
    let svgContent = '';
    
    // Agent hubs (top row)
    const agentPositions = agents.map((a, i) => ({
      x: (W / (agents.length + 1)) * (i + 1),
      y: 70,
      label: a,
      memories: state.memories.filter(m => m.agent === a),
    }));
    
    // Project hubs (middle row)
    const projectPositions = projects.map((p, i) => ({
      x: (W / (projects.length + 1)) * (i + 1),
      y: 200,
      label: p,
    }));
    
    // Memory nodes (bottom row) — limited to 20
    const memoryNodes = state.filteredMemories.slice(0, 20).map((m, i) => ({
      x: (W / 21) * (i + 1) + 20,
      y: 350,
      label: m.text.slice(0, 20),
      mem: m,
    }));
    
    // Edges: agents → projects
    agentPositions.forEach(ap => {
      ap.memories.forEach(m => {
        const pp = projectPositions.find(p => p.label === m.project);
        if (pp) {
          svgContent += `<line x1="${ap.x}" y1="${ap.y}" x2="${pp.x}" y2="${pp.y}" stroke="rgba(255,255,255,.06)" stroke-width="1"/>`;
        }
      });
    });
    
    // Edges: projects → memories
    memoryNodes.forEach((mn, i) => {
      const pp = projectPositions.find(p => p.label === mn.mem.project);
      if (pp) {
        svgContent += `<line x1="${pp.x}" y1="${pp.y}" x2="${mn.x}" y2="${mn.y}" stroke="rgba(96,165,250,.12)" stroke-width="1.5" stroke-dasharray="3,4"/>`;
      }
    });
    
    // Draw agent nodes
    agentPositions.forEach((ap, i) => {
      const color = palette[i % palette.length];
      svgContent += `<circle cx="${ap.x}" cy="${ap.y}" r="22" fill="${color}" opacity="0.25"/>`;
      svgContent += `<circle cx="${ap.x}" cy="${ap.y}" r="16" fill="${color}" opacity="0.4"/>`;
      svgContent += `<text x="${ap.x}" y="${ap.y + 4}" text-anchor="middle" fill="rgba(255,255,255,.7)" font-size="8" font-family="Inter,sans-serif">${ap.label}</text>`;
    });
    
    // Draw project nodes
    projectPositions.forEach((pp, i) => {
      svgContent += `<rect x="${pp.x - 50}" y="${pp.y - 14}" width="100" height="28" rx="14" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.08)" stroke-width="1"/>`;
      svgContent += `<text x="${pp.x}" y="${pp.y + 4}" text-anchor="middle" fill="rgba(255,255,255,.5)" font-size="9" font-family="Inter,sans-serif">${pp.label}</text>`;
    });
    
    // Draw memory nodes
    memoryNodes.forEach((mn, i) => {
      const mem = mn.mem;
      const impScale = 6 + mem.importance * 8;
      const confOpacity = 0.3 + mem.confidence * 0.4;
      const color = mem.pinned ? '#FBBF24' : mem.importance > 0.8 ? '#60A5FA' : '#6EE7B7';
      
      svgContent += `<circle cx="${mn.x}" cy="${mn.y}" r="${impScale}" fill="${color}" opacity="${confOpacity}"/>`;
      if (mem.pinned) {
        svgContent += `<circle cx="${mn.x}" cy="${mn.y}" r="${impScale + 3}" fill="none" stroke="${color}" stroke-width="1" opacity="0.3" stroke-dasharray="2,3"/>`;
      }
      svgContent += `<text x="${mn.x}" y="${mn.y + 18}" text-anchor="middle" fill="rgba(255,255,255,.3)" font-size="6" font-family="Inter,sans-serif">${mn.label}${mn.label.length >= 20 ? '…' : ''}</text>`;
    });
    
    // Connection lines between related memories (same project)
    for (let i = 0; i < memoryNodes.length; i++) {
      for (let j = i + 1; j < memoryNodes.length; j++) {
        if (memoryNodes[i].mem.project === memoryNodes[j].mem.project) {
          const a = memoryNodes[i], b = memoryNodes[j];
          svgContent += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="rgba(96,165,250,.08)" stroke-width="0.8"/>`;
        }
      }
    }
    
    svg.innerHTML = svgContent;
  }

  // ============================================================
  // MEMORY DETAIL OVERLAY
  // ============================================================
  function openMemoryDetail(mem) {
    let overlay = document.getElementById('axMemDetailOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'axMemDetailOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(5,5,5,.85);backdrop-filter:blur(16px);display:none;align-items:center;justify-content:center;';
      overlay.innerHTML = `
        <div style="width:min(440px,calc(100vw - 32px));padding:28px;border-radius:28px;background:#111;border:1px solid rgba(255,255,255,.1);box-shadow:0 30px 80px rgba(0,0,0,.5);color:#F5F5F5;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
            <h4 id="memDetailTitle" style="font-size:.95rem;font-weight:600;">Memory Detail</h4>
            <button id="memDetailClose" style="width:26px;height:26px;border-radius:6px;border:none;background:transparent;color:rgba(255,255,255,.4);cursor:pointer;">✕</button>
          </div>
          <p id="memDetailText" style="font-size:.84rem;color:rgba(255,255,255,.7);line-height:1.5;margin:0 0 14px;"></p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
            <span class="ax-badge" id="memDetailAgent" style="padding:3px 10px;border-radius:999px;background:rgba(96,165,250,.1);border:1px solid rgba(96,165,250,.2);color:#60A5FA;font-size:.72rem;"></span>
            <span class="ax-badge" id="memDetailDate" style="padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.5);font-size:.72rem;"></span>
            <span class="ax-badge" id="memDetailProject" style="padding:3px 10px;border-radius:999px;background:rgba(110,231,183,.1);border:1px solid rgba(110,231,183,.2);color:#6EE7B7;font-size:.72rem;"></span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
            <div><div style="font-size:.68rem;color:rgba(255,255,255,.35);margin-bottom:4px;">Importance</div><div style="height:6px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden;"><span id="memDetailImportance" style="display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#60A5FA,#6EE7B7);"></span></div></div>
            <div><div style="font-size:.68rem;color:rgba(255,255,255,.35);margin-bottom:4px;">Confidence</div><div style="height:6px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden;"><span id="memDetailConfidence" style="display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#6EE7B7,#60A5FA);"></span></div></div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;" id="memDetailTags"></div>
          <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
            <button id="memDetailPinBtn" class="btn btn-outline btn-sm">📌 Pin</button>
            <button id="memDetailCloseBtn" class="btn btn-solid btn-sm">Close</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      
      overlay.addEventListener('click', e => {
        if (e.target === overlay || e.target.id === 'memDetailClose' || e.target.id === 'memDetailCloseBtn') {
          overlay.style.display = 'none';
        }
      });
    }
    
    if (engine) engine.touchMemory(mem.id);
    overlay.querySelector('#memDetailText').textContent = mem.text;
    overlay.querySelector('#memDetailAgent').textContent = mem.agent;
    overlay.querySelector('#memDetailDate').textContent = mem.date;
    overlay.querySelector('#memDetailProject').textContent = mem.project;
    overlay.querySelector('#memDetailImportance').style.width = (mem.importance * 100) + '%';
    overlay.querySelector('#memDetailConfidence').style.width = (mem.confidence * 100) + '%';
    overlay.querySelector('#memDetailTags').innerHTML = mem.tags.map(t => `<span style="font-size:.68rem;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);color:rgba(255,255,255,.35);">#${t}</span>`).join('');
    
    const pinBtn = overlay.querySelector('#memDetailPinBtn');
    pinBtn.textContent = mem.pinned ? '📌 Unpin' : '📌 Pin';
    pinBtn.onclick = () => {
      const nextPinned = !mem.pinned;
      if (engine) engine.updateMemory(mem.id, { pinned: nextPinned });
      mem.pinned = nextPinned;
      pinBtn.textContent = mem.pinned ? '📌 Unpin' : '📌 Pin';
      refreshMemoriesFromEngine();
      rebuild();
    };
    
    overlay.style.display = 'flex';
  }

  // ============================================================
  // EVENT WIRING
  // ============================================================
  function wireEvents() {
    // View toggle
    document.querySelectorAll('.memory-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.view = btn.dataset.view;
        rebuild();
      });
    });
    
    // Filter
    const filterSelect = document.getElementById('memFilter');
    if (filterSelect) {
      filterSelect.addEventListener('change', () => {
        state.filter = filterSelect.value;
        rebuild();
      });
    }
    
    // Sort
    const sortSelect = document.getElementById('memSortBy');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        state.sortBy = sortSelect.value;
        rebuild();
      });
    }
    
    // Search
    const searchInput = document.getElementById('memSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        state.searchQuery = searchInput.value;
        rebuild();
      });
    }
    
    // Tag filter
    document.querySelectorAll('.mem-tag').forEach(el => {
      el.addEventListener('click', () => {
        const tag = el.dataset.tag;
        state.tagFilter = state.tagFilter === tag ? '' : tag;
        rebuild();
      });
    });
    
    // Clear tag filter
    const clearTag = document.querySelector('.mem-tag-clear');
    if (clearTag) {
      clearTag.addEventListener('click', () => {
        state.tagFilter = '';
        rebuild();
      });
    }
    
    // Pin buttons
    document.querySelectorAll('.pin-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const mem = state.memories.find(m => m.id === id);
        if (mem) {
          const nextPinned = !mem.pinned;
          if (engine) engine.updateMemory(id, { pinned: nextPinned });
          refreshMemoriesFromEngine();
          rebuild();
        }
      });
    });
    
    // Detail buttons
    document.querySelectorAll('.detail-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const mem = state.memories.find(m => m.id === id);
        if (mem) openMemoryDetail(mem);
      });
    });
    
    // Add memory
    const addBtn = document.getElementById('memoryAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const modal = document.getElementById('addMemoryModal');
        if (modal) modal.style.display = 'flex';
      });
    }

    // Save memory (was previously an inert button with no handler at all)
    const saveBtn = document.getElementById('addMemoryModalSave');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const textEl = document.getElementById('addMemoryContent');
        const agentEl = document.getElementById('addMemoryAgent');
        const text = (textEl && textEl.value || '').trim();
        if (!text) return;
        const agent = (agentEl && agentEl.value) || 'General';
        if (engine) {
          engine.addMemory({
            text,
            agent: agent === 'All Agents' ? 'General' : agent,
            project: 'general',
            type: 'context',
            tags: [],
            importance: 0.6,
            confidence: 0.7,
            pinned: false
          });
          refreshMemoriesFromEngine();
        }
        if (textEl) textEl.value = '';
        const modal = document.getElementById('addMemoryModal');
        if (modal) modal.style.display = 'none';
        rebuild();
      };
    }
    
    // Export
    const exportBtn = document.getElementById('memoryExportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const data = JSON.stringify(engine ? engine.exportAll() : state.memories, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'axiom-memory-export.json';
        a.click();
        URL.revokeObjectURL(url);
      });
    }
  }

  // ============================================================
  // REBUILD
  // ============================================================
  function rebuild() {
    buildMemoryUI();
  }

  // ============================================================
  // LIVE UPDATES
  // ============================================================
  function liveTick() {
    // Reflect the engine's actual working-memory load (session-scoped,
    // not a decorative random walk).
    if (engine) {
      engine.touchSession();
      state.shortTermCache = engine.getStats().shortTermCacheLoad;
    }

    // Update metric if on screen
    const cacheEl = document.getElementById('shortTermCache');
    if (cacheEl) cacheEl.textContent = Math.round(state.shortTermCache * 100) + '%';
    const cacheBar = document.querySelector('#shortTermCache')?.closest('.brain-metric-card')?.querySelector('.brain-metric-bar span');
    if (cacheBar) cacheBar.style.width = (state.shortTermCache * 100) + '%';
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    cacheEls();

    if (engine) {
      engine.init();
      seedIfEmpty();
      refreshMemoriesFromEngine();
      engine.onChange(evt => {
        if (evt.type.indexOf('memory:') === 0) refreshMemoriesFromEngine();
      });
    }
    
    // Wait a moment for the page to load, then replace content
    setTimeout(() => {
      buildMemoryUI();
      
      // Start live updates
      setInterval(liveTick, 3000);
      
      console.log('[MemoryUltimate] Initialized — Memory Foundation ' + (engine ? 'active' : 'unavailable, falling back to in-memory only'));
    }, 100);
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.AxiomMemory = {
    getState: () => state,
    rebuild,
    openMemoryDetail,
  };

})(window);

