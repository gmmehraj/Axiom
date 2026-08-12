// ============================================================
// AXIOM — AI Memory World (Part 10: AXIOM ULTIMATE)
// Reads the existing memory table (already in the DOM) and
// projects it into a starfield of crystals. Click a crystal to
// open the memory. Type in the search box to fly through and
// isolate matches — everything else fades into the background.
// ============================================================
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(init);

  function init() {
    const toggle = document.getElementById('memoryWorldToggle');
    const world = document.getElementById('axMemoryWorld');
    const tableWrap = document.getElementById('axMemoryTableWrap');
    const canvas = document.getElementById('axMemoryWorldCanvas');
    const search = document.getElementById('axMemoryWorldSearch');
    if (!toggle || !world || !canvas) return;

    let built = false;
    let crystals = [];

    function readMemories() {
      const rows = tableWrap ? tableWrap.querySelectorAll('tbody tr') : [];
      return Array.from(rows).map(row => {
        const cells = row.querySelectorAll('td');
        return {
          text: cells[0] ? cells[0].textContent.trim() : 'Memory',
          agent: cells[1] ? cells[1].textContent.trim() : '—',
          date: cells[2] ? cells[2].textContent.trim() : '',
          pinned: row.innerHTML.includes('Pinned')
        };
      });
    }

    function buildWorld() {
      const memories = readMemories();
      canvas.innerHTML = '';
      crystals = memories.map((mem, i) => {
        const el = document.createElement('div');
        el.className = 'ax-memory-crystal' + (mem.pinned ? ' pinned' : '');
        const top = 15 + Math.random() * 65;
        const left = 8 + ((i * 137.5) % 84) + Math.random() * 4; // golden-angle scatter, deterministic-ish
        el.style.top = top + '%';
        el.style.left = Math.min(92, left) + '%';
        el.style.animationDelay = (-Math.random() * 6) + 's';
        el.innerHTML = `<div class="shape"></div><div class="label">${escapeHtml(truncate(mem.text, 60))}</div>`;
        el.addEventListener('click', () => openDetail(mem));
        canvas.appendChild(el);
        return { el, mem };
      });
    }

    function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
    function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

    function openDetail(mem) {
      let overlay = document.getElementById('axMemoryDetailOverlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'axMemoryDetailOverlay';
        overlay.className = 'ax-memory-detail-overlay';
        overlay.innerHTML = `
          <div class="ax-memory-detail-card">
            <h4>Memory</h4>
            <p data-detail-text></p>
            <div class="meta">
              <span class="ax-badge ax-badge-info" data-detail-agent></span>
              <span class="ax-badge ax-badge-success" data-detail-date></span>
            </div>
            <button class="btn btn-outline btn-sm" data-detail-close>Close</button>
          </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => {
          if (e.target === overlay || e.target.hasAttribute('data-detail-close')) {
            overlay.classList.remove('open');
          }
        });
      }
      overlay.querySelector('[data-detail-text]').textContent = mem.text;
      overlay.querySelector('[data-detail-agent]').textContent = mem.agent;
      overlay.querySelector('[data-detail-date]').textContent = mem.date;
      requestAnimationFrame(() => overlay.classList.add('open'));
    }

    // ---- search flies through / isolates matches ----
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        crystals.forEach(({ el, mem }) => {
          const match = !q || mem.text.toLowerCase().includes(q) || mem.agent.toLowerCase().includes(q);
          el.classList.toggle('dim', !match);
        });
      });
    }

    toggle.addEventListener('click', () => {
      const showing = world.style.display !== 'none';
      if (showing) {
        world.style.display = 'none';
        if (tableWrap) tableWrap.style.display = '';
        toggle.textContent = '✨ Memory World';
      } else {
        if (!built) { buildWorld(); built = true; }
        world.style.display = '';
        if (tableWrap) tableWrap.style.display = 'none';
        toggle.textContent = '📋 Table View';
      }
    });
  }
})();
