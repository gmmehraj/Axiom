// ============================================================
// AXIOM AI OS X — Memory Workspace Module
// ------------------------------------------------------------
// The OS workspace is a view over AxiomMemoryEngine. It does not
// own memory data, seed fake records, or maintain a second store.
// ============================================================
if (!window.AxiomWorkspaces) window.AxiomWorkspaces = {};

window.AxiomWorkspaces.memory = {
  name: 'Memory',
  icon: 'memory',

  render: function (container) {
    const engine = window.AxiomMemoryEngine;
    if (!engine) {
      container.innerHTML = `
        <div class="ax-workspace-window" data-motion="fade-in">
          <div class="ax-workspace-window-header">
            <span class="ax-workspace-window-title">Memory System</span>
            <button class="ax-workspace-window-close" onclick="AxiomOS.openWorkspace('dashboard')" aria-label="Close">×</button>
          </div>
          <div class="ax-workspace-window-body">
            <div class="ax-workspace-fallback">
              <h2>Memory unavailable</h2>
              <p>The Memory Engine is not loaded on this page.</p>
            </div>
          </div>
        </div>`;
      return;
    }

    engine.init();
    let unsubscribe = null;
    let search = '';
    let filter = 'all';

    container.innerHTML = `
      <div class="ax-workspace-window ax-memory-workspace" data-motion="fade-in">
        <div class="ax-workspace-window-header">
          <span class="ax-workspace-window-title">Memory System</span>
          <button class="ax-workspace-window-close" onclick="AxiomOS.openWorkspace('dashboard')" aria-label="Close">×</button>
        </div>
        <div class="ax-workspace-window-body">
          <div class="ax-memory-page" style="max-width:1100px;margin:0 auto;padding:clamp(12px,2vw,28px);">
            <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-bottom:20px;">
              <div>
                <h2 style="margin:0 0 6px;">Memory System</h2>
                <p style="margin:0;color:var(--ax-text-3);max-width:650px;">Persistent memory from the same engine used by Axiom's Memory page.</p>
              </div>
              <span data-memory-live style="font-size:.72rem;color:var(--ax-text-3);">Live data</span>
            </div>

            <div data-memory-stats style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:20px;"></div>

            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px;">
              <button type="button" data-memory-filter="all" class="btn btn-solid btn-sm">All</button>
              <button type="button" data-memory-filter="recent" class="btn btn-ghost btn-sm">Recent</button>
              <button type="button" data-memory-filter="pinned" class="btn btn-ghost btn-sm">Pinned</button>
              <div style="flex:1;min-width:120px;"></div>
              <input data-memory-search type="search" placeholder="Search memory..." aria-label="Search memory" style="max-width:280px;width:100%;background:rgba(255,255,255,.03);border:1px solid var(--ax-border);border-radius:999px;padding:8px 12px;color:var(--ax-text);outline:none;">
            </div>

            <div data-memory-list></div>
          </div>
        </div>
      </div>`;

    const statsEl = container.querySelector('[data-memory-stats]');
    const listEl = container.querySelector('[data-memory-list]');
    const searchEl = container.querySelector('[data-memory-search]');
    const filterButtons = Array.from(container.querySelectorAll('[data-memory-filter]'));

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>\"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[ch]));
    }

    function relativeDate(ts) {
      const diff = Math.max(0, Date.now() - Number(ts || 0));
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + 'm ago';
      if (diff < 86400000) return Math.round(diff / 3600000) + 'h ago';
      return Math.round(diff / 86400000) + 'd ago';
    }

    function getItems() {
      let items = engine.queryMemories({ text: search.trim() });
      if (filter === 'recent') items = items.filter(m => Date.now() - Number(m.updatedAt || m.createdAt || 0) < 2 * 86400000);
      if (filter === 'pinned') items = items.filter(m => !!m.pinned);
      return items.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    }

    function render() {
      const stats = engine.getStats();
      const memories = getItems();
      const all = engine.queryMemories({});
      const recent = all.filter(m => Date.now() - Number(m.updatedAt || m.createdAt || 0) < 7 * 86400000).length;
      const working = engine.getWorkingMemory();
      const tagCount = engine.listTags().length;

      statsEl.innerHTML = [
        ['Memories', stats.memoryCount, 'Stored by Memory Engine'],
        ['Pinned', stats.pinnedCount, 'Persisted pinned memories'],
        ['Recent', recent, 'Updated in the last 7 days'],
        ['Working memory', working.length, `${Math.round(stats.shortTermCacheLoad * 100)}% of current capacity`]
      ].map(card => `<div class="ax-widget"><div class="ax-widget-head"><span class="ax-widget-label">${card[0]}</span></div><div class="ax-widget-value">${card[1]}</div><div class="ax-widget-sub">${card[2]}</div></div>`).join('');

      const live = container.querySelector('[data-memory-live]');
      if (live) live.textContent = `${all.length} memories · ${tagCount} tags · live engine`;

      if (!memories.length) {
        listEl.innerHTML = `
          <div class="ax-workspace-fallback" style="padding:48px 20px;">
            <h3>${search || filter !== 'all' ? 'No matching memories' : 'No memories yet'}</h3>
            <p>${search || filter !== 'all' ? 'Try a different search or filter.' : 'Axiom will build memory as you interact with it.'}</p>
          </div>`;
        return;
      }

      listEl.innerHTML = `
        <div style="overflow:auto;background:var(--ax-glass);border:1px solid var(--ax-border);border-radius:var(--ax-radius-sm);">
          <table style="width:100%;min-width:620px;border-collapse:collapse;font-size:.82rem;">
            <thead><tr style="border-bottom:1px solid var(--ax-border);">
              <th style="padding:10px 14px;text-align:left;color:var(--ax-text-3);font-size:.68rem;text-transform:uppercase;">Memory</th>
              <th style="padding:10px 14px;text-align:left;color:var(--ax-text-3);font-size:.68rem;text-transform:uppercase;">Agent</th>
              <th style="padding:10px 14px;text-align:left;color:var(--ax-text-3);font-size:.68rem;text-transform:uppercase;">Updated</th>
              <th style="padding:10px 14px;text-align:left;color:var(--ax-text-3);font-size:.68rem;text-transform:uppercase;">Confidence</th>
              <th style="padding:10px 14px;text-align:left;color:var(--ax-text-3);font-size:.68rem;text-transform:uppercase;">Tags</th>
            </tr></thead>
            <tbody>${memories.map(m => `
              <tr style="border-bottom:1px solid rgba(255,255,255,.04);">
                <td style="padding:12px 14px;color:var(--ax-text-2);max-width:520px;">${escapeHtml(m.text)}</td>
                <td style="padding:12px 14px;color:var(--ax-text-2);white-space:nowrap;">${escapeHtml(m.agent || 'Unknown')}</td>
                <td style="padding:12px 14px;color:var(--ax-text-3);white-space:nowrap;">${relativeDate(m.updatedAt || m.createdAt)}</td>
                <td style="padding:12px 14px;color:var(--ax-text-2);white-space:nowrap;">${typeof m.confidence === 'number' ? Math.round(m.confidence * 100) + '%' : 'Unavailable'}</td>
                <td style="padding:12px 14px;color:var(--ax-text-3);">${escapeHtml((m.tags || []).join(', ')) || '—'}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>`;
    }

    searchEl.addEventListener('input', () => { search = searchEl.value; render(); });
    filterButtons.forEach(btn => btn.addEventListener('click', () => {
      filter = btn.dataset.memoryFilter || 'all';
      filterButtons.forEach(b => b.classList.toggle('btn-solid', b === btn));
      filterButtons.forEach(b => b.classList.toggle('btn-ghost', b !== btn));
      render();
    }));

    const onChange = () => render();
    unsubscribe = typeof engine.onChange === 'function' ? engine.onChange(onChange) : null;
    render();

    const observer = new MutationObserver(() => {
      if (!document.body.contains(container) && unsubscribe) {
        unsubscribe();
        unsubscribe = null;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
};
