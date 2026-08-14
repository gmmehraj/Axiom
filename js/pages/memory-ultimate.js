/* ============================================================
   AXIOM — Truthful Memory Page
   ------------------------------------------------------------
   This page is a view over AxiomMemoryEngine. It never seeds demo
   memories, invents statistics, or owns a second memory store.
   ============================================================ */
(function (global) {
  'use strict';

  const engine = global.AxiomMemoryEngine;
  let unsubscribe = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>\"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[ch]));
  }

  function relativeDate(ts) {
    const diff = Math.max(0, Date.now() - Number(ts || 0));
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + 'm ago';
    if (diff < 86400000) return Math.round(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.round(diff / 86400000) + 'd ago';
    return Math.round(diff / 604800000) + 'w ago';
  }

  function init() {
    const page = document.querySelector('.app-content-inner');
    if (!page) return;

    if (!engine) {
      page.innerHTML = `<div class="ax-page-header"><div><h1>Persistent Memory</h1><p>Memory Engine unavailable.</p></div></div><div class="ax-workspace-fallback"><h2>Memory unavailable</h2><p>The real Memory Engine is not loaded on this page.</p></div>`;
      return;
    }

    engine.init();
    let filter = 'all';
    let query = '';

    page.innerHTML = `
      <div class="ax-page-header">
        <div class="ax-page-header-left">
          <h1>Persistent Memory</h1>
          <p>Manage the memories Axiom actually stores across sessions.</p>
        </div>
        <div class="ax-page-header-right">
          <button class="btn btn-outline btn-sm" id="memoryImportBtn">Import</button>
          <button class="btn btn-solid btn-sm" id="memoryExportBtn">Export All</button>
        </div>
      </div>

      <div class="ax-page-grid ax-page-grid-3" data-memory-stats></div>

      <div class="ax-chart-card">
        <div class="ax-chart-header ax-chart-header-wrap">
          <div class="filter-bar">
            <button type="button" class="chip active" data-filter="all">All Memory</button>
            <button type="button" class="chip" data-filter="recent">Recent</button>
            <button type="button" class="chip" data-filter="pinned">Pinned</button>
          </div>
          <div class="ax-chart-header-actions">
            <input type="search" id="memoryPageSearch" placeholder="Search memory..." aria-label="Search memory" style="max-width:260px;width:100%;padding:8px 12px;background:rgba(255,255,255,.03);border:1px solid var(--ax-border);border-radius:999px;color:var(--ax-text);outline:none;">
            <button class="btn btn-solid btn-sm" id="memoryAddBtn">+ Add Memory</button>
          </div>
        </div>
        <div class="ax-table-wrap" id="axMemoryTableWrap"></div>
      </div>`;

    const statsEl = page.querySelector('[data-memory-stats]');
    const tableEl = page.querySelector('#axMemoryTableWrap');
    const searchEl = page.querySelector('#memoryPageSearch');

    function render() {
      const stats = engine.getStats();
      const all = engine.queryMemories({});
      const recent = all.filter(m => Date.now() - Number(m.updatedAt || m.createdAt || 0) < 7 * 86400000).length;
      const working = engine.getWorkingMemory();

      statsEl.innerHTML = [
        ['Memory Items', stats.memoryCount, 'Stored by Memory Engine'],
        ['Recent', recent, 'Updated in the last 7 days'],
        ['Pinned', stats.pinnedCount, 'Actually pinned'],
      ].map(c => `<div class="ax-metric-card"><div class="ax-metric-label">${c[0]}</div><div class="ax-metric-value">${c[1]}</div><div class="ax-metric-sub">${c[2]}</div></div>`).join('');

      let items = engine.queryMemories({ text: query.trim() });
      if (filter === 'recent') items = items.filter(m => Date.now() - Number(m.updatedAt || m.createdAt || 0) < 2 * 86400000);
      if (filter === 'pinned') items = items.filter(m => !!m.pinned);
      items.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

      if (!items.length) {
        tableEl.innerHTML = `<div class="ax-workspace-fallback" style="padding:52px 20px;"><h2>${query || filter !== 'all' ? 'No matching memories' : 'No memories yet'}</h2><p>${query || filter !== 'all' ? 'Try another search or filter.' : 'Axiom will build memory as you interact with it.'}</p></div>`;
        return;
      }

      tableEl.innerHTML = `<table class="ax-table"><thead><tr><th>Memory</th><th>Agent</th><th>Date</th><th>Type</th><th>Confidence</th><th></th></tr></thead><tbody>${items.map(m => `
        <tr>
          <td>${escapeHtml(m.text)}</td>
          <td>${escapeHtml(m.agent || 'Unknown')}</td>
          <td>${relativeDate(m.updatedAt || m.createdAt)}</td>
          <td>${escapeHtml(m.type || 'Unknown')}</td>
          <td>${typeof m.confidence === 'number' ? Math.round(m.confidence * 100) + '%' : 'Unavailable'}</td>
          <td>${m.pinned ? '<span class="badge">Pinned</span>' : '<button type="button" class="btn btn-ghost btn-sm" data-pin="' + escapeHtml(m.id) + '">Pin</button>'}</td>
        </tr>`).join('')}</tbody></table>`;

      tableEl.querySelectorAll('[data-pin]').forEach(btn => btn.addEventListener('click', () => {
        engine.updateMemory(btn.dataset.pin, { pinned: true });
      }));
    }

    page.querySelectorAll('[data-filter]').forEach(btn => btn.addEventListener('click', () => {
      filter = btn.dataset.filter || 'all';
      page.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === btn));
      render();
    }));
    searchEl.addEventListener('input', () => { query = searchEl.value; render(); });

    page.querySelector('#memoryAddBtn')?.addEventListener('click', () => {
      const modal = document.getElementById('addMemoryModal');
      if (modal) modal.style.display = 'flex';
    });

    page.querySelector('#memoryExportBtn')?.addEventListener('click', () => {
      const payload = engine.exportAll();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'axiom-memory-export.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    page.querySelector('#memoryImportBtn')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const data = JSON.parse(await file.text());
          if (engine.importAll(data)) render();
        } catch (e) {
          console.error('[Memory] import failed', e);
        }
      });
      input.click();
    });

    const saveBtn = document.getElementById('addMemoryModalSave');
    saveBtn?.addEventListener('click', () => {
      const content = document.getElementById('addMemoryContent')?.value?.trim();
      if (!content) return;
      const agent = document.getElementById('addMemoryAgent')?.value || 'General';
      engine.addMemory({ text: content, agent: agent === 'All Agents' ? 'General' : agent, source: 'manual' });
      const modal = document.getElementById('addMemoryModal');
      if (modal) modal.style.display = 'none';
      const input = document.getElementById('addMemoryContent');
      if (input) input.value = '';
      render();
    });

    unsubscribe = typeof engine.onChange === 'function' ? engine.onChange(render) : null;
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
