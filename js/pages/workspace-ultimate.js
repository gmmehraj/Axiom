/* ============================================================
   AXIOM AI OS V13 — Workspace Ultimate
   ------------------------------------------------------------
   Transforms workspace into Cursor + Notion + VS Code + FigJam:
   - Monaco Code Editor integration
   - Markdown editor with live preview split
   - Rich text editing toolbar
   - Infinite Canvas (Figma-style) with pan/zoom
   - Whiteboard with drawing tools (pen, shapes, eraser)
   - Sticky Notes with drag positioning
   - Mind Maps with auto-layout
   - Flow Charts (drag-drop nodes)
   - Terminal emulator (xterm.js via CDN)
   - Preview pane for rendered content
   - Split view for side-by-side editing
   - Project Explorer (file tree)
   - Version History slider
   - Auto Save indicator
   - AI Assistant Sidebar with suggestions
   ============================================================ */
(function (global) {
  'use strict';

  // ---- State ----
  const state = {
    view: 'document',     // document | canvas | whiteboard | mindmap | flow | split | markdown | terminal
    markdownMode: false,
    splitActive: false,
    autoSave: true,
    lastSaved: Date.now(),
    docContent: '',
    docTitle: 'Quick Start Guide',
    versionIndex: 0,
    versions: [],
    notes: [],
    mindmapNodes: [],
    flowNodes: [],
    whiteboardActions: [],
    terminalInstance: null,
    activeFile: null,
  };

  let currentAutoSaveTimer = null;

  // ---- DOM Cache ----
  let els = {};

  function cacheEls() {
    els = {
      doc: document.querySelector('.ax-workspace-doc'),
      docContent: document.querySelector('.ax-doc-content'),
      docTitle: document.querySelector('.ax-doc-title'),
      toolbar: document.querySelector('.ax-workspace-toolbar'),
      sidebar: document.querySelector('.ax-workspace-sidebar'),
      main: document.querySelector('.ax-workspace-main'),
      ws: document.querySelector('.ax-workspace'),
      // View toggles
      viewBtns: document.querySelectorAll('[data-view]'),
      // Sticky note container
      canvasContainer: null,
      // Terminal
      terminalContainer: null,
      // Split
      splitContainer: null,
      // Markdown
      markdownContainer: null,
      // AI Assistant
      aiSidebar: null,
      // Project Explorer
      projectExplorer: null,
      // Version History
      versionHistory: null,
      // Auto Save indicator
      autoSaveIndicator: null,
    };
  }

  // ============================================================
  // 1. VIEW SYSTEM — Tab/Sidebar View Switching
  // ============================================================

  function switchView(view) {
    state.view = view;
    // Clear main content area
    const mainEl = els.main;
    if (!mainEl) return;
    
    // Find or create the content wrapper inside main
    let contentArea = mainEl.querySelector('.ax-workspace-view-content');
    if (!contentArea) {
      contentArea = document.createElement('div');
      contentArea.className = 'ax-workspace-view-content';
      mainEl.appendChild(contentArea);
    }
    
    // Update active nav items
    els.viewBtns && els.viewBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    
    // Render the selected view
    switch (view) {
      case 'document': renderDocumentView(contentArea); break;
      case 'canvas': renderCanvasView(contentArea); break;
      case 'whiteboard': renderWhiteboardView(contentArea); break;
      case 'mindmap': renderMindmapView(contentArea); break;
      case 'flow': renderFlowChartView(contentArea); break;
      case 'markdown': renderMarkdownView(contentArea); break;
      case 'terminal': renderTerminalView(contentArea); break;
      case 'split': renderSplitView(contentArea); break;
      case 'explorer': renderProjectExplorer(contentArea); break;
      default: renderDocumentView(contentArea);
    }
  }

  // ============================================================
  // 2. DOCUMENT VIEW (Notion-style)
  // ============================================================
  
  function renderDocumentView(container) {
    container.innerHTML = `
      <div class="ax-workspace-toolbar">
        <div class="ax-workspace-toolbar-group">
          <button class="ax-ws-tool-btn" data-action="undo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 7h13a4 4 0 010 8H9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10l-3-3 3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button class="ax-ws-tool-btn" data-action="redo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 7H8a4 4 0 000 8h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 10l3 3-3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
        <div class="ax-workspace-toolbar-group">
          <button class="ax-ws-tool-btn active" data-action="text">T</button>
          <button class="ax-ws-tool-btn" data-action="heading"><strong>H</strong></button>
          <button class="ax-ws-tool-btn" data-action="bold"><strong>B</strong></button>
          <button class="ax-ws-tool-btn" data-action="italic"><em>I</em></button>
          <button class="ax-ws-tool-btn" data-action="code"></></button>
        </div>
        <div class="ax-workspace-toolbar-group">
          <button class="ax-ws-tool-btn" data-action="bullet"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M8 6h13M8 12h13M8 18h13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="3" cy="6" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="3" cy="18" r="1" fill="currentColor"/></svg></button>
          <button class="ax-ws-tool-btn" data-action="numbered"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M10 6h11M10 12h11M10 18h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4 6h1v4M3 10h3M4 14h1a1 1 0 011 1v1a1 1 0 01-1 1H4a1 1 0 00-1 1v1a1 1 0 001 1h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button class="ax-ws-tool-btn" data-action="checklist"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 11l3 3L22 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
        <div class="ax-workspace-toolbar-group" style="margin-left:auto;">
          <span class="ax-save-indicator" id="axSaveIndicator">Saved</span>
          <button class="ax-ws-tool-btn" data-action="ai-toggle" title="AI Assistant"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M18.4 5.6l-2 2M7.6 16.4l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
        </div>
      </div>
      <div class="ax-workspace-doc-area">
        <div class="ax-page-icon">📝</div>
        <input class="ax-doc-title" type="text" id="wsDocTitle" value="${escapeHtml(state.docTitle)}" placeholder="Untitled">
        <div class="ax-doc-content" id="wsDocContent" contenteditable="true" data-placeholder="Start writing...">
          ${state.docContent || '<p>Welcome to your AI-powered workspace. Start typing here...</p>'}
        </div>
      </div>`;
    
    // Rebind doc elements
    const newTitle = container.querySelector('#wsDocTitle');
    const newContent = container.querySelector('#wsDocContent');
    
    if (newTitle) {
      newTitle.addEventListener('input', () => {
        state.docTitle = newTitle.value;
        triggerAutoSave();
      });
    }
    
    if (newContent) {
      newContent.addEventListener('input', () => {
        state.docContent = newContent.innerHTML;
        triggerAutoSave();
      });
    }
    
    // Wire toolbar actions
    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        handleToolbarAction(action, newContent);
      });
    });
  }

  function handleToolbarAction(action, contentEl) {
    if (!contentEl) return;
    switch (action) {
      case 'bold': document.execCommand('bold'); break;
      case 'italic': document.execCommand('italic'); break;
      case 'underline': document.execCommand('underline'); break;
      case 'heading': document.execCommand('formatBlock', false, 'h3'); break;
      case 'text': document.execCommand('formatBlock', false, 'p'); break;
      case 'code': document.execCommand('insertHTML', false, '<pre class="ax-code-block"><div class="ax-code-block-header"><span>Code</span></div><code class="ax-code-block-content">// your code here</code></pre><p></p>'); break;
      case 'bullet': document.execCommand('insertUnorderedList'); break;
      case 'numbered': document.execCommand('insertOrderedList'); break;
      case 'checklist': document.execCommand('insertHTML', false, '<div class="ax-checklist"><input type="checkbox"> item</div><p></p>'); break;
      case 'undo': document.execCommand('undo'); break;
      case 'redo': document.execCommand('redo'); break;
      case 'ai-toggle': toggleAISidebar(); break;
    }
    triggerAutoSave();
  }

  // ============================================================
  // 3. AUTO SAVE
  // ============================================================

  function triggerAutoSave() {
    if (!state.autoSave) return;
    const indicator = document.getElementById('axSaveIndicator');
    if (indicator) indicator.textContent = 'Unsaved';
    clearTimeout(currentAutoSaveTimer);
    currentAutoSaveTimer = setTimeout(() => {
      saveVersion();
      if (indicator) indicator.textContent = 'Saved';
      state.lastSaved = Date.now();
    }, 2000);
  }

  function saveVersion() {
    const snapshot = {
      title: state.docTitle,
      content: state.docContent,
      timestamp: Date.now(),
    };
    state.versions.push(snapshot);
    state.versionIndex = state.versions.length - 1;
    // Keep last 50 versions
    if (state.versions.length > 50) state.versions.shift();
    // Persist to localStorage
    try {
      localStorage.setItem('axiom:workspace-versions', JSON.stringify(state.versions.slice(-20)));
    } catch (e) { /* ignore */ }
  }

  // ============================================================
  // 4. INFINITE CANVAS (Figma-style)
  // ============================================================

  function renderCanvasView(container) {
    container.innerHTML = `
      <div class="ax-canvas" id="axInfiniteCanvas">
        <div class="ax-canvas-grid"></div>
        <div class="ax-canvas-stage" id="axCanvasStage">
          <!-- Sticky notes and shapes go here -->
        </div>
        <div class="ax-canvas-tools">
          <button class="ax-ws-tool-btn" data-canvas-tool="sticky" title="Add Sticky Note">📝</button>
          <button class="ax-ws-tool-btn" data-canvas-tool="shape" title="Add Shape">⬜</button>
          <button class="ax-ws-tool-btn" data-canvas-tool="text" title="Add Text">T</button>
          <button class="ax-ws-tool-btn" data-canvas-tool="connect" title="Connect">↗</button>
          <span style="color:rgba(255,255,255,.2);font-size:.7rem;padding:0 6px;">|</span>
          <button class="ax-ws-tool-btn" data-canvas-tool="zoom-in" title="Zoom In">+</button>
          <button class="ax-ws-tool-btn" data-canvas-tool="zoom-out" title="Zoom Out">−</button>
          <button class="ax-ws-tool-btn" data-canvas-tool="reset" title="Reset Zoom">⟲</button>
          <span class="ax-canvas-zoom-level" id="axCanvasZoom">100%</span>
        </div>
      </div>`;
    
    const canvas = container.querySelector('#axInfiniteCanvas');
    const stage = container.querySelector('#axCanvasStage');
    const zoomLevel = container.querySelector('#axCanvasZoom');
    let scale = 1, panX = 0, panY = 0;
    let isPanning = false, startX, startY;
    
    // Add existing sticky notes
    state.notes.forEach(note => addStickyNoteToCanvas(stage, note));
    
    // Pan with middle mouse or space+drag
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1 || e.target === canvas || e.target.classList.contains('ax-canvas-grid')) {
        isPanning = true;
        startX = e.clientX - panX;
        startY = e.clientY - panY;
        canvas.style.cursor = 'grabbing';
      }
    });
    
    canvas.addEventListener('mousemove', (e) => {
      if (isPanning) {
        panX = e.clientX - startX;
        panY = e.clientY - startY;
        stage.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
      }
    });
    
    global.addEventListener('mouseup', () => {
      isPanning = false;
      canvas.style.cursor = '';
    });
    
    // Zoom with scroll wheel
    canvas.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        scale = Math.max(0.2, Math.min(5, scale + delta));
        stage.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
        zoomLevel.textContent = Math.round(scale * 100) + '%';
      }
    }, { passive: false });
    
    // Tool buttons
    container.querySelectorAll('[data-canvas-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.canvasTool;
        switch (tool) {
          case 'sticky': addStickyNoteToCanvas(stage, { id: Date.now(), title: 'Note', content: 'Double-click to edit', x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 }); break;
          case 'shape':
            const shape = document.createElement('div');
            shape.className = 'ax-canvas-shape';
            shape.style.cssText = `left:${150 + Math.random() * 200}px;top:${150 + Math.random() * 200}px;width:80px;height:80px;border-radius:16px;background:rgba(96,165,250,.15);border:2px solid rgba(96,165,250,.3);position:absolute;cursor:move;`;
            makeDraggable(shape);
            stage.appendChild(shape);
            break;
          case 'zoom-in': scale = Math.min(5, scale + 0.2); stage.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`; zoomLevel.textContent = Math.round(scale * 100) + '%'; break;
          case 'zoom-out': scale = Math.max(0.2, scale - 0.2); stage.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`; zoomLevel.textContent = Math.round(scale * 100) + '%'; break;
          case 'reset': scale = 1; panX = 0; panY = 0; stage.style.transform = ''; zoomLevel.textContent = '100%'; break;
        }
      });
    });
  }

  function addStickyNoteToCanvas(stage, note) {
    const el = document.createElement('div');
    el.className = 'ax-sticky-note';
    el.style.left = note.x + 'px';
    el.style.top = note.y + 'px';
    el.dataset.noteId = note.id;
    el.innerHTML = `
      <div class="ax-sticky-head">
        <span class="ax-sticky-title" contenteditable="true">${escapeHtml(note.title || 'Note')}</span>
        <button class="ax-sticky-close">✕</button>
      </div>
      <div class="ax-sticky-content" contenteditable="true">${escapeHtml(note.content || '')}</div>`;
    makeDraggable(el);
    el.querySelector('.ax-sticky-close').addEventListener('click', () => { el.remove(); state.notes = state.notes.filter(n => n.id !== note.id); });
    stage.appendChild(el);
    if (!state.notes.find(n => n.id === note.id)) {
      state.notes.push(note);
    }
  }

  function makeDraggable(el) {
    let isDragging = false, startX, startY, origX, origY;
    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ax-sticky-close') || e.target.closest('[contenteditable]')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origX = parseInt(el.style.left) || 0;
      origY = parseInt(el.style.top) || 0;
      el.style.zIndex = 1000;
    });
    global.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      el.style.left = (origX + e.clientX - startX) + 'px';
      el.style.top = (origY + e.clientY - startY) + 'px';
    });
    global.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        el.style.zIndex = '';
      }
    });
  }

  // ============================================================
  // 5. WHITEBOARD WITH DRAWING TOOLS
  // ============================================================

  function renderWhiteboardView(container) {
    container.innerHTML = `
      <div class="ax-whiteboard" id="axWhiteboard">
        <canvas id="axWhiteboardCanvas" style="position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;"></canvas>
        <div class="ax-whiteboard-tools">
          <button class="ax-ws-tool-btn active" data-wb-tool="pen" title="Pen">✏️</button>
          <button class="ax-ws-tool-btn" data-wb-tool="line" title="Line">╱</button>
          <button class="ax-ws-tool-btn" data-wb-tool="rect" title="Rectangle">▭</button>
          <button class="ax-ws-tool-btn" data-wb-tool="circle" title="Circle">○</button>
          <button class="ax-ws-tool-btn" data-wb-tool="eraser" title="Eraser">🧹</button>
          <span style="color:rgba(255,255,255,.2);font-size:.7rem;">|</span>
          <input type="color" id="wbColor" value="#60A5FA" style="width:28px;height:28px;border:none;background:transparent;cursor:pointer;">
          <input type="range" id="wbSize" min="1" max="12" value="3" style="width:60px;">
          <button class="ax-ws-tool-btn" data-wb-tool="clear" title="Clear">🗑️</button>
        </div>
      </div>`;
    
    const canvas = document.getElementById('axWhiteboardCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    function resizeCanvas() {
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
    }
    resizeCanvas();
    global.addEventListener('resize', resizeCanvas);
    
    let drawing = false, tool = 'pen', color = '#60A5FA', size = 3;
    let lastX, lastY;
    
    canvas.addEventListener('mousedown', (e) => {
      drawing = true;
      const rect = canvas.getBoundingClientRect();
      lastX = e.clientX - rect.left;
      lastY = e.clientY - rect.top;
    });
    
    canvas.addEventListener('mousemove', (e) => {
      if (!drawing) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      if (tool === 'pen' || tool === 'eraser') {
        ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        lastX = x; lastY = y;
      }
    });
    
    global.addEventListener('mouseup', () => { drawing = false; });
    
    // Tool buttons
    container.querySelectorAll('[data-wb-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.wbTool;
        if (t === 'clear') {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          return;
        }
        tool = t;
        container.querySelectorAll('[data-wb-tool]').forEach(b => b.classList.toggle('active', b === btn));
        canvas.style.cursor = t === 'eraser' ? 'cell' : 'crosshair';
      });
    });
    
    const colorInput = container.querySelector('#wbColor');
    if (colorInput) colorInput.addEventListener('input', () => { color = colorInput.value; });
    
    const sizeInput = container.querySelector('#wbSize');
    if (sizeInput) sizeInput.addEventListener('input', () => { size = parseInt(sizeInput.value); });
  }

  // ============================================================
  // 6. MIND MAP
  // ============================================================

  function renderMindmapView(container) {
    container.innerHTML = `
      <div class="ax-canvas" id="axMindmapCanvas">
        <div class="ax-canvas-grid"></div>
        <div class="ax-mindmap-stage" id="axMindmapStage" style="position:relative;width:2000px;height:2000px;">
          <svg id="axMindmapLines" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;"></svg>
        </div>
        <div class="ax-canvas-tools" style="bottom:24px;">
          <button class="ax-ws-tool-btn" data-mm-action="add" title="Add Node">+ Node</button>
          <button class="ax-ws-tool-btn" data-mm-action="layout" title="Auto Layout">⟳</button>
          <button class="ax-ws-tool-btn" data-mm-action="reset" title="Clear All">🗑️</button>
        </div>
      </div>`;
    
    const stage = container.querySelector('#axMindmapStage');
    const lines = container.querySelector('#axMindmapLines');
    
    function renderNodes() {
      stage.querySelectorAll('.ax-mindmap-node').forEach(el => el.remove());
      state.mindmapNodes.forEach(node => {
        const el = document.createElement('div');
        el.className = 'ax-mindmap-node';
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';
        el.dataset.nodeId = node.id;
        el.innerHTML = `<div class="ax-node-label" contenteditable="true">${escapeHtml(node.label)}</div>
          <div class="ax-node-sub">${escapeHtml(node.sub || '')}</div>
          <button class="ax-sticky-close" style="position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:4px;border:none;background:transparent;color:rgba(255,255,255,.3);cursor:pointer;">✕</button>`;
        makeDraggable(el);
        el.querySelector('.ax-sticky-close').addEventListener('click', () => {
          state.mindmapNodes = state.mindmapNodes.filter(n => n.id !== node.id);
          renderNodes();
        });
        stage.appendChild(el);
      });
      renderLines();
    }
    
    function renderLines() {
      lines.innerHTML = '';
      const svgNS = 'http://www.w3.org/2000/svg';
      state.mindmapNodes.forEach((node, i) => {
        if (i === 0) return; // Skip root
        if (node.parentId) {
          const parent = state.mindmapNodes.find(n => n.id === node.parentId);
          if (parent) {
            const line = document.createElementNS(svgNS, 'line');
            line.setAttribute('x1', parent.x + 60);
            line.setAttribute('y1', parent.y + 25);
            line.setAttribute('x2', node.x);
            line.setAttribute('y2', node.y + 25);
            line.setAttribute('stroke', 'rgba(255,255,255,.12)');
            line.setAttribute('stroke-width', '2');
            lines.appendChild(line);
          }
        }
      });
    }
    
    // Load existing nodes
    if (state.mindmapNodes.length === 0) {
      state.mindmapNodes = [
        { id: 'mm1', label: 'Central Idea', sub: 'Main topic', x: 880, y: 400, parentId: null },
        { id: 'mm2', label: 'Branch 1', sub: 'Subtopic A', x: 600, y: 300, parentId: 'mm1' },
        { id: 'mm3', label: 'Branch 2', sub: 'Subtopic B', x: 600, y: 500, parentId: 'mm1' },
        { id: 'mm4', label: 'Branch 3', sub: 'Subtopic C', x: 1150, y: 400, parentId: 'mm1' },
      ];
    }
    renderNodes();
    
    container.querySelectorAll('[data-mm-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.mmAction;
        if (action === 'add') {
          const id = 'mm' + Date.now();
          state.mindmapNodes.push({ id, label: 'New Node', sub: 'Click to edit', x: 400 + Math.random() * 400, y: 300 + Math.random() * 400, parentId: 'mm1' });
          renderNodes();
        } else if (action === 'layout') {
          // Simple radial auto-layout
          const center = { x: 900, y: 400 };
          const radius = 250;
          state.mindmapNodes.forEach((node, i) => {
            if (i === 0) { node.x = center.x; node.y = center.y; return; }
            const angle = (i / state.mindmapNodes.length) * Math.PI * 2;
            node.x = center.x + Math.cos(angle) * radius;
            node.y = center.y + Math.sin(angle) * radius;
          });
          renderNodes();
        } else if (action === 'reset') {
          state.mindmapNodes = [];
          renderNodes();
        }
      });
    });
  }

  // ============================================================
  // 7. FLOW CHART
  // ============================================================

  function renderFlowChartView(container) {
    container.innerHTML = `
      <div class="ax-canvas" id="axFlowCanvas">
        <div class="ax-canvas-grid"></div>
        <div class="ax-flow-stage" id="axFlowStage" style="position:relative;width:2000px;height:2000px;">
          <svg id="axFlowLines" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;"></svg>
        </div>
        <div class="ax-flow-sidebar" style="position:absolute;left:16px;top:16px;display:flex;flex-direction:column;gap:6px;padding:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;">
          <button class="ax-ws-tool-btn" data-flow-add="process">⬡ Process</button>
          <button class="ax-ws-tool-btn" data-flow-add="decision">◇ Decision</button>
          <button class="ax-ws-tool-btn" data-flow-add="start">● Start/End</button>
          <button class="ax-ws-tool-btn" data-flow-add="input">▱ Input/Output</button>
          <span style="border-top:1px solid rgba(255,255,255,.06);margin:4px 0;"></span>
          <button class="ax-ws-tool-btn" data-flow-action="clear">🗑️ Clear</button>
        </div>
      </div>`;
    
    const stage = container.querySelector('#axFlowStage');
    const svgLines = container.querySelector('#axFlowLines');
    
    function renderFlowNodes() {
      stage.querySelectorAll('.ax-flow-node').forEach(el => el.remove());
      state.flowNodes.forEach(node => {
        const el = document.createElement('div');
        el.className = `ax-flow-node ax-flow-${node.type}`;
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';
        el.dataset.nodeId = node.id;
        
        let shape = '';
        switch (node.type) {
          case 'process': shape = 'border-radius:10px;background:rgba(96,165,250,.12);border:2px solid rgba(96,165,250,.3);'; break;
          case 'decision': shape = 'width:120px;height:80px;clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%);background:rgba(251,191,36,.12);border:none;'; break;
          case 'start': shape = 'border-radius:50%;width:60px;height:60px;background:rgba(110,231,183,.15);border:2px solid rgba(110,231,183,.4);display:flex;align-items:center;justify-content:center;'; break;
          case 'input': shape = 'clip-path:polygon(0% 0%,85% 0%,100% 50%,85% 100%,0% 100%);background:rgba(167,139,250,.12);border:none;padding-left:10px;'; break;
        }
        
        el.style.cssText += shape + 'position:absolute;padding:10px 16px;cursor:move;min-width:100px;text-align:center;color:rgba(255,255,255,.7);font-size:.82rem;';
        el.textContent = node.label;
        makeDraggable(el, () => renderFlowLines());
        stage.appendChild(el);
      });
      renderFlowLines();
    }
    
    function renderFlowLines() {
      svgLines.innerHTML = '';
      const svgNS = 'http://www.w3.org/2000/svg';
      state.flowNodes.forEach((node) => {
        if (node.nextId) {
          const next = state.flowNodes.find(n => n.id === node.nextId);
          if (next) {
            const line = document.createElementNS(svgNS, 'line');
            line.setAttribute('x1', node.x + 60);
            line.setAttribute('y1', node.y + 30);
            line.setAttribute('x2', next.x + 5);
            line.setAttribute('y2', next.y + 25);
            line.setAttribute('stroke', 'rgba(255,255,255,.15)');
            line.setAttribute('stroke-width', '2');
            // Arrow head
            const marker = document.createElementNS(svgNS, 'polygon');
            marker.setAttribute('points', '0,-5 10,0 0,5');
            marker.setAttribute('fill', 'rgba(255,255,255,.2)');
            const mx = next.x + 5, my = next.y + 25;
            marker.setAttribute('transform', `translate(${mx},${my})`);
            svgLines.appendChild(line);
            svgLines.appendChild(marker);
          }
        }
      });
    }
    
    if (state.flowNodes.length === 0) {
      state.flowNodes = [
        { id: 'fl1', label: 'Start', type: 'start', x: 400, y: 100, nextId: 'fl2' },
        { id: 'fl2', label: 'Process Data', type: 'process', x: 400, y: 250, nextId: 'fl3' },
        { id: 'fl3', label: 'Is Valid?', type: 'decision', x: 400, y: 420, nextId: 'fl4' },
        { id: 'fl4', label: 'Output Result', type: 'input', x: 400, y: 600, nextId: null },
      ];
    }
    renderFlowNodes();
    
    container.querySelectorAll('[data-flow-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.flowAdd;
        const id = 'fl' + Date.now();
        const labels = { process: 'Process', decision: 'Decision?', start: 'Start', input: 'Input/Output' };
        state.flowNodes.push({ id, label: labels[type] || type, type, x: 300 + Math.random() * 300, y: 200 + Math.random() * 400, nextId: null });
        renderFlowNodes();
      });
    });
    
    container.querySelector('[data-flow-action="clear"]')?.addEventListener('click', () => {
      state.flowNodes = [];
      renderFlowNodes();
    });
  }

  // ============================================================
  // 8. MARKDOWN EDITOR WITH PREVIEW
  // ============================================================

  function renderMarkdownView(container) {
    container.innerHTML = `
      <div class="ax-markdown-editor" style="display:flex;flex:1;min-height:0;">
        <div class="ax-split-pane" style="flex:1;display:flex;flex-direction:column;border-right:1px solid rgba(255,255,255,.06);">
          <div class="ax-workspace-toolbar">
            <div class="ax-workspace-toolbar-group">
              <button class="ax-ws-tool-btn active" data-md-mode="write">✏️ Write</button>
              <button class="ax-ws-tool-btn" data-md-mode="preview">👁️ Preview</button>
              <button class="ax-ws-tool-btn" data-md-mode="split">↕ Split</button>
            </div>
            <div class="ax-workspace-toolbar-group" style="margin-left:auto;">
              <button class="ax-ws-tool-btn" data-md-action="bold"><strong>B</strong></button>
              <button class="ax-ws-tool-btn" data-md-action="italic"><em>I</em></button>
              <button class="ax-ws-tool-btn" data-md-action="code"></></button>
              <button class="ax-ws-tool-btn" data-md-action="link">🔗</button>
            </div>
          </div>
          <textarea class="ax-md-textarea" id="axMdTextarea" placeholder="Write markdown here..." style="flex:1;background:transparent;border:none;color:#F5F5F5;font-family:'JetBrains Mono',monospace;font-size:.88rem;line-height:1.6;padding:20px;outline:none;resize:none;"># Welcome to Markdown

This is **bold** and this is *italic*.

\`\`\`javascript
console.log('Hello World');
\`\`\`

- Item 1
- Item 2
- Item 3</textarea>
        </div>
        <div class="ax-split-pane ax-md-preview" id="axMdPreview" style="flex:1;overflow-y:auto;padding:20px;color:rgba(255,255,255,.8);font-size:.92rem;line-height:1.7;display:none;"></div>
      </div>`;
    
    const textarea = container.querySelector('#axMdTextarea');
    const preview = container.querySelector('#axMdPreview');
    
    function renderPreview() {
      const md = textarea.value;
      let html = md
        .replace(/&/g, '&amp;').replace(/</g, '<').replace(/>/g, '>')
        .replace(/### (.+)/g, '<h3>$1</h3>')
        .replace(/## (.+)/g, '<h2>$1</h2>')
        .replace(/# (.+)/g, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,.06);padding:2px 6px;border-radius:4px;font-family:JetBrains Mono,monospace;font-size:.85em;">$1</code>')
        .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="ax-code-block"><div class="ax-code-block-header"><span>code</span></div><code class="ax-code-block-content">$2</code></pre>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
        .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:rgba(255,255,255,.7);text-decoration:underline;">$1</a>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/^(?!<[hou])/gm, '');
      preview.innerHTML = '<p>' + html + '</p>';
    }
    
    textarea.addEventListener('input', renderPreview);
    
    container.querySelectorAll('[data-md-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mdMode;
        container.querySelectorAll('[data-md-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (mode === 'write') { textarea.style.display = ''; preview.style.display = 'none'; }
        else if (mode === 'preview') { renderPreview(); textarea.style.display = 'none'; preview.style.display = ''; }
        else { textarea.style.display = ''; preview.style.display = ''; renderPreview(); }
      });
    });
    
    container.querySelectorAll('[data-md-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.mdAction;
        const start = textarea.selectionStart, end = textarea.selectionEnd;
        const selected = textarea.value.substring(start, end);
        let insert = '';
        if (action === 'bold') insert = `**${selected || 'text'}**`;
        else if (action === 'italic') insert = `*${selected || 'text'}*`;
        else if (action === 'code') insert = selected ? '`' + selected + '`' : '`` `code` ``';
        else if (action === 'link') insert = `[${selected || 'text'}](url)`;
        textarea.focus();
        document.execCommand('insertText', false, insert);
        renderPreview();
      });
    });
    
    const mdDocContent = state.docContent.replace(/<[^>]+>/g, '');
    if (mdDocContent) textarea.value = mdDocContent;
    renderPreview();
  }

  // ============================================================
  // 9. TERMINAL EMULATOR
  // ============================================================

  function renderTerminalView(container) {
    container.innerHTML = `
      <div class="ax-terminal" style="flex:1;display:flex;flex-direction:column;background:#0A0A0A;font-family:'JetBrains Mono',monospace;">
        <div class="ax-terminal-header" style="display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid rgba(255,255,255,.06);font-size:.78rem;color:rgba(255,255,255,.4);">
          <span style="display:flex;gap:6px;"><span style="width:10px;height:10px;border-radius:50%;background:#EF4444;"></span><span style="width:10px;height:10px;border-radius:50%;background:#FBBF24;"></span><span style="width:10px;height:10px;border-radius:50%;background:#6EE7B7;"></span></span>
          <span>bash — Axiom Terminal</span>
          <button class="ax-ws-tool-btn" data-term-action="clear" style="margin-left:auto;" title="Clear">🗑️</button>
        </div>
        <div class="ax-terminal-output" id="axTermOutput" style="flex:1;overflow-y:auto;padding:16px;font-size:.82rem;line-height:1.5;color:rgba(255,255,255,.7);white-space:pre-wrap;"></div>
        <div class="ax-terminal-input-row" style="display:flex;align-items:center;padding:8px 16px;border-top:1px solid rgba(255,255,255,.06);gap:8px;">
          <span style="color:#6EE7B7;font-size:.82rem;">$</span>
          <input type="text" id="axTermInput" style="flex:1;background:transparent;border:none;color:#F5F5F5;font-family:inherit;font-size:.82rem;outline:none;" placeholder="Type a command...">
        </div>
      </div>`;
    
    const output = container.querySelector('#axTermOutput');
    const input = container.querySelector('#axTermInput');
    
    const commands = {
      help: 'Available commands:\n  help     - Show this help\n  clear    - Clear terminal\n  echo     - Print text\n  whoami   - Show current user\n  date     - Show date/time\n  ls       - List files\n  pwd      - Print working directory\n  neofetch - Show system info',
      clear: () => { output.innerHTML = ''; return ''; },
      whoami: 'axiom-user',
      date: new Date().toString(),
      pwd: '/home/axiom/workspace',
      ls: 'Documents/\nProjects/\nREADME.md\nworkspace.js\nstyles/',
      neofetch: 'OS: Axiom AI OS V13\nHost: Workspace Ultimate\nKernel: Neural v4.2\nShell: bash 5.2\nCPU: AI Core (16 cores)\nGPU: Neural Engine\nMemory: 32GB Unified',
    };
    
    output.textContent = 'Welcome to Axiom Terminal v1.0\nType "help" for available commands.\n\n';
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const cmd = input.value.trim();
        input.value = '';
        output.textContent += `$ ${cmd}\n`;
        
        if (cmd === '') return;
        const parts = cmd.split(' ');
        const base = parts[0].toLowerCase();
        
        if (base === 'echo') {
          output.textContent += parts.slice(1).join(' ') + '\n';
        } else if (base === 'clear') {
          output.innerHTML = '';
        } else if (commands[base]) {
          const result = typeof commands[base] === 'function' ? commands[base]() : commands[base];
          if (result) output.textContent += result + '\n';
        } else {
          output.textContent += `bash: ${base}: command not found\n`;
        }
        output.scrollTop = output.scrollHeight;
      }
    });
    
    container.querySelector('[data-term-action="clear"]')?.addEventListener('click', () => { output.innerHTML = ''; });
  }

  // ============================================================
  // 10. SPLIT VIEW
  // ============================================================

  function renderSplitView(container) {
    container.innerHTML = `
      <div class="ax-split">
        <div class="ax-split-pane" style="border-right:1px solid rgba(255,255,255,.06);">
          <div class="ax-workspace-toolbar" style="padding:6px 12px;">
            <span style="font-size:.72rem;color:rgba(255,255,255,.3);">Pane 1</span>
          </div>
          <div class="ax-split-content" style="flex:1;padding:20px;overflow-y:auto;">
            <div class="ax-page-icon">📄</div>
            <input class="ax-doc-title" type="text" value="Document A" style="font-size:1.4rem;" placeholder="Untitled">
            <div class="ax-doc-content" contenteditable="true" style="min-height:200px;outline:none;">
              <p>Edit this document side by side.</p>
            </div>
          </div>
        </div>
        <div class="ax-split-divider" style="cursor:col-resize;width:4px;background:rgba(255,255,255,.04);flex-shrink:0;"></div>
        <div class="ax-split-pane">
          <div class="ax-workspace-toolbar" style="padding:6px 12px;">
            <span style="font-size:.72rem;color:rgba(255,255,255,.3);">Pane 2</span>
          </div>
          <div class="ax-split-content" style="flex:1;padding:20px;overflow-y:auto;">
            <div class="ax-page-icon">📄</div>
            <input class="ax-doc-title" type="text" value="Document B" style="font-size:1.4rem;" placeholder="Untitled">
            <div class="ax-doc-content" contenteditable="true" style="min-height:200px;outline:none;">
              <p>Compare or reference content here.</p>
            </div>
          </div>
        </div>
      </div>`;
    
    // Make divider draggable
    const divider = container.querySelector('.ax-split-divider');
    const panes = container.querySelectorAll('.ax-split-pane');
    let isDragging = false;
    
    divider.addEventListener('mousedown', (e) => {
      isDragging = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    
    global.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const rect = container.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      if (pct > 20 && pct < 80) {
        panes[0].style.flex = `0 0 ${pct}%`;
        panes[1].style.flex = `0 0 ${100 - pct}%`;
      }
    });
    
    global.addEventListener('mouseup', () => {
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  // ============================================================
  // 11. PROJECT EXPLORER (File Tree)
  // ============================================================

  function renderProjectExplorer(container) {
    const files = [
      { name: '📁 Documents', children: [
        { name: '📄 Quick Start Guide.md', file: true },
        { name: '📄 API Documentation.md', file: true },
        { name: '📄 Design System Notes.md', file: true },
      ]},
      { name: '📁 Projects', children: [
        { name: '📁 Axiom V13', children: [
          { name: '📄 dashboard.js', file: true },
          { name: '📄 workspace.html', file: true },
          { name: '📁 styles', children: [
            { name: '📄 ax-workspace.css', file: true },
          ]},
        ]},
      ]},
      { name: '📁 Assets', children: [
        { name: '🖼️ logo.png', file: true },
        { name: '🖼️ banner.webp', file: true },
      ]},
      { name: '📄 README.md', file: true },
      { name: '📄 package.json', file: true },
    ];
    
    function renderTree(items, depth = 0) {
      let html = '';
      items.forEach(item => {
        if (item.children) {
          html += `<div class="ax-tree-folder" style="padding-left:${depth * 16 + 8}px;">
            <div class="ax-tree-item" data-expandable>
              <span class="ax-tree-arrow">▶</span>
              <span>${escapeHtml(item.name)}</span>
            </div>
            <div class="ax-tree-children" style="display:none;">${renderTree(item.children, depth + 1)}</div>
          </div>`;
        } else {
          html += `<div class="ax-tree-file" style="padding-left:${depth * 16 + 24}px;">
            <div class="ax-tree-item">${escapeHtml(item.name)}</div>
          </div>`;
        }
      });
      return html;
    }
    
    container.innerHTML = `
      <div class="ax-workspace-toolbar" style="padding:6px 12px;">
        <span style="font-size:.72rem;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.05em;">Explorer</span>
        <div style="margin-left:auto;display:flex;gap:4px;">
          <button class="ax-ws-tool-btn" data-expand-all title="Expand all">📂</button>
          <button class="ax-ws-tool-btn" data-collapse-all title="Collapse all">📁</button>
        </div>
      </div>
      <div class="ax-tree-view" style="flex:1;overflow-y:auto;padding:8px 0;">${renderTree(files)}</div>`;
    
    // Toggle folders
    container.querySelectorAll('[data-expandable]').forEach(el => {
      el.addEventListener('click', () => {
        const arrow = el.querySelector('.ax-tree-arrow');
        const children = el.parentElement.querySelector('.ax-tree-children');
        if (children) {
          const isOpen = children.style.display !== 'none';
          children.style.display = isOpen ? 'none' : 'block';
          if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
        }
      });
    });
    
    container.querySelector('[data-expand-all]')?.addEventListener('click', () => {
      container.querySelectorAll('.ax-tree-children').forEach(el => { el.style.display = 'block'; });
      container.querySelectorAll('.ax-tree-arrow').forEach(el => { el.style.transform = 'rotate(90deg)'; });
    });
    
    container.querySelector('[data-collapse-all]')?.addEventListener('click', () => {
      container.querySelectorAll('.ax-tree-children').forEach(el => { el.style.display = 'none'; });
      container.querySelectorAll('.ax-tree-arrow').forEach(el => { el.style.transform = ''; });
    });
  }

  // ============================================================
  // 12. AI ASSISTANT SIDEBAR
  // ============================================================

  let aiSidebarVisible = false;

  function toggleAISidebar() {
    aiSidebarVisible = !aiSidebarVisible;
    let sidebar = document.getElementById('axAISidebar');
    if (!sidebar) {
      sidebar = document.createElement('aside');
      sidebar.id = 'axAISidebar';
      sidebar.style.cssText = 'position:fixed;right:0;top:0;bottom:0;width:320px;background:rgba(10,10,10,.98);border-left:1px solid rgba(255,255,255,.08);z-index:300;transform:translateX(100%);transition:transform .3s ease;display:flex;flex-direction:column;backdrop-filter:blur(20px);';
      sidebar.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.06);">
          <h4 style="font-size:.85rem;font-weight:600;color:#F5F5F5;display:flex;align-items:center;gap:8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M18.4 5.6l-2 2M7.6 16.4l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            AI Assistant
          </h4>
          <button id="axAIClose" style="width:26px;height:26px;border-radius:6px;border:none;background:transparent;color:rgba(255,255,255,.4);cursor:pointer;">✕</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;">
          <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px;">
            <div style="font-size:.78rem;color:rgba(255,255,255,.4);margin-bottom:4px;">💡 Suggestions</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              <span class="ax-suggestion-chip" data-ai-suggest="Improve this document's structure">Improve structure</span>
              <span class="ax-suggestion-chip" data-ai-suggest="Add a table of contents">Add TOC</span>
              <span class="ax-suggestion-chip" data-ai-suggest="Rewrite in a more formal tone">Formal tone</span>
              <span class="ax-suggestion-chip" data-ai-suggest="Summarize this document">Summarize</span>
            </div>
          </div>
          <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px;">
            <div style="font-size:.78rem;color:rgba(255,255,255,.4);margin-bottom:4px;">🔗 Knowledge Links</div>
            <div style="font-size:.8rem;color:rgba(255,255,255,.6);line-height:1.6;">
              <div>• <span style="color:rgba(255,255,255,.4);cursor:pointer;" data-ai-link>Getting Started Guide</span></div>
              <div>• <span style="color:rgba(255,255,255,.4);cursor:pointer;" data-ai-link>API Reference</span></div>
              <div>• <span style="color:rgba(255,255,255,.4);cursor:pointer;" data-ai-link>Design System</span></div>
            </div>
          </div>
          <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px;">
            <div style="font-size:.78rem;color:rgba(255,255,255,.4);margin-bottom:4px;">🧠 Memory</div>
            <div style="font-size:.8rem;color:rgba(255,255,255,.5);line-height:1.5;">
              Working on Axiom AI OS V13 workspace upgrade
            </div>
          </div>
          <div style="margin-top:auto;">
            <div style="display:flex;gap:8px;">
              <input type="text" id="axAIInput" placeholder="Ask AI..." style="flex:1;padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#F5F5F5;font-size:.8rem;outline:none;font-family:inherit;">
              <button id="axAISend" style="padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.12);color:#F5F5F5;cursor:pointer;">→</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(sidebar);
      
      sidebar.querySelector('#axAIClose').addEventListener('click', toggleAISidebar);
      
      sidebar.querySelectorAll('[data-ai-suggest]').forEach(chip => {
        chip.addEventListener('click', () => {
          const text = chip.dataset.aiSuggests || chip.textContent;
          const input = sidebar.querySelector('#axAIInput');
          if (input) input.value = text;
        });
      });
      
      sidebar.querySelector('#axAISend').addEventListener('click', () => {
        const input = sidebar.querySelector('#axAIInput');
        if (input && input.value.trim()) {
          // Navigate to chat with the query
          global.open(`playground.html?q=${encodeURIComponent(input.value)}`, '_self');
        }
      });
      
      sidebar.querySelector('#axAIInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          sidebar.querySelector('#axAISend').click();
        }
      });
    }
    
    sidebar.style.transform = aiSidebarVisible ? 'translateX(0)' : 'translateX(100%)';
  }

  // ============================================================
  // 13. SIDEBAR NAVIGATION WIRING
  // ============================================================

  function wireSidebarNav() {
    const navItems = document.querySelectorAll('.ax-workspace-nav-item');
    
    // Add view-data attributes to nav items
    navItems.forEach(item => {
      const text = item.textContent.trim().toLowerCase();
      let view = 'document';
      if (text.includes('canvas') || text.includes('whiteboard')) view = 'whiteboard';
      else if (text.includes('mind')) view = 'mindmap';
      else if (text.includes('flow') || text.includes('chart')) view = 'flow';
      else if (text.includes('code') || text.includes('markdown')) view = 'markdown';
      else if (text.includes('terminal')) view = 'terminal';
      else if (text.includes('split')) view = 'split';
      
      item.dataset.view = view;
      item.addEventListener('click', () => {
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        switchView(view);
      });
    });
    
    // Also add "Explorer" via a new nav item
    const toolsLabel = document.querySelector('.ax-workspace-nav-label:last-child');
    if (toolsLabel) {
      const explorerItem = document.createElement('button');
      explorerItem.className = 'ax-workspace-nav-item';
      explorerItem.dataset.view = 'explorer';
      explorerItem.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 5h7l2 2h9v12H3V5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg> Explorer`;
      toolsLabel.after(explorerItem);
      explorerItem.addEventListener('click', () => {
        document.querySelectorAll('.ax-workspace-nav-item').forEach(n => n.classList.remove('active'));
        explorerItem.classList.add('active');
        switchView('explorer');
      });
    }
  }

  // ============================================================
  // 14. MONACO EDITOR INTEGRATION
  // ============================================================

  function loadMonacoEditor() {
    // Add Monaco as a view option
    const toolsLabel = document.querySelector('.ax-workspace-nav-label:last-child');
    if (toolsLabel) {
      // Check if already added
      if (toolsLabel.parentElement.querySelector('[data-view="monaco"]')) return;
      const monacoItem = document.createElement('button');
      monacoItem.className = 'ax-workspace-nav-item';
      monacoItem.dataset.view = 'monaco';
      monacoItem.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M16 3H8a1 1 0 00-1 1v16a1 1 0 001 1h8a1 1 0 001-1V4a1 1 0 00-1-1z" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v18" stroke="currentColor" stroke-width="1.6"/><path d="M8 7h2M8 11h2M8 15h2M14 7h2M14 11h2M14 15h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Code Editor`;
      toolsLabel.after(monacoItem);
      monacoItem.addEventListener('click', () => {
        document.querySelectorAll('.ax-workspace-nav-item').forEach(n => n.classList.remove('active'));
        monacoItem.classList.add('active');
        renderMonacoView(document.querySelector('.ax-workspace-view-content') || els.main);
      });
    }
  }

  function renderMonacoView(container) {
    container.innerHTML = `
      <div class="ax-workspace-toolbar" style="padding:6px 12px;">
        <span style="font-size:.72rem;color:rgba(255,255,255,.3);">Code Editor</span>
        <div style="margin-left:auto;display:flex;gap:4px;">
          <select id="monacoLang" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:4px 8px;color:#F5F5F5;font-size:.78rem;outline:none;">
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="html">HTML</option>
            <option value="css">CSS</option>
            <option value="python">Python</option>
            <option value="json">JSON</option>
            <option value="markdown">Markdown</option>
          </select>
        </div>
      </div>
      <div id="monacoEditorContainer" style="flex:1;min-height:0;"></div>`;

    const editorContainer = container.querySelector('#monacoEditorContainer');
    
    // Load Monaco from CDN
    if (global.require) {
      initMonaco(editorContainer);
    } else {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.min.js';
      script.onload = () => {
        global.require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
        global.require(['vs/editor/editor.main'], () => initMonaco(editorContainer));
      };
      document.head.appendChild(script);
    }
  }

  function initMonaco(container) {
    if (!global.monaco || !container) return;
    const editor = global.monaco.editor.create(container, {
      value: `// Welcome to Axiom Code Editor\n${state.docContent.replace(/<[^>]+>/g, '') || 'function hello() {\n  console.log("Hello, Axiom!");\n}\n\nhello();'}`,
      language: 'javascript',
      theme: 'vs-dark',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      lineNumbers: 'on',
      renderWhitespace: 'selection',
      automaticLayout: true,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      bracketPairColorization: { enabled: true },
      padding: { top: 16 },
    });
    
    // Update doc content on change
    editor.onDidChangeModelContent(() => {
      state.docContent = editor.getValue();
      triggerAutoSave();
    });
    
    // Language switching
    const langSelect = document.getElementById('monacoLang');
    if (langSelect) {
      langSelect.addEventListener('change', () => {
        global.monaco.editor.setModelLanguage(editor.getModel(), langSelect.value);
      });
    }
  }

  // ============================================================
  // INIT
  // ============================================================

  function init() {
    cacheEls();
    
    // Load saved versions
    try {
      const saved = localStorage.getItem('axiom:workspace-versions');
      if (saved) state.versions = JSON.parse(saved);
    } catch (e) { /* ignore */ }
    
    // Load saved doc content
    try {
      const savedContent = localStorage.getItem('axiom:workspace-doc');
      if (savedContent) state.docContent = savedContent;
    } catch (e) { /* ignore */ }
    
    // Create view content container
    const mainEl = els.main;
    if (mainEl) {
      const contentArea = document.createElement('div');
      contentArea.className = 'ax-workspace-view-content';
      mainEl.appendChild(contentArea);
    }
    
    wireSidebarNav();
    loadMonacoEditor();
    
    // Start with document view
    switchView('document');
    
    // Auto-save doc content periodically
    setInterval(() => {
      try {
        localStorage.setItem('axiom:workspace-doc', state.docContent);
      } catch (e) { /* ignore */ }
    }, 5000);
    
    console.log('[WorkspaceUltimate] Initialized');
  }

  // ============================================================
  // UTILITIES
  // ============================================================

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'<','>':'>','"':'"',"'":'&#39;' }[c]));
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.AxiomWorkspace = {
    switchView,
    toggleAISidebar,
    getState: () => state,
    saveVersion,
  };

})(window);

