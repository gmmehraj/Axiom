// AXIOM AI OS — Part 9: AI Automation Platform
// Handles: section tabs, integrations grid, drag & drop workflow canvas,
// API Builder endpoint creation, Webhook Builder generation, copy-to-clipboard.
(function () {
  'use strict';

  /* ---------------- toast ---------------- */
  function toast(msg) {
    let el = document.getElementById('axPart9Toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'axPart9Toast';
      el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);' +
        'background:rgba(20,20,22,.92);border:1px solid rgba(255,255,255,.1);color:#F5F5F5;' +
        'padding:10px 18px;border-radius:12px;font-size:.78rem;z-index:9999;opacity:0;' +
        'transition:opacity .2s,transform .2s;backdrop-filter:blur(16px);pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(20px)';
    }, 1800);
  }

  /* ---------------- tabs ---------------- */
  function initTabs() {
    const tabs = document.querySelectorAll('#axAutomationTabs .ax-tab');
    if (!tabs.length) return;
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.getAttribute('data-tab');
        document.querySelectorAll('.ax-tab-panel').forEach(p => {
          p.classList.toggle('active', p.getAttribute('data-panel') === target);
        });
      });
    });
  }

  /* ---------------- integrations ---------------- */
  const INTEGRATIONS = [
    { name: 'Email', desc: 'Gmail, Outlook & IMAP triggers/actions', connected: true, color: '#6EE7B7',
      icon: '<rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M3 7l9 6 9-6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' },
    { name: 'Calendar', desc: 'Schedule-based triggers & event sync', connected: true, color: '#60A5FA',
      icon: '<rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M3 9h18M8 2v4M16 2v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' },
    { name: 'Files', desc: 'Workspace file upload/change triggers', connected: true, color: '#FBBF24',
      icon: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' },
    { name: 'GitHub', desc: 'Repo events, issues & pull requests', connected: true, color: '#F5F5F5',
      icon: '<path d="M12 2a10 10 0 100 20 10 10 0 000-20zM12 9v4M12 9a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" stroke-width="1.6"/>' },
    { name: 'Discord', desc: 'Post messages & respond to events', connected: false, color: '#A78BFA',
      icon: '<rect x="3" y="5" width="18" height="14" rx="4" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/>' },
    { name: 'Slack', desc: 'Channel messages, DMs & slash commands', connected: true, color: '#F2657A',
      icon: '<path d="M21 11.5a8.5 8.5 0 01-8.9 8.49 8.63 8.63 0 01-3.9-.94L3 21l1.95-5.2a8.5 8.5 0 1116.05-4.3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' },
    { name: 'WhatsApp', desc: 'Send & receive via WhatsApp Business', connected: false, color: '#6EE7B7',
      icon: '<path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.07L2 22l5.07-1.32A9.94 9.94 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" stroke="currentColor" stroke-width="1.6"/>' },
    { name: 'Google Drive', desc: 'Read/write files & folder triggers', connected: true, color: '#FBBF24',
      icon: '<path d="M8 3l8 0 5 8.5-5 8.5H8l-5-8.5L8 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' },
    { name: 'Dropbox', desc: 'File sync & shared-folder triggers', connected: false, color: '#60A5FA',
      icon: '<path d="M6 3l6 4-6 4-6-4 6-4zM18 3l6 4-6 4-6-4 6-4zM6 15l6 4-6 4-6-4 6-4zM18 15l6 4-6 4-6-4 6-4z" stroke="currentColor" stroke-width="1.2"/>' },
    { name: 'Browser Automation', desc: 'Headless browsing, scraping & form-fill', connected: true, color: '#A78BFA',
      icon: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 00-10 10M12 2a15 15 0 0110 10" stroke="currentColor" stroke-width="1.6"/>' }
  ];

  function renderIntegrations() {
    const grid = document.getElementById('axIntegrationGrid');
    if (!grid) return;
    grid.innerHTML = INTEGRATIONS.map((it, i) => `
      <div class="ax-integration-card">
        <div class="ax-integration-icon" style="background:${it.color}1F; color:${it.color};">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">${it.icon}</svg>
        </div>
        <div class="ax-integration-info">
          <div class="name">${it.name}</div>
          <div class="desc">${it.desc}</div>
        </div>
        <button class="ax-integration-toggle ${it.connected ? 'connected' : ''}" data-idx="${i}">
          ${it.connected ? 'Connected' : 'Connect'}
        </button>
      </div>
    `).join('');

    grid.querySelectorAll('.ax-integration-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = +btn.getAttribute('data-idx');
        const it = INTEGRATIONS[idx];
        it.connected = !it.connected;
        btn.classList.toggle('connected', it.connected);
        btn.textContent = it.connected ? 'Connected' : 'Connect';
        toast(it.connected ? `${it.name} connected` : `${it.name} disconnected`);
      });
    });
  }

  /* ---------------- workflow canvas drag & drop ---------------- */
  const NODE_COLORS = {
    Schedule: '6EE7B7', 'AI Event': '6EE7B7', Webhook: '6EE7B7', 'File Upload': '6EE7B7',
    'AI Generate': 'FBBF24', 'API Call': 'FBBF24', 'Send Email': 'FBBF24', 'Save File': 'FBBF24',
    Condition: 'FBBF24', Loop: '60A5FA', Variable: '60A5FA', Filter: '60A5FA',
    Email: '6EE7B7', Calendar: '60A5FA', GitHub: 'F5F5F5', Slack: 'F2657A',
    WhatsApp: '6EE7B7', 'Google Drive': 'FBBF24'
  };

  function nodeIconSvg(el) {
    const svg = el.querySelector('svg');
    return svg ? svg.outerHTML : '';
  }

  function initCanvas() {
    const canvas = document.querySelector('.ax-workflow-canvas');
    const paletteItems = document.querySelectorAll('.ax-palette-item');
    if (!canvas || !paletteItems.length) return;

    let dragLabel = null, dragIcon = null;
    paletteItems.forEach(item => {
      item.addEventListener('dragstart', () => {
        dragLabel = item.textContent.trim();
        dragIcon = nodeIconSvg(item);
      });
    });

    canvas.addEventListener('dragover', e => { e.preventDefault(); canvas.classList.add('drop-hover'); });
    canvas.addEventListener('dragleave', () => canvas.classList.remove('drop-hover'));
    canvas.addEventListener('drop', e => {
      e.preventDefault();
      canvas.classList.remove('drop-hover');
      if (!dragLabel) return;
      addNode(canvas, dragLabel, dragIcon);
      dragLabel = null; dragIcon = null;
    });

    canvas.addEventListener('click', e => {
      const node = e.target.closest('.ax-workflow-node');
      if (!node) return;
      if (e.target.closest('.ax-node-remove')) {
        node.previousElementSibling && node.previousElementSibling.classList.contains('ax-workflow-connector')
          ? node.previousElementSibling.remove() : null;
        node.remove();
        return;
      }
      canvas.querySelectorAll('.ax-workflow-node').forEach(n => n.classList.remove('selected'));
      node.classList.add('selected');
    });
  }

  function addNode(canvas, label, iconSvg) {
    const color = NODE_COLORS[label] || 'F5F5F5';
    const hint = canvas.querySelector('div[style*="Drag items"]');

    const connector = document.createElement('div');
    connector.className = 'ax-workflow-connector';
    connector.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const node = document.createElement('div');
    node.className = 'ax-workflow-node';
    node.style.borderColor = `rgba(${hexToRgb(color)},.2)`;
    node.innerHTML = `
      <button class="ax-node-remove" title="Remove step">×</button>
      <div class="node-icon" style="background:rgba(${hexToRgb(color)},.1); color:#${color};">${iconSvg || ''}</div>
      <div>
        <div class="node-label">${label}</div>
        <div class="node-desc">New step — click to configure</div>
      </div>`;

    if (hint) {
      canvas.insertBefore(connector, hint);
      canvas.insertBefore(node, hint);
    } else {
      canvas.appendChild(connector);
      canvas.appendChild(node);
    }
    toast(`Added "${label}" step`);
  }

  function hexToRgb(hex) {
    const n = parseInt(hex, 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }

  /* ---------------- API builder ---------------- */
  function initApiBuilder() {
    const btn = document.getElementById('apiCreateBtn');
    const list = document.getElementById('apiEndpointList');
    const methodSel = document.getElementById('apiMethodSelect');
    const pathInput = document.getElementById('apiPathInput');
    if (!btn || !list) return;

    btn.addEventListener('click', () => {
      const method = methodSel.value;
      let path = pathInput.value.trim();
      if (!path) { toast('Enter a route path first'); return; }
      if (!path.startsWith('/')) path = '/' + path;
      const methodClass = 'ax-method-' + method.toLowerCase();
      const url = `https://api.axiomai.app/v1${path}`;
      const row = document.createElement('div');
      row.className = 'ax-endpoint-row';
      row.innerHTML = `
        <span class="ax-method-tag ${methodClass}">${method}</span>
        <span class="ax-endpoint-path">${path}</span>
        <span class="ax-badge ax-badge-warning">Draft</span>
        <button class="ax-copy-btn" data-copy="${url}">Copy URL</button>`;
      list.appendChild(row);
      pathInput.value = '';
      toast(`Endpoint ${method} ${path} created`);
    });
  }

  /* ---------------- webhook builder ---------------- */
  function initWebhookBuilder() {
    const btn = document.getElementById('webhookCreateBtn');
    const list = document.getElementById('webhookList');
    const nameInput = document.getElementById('webhookNameInput');
    const eventSel = document.getElementById('webhookEventSelect');
    if (!btn || !list) return;

    btn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      const event = eventSel.value;
      const token = Math.random().toString(16).slice(2, 8);
      const url = `https://hooks.axiomai.app/wh/${token}`;
      const row = document.createElement('div');
      row.className = 'ax-endpoint-row';
      row.innerHTML = `
        <span class="ax-badge ax-badge-info">${event}</span>
        <span class="ax-endpoint-path">${url}</span>
        <span class="ax-badge ax-badge-success">Active</span>
        <button class="ax-copy-btn" data-copy="${url}">Copy URL</button>`;
      list.appendChild(row);
      nameInput.value = '';
      toast(name ? `Webhook "${name}" generated` : 'Webhook generated');
    });
  }

  /* ---------------- copy buttons (delegated, works for dynamic rows too) ---------------- */
  function initCopyDelegate() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('.ax-copy-btn');
      if (!btn) return;
      const text = btn.getAttribute('data-copy') || '';
      if (navigator.clipboard && text) {
        navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard')).catch(() => toast('Copy failed'));
      }
    });
  }

  /* ---------------- publish workflow ----------------
   * Block 2 / Step 4 / Part 1: publishing no longer just shows a toast.
   * It dispatches an event that automation-runtime-ui.js (loaded after
   * this file) handles by reading the live canvas nodes, persisting them
   * as a real workflow via AxiomAutomationEngine, and marking it active.
   * This file stays focused on canvas/tabs/integrations wiring and does
   * not talk to the engine directly. */
  function initPublish() {
    const btn = document.getElementById('publishWorkflow');
    if (!btn) return;
    btn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('axiom:automation:publish-request'));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    renderIntegrations();
    initCanvas();
    initApiBuilder();
    initWebhookBuilder();
    initCopyDelegate();
    initPublish();
  });
})();
