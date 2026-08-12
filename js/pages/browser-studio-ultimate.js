/* ============================================================
   AXIOM AI OS V13 — Browser + Studio Ultimate
   ------------------------------------------------------------
   Enhances browser.html with:
   - Vertical tabs sidebar (Arc-style) with spaces
   - Collections for saved pages
   - Split View for page comparison
   - AI Summary sidebar (Perplexity-style)
   - Reader Mode toggle
   - Notes panel
   - Highlights manager
   - Download Manager
   
   Enhances studios.html with:
   - Document Studio (generation, editing, export)
   - Presentation Studio (generation, editing, export)
   - Interactive tool panels for all 6 studios
   ============================================================ */
(function (global) {
  'use strict';

  // ============================================================
  // STATE
  // ============================================================
  const state = {
    browser: {
      tabs: [
        { id: 'tab1', title: 'Axiom AI OS', url: 'https://axiom.ai/os/v13', favicon: '🌐', active: true },
        { id: 'tab2', title: 'GitHub', url: 'https://github.com', favicon: '🐙', active: false },
        { id: 'tab3', title: 'Documentation', url: 'https://docs.axiom.ai', favicon: '📄', active: false },
      ],
      bookmarks: [
        { title: 'Axiom OS Shell', url: '/os-shell.html', icon: '📊' },
        { title: 'AI Brain', url: '/brain.html', icon: '🧠' },
        { title: 'Memory', url: '/memory.html', icon: '💾' },
        { title: 'Agent Library', url: '/agent-library.html', icon: '🤖' },
      ],
      collections: [
        { name: 'Dev Resources', count: 12 },
        { name: 'Design System', count: 8 },
        { name: 'API Docs', count: 15 },
      ],
      downloads: [
        { name: 'axiom-v13-report.pdf', size: '2.4 MB', progress: 100, status: 'complete' },
        { name: 'vision-glass-assets.zip', size: '14.1 MB', progress: 67, status: 'downloading' },
        { name: 'brain-data-export.json', size: '856 KB', progress: 100, status: 'complete' },
      ],
      notes: [
        { text: 'Update the glass effect on the hero section', pinned: true },
        { text: 'Review part 10 pull request', pinned: false },
        { text: 'Add transition animations to new pages', pinned: false },
      ],
      highlights: [
        { text: '"VisionOS Glass on all panels" — Design spec v3.2', color: '#FBBF24' },
        { text: '"60 FPS target for all animations" — Performance goal', color: '#6EE7B7' },
      ],
      aiSummary: null,
      viewerUrl: 'about:blank',
      readerMode: false,
      showSidebar: 'tabs', // tabs | bookmarks | history | collections | notes | highlights | downloads | ai-summary
    },
    studios: {
      activeStudio: 'image',
      docContent: '# Welcome to Document Studio\n\nStart writing or generating documents with AI.\n\n## Features\n- Rich text editing\n- AI-powered generation\n- Export to PDF, DOCX, HTML\n- Templates & formatting',
      presContent: '# Presentation Title\n\n## Slide 1 — Introduction\nYour presentation content here.\n\n## Slide 2 — Key Points\n- Point one\n- Point two\n- Point three',
    },
  };

  // ============================================================
  // BROWSER ENHANCEMENTS
  // ============================================================
  function enhanceBrowser() {
    // Block 2 / Step 5 / Part 3 (Browser Engine integration): browser.html's
    // viewport is now owned end-to-end by the real Browser Engine
    // (os/core/browser-engine.js) via browser-live.js — the live
    // <iframe id="axBrowserFrame"> plus its empty/loading/blocked states.
    // This legacy enhancement predates that engine and used to call
    // `viewport.innerHTML = ''` below, which silently deleted that real
    // iframe (and every element browser-live.js holds a reference to) a
    // couple hundred ms after load and replaced it with a static mock
    // placeholder driven by hardcoded fake tabs — a second, disconnected
    // copy of "browser state" fighting the real one for the same DOM.
    // Per the Browser Engine integration objective ("single source of
    // truth", "remove any duplicated browser state if verified"), skip
    // this mock enhancement whenever the real engine-backed viewport is
    // present, rather than redesign or remove the underlying layout.
    if (document.getElementById('axBrowserFrame')) return;

    const page = document.querySelector('.ax-page');
    if (!page || page.classList.contains('ax-browser-enhanced')) return;
    page.classList.add('ax-browser-enhanced');
    
    // We enhance the existing layout without replacing it
    const viewport = document.querySelector('.ax-browser-viewport');
    const toolbar = document.querySelector('.ax-browser-toolbar');
    const urlBar = document.querySelector('.ax-browser-url');
    
    if (!viewport) return;
    
    // Add sidebar toggle buttons to toolbar
    if (toolbar) {
      const sidebarBtns = document.createElement('div');
      sidebarBtns.style.cssText = 'display:flex;gap:4px;margin-left:auto;';
      const sidebarOptions = [
        { id: 'tabs', icon: '📑', title: 'Tabs' },
        { id: 'bookmarks', icon: '⭐', title: 'Bookmarks' },
        { id: 'notes', icon: '📝', title: 'Notes' },
        { id: 'downloads', icon: '⬇️', title: 'Downloads' },
        { id: 'ai-summary', icon: '🤖', title: 'AI Summary' },
      ];
      sidebarOptions.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'icon-btn';
        btn.style.cssText = `width:30px;height:30px;border-radius:8px;font-size:13px;background:${state.browser.showSidebar === opt.id ? 'rgba(255,255,255,.08)' : 'transparent'};`;
        btn.title = opt.title;
        btn.textContent = opt.icon;
        btn.addEventListener('click', () => {
          state.browser.showSidebar = state.browser.showSidebar === opt.id ? null : opt.id;
          updateBrowserSidebar();
          btn.style.background = state.browser.showSidebar === opt.id ? 'rgba(255,255,255,.08)' : 'transparent';
        });
        sidebarBtns.appendChild(btn);
      });
      toolbar.appendChild(sidebarBtns);
    }
    
    // Add reader mode + AI summary buttons to URL bar
    if (urlBar) {
      const readerBtn = document.createElement('button');
      readerBtn.className = 'icon-btn';
      readerBtn.style.cssText = 'width:26px;height:26px;border-radius:8px;font-size:11px;';
      readerBtn.title = 'Reader Mode';
      readerBtn.innerHTML = state.browser.readerMode ? '📖' : '📄';
      readerBtn.addEventListener('click', () => {
        state.browser.readerMode = !state.browser.readerMode;
        readerBtn.innerHTML = state.browser.readerMode ? '📖' : '📄';
        updateBrowserViewport();
      });
      urlBar.appendChild(readerBtn);
    }
    
    // Transform viewport into a split view with sidebar
    viewport.style.display = 'flex';
    viewport.style.flexDirection = 'row';
    viewport.style.gap = '0';
    viewport.style.padding = '0';
    viewport.style.alignItems = 'stretch';
    viewport.style.minHeight = '300px';
    
    // Main content area
    const mainArea = document.createElement('div');
    mainArea.id = 'axBrowserMain';
    mainArea.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:40px;';
    mainArea.innerHTML = `
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style="opacity:.2;"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 00-10 10M12 2a15 15 0 0110 10" stroke="currentColor" stroke-width="1.6"/></svg>
      <span style="font-size:.9rem;color:rgba(255,255,255,.2);">Page loaded in embedded browser</span>
      <span style="font-size:.74rem;color:rgba(255,255,255,.12);">Use the sidebar for AI-powered tools</span>
    `;
    
    // Sidebar panel
    const sidebarPanel = document.createElement('div');
    sidebarPanel.id = 'axBrowserSidebar';
    sidebarPanel.style.cssText = 'width:0;overflow:hidden;transition:width .25s ease;border-left:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.015);';
    
    viewport.innerHTML = '';
    viewport.appendChild(mainArea);
    viewport.appendChild(sidebarPanel);
    
    // Wire up existing tab clicks to update display
    wireBrowserTabs();
  }
  
  function wireBrowserTabs() {
    const tabs = document.querySelectorAll('.ax-browser-tab');
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        const titles = ['Axiom AI OS', 'GitHub', 'Documentation'];
        if (state.browser.tabs[i]) {
          state.browser.tabs[i].active = true;
          const main = document.getElementById('axBrowserMain');
          if (main) {
            main.innerHTML = `
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style="opacity:.2;"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 00-10 10M12 2a15 15 0 0110 10" stroke="currentColor" stroke-width="1.6"/></svg>
              <span style="font-size:.9rem;color:rgba(255,255,255,.25);">${titles[i]} — loaded</span>
              <span style="font-size:.74rem;color:rgba(255,255,255,.12);">${state.browser.tabs[i].url}</span>
            `;
          }
          const urlInput = document.querySelector('.ax-browser-url input');
          if (urlInput) urlInput.value = state.browser.tabs[i].url;
        }
      });
    });
  }
  
  function updateBrowserSidebar() {
    const panel = document.getElementById('axBrowserSidebar');
    if (!panel) return;
    
    const mode = state.browser.showSidebar;
    if (!mode) {
      panel.style.width = '0';
      panel.style.padding = '0';
      return;
    }
    
    panel.style.width = '280px';
    panel.style.padding = '16px';
    
    let content = '';
    
    switch (mode) {
      case 'tabs':
        content = `
          <div style="font-size:.75rem;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:10px;">📑 Open Tabs (${state.browser.tabs.length})</div>
          ${state.browser.tabs.map(t => `
            <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:${t.active ? 'rgba(255,255,255,.06)' : 'transparent'};cursor:pointer;transition:background .15s;margin-bottom:4px;">
              <span style="font-size:14px;">${t.favicon}</span>
              <span style="font-size:.8rem;color:rgba(255,255,255,.6);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.title}</span>
              <span style="font-size:.58rem;color:rgba(255,255,255,.2);">✕</span>
            </div>
          `).join('')}
          <div style="margin-top:20px;">
            <div style="font-size:.75rem;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:10px;">📚 Collections</div>
            ${state.browser.collections.map(c => `
              <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;">
                <span style="font-size:.72rem;color:rgba(255,255,255,.5);flex:1;">${c.name}</span>
                <span style="font-size:.65rem;color:rgba(255,255,255,.25);">${c.count}</span>
              </div>
            `).join('')}
          </div>
        `;
        break;
        
      case 'bookmarks':
        content = `
          <div style="font-size:.75rem;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:10px;">⭐ Bookmarks</div>
          ${state.browser.bookmarks.map(b => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;transition:background .15s;">
              <span>${b.icon}</span>
              <span style="font-size:.8rem;color:rgba(255,255,255,.55);">${b.title}</span>
            </div>
          `).join('')}
          <div style="margin-top:16px;">
            <input type="text" id="axBookmarkInput" placeholder="Add bookmark URL..." style="width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:8px 12px;color:rgba(255,255,255,.5);font-size:.78rem;outline:none;">
          </div>
        `;
        break;
        
      case 'notes':
        content = `
          <div style="font-size:.75rem;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:10px;">📝 Notes</div>
          ${state.browser.notes.map(n => `
            <div style="padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);margin-bottom:8px;">
              <div style="font-size:.78rem;color:rgba(255,255,255,.55);line-height:1.4;">${n.text}</div>
              ${n.pinned ? '<span style="font-size:.6rem;color:#FBBF24;margin-top:4px;display:inline-block;">📌 Pinned</span>' : ''}
            </div>
          `).join('')}
          <div style="display:flex;gap:6px;margin-top:8px;">
            <input type="text" id="axNoteInput" placeholder="Add a note..." style="flex:1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:8px 12px;color:rgba(255,255,255,.5);font-size:.78rem;outline:none;">
            <button class="btn btn-solid btn-sm" id="axNoteAddBtn">+</button>
          </div>
        `;
        break;
        
      case 'downloads':
        content = `
          <div style="font-size:.75rem;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:10px;">⬇️ Downloads</div>
          ${state.browser.downloads.map(d => `
            <div style="padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);margin-bottom:8px;">
              <div style="display:flex;align-items:center;justify-content:space-between;">
                <span style="font-size:.78rem;color:rgba(255,255,255,.55);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.name}</span>
                <span style="font-size:.65rem;color:rgba(255,255,255,.3);">${d.size}</span>
              </div>
              <div style="height:3px;border-radius:999px;background:rgba(255,255,255,.05);overflow:hidden;margin-top:6px;">
                <span style="display:block;height:100%;width:${d.progress}%;border-radius:999px;background:${d.status === 'complete' ? 'rgba(110,231,183,.6)' : 'rgba(96,165,250,.6)'};"></span>
              </div>
              <span style="font-size:.6rem;color:${d.status === 'complete' ? 'rgba(110,231,183,.4)' : 'rgba(96,165,250,.4)'};">${d.status === 'complete' ? '✅ Complete' : '⏳ Downloading...'}</span>
            </div>
          `).join('')}
        `;
        break;
        
      case 'ai-summary':
        content = `
          <div style="font-size:.75rem;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:10px;">🤖 AI Summary</div>
          <div style="padding:12px;border-radius:14px;background:rgba(96,165,250,.06);border:1px solid rgba(96,165,250,.15);margin-bottom:12px;">
            <div style="font-size:.75rem;color:rgba(255,255,255,.4);margin-bottom:6px;">Page Context</div>
            <div style="font-size:.82rem;color:rgba(255,255,255,.65);line-height:1.5;">
              This appears to be the Axiom AI OS interface — a premium AI operating system dashboard with glass-morphism design, task management, and multi-agent support.
            </div>
          </div>
          <div style="font-size:.75rem;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:8px;">🔍 Key Points</div>
          <div style="font-size:.78rem;color:rgba(255,255,255,.5);line-height:1.6;">
            • Glass-morphism UI with dark theme (#050505)<br>
            • 10+ AI agents available for different tasks<br>
            • Memory system with 248 stored items<br>
            • Workspace with document/canvas/mind map tools<br>
            • Live cognition monitoring in AI Brain
          </div>
          <div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap;">
            <span style="font-size:.68rem;padding:3px 10px;border-radius:999px;background:rgba(168,85,247,.1);border:1px solid rgba(168,85,247,.2);color:#C4B5FD;">Summarize</span>
            <span style="font-size:.68rem;padding:3px 10px;border-radius:999px;background:rgba(110,231,183,.1);border:1px solid rgba(110,231,183,.2);color:#6EE7B7;">Translate</span>
            <span style="font-size:.68rem;padding:3px 10px;border-radius:999px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.2);color:#FBBF24;">Explain</span>
          </div>
        `;
        break;
    }
    
    panel.innerHTML = content;
    
    // Wire up note add
    const noteAddBtn = document.getElementById('axNoteAddBtn');
    const noteInput = document.getElementById('axNoteInput');
    if (noteAddBtn && noteInput) {
      noteAddBtn.addEventListener('click', () => {
        const text = noteInput.value.trim();
        if (text) {
          state.browser.notes.unshift({ text, pinned: false });
          noteInput.value = '';
          updateBrowserSidebar();
        }
      });
      noteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') noteAddBtn.click();
      });
    }
  }
  
  function updateBrowserViewport() {
    const main = document.getElementById('axBrowserMain');
    if (!main) return;
    
    if (state.browser.readerMode) {
      main.innerHTML = `
        <div style="max-width:680px;width:100%;text-align:left;">
          <div style="font-size:1.4rem;font-weight:700;color:#F5F5F5;margin-bottom:8px;">Axiom AI OS v13 — Documentation</div>
          <div style="font-size:.78rem;color:rgba(255,255,255,.35);margin-bottom:20px;">Published · 12 min read</div>
          <div style="font-size:.92rem;color:rgba(255,255,255,.7);line-height:1.7;">
            <p>Axiom AI OS v13 represents a complete reimagining of the AI operating system paradigm. Built on a foundation of glass-morphism design principles, it delivers a unified interface for interacting with multiple AI agents, managing persistent memory, and creating content across various studios.</p>
            <p>The system features a Mission Control dashboard with live AI Core visualization, an intelligent chat interface, a full workspace with document/canvas/mind maps, and dedicated studios for image, video, audio, and 3D content creation.</p>
          </div>
        </div>
      `;
    } else {
      main.innerHTML = `
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style="opacity:.2;"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 00-10 10M12 2a15 15 0 0110 10" stroke="currentColor" stroke-width="1.6"/></svg>
        <span style="font-size:.9rem;color:rgba(255,255,255,.25);">Browse the web securely with AI</span>
        <span style="font-size:.74rem;color:rgba(255,255,255,.12);">Use the sidebar for bookmarks, notes, download manager, and AI summary</span>
      `;
    }
  }

  // ============================================================
  // STUDIOS ENHANCEMENTS — Add Document + Presentation studios
  // ============================================================
  function enhanceStudios() {
    const page = document.querySelector('.app-content-inner section.panel');
    if (!page || page.classList.contains('ax-studios-enhanced')) return;
    page.classList.add('ax-studios-enhanced');
    
    // Find the studio nav and section containers
    const studioNav = document.getElementById('studioNav');
    const studioContainer = studioNav ? studioNav.parentElement : null;
    if (!studioContainer) return;
    
    // Add Document Studio and Presentation Studio to nav
    const docCard = document.createElement('button');
    docCard.type = 'button';
    docCard.className = 'studio-nav-card';
    docCard.dataset.studio = 'document';
    docCard.innerHTML = `
      <div class="studio-nav-icon" style="background:rgba(251,191,36,.1);color:#FBBF24;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </div>
      <div class="studio-nav-name">Document Studio</div>
      <div class="studio-nav-sub">Generate, edit &amp; export docs</div>
      <div class="studio-nav-count">5 tools</div>
    `;
    
    const presCard = document.createElement('button');
    presCard.type = 'button';
    presCard.className = 'studio-nav-card';
    presCard.dataset.studio = 'presentation';
    presCard.innerHTML = `
      <div class="studio-nav-icon" style="background:rgba(239,68,68,.1);color:#EF4444;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M12 16v4M8 20h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </div>
      <div class="studio-nav-name">Presentation Studio</div>
      <div class="studio-nav-sub">Slides, themes &amp; exports</div>
      <div class="studio-nav-count">5 tools</div>
    `;
    
    studioNav.appendChild(docCard);
    studioNav.appendChild(presCard);
    // Update grid to 6 columns
    studioNav.style.gridTemplateColumns = 'repeat(6,1fr)';
    
    // Add sections
    const lastSection = document.getElementById('studio-three-d');
    if (lastSection) {
      // Document Studio
      const docSection = document.createElement('div');
      docSection.className = 'studio-section';
      docSection.id = 'studio-document';
      docSection.innerHTML = `
        <div class="studio-section-head">
          <div>
            <h2><span style="color:#FBBF24;">◆</span>&nbsp;Document Studio</h2>
            <p>Create and format professional documents with AI assistance.</p>
          </div>
        </div>
        <div class="tool-grid">
          <div class="tool-card">
            <div class="tool-card-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3v18M3 12h18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></div>
            <div class="tool-card-name">Generate Document</div>
            <div class="tool-card-desc">Create a fully formatted document from a text prompt.</div>
            <div class="tool-card-actions"><button class="btn btn-solid btn-sm open-studio" data-studio="document">Open</button></div>
          </div>
          <div class="tool-card">
            <div class="tool-card-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M17 3l4 4-11 11H6v-4L17 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
            <div class="tool-card-name">Edit Document</div>
            <div class="tool-card-desc">Edit, format, and restructure existing documents.</div>
            <div class="tool-card-actions"><button class="btn btn-solid btn-sm open-studio" data-studio="document">Open</button></div>
          </div>
          <div class="tool-card">
            <div class="tool-card-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M3 12h18M8 6v12M14 6v12" stroke="currentColor" stroke-width="1.4"/></svg></div>
            <div class="tool-card-name">Templates</div>
            <div class="tool-card-desc">Start from a library of pre-built document templates.</div>
            <div class="tool-card-actions"><button class="btn btn-solid btn-sm">Browse</button></div>
          </div>
          <div class="tool-card">
            <div class="tool-card-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M3 9h18" stroke="currentColor" stroke-width="1.6"/></svg></div>
            <div class="tool-card-name">Formatting</div>
            <div class="tool-card-desc">Apply styles, headings, tables, and consistent formatting.</div>
            <div class="tool-card-actions"><button class="btn btn-solid btn-sm">Open</button></div>
          </div>
          <div class="tool-card">
            <div class="tool-card-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            <div class="tool-card-name">Export</div>
            <div class="tool-card-desc">Export to PDF, DOCX, HTML, or Markdown format.</div>
            <div class="tool-card-actions"><button class="btn btn-solid btn-sm">Export</button></div>
          </div>
        </div>
      `;
      
      // Presentation Studio
      const presSection = document.createElement('div');
      presSection.className = 'studio-section';
      presSection.id = 'studio-presentation';
      presSection.innerHTML = `
        <div class="studio-section-head">
          <div>
            <h2><span style="color:#EF4444;">◆</span>&nbsp;Presentation Studio</h2>
            <p>Design and present stunning slide decks with AI.</p>
          </div>
        </div>
        <div class="tool-grid">
          <div class="tool-card">
            <div class="tool-card-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M12 16v4M8 20h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></div>
            <div class="tool-card-name">Generate Deck</div>
            <div class="tool-card-desc">Create a multi-slide deck from a topic or prompt.</div>
            <div class="tool-card-actions"><button class="btn btn-solid btn-sm open-studio" data-studio="presentation">Open</button></div>
          </div>
          <div class="tool-card">
            <div class="tool-card-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M17 3l4 4-11 11H6v-4L17 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
            <div class="tool-card-name">Edit Slides</div>
            <div class="tool-card-desc">Edit slide content, layout, and visual hierarchy.</div>
            <div class="tool-card-actions"><button class="btn btn-solid btn-sm">Open</button></div>
          </div>
          <div class="tool-card">
            <div class="tool-card-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></div>
            <div class="tool-card-name">Themes</div>
            <div class="tool-card-desc">Apply and customize themes, fonts, and color palettes.</div>
            <div class="tool-card-actions"><button class="btn btn-solid btn-sm">Browse</button></div>
          </div>
          <div class="tool-card">
            <div class="tool-card-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M18 4v4h-4M6 20v-4h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            <div class="tool-card-name">Transitions</div>
            <div class="tool-card-desc">Add slide transitions, animations, and auto-advance timing.</div>
            <div class="tool-card-actions"><button class="btn btn-solid btn-sm">Open</button></div>
          </div>
          <div class="tool-card">
            <div class="tool-card-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            <div class="tool-card-name">Export</div>
            <div class="tool-card-desc">Export to PPTX, PDF, or shareable web link.</div>
            <div class="tool-card-actions"><button class="btn btn-solid btn-sm">Export</button></div>
          </div>
        </div>
      `;
      
      lastSection.after(docSection);
      docSection.after(presSection);
    }
    
    // Wire up studio nav clicks (preserving existing + new)
    const allNavCards = document.querySelectorAll('.studio-nav-card');
    const allSections = document.querySelectorAll('.studio-section');
    
    // Remove existing listeners by cloning
    const newNav = studioNav.cloneNode(true);
    studioNav.parentElement.replaceChild(newNav, studioNav);
    
    newNav.querySelectorAll('.studio-nav-card').forEach(card => {
      card.addEventListener('click', () => {
        const target = card.dataset.studio;
        newNav.querySelectorAll('.studio-nav-card').forEach(c => c.classList.toggle('active', c === card));
        document.querySelectorAll('.studio-section').forEach(s => s.classList.toggle('active', s.id === 'studio-' + target));
      });
    });
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    // Detect which page we're on
    const path = window.location.pathname;
    const filename = path.split('/').pop() || '';
    
    if (filename === 'browser.html' || path.endsWith('browser')) {
      setTimeout(enhanceBrowser, 200);
      console.log('[BrowserStudioUltimate] Browser enhanced');
    }
    
    if (filename === 'studios.html' || path.endsWith('studios')) {
      setTimeout(enhanceStudios, 200);
      console.log('[BrowserStudioUltimate] Studios enhanced');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.AxiomBrowserStudio = {
    state,
    enhanceBrowser,
    enhanceStudios,
  };

})(window);

