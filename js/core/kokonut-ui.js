// AXIOM — Kokonut-inspired UI primitives
// Vanilla-compatible implementation for the existing Axiom architecture.
(function () {
  'use strict';

  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function init() {
    if (reduced()) return;
    initCommandPalette();
    initShimmerText();
    initParticleButtons();
    initMagneticButtons();
    initAIInput();
  }

  function initCommandPalette() {
    if (document.querySelector('[data-axiom-command-palette]')) return;
    const palette = document.createElement('div');
    palette.className = 'kokonut-command-palette';
    palette.dataset.axiomCommandPalette = 'true';
    palette.hidden = true;
    palette.innerHTML = `
      <div class="kokonut-command-backdrop" data-command-close></div>
      <section class="kokonut-command-panel" role="dialog" aria-modal="true" aria-label="Axiom Command">
        <div class="kokonut-command-search-wrap">
          <span class="kokonut-command-icon">⌘</span>
          <input class="kokonut-command-search" type="search" placeholder="Search Axiom or run a command…" autocomplete="off" />
          <kbd>ESC</kbd>
        </div>
        <div class="kokonut-command-list" role="listbox"></div>
      </section>`;
    document.body.appendChild(palette);

    const search = palette.querySelector('.kokonut-command-search');
    const list = palette.querySelector('.kokonut-command-list');
    const commands = [
      ['Open Playground', 'playground.html', 'AI workspace'],
      ['Open Dashboard', 'os-shell.html', 'Axiom home'],
      ['Open Brain', 'brain.html', 'AI memory'],
      ['Open Browser', 'browser.html', 'Web automation'],
      ['Open Settings', 'settings.html', 'Preferences'],
      ['Open Billing', 'billing.html', 'Plan & credits']
    ];

    function render(filter = '') {
      const q = filter.trim().toLowerCase();
      const matches = commands.filter(c => c.join(' ').toLowerCase().includes(q));
      list.innerHTML = matches.map((c, i) => `<button class="kokonut-command-item" role="option" data-command-index="${i}" data-href="${c[1]}"><span><strong>${c[0]}</strong><small>${c[2]}</small></span><kbd>↵</kbd></button>`).join('') || '<div class="kokonut-command-empty">No matching commands</div>';
      list.querySelectorAll('[data-href]').forEach(btn => btn.addEventListener('click', () => { location.href = btn.dataset.href; }));
    }
    render();

    function open() {
      palette.hidden = false;
      document.body.classList.add('kokonut-command-open');
      search.value = '';
      render();
      requestAnimationFrame(() => search.focus());
    }
    function close() { palette.hidden = true; document.body.classList.remove('kokonut-command-open'); }

    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette.hidden ? open() : close(); }
      else if (e.key === 'Escape' && !palette.hidden) close();
    });
    palette.addEventListener('click', e => { if (e.target.matches('[data-command-close]')) close(); });
    search.addEventListener('input', () => render(search.value));
  }

  function initShimmerText() {
    document.querySelectorAll('[data-kokonut-shimmer]').forEach(el => el.classList.add('kokonut-shimmer-text'));
  }

  function initParticleButtons() {
    document.querySelectorAll('[data-kokonut-particles]').forEach(btn => {
      if (btn.dataset.particlesBound) return;
      btn.dataset.particlesBound = 'true';
      btn.addEventListener('click', () => {
        const rect = btn.getBoundingClientRect();
        for (let i = 0; i < 10; i++) {
          const p = document.createElement('i');
          p.className = 'kokonut-particle';
          p.style.left = `${rect.width / 2}px`;
          p.style.top = `${rect.height / 2}px`;
          p.style.setProperty('--dx', `${(Math.random() - .5) * 90}px`);
          p.style.setProperty('--dy', `${(Math.random() - .5) * 70}px`);
          btn.appendChild(p);
          setTimeout(() => p.remove(), 650);
        }
      }, { passive: true });
    });
  }

  function initMagneticButtons() {
    if (window.matchMedia?.('(pointer: coarse)').matches) return;
    document.querySelectorAll('[data-kokonut-magnetic]').forEach(el => {
      if (el.dataset.magneticBound) return;
      el.dataset.magneticBound = 'true';
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) / r.width;
        const y = (e.clientY - r.top - r.height / 2) / r.height;
        el.style.transform = `translate(${x * 5}px, ${y * 5}px)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  function initAIInput() {
    document.querySelectorAll('[data-kokonut-ai-input]').forEach(input => {
      if (input.dataset.aiInputBound) return;
      input.dataset.aiInputBound = 'true';
      const resize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; };
      input.addEventListener('input', resize);
      resize();
    });
  }

  window.AxiomKokonut = { initCommandPalette };
  window.addEventListener('DOMContentLoaded', init, { once: true });
})();
