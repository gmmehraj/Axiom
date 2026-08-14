// ============================================================
// AXIOM AI OS X — Canonical Workspace Manager
// ------------------------------------------------------------
// The app manifest owns workspace identity and availability. This manager
// owns the single runtime opening path used by desktop and shell launchers.
// ============================================================
window.AxiomWorkspaceManager = (function() {
  'use strict';

  let currentWorkspace = null;
  let listeners = [];
  let loading = {};

  function registry() {
    return window.AxiomAppManifest ? window.AxiomAppManifest.workspaces : {};
  }

  function getWorkspaces() {
    return registry();
  }

  function getCurrent() {
    return currentWorkspace;
  }

  function getWorkspace(id) {
    return registry()[id] || null;
  }

  function setContainer() {
    // Kept for backward compatibility with existing shell boot code.
  }

  function open(workspaceId, opts = {}) {
    const ws = getWorkspace(workspaceId);
    if (!ws) {
      showUnavailable(workspaceId, 'This workspace does not exist in the Axiom registry.');
      return false;
    }

    if (workspaceId === currentWorkspace && !opts.force && workspaceId !== 'dashboard') {
      return true;
    }

    currentWorkspace = workspaceId;
    document.body.dataset.workspace = workspaceId;
    listeners.forEach(fn => fn(workspaceId, ws));
    document.dispatchEvent(new CustomEvent('ax-workspace-open', {
      detail: { workspace: workspaceId, config: ws }
    }));

    if (workspaceId === 'dashboard') {
      // Dashboard is the shell itself. Other workspaces are native windows,
      // so returning here preserves the live Mission Control DOM and its
      // bound event handlers.
      return true;
    }

    if (ws.status === 'pending') {
      return showUnavailable(workspaceId, 'This workspace is not yet available in Axiom.');
    }

    if (ws.status === 'standalone') {
      if (ws.route) window.open(ws.route, '_blank', 'noopener');
      return true;
    }

    if (!ws.safeToOpen) {
      return showUnavailable(workspaceId, 'This workspace is currently unavailable.');
    }

    if (ws.modulePath) {
      return loadModule(workspaceId, opts);
    }

    if (ws.route) {
      return openWindow(workspaceId, { ...opts, iframeSrc: ws.route });
    }

    return showUnavailable(workspaceId, 'This workspace has no implementation or route yet.');
  }

  function loadModule(workspaceId, opts = {}) {
    const ws = getWorkspace(workspaceId);
    if (!ws || !ws.modulePath) return false;

    if (window.AxiomWorkspaces && window.AxiomWorkspaces[workspaceId]) {
      return openModuleWindow(workspaceId, window.AxiomWorkspaces[workspaceId], opts);
    }

    if (loading[workspaceId]) return true;
    loading[workspaceId] = true;

    const script = document.createElement('script');
    script.src = ws.modulePath;
    script.onload = () => {
      delete loading[workspaceId];
      const module = window.AxiomWorkspaces && window.AxiomWorkspaces[workspaceId];
      if (module) openModuleWindow(workspaceId, module, opts);
      else showError(workspaceId, 'This workspace module loaded but did not register correctly.');
    };
    script.onerror = () => {
      delete loading[workspaceId];
      showError(workspaceId, 'This workspace failed to load.');
    };
    document.head.appendChild(script);
    return true;
  }

  function openModuleWindow(workspaceId, module, opts = {}) {
    const ws = getWorkspace(workspaceId);
    if (!ws || !module || typeof module.render !== 'function') {
      return showError(workspaceId, 'This workspace has no usable implementation.');
    }

    const win = openWindow(workspaceId, opts);
    if (!win || !win.element) return false;

    const body = win.element.querySelector('.ax-window-body');
    if (!body) return false;

    const temp = document.createElement('div');
    try {
      module.render(temp, opts);
    } catch (error) {
      body.innerHTML = '';
      renderState(body, ws, 'error', error?.message || 'This workspace failed to render.');
      return false;
    }

    // Existing workspace modules render their own .ax-workspace-window shell.
    // Reuse their real inner content while letting AxiomWindowManager own the
    // outer native window. This removes the second window-opening system
    // without rewriting the working workspace pages.
    const moduleWindow = temp.querySelector('.ax-workspace-window');
    const moduleBody = moduleWindow?.querySelector('.ax-workspace-window-body');
    body.innerHTML = '';
    if (moduleBody) {
      Array.from(moduleBody.childNodes).forEach(node => body.appendChild(node));
    } else {
      Array.from(temp.childNodes).forEach(node => body.appendChild(node));
    }

    if (ws.status === 'partial') {
      const banner = document.createElement('div');
      banner.className = 'ax-workspace-status-banner';
      banner.textContent = 'Partial workspace — some capabilities are still being completed.';
      body.prepend(banner);
    }

    return true;
  }

  function openWindow(workspaceId, opts = {}) {
    const ws = getWorkspace(workspaceId);
    const wm = window.AxiomWindowManager;
    if (!ws || !wm || typeof wm.createWindow !== 'function') {
      return null;
    }

    const existing = wm.getAllWindows ? wm.getAllWindows().find(w => w.id === 'ws-' + workspaceId) : null;
    if (existing && typeof existing.focus === 'function') {
      existing.focus();
      return existing;
    }

    return wm.createWindow({
      id: 'ws-' + workspaceId,
      title: ws.name,
      icon: ws.icon,
      width: opts.width || 800,
      height: opts.height || 550,
      iframeSrc: opts.iframeSrc || null,
      content: opts.content || '',
      onClose: () => rememberOpenWorkspaces(),
    });
  }

  function showUnavailable(workspaceId, message) {
    const ws = getWorkspace(workspaceId) || {
      id: workspaceId, name: workspaceId || 'Workspace', icon: 'os'
    };
    const win = openWindow(workspaceId, {});
    if (!win || !win.element) return false;
    const body = win.element.querySelector('.ax-window-body');
    if (!body) return false;
    renderState(body, ws, 'unavailable', message);
    rememberOpenWorkspaces();
    return true;
  }

  function showError(workspaceId, message) {
    const ws = getWorkspace(workspaceId) || {
      id: workspaceId, name: workspaceId || 'Workspace', icon: 'os'
    };
    const win = openWindow(workspaceId, {});
    if (!win || !win.element) return false;
    const body = win.element.querySelector('.ax-window-body');
    if (!body) return false;
    renderState(body, ws, 'error', message);
    const retry = document.createElement('button');
    retry.className = 'btn btn-sm';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => open(workspaceId, { force: true }));
    body.appendChild(retry);
    rememberOpenWorkspaces();
    return false;
  }

  function renderState(container, ws, state, message) {
    const heading = state === 'error' ? 'Workspace error' : 'Coming soon';
    container.innerHTML = `
      <div class="ax-workspace-fallback" data-motion="fade-in">
        <div class="ax-workspace-fallback-icon">${window.AxiomIcons ? window.AxiomIcons.svg(ws.icon || 'os', 48) : ''}</div>
        <h2>${ws.name || 'Workspace'}</h2>
        <p>${message}</p>
        <small>${heading}</small>
      </div>
    `;
  }

  function rememberOpenWorkspaces() {
    try {
      const open = window.AxiomWindowManager
        ? window.AxiomWindowManager.getAllWindows()
            .map(w => w.id)
            .filter(id => id && id.startsWith('ws-') && !id.startsWith('ws-dashboard'))
            .map(id => id.slice(3))
            .filter(id => {
              const ws = getWorkspace(id);
              return ws && ws.status !== 'pending' && ws.presentation === 'window';
            })
        : [];
      localStorage.setItem('axiom-open-workspaces', JSON.stringify(open));
    } catch (_) { /* storage may be unavailable */ }
  }

  function onChange(fn) {
    listeners.push(fn);
    return () => { listeners = listeners.filter(l => l !== fn); };
  }

  return {
    getWorkspaces,
    getCurrent,
    getWorkspace,
    setContainer,
    open,
    showUnavailable,
    onChange,
  };
})();
