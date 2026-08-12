// ============================================================
// AXIOM AI OS X — Premium Window Manager
// Native OS-style windows: create, drag, resize, snap,
// minimize, maximize, close, multi-window z-index stacking
// ============================================================
window.AxiomWindowManager = (function() {
  'use strict';

  let windows = {};
  let zIndex = 10;
  let activeWindowId = null;
  let container = null;
  let dragState = null;
  let resizeState = null;
  let snapThreshold = 40;
  let minimizedWindows = [];
  let preShowDesktop = null; // stores minimized state before "show desktop"

  // ---- VIRTUAL DESKTOPS ----
  // Every window carries a `desktop` id. Desktop switching is delegated to
  // AxiomMissionControl, but the window manager owns visibility so that
  // desktops stay in sync no matter which module triggers a switch.
  let activeDesktop = 1;

  function setActiveDesktop(n) {
    activeDesktop = n;
    Object.values(windows).forEach(w => {
      const belongs = w.desktop === n;
      w.element.style.display = (belongs && !w.minimized) ? '' : 'none';
    });
    document.dispatchEvent(new CustomEvent('axwm:desktopchange', { detail: { desktop: n } }));
  }

  function getActiveDesktop() { return activeDesktop; }

  function moveWindowToDesktop(id, n) {
    const w = windows[id];
    if (!w) return;
    w.desktop = n;
    w.element.style.display = (n === activeDesktop && !w.minimized) ? '' : 'none';
  }

  function getWindowsByDesktop(n) {
    return Object.values(windows).filter(w => w.desktop === (n == null ? activeDesktop : n));
  }

  // ---- INIT ----
  function init(containerEl) {
    container = containerEl;
    if (!container) {
      container = document.createElement('div');
      container.className = 'ax-wm';
      const wsContainer = document.getElementById('axWorkspaceContainer');
      if (wsContainer) {
        wsContainer.appendChild(container);
      } else {
        document.body.appendChild(container);
      }
    }
    container.classList.add('active');
  }

  // ---- CREATE WINDOW ----
  function createWindow(opts = {}) {
    const id = opts.id || 'win-' + Date.now();

    // Milestone 2 — Step 1: re-opening an already-open workspace must
    // RESTORE (if minimized) and FOCUS it, not silently no-op. Previously
    // this just returned the existing window object with no visible effect,
    // which meant clicking a dock icon for a minimized/background workspace
    // did nothing.
    if (windows[id]) {
      const existing = windows[id];
      if (existing.minimized) restoreWindow(id);
      focusWindow(id);
      return existing;
    }

    const w = {
      id,
      title: opts.title || 'Window',
      icon: opts.icon || 'workspace',
      width: opts.width || 640,
      height: opts.height || 420,
      x: opts.x || 80 + Math.random() * 60,
      y: opts.y || 50 + Math.random() * 50,
      minWidth: 200,
      minHeight: 120,
      maximized: false,
      minimized: false,
      element: null,
      content: opts.content || '',
      iframeSrc: opts.iframeSrc || null,
      onClose: opts.onClose || null,
      onFocus: opts.onFocus || null,
      desktop: opts.desktop || activeDesktop,
      appId: opts.appId || opts.icon || 'app',
    };

    // Ensure window is within viewport
    w.x = Math.min(w.x, window.innerWidth - 100);
    w.y = Math.min(w.y, window.innerHeight - 100);
    w.x = Math.max(w.x, 0);
    w.y = Math.max(w.y, 0);

    const el = document.createElement('div');
    el.className = 'ax-window';
    el.id = 'ax-win-' + id;
    el.style.width = w.width + 'px';
    el.style.height = w.height + 'px';
    el.style.left = w.x + 'px';
    el.style.top = w.y + 'px';
    el.style.zIndex = ++zIndex;

    w.element = el;
    windows[id] = w;

    // Build HTML
    const iconSvg = window.AxiomIcons ? window.AxiomIcons.svg(w.icon, 14) : '';
    el.innerHTML = `
      <div class="ax-window-titlebar" data-window-drag>
        <div class="ax-window-dots">
          <button class="ax-window-dot close" data-win-close title="Close">
            <svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>
          </button>
          <button class="ax-window-dot minimize" data-win-minimize title="Minimize">
            <svg viewBox="0 0 24 24"><path d="M18 12H6" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>
          </button>
          <button class="ax-window-dot maximize" data-win-maximize title="Maximize">
            <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/></svg>
          </button>
        </div>
        <div class="ax-window-icon">${iconSvg}</div>
        <div class="ax-window-title">${w.title}</div>
        <div style="width:52px;flex-shrink:0;"></div>
      </div>
      <div class="ax-window-body">
        ${w.iframeSrc ? `
          <div class="ax-window-loading" data-win-loading>
            <div class="ax-loader-ring"></div>
          </div>
          <div class="ax-window-error" data-win-error style="display:none;">
            <p>This couldn't be loaded here.</p>
            <button class="btn btn-sm" data-win-error-retry>Retry</button>
            <a class="btn btn-sm btn-ghost" data-win-error-open href="${w.iframeSrc}" target="_blank" rel="noopener">Open in new tab</a>
          </div>
          <iframe src="${w.iframeSrc}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" data-win-iframe></iframe>
        ` : w.content}
      </div>
      <div class="ax-window-resize-handle n" data-win-resize="n"></div>
      <div class="ax-window-resize-handle s" data-win-resize="s"></div>
      <div class="ax-window-resize-handle e" data-win-resize="e"></div>
      <div class="ax-window-resize-handle w" data-win-resize="w"></div>
      <div class="ax-window-resize-handle ne" data-win-resize="ne"></div>
      <div class="ax-window-resize-handle nw" data-win-resize="nw"></div>
      <div class="ax-window-resize-handle se" data-win-resize="se"></div>
      <div class="ax-window-resize-handle sw" data-win-resize="sw"></div>
    `;

    if (!container) init();
    container.appendChild(el);

    // --- Loading / Error state for iframe-backed windows ---
    if (w.iframeSrc) {
      const iframeEl = el.querySelector('[data-win-iframe]');
      const loadingEl = el.querySelector('[data-win-loading]');
      const errorEl = el.querySelector('[data-win-error]');
      let settled = false;

      const showLoaded = () => {
        if (settled) return;
        settled = true;
        clearTimeout(loadTimer);
        if (loadingEl) loadingEl.style.display = 'none';
      };
      const showError = () => {
        if (settled) return;
        settled = true;
        clearTimeout(loadTimer);
        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) errorEl.style.display = 'flex';
      };

      // Same-origin app pages fire 'load' normally. Cross-origin pages that
      // refuse to be framed (X-Frame-Options / CSP frame-ancestors) never
      // fire 'load' and never throw a catchable JS error — a fixed timeout
      // is the standard, documented workaround for detecting that case.
      const loadTimer = setTimeout(showError, 8000);
      iframeEl.addEventListener('load', () => {
        // A same-origin frame that actually loaded content has a real DOM;
        // a frame that was refused by the browser stays blank/about:blank.
        try {
          const blocked = iframeEl.contentWindow && iframeEl.contentDocument &&
            iframeEl.contentDocument.location.href === 'about:blank' && w.iframeSrc !== 'about:blank';
          if (blocked) { showError(); return; }
        } catch (e) {
          // Cross-origin load that DID succeed throws on contentDocument access — that's a success case.
        }
        showLoaded();
      });
      iframeEl.addEventListener('error', showError);

      const retryBtn = el.querySelector('[data-win-error-retry]');
      if (retryBtn) retryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settled = false;
        errorEl.style.display = 'none';
        loadingEl.style.display = 'flex';
        iframeEl.src = iframeEl.src;
        setTimeout(showError, 8000);
      });
    }

    // --- Event Handlers ---
    // Focus on click
    el.addEventListener('mousedown', () => focusWindow(id));

    // Close button
    el.querySelector('[data-win-close]').addEventListener('click', (e) => {
      e.stopPropagation();
      closeWindow(id);
    });

    // Minimize button
    el.querySelector('[data-win-minimize]').addEventListener('click', (e) => {
      e.stopPropagation();
      minimizeWindow(id);
    });

    // Maximize button
    el.querySelector('[data-win-maximize]').addEventListener('click', (e) => {
      e.stopPropagation();
      maximizeWindow(id);
    });

    // Drag
    const titlebar = el.querySelector('[data-window-drag]');
    titlebar.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ax-window-dot')) return;
      if (w.maximized) return;
      startDrag(e, id);
    });

    // Resize
    el.querySelectorAll('[data-win-resize]').forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (w.maximized) return;
        startResize(e, id, handle.dataset.winResize);
      });
    });

    // Double-click titlebar to maximize
    titlebar.addEventListener('dblclick', (e) => {
      if (e.target.closest('.ax-window-dot')) return;
      maximizeWindow(id);
    });

    // Animate in
    requestAnimationFrame(() => {
      el.style.animation = 'none';
      el.offsetHeight; // reflow
      el.style.animation = '';
    });

    focusWindow(id);
    return w;
  }

  // ---- FOCUS ----
  function focusWindow(id) {
    const w = windows[id];
    if (!w || w.minimized) return;
    
    activeWindowId = id;
    w.element.style.zIndex = ++zIndex;
    
    Object.values(windows).forEach(other => {
      if (other.element) {
        other.element.classList.toggle('active', other.id === id);
      }
    });

    if (w.onFocus) w.onFocus(w);
  }

  // ---- CLOSE ----
  function closeWindow(id) {
    const w = windows[id];
    if (!w) return;
    
    if (w.onClose) w.onClose(w);
    
    w.element.style.animation = 'axWindowMinimize .2s cubic-bezier(.19,1,.22,1) forwards';
    setTimeout(() => {
      w.element.remove();
      delete windows[id];
      if (activeWindowId === id) activeWindowId = null;
    }, 200);
  }

  // ---- MINIMIZE ----
  function minimizeWindow(id) {
    const w = windows[id];
    if (!w || w.minimized) return;
    
    if (w.maximized) {
      w.maximized = false;
      restoreSize(w);
    }
    
    w.minimized = true;
    w.element.classList.add('minimized');
    
    minimizedWindows.push(id);
    
    // Remove from visual space after animation
    setTimeout(() => {
      w.element.style.display = 'none';
    }, 250);
    
    // Dispatch event for dock to show indicator
    document.dispatchEvent(new CustomEvent('ax-window-minimized', {
      detail: { id, title: w.title }
    }));
  }

  // ---- RESTORE (from minimized or maximized) ----
  function restoreWindow(id) {
    const w = windows[id];
    if (!w) return;
    
    if (w.minimized) {
      w.minimized = false;
      w.element.style.display = '';
      w.element.classList.remove('minimized');
      w.element.style.animation = 'axWindowAppear .25s cubic-bezier(.19,1,.22,1)';
      minimizedWindows = minimizedWindows.filter(mid => mid !== id);
      focusWindow(id);
    }
    
    if (w.maximized) {
      w.maximized = false;
      restoreSize(w);
    }
  }

  // ---- MAXIMIZE ----
  function maximizeWindow(id) {
    const w = windows[id];
    if (!w) return;
    
    if (w.minimized) {
      restoreWindow(id);
      return;
    }
    
    if (w.maximized) {
      w.maximized = false;
      restoreSize(w);
      return;
    }
    
    w.maximized = true;
    w._prevBounds = {
      width: w.width,
      height: w.height,
      x: w.x,
      y: w.y,
    };
    
    w.element.classList.add('maximized');
    w.element.style.left = '0';
    w.element.style.top = '0';
    w.element.style.width = '100%';
    w.element.style.height = '100%';
    w.element.style.borderRadius = '0';
  }

  function restoreSize(w) {
    w.element.classList.remove('maximized');
    
    const prev = w._prevBounds || { width: 640, height: 420, x: 80, y: 50 };
    w.width = prev.width;
    w.height = prev.height;
    w.x = prev.x;
    w.y = prev.y;
    
    w.element.style.left = w.x + 'px';
    w.element.style.top = w.y + 'px';
    w.element.style.width = w.width + 'px';
    w.element.style.height = w.height + 'px';
    w.element.style.borderRadius = '';
    
    w.maximized = false;
  }

  // ---- DRAG ----
  function startDrag(e, id) {
    const w = windows[id];
    if (!w) return;
    
    const rect = w.element.getBoundingClientRect();
    dragState = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
    };
    
    w.element.classList.add('dragging');
    document.dispatchEvent(new CustomEvent('axwm:dragstart', { detail: { id } }));

    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);
  }

  function onDrag(e) {
    if (!dragState) return;
    const w = windows[dragState.id];
    if (!w) return;
    
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    
    let newX = dragState.origLeft + dx;
    let newY = dragState.origTop + dy;
    
    // Snap detection
    const snapDist = 20;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    // Snap to edges
    if (newX < snapDist) newX = 0;
    else if (newX + w.width > vw - snapDist) newX = vw - w.width;
    
    if (newY < snapDist) newY = 0;
    else if (newY + w.height > vh - snapDist) newY = vh - w.height;
    
    // Snap to center
    if (Math.abs(newX + w.width / 2 - vw / 2) < snapDist && 
        Math.abs(newY + w.height / 2 - vh / 2) < snapDist) {
      newX = vw / 2 - w.width / 2;
      newY = vh / 2 - w.height / 2;
    }
    
    w.x = newX;
    w.y = newY;
    w.element.style.left = newX + 'px';
    w.element.style.top = newY + 'px';

    document.dispatchEvent(new CustomEvent('axwm:dragmove', {
      detail: { id: dragState.id, clientX: e.clientX, clientY: e.clientY }
    }));
  }

  function stopDrag() {
    if (dragState) {
      const id = dragState.id;
      const w = windows[id];
      if (w) w.element.classList.remove('dragging');
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup', stopDrag);
      // Let snap-zones.js decide if the drop point lands in a snap region.
      // It calls snapToZone() itself; we just announce the drop.
      document.dispatchEvent(new CustomEvent('axwm:dragend', { detail: { id } }));
      dragState = null;
      return;
    }
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', stopDrag);
  }

  // ---- SPLIT SCREEN / SNAP ZONES ----
  // zone: 'left' | 'right' | 'top' | 'bottom' | 'tl' | 'tr' | 'bl' | 'br' | 'full'
  function snapToZone(id, zone) {
    const w = windows[id];
    if (!w) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const half = { w: vw / 2, h: vh };
    const quarter = { w: vw / 2, h: vh / 2 };
    let rect;
    switch (zone) {
      case 'left':   rect = { x: 0, y: 0, width: half.w, height: half.h }; break;
      case 'right':  rect = { x: vw / 2, y: 0, width: half.w, height: half.h }; break;
      case 'top':    rect = { x: 0, y: 0, width: vw, height: vh / 2 }; break;
      case 'bottom': rect = { x: 0, y: vh / 2, width: vw, height: vh / 2 }; break;
      case 'tl': rect = { x: 0, y: 0, width: quarter.w, height: quarter.h }; break;
      case 'tr': rect = { x: vw / 2, y: 0, width: quarter.w, height: quarter.h }; break;
      case 'bl': rect = { x: 0, y: vh / 2, width: quarter.w, height: quarter.h }; break;
      case 'br': rect = { x: vw / 2, y: vh / 2, width: quarter.w, height: quarter.h }; break;
      case 'full': return maximizeWindow(id);
      default: return;
    }
    w.maximized = false;
    w.x = rect.x; w.y = rect.y; w.width = rect.width; w.height = rect.height;
    w.element.classList.add('ax-snap-anim');
    w.element.style.left = rect.x + 'px';
    w.element.style.top = rect.y + 'px';
    w.element.style.width = rect.width + 'px';
    w.element.style.height = rect.height + 'px';
    setTimeout(() => w.element.classList.remove('ax-snap-anim'), 220);
    w.snapZone = zone;
  }

  // ---- SHOW DESKTOP ----
  function toggleShowDesktop() {
    if (preShowDesktop) {
      // restore
      preShowDesktop.forEach(id => {
        const w = windows[id];
        if (w) { w.element.classList.remove('ax-desktop-hidden'); }
      });
      preShowDesktop = null;
    } else {
      preShowDesktop = [];
      Object.values(windows).forEach(w => {
        if (w.desktop === activeDesktop && !w.minimized) {
          w.element.classList.add('ax-desktop-hidden');
          preShowDesktop.push(w.id);
        }
      });
    }
  }

  // ---- RESIZE ----
  function startResize(e, id, direction) {
    const w = windows[id];
    if (!w) return;
    
    const rect = w.element.getBoundingClientRect();
    resizeState = {
      id,
      direction,
      startX: e.clientX,
      startY: e.clientY,
      origWidth: rect.width,
      origHeight: rect.height,
      origLeft: rect.left,
      origTop: rect.top,
    };
    
    w.element.classList.add('resizing');
    
    document.addEventListener('mousemove', onResize);
    document.addEventListener('mouseup', stopResize);
  }

  function onResize(e) {
    if (!resizeState) return;
    const w = windows[resizeState.id];
    if (!w) return;
    
    const dx = e.clientX - resizeState.startX;
    const dy = e.clientY - resizeState.startY;
    const dir = resizeState.direction;
    
    let newW = resizeState.origWidth;
    let newH = resizeState.origHeight;
    let newX = resizeState.origLeft;
    let newY = resizeState.origTop;
    
    if (dir.includes('e')) newW = Math.max(w.minWidth, resizeState.origWidth + dx);
    if (dir.includes('w')) {
      newW = Math.max(w.minWidth, resizeState.origWidth - dx);
      newX = resizeState.origLeft + (resizeState.origWidth - newW);
    }
    if (dir.includes('s')) newH = Math.max(w.minHeight, resizeState.origHeight + dy);
    if (dir.includes('n')) {
      newH = Math.max(w.minHeight, resizeState.origHeight - dy);
      newY = resizeState.origTop + (resizeState.origHeight - newH);
    }
    
    // Snap to edges on resize
    if (newX < 0) { newX = 0; }
    if (newY < 0) { newY = 0; }
    if (newX + newW > window.innerWidth) { newW = window.innerWidth - newX; }
    if (newY + newH > window.innerHeight) { newH = window.innerHeight - newY; }
    
    w.width = newW;
    w.height = newH;
    w.x = newX;
    w.y = newY;
    
    w.element.style.width = newW + 'px';
    w.element.style.height = newH + 'px';
    w.element.style.left = newX + 'px';
    w.element.style.top = newY + 'px';
  }

  function stopResize() {
    if (resizeState) {
      const w = windows[resizeState.id];
      if (w) w.element.classList.remove('resizing');
      resizeState = null;
    }
    document.removeEventListener('mousemove', onResize);
    document.removeEventListener('mouseup', stopResize);
  }

  // ---- UTILITIES ----
  function getWindow(id) {
    return windows[id] || null;
  }

  function getAllWindows() {
    return Object.values(windows);
  }

  function getActiveWindow() {
    return activeWindowId ? windows[activeWindowId] : null;
  }

  function closeAll() {
    Object.keys(windows).forEach(id => closeWindow(id));
  }

  function closeOthers(id) {
    Object.keys(windows).forEach(wid => {
      if (wid !== id) closeWindow(wid);
    });
  }

  // ---- KEYBOARD SHORTCUTS ----
  document.addEventListener('keydown', (e) => {
    // Cmd+W or Ctrl+W: Close active window
    if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
      e.preventDefault();
      if (activeWindowId) closeWindow(activeWindowId);
    }
    // Cmd+M or Ctrl+M: Minimize active window
    if ((e.metaKey || e.ctrlKey) && e.key === 'm') {
      e.preventDefault();
      if (activeWindowId) minimizeWindow(activeWindowId);
    }
  });

  // ---- EXPOSE ----
  return {
    init,
    createWindow,
    closeWindow,
    minimizeWindow,
    maximizeWindow,
    restoreWindow,
    focusWindow,
    getWindow,
    getAllWindows,
    getActiveWindow,
    closeAll,
    closeOthers,
    // Part 6 additions
    snapToZone,
    toggleShowDesktop,
    setActiveDesktop,
    getActiveDesktop,
    moveWindowToDesktop,
    getWindowsByDesktop,
  };
})();

// Auto-init if container exists
if (document.getElementById('axWorkspaceContainer')) {
  window.AxiomWindowManager.init();
}

