// ============================================================
// AXIOM — Block 2 / Step 4 / Part 1: Automation Runtime UI Bridge
// ------------------------------------------------------------
// Wires the existing Visual Automation Builder markup (automation.html)
// to the real os/core/automation-engine.js. Loaded after
// js/pages/automation-part9.js, which still owns tabs, the drag/drop
// canvas, the integrations grid, and the API/webhook builders — none
// of that is touched here.
//
// Responsibilities:
//   - Publish: reads the live canvas nodes, persists them as a
//     workflow through the engine, marks it active.
//   - Run Now: enqueues a real run of the published workflow.
//   - Recent Workflow Runs table: rendered from engine.listRuns(),
//     no hardcoded rows, updates live as runs execute.
//   - Cancel / Retry: per-run actions wired to the engine.
//   - Stat cards: Active Workflows / Total Runs Today / Failed Runs
//     reflect engine.getStats(), not fixed numbers.
// ============================================================
(function () {
  'use strict';

  const UI_NS = 'axiom:automation:ui:v1:';
  const CURRENT_WF_KEY = UI_NS + 'currentWorkflowId';

  function engine() { return window.AxiomAutomationBuilderEngine; }

  /* ---------------- toast (shared visual language with automation-part9.js) ---------------- */
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

  /* ---------------- read the live canvas into a step list ---------------- */
  function readCanvasSteps() {
    const nodes = document.querySelectorAll('.ax-workflow-canvas .ax-workflow-node');
    const steps = [];
    nodes.forEach(node => {
      const label = (node.querySelector('.node-label') || {}).textContent || 'Step';
      const desc = (node.querySelector('.node-desc') || {}).textContent || '';
      steps.push({ label: label.trim(), desc: desc.trim(), type: inferType(label.trim()) });
    });
    return steps;
  }

  const KNOWN_TYPES = (engine() && engine().STEP_TYPES) || [
    'Schedule', 'Webhook', 'File Upload', 'AI Event', 'Condition', 'Loop', 'Variable', 'Filter',
    'AI Generate', 'API Call', 'Send Email', 'Save File', 'Email', 'Calendar', 'GitHub', 'Slack', 'WhatsApp', 'Google Drive'
  ];
  function inferType(label) {
    const found = KNOWN_TYPES.find(t => label.indexOf(t) !== -1);
    return found || 'Action';
  }

  /* ---------------- current workflow tracking ---------------- */
  function getCurrentWorkflowId() {
    try { return window.localStorage.getItem(CURRENT_WF_KEY); } catch (e) { return null; }
  }
  function setCurrentWorkflowId(id) {
    try { window.localStorage.setItem(CURRENT_WF_KEY, id); } catch (e) { /* ignore */ }
  }

  function ensureWorkflowFromCanvas(name) {
    const eng = engine();
    const steps = readCanvasSteps();
    if (!steps.length) return null;

    let id = getCurrentWorkflowId();
    let wf = id ? eng.getWorkflow(id) : null;
    if (!wf) {
      wf = eng.createWorkflow({ name: name || 'Visual Workflow', steps });
      setCurrentWorkflowId(wf.id);
    } else {
      wf = eng.updateWorkflow(wf.id, { steps, name: name || wf.name });
    }
    return wf;
  }

  /* ---------------- publish / run wiring ---------------- */
  function initPublishHandler() {
    document.addEventListener('axiom:automation:publish-request', () => {
      const eng = engine();
      if (!eng) { toast('Automation engine unavailable'); return; }
      const wf = ensureWorkflowFromCanvas();
      if (!wf) { toast('Add at least one step before publishing'); return; }
      eng.publishWorkflow(wf.id);
      toast('Workflow published');
      const runBtn = document.getElementById('runWorkflowNow');
      if (runBtn) runBtn.disabled = false;
      renderStats();
    });
  }

  function initRunNowHandler() {
    const btn = document.getElementById('runWorkflowNow');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const eng = engine();
      if (!eng) return;
      const id = getCurrentWorkflowId();
      const wf = id ? eng.getWorkflow(id) : null;
      if (!wf || wf.status !== 'active') {
        toast('Publish the workflow before running it');
        return;
      }
      eng.enqueueRun(wf.id, { trigger: 'Manual' });
      toast('Run queued');
    });
  }

  /* ---------------- runs table rendering ---------------- */
  function relativeTime(ts) {
    const diffMs = Date.now() - ts;
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  }

  const STATUS_BADGE = {
    success: '<span class="ax-badge ax-badge-success">Success</span>',
    failed: '<span class="ax-badge ax-badge-error">Failed</span>',
    cancelled: '<span class="ax-badge ax-badge-warning">Cancelled</span>',
    running: '<span class="ax-badge ax-badge-info">Running…</span>',
    queued: '<span class="ax-badge ax-badge-info">Queued</span>'
  };

  function formatDuration(run) {
    if (typeof run.duration === 'number') return (run.duration / 1000).toFixed(1) + 's';
    return '—';
  }

  function renderRunRow(run) {
    const badge = STATUS_BADGE[run.status] || run.status;
    const canCancel = run.status === 'queued' || run.status === 'running';
    const canRetry = run.status === 'failed' || run.status === 'cancelled';
    let actions = '';
    if (canCancel) actions += `<button class="ax-copy-btn" data-cancel-run="${run.id}">Cancel</button>`;
    if (canRetry) actions += `<button class="ax-copy-btn" data-retry-run="${run.id}">Retry</button>`;
    if (!actions) actions = '<span style="color:var(--ax-text-tertiary, rgba(255,255,255,.3));">—</span>';
    return `<tr data-run-row="${run.id}">
      <td>${run.workflowName}</td>
      <td>${badge}</td>
      <td>${formatDuration(run)}</td>
      <td>${run.trigger}</td>
      <td>${relativeTime(run.queuedAt)}</td>
      <td>${actions}</td>
    </tr>`;
  }

  function renderRunsTable() {
    const eng = engine();
    const body = document.getElementById('axRunsTableBody');
    const wrap = document.getElementById('axRunsTableWrap');
    const empty = document.getElementById('axRunsEmpty');
    if (!eng || !body) return;

    const runs = eng.listRuns({ limit: 25 });
    if (!runs.length) {
      body.innerHTML = '';
      if (wrap) wrap.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }
    if (wrap) wrap.hidden = false;
    if (empty) empty.hidden = true;
    body.innerHTML = runs.map(renderRunRow).join('');
  }

  function initRunsTableActions() {
    const body = document.getElementById('axRunsTableBody');
    if (!body) return;
    body.addEventListener('click', e => {
      const eng = engine();
      if (!eng) return;
      const cancelBtn = e.target.closest('[data-cancel-run]');
      if (cancelBtn) {
        eng.cancelRun(cancelBtn.getAttribute('data-cancel-run'));
        toast('Run cancelled');
        return;
      }
      const retryBtn = e.target.closest('[data-retry-run]');
      if (retryBtn) {
        eng.retryRun(retryBtn.getAttribute('data-retry-run'));
        toast('Retry queued');
      }
    });
  }

  /* ---------------- stat cards ---------------- */
  function renderStats() {
    const eng = engine();
    if (!eng) return;
    const stats = eng.getStats();
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    setText('axMetricActiveWorkflows', stats.activeWorkflows);
    setText('axMetricRunsToday', stats.totalRunsToday);
    setText('axMetricFailedRuns', stats.failedRunsToday);

    const activeSub = document.getElementById('axMetricActiveWorkflowsSub');
    if (activeSub) activeSub.textContent = stats.activeWorkflows ? 'All running optimally' : 'No workflows published yet';

    const runningSub = document.getElementById('axMetricRunningNow');
    if (runningSub) {
      const q = eng.getQueueState();
      runningSub.textContent = q.running > 0
        ? `${q.running} running, ${q.pending} queued`
        : (q.pending > 0 ? `${q.pending} queued` : 'Queue idle');
    }
  }

  /* ---------------- init ---------------- */
  function init() {
    const eng = engine();
    if (!eng) { toast('Automation engine failed to load'); return; }
    eng.init();

    initPublishHandler();
    initRunNowHandler();
    initRunsTableActions();

    const id = getCurrentWorkflowId();
    const wf = id ? eng.getWorkflow(id) : null;
    const runBtn = document.getElementById('runWorkflowNow');
    if (runBtn) runBtn.disabled = !(wf && wf.status === 'active');

    eng.onChange(() => {
      renderRunsTable();
      renderStats();
    });

    renderRunsTable();
    renderStats();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
