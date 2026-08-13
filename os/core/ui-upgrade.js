/* AXIOM OS premium interaction layer
 * Runtime libraries:
 *  - Motion: spring/gesture/page micro-transitions (actual runtime import)
 *  - Anime.js: kinetic stagger/hover choreography (actual runtime import)
 * UI systems:
 *  - KokonutUI-inspired spotlight/command surfaces
 *  - Bklit UI-inspired compact metric/data surfaces
 *
 * AXIOM is currently a vanilla HTML/JS shell, while KokonutUI and Bklit UI
 * publish React/shadcn components. Their visual/component patterns are
 * therefore adapted here without forcing a React migration into the OS shell.
 */

(async function () {
  'use strict';

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let motion = null;
  let anime = null;

  try {
    motion = await import('https://cdn.jsdelivr.net/npm/motion@latest/+esm');
  } catch (e) {
    console.warn('[AXIOM UI] Motion CDN unavailable; using CSS fallback.', e);
  }

  try {
    anime = await import('https://cdn.jsdelivr.net/npm/animejs/+esm');
  } catch (e) {
    console.warn('[AXIOM UI] Anime.js CDN unavailable; using CSS fallback.', e);
  }

  const motionAnimate = motion?.animate;
  const animeAnimate = anime?.animate;
  const animeStagger = anime?.stagger;

  function safeMotion(target, keyframes, options = {}) {
    if (reduceMotion || !motionAnimate) return null;
    try { return motionAnimate(target, keyframes, options); } catch (_) { return null; }
  }

  function safeAnime(target, props, options = {}) {
    if (reduceMotion || !animeAnimate) return null;
    try { return animeAnimate(target, props, options); } catch (_) { return null; }
  }

  function addSpotlights() {
    document.querySelectorAll('.ax-topbar, .ax-dock, .ax-control-center, .ax-cmd-panel, .ax-search-panel, .ax-db-panel').forEach(el => {
      el.classList.add('ax-ui-spotlight');
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--spot-x', `${((e.clientX - r.left) / r.width) * 100}%`);
        el.style.setProperty('--spot-y', `${((e.clientY - r.top) / r.height) * 100}%`);
      }, { passive: true });
    });
  }

  function upgradeDock() {
    const dock = document.getElementById('axDock');
    if (!dock) return;
    dock.classList.add('ax-ui-kinetic');

    const items = [...dock.querySelectorAll('.ax-dock-item')];
    if (animeAnimate && animeStagger && !reduceMotion) {
      safeAnime(items, {
        opacity: [0, 1],
        translateY: [10, 0],
        scale: [0.96, 1],
        delay: animeStagger(22),
        duration: 420,
        ease: 'out(4)'
      });
    }

    items.forEach(item => {
      item.addEventListener('pointerenter', () => {
        safeMotion(item, { scale: 1.08, y: -4 }, { type: 'spring', stiffness: 420, damping: 22 });
      });
      item.addEventListener('pointerleave', () => {
        safeMotion(item, { scale: 1, y: 0 }, { type: 'spring', stiffness: 420, damping: 25 });
      });
    });
  }

  function upgradeMetrics() {
    const widgets = document.getElementById('axDbWidgets');
    if (!widgets) return;
    [...widgets.children].forEach((card, index) => {
      card.classList.add('ax-ui-metric', 'ax-ui-kinetic');
      card.style.setProperty('--metric-progress', `${Math.max(.2, .9 - index * .09)}`);
    });
  }

  function createProfilePopover() {
    const avatar = document.getElementById('axProfileBtn');
    if (!avatar || document.getElementById('axProfilePopover')) return;

    const pop = document.createElement('section');
    pop.id = 'axProfilePopover';
    pop.className = 'ax-ui-popover ax-ui-spotlight';
    pop.hidden = true;
    pop.setAttribute('aria-label', 'AXIOM profile');
    pop.innerHTML = `
      <div class="ax-ui-popover-header">
        <div>
          <div class="ax-ui-popover-title">AXIOM Profile</div>
          <div class="ax-ui-popover-subtitle">Personalize your OS</div>
        </div>
        <button type="button" class="ax-ui-popover-close" aria-label="Close profile">×</button>
      </div>
      <div class="ax-ui-grid">
        <button type="button" class="ax-ui-action" data-profile-action="settings">
          <strong>Settings</strong><span>OS preferences</span>
        </button>
        <button type="button" class="ax-ui-action" data-profile-action="theme">
          <strong>Theme</strong><span>Change appearance</span>
        </button>
        <button type="button" class="ax-ui-action" data-profile-action="wallpaper">
          <strong>Wallpaper</strong><span>Open Wallpaper Engine</span>
        </button>
        <button type="button" class="ax-ui-action" data-profile-action="control">
          <strong>Control Center</strong><span>System controls</span>
        </button>
      </div>
      <div class="ax-ui-section">
        <div class="ax-ui-row">
          <label for="axProfileTheme">Theme</label>
          <select id="axProfileTheme" class="ax-ui-select"></select>
        </div>
      </div>`;

    document.body.appendChild(pop);

    const close = () => {
      pop.hidden = true;
      avatar.setAttribute('aria-expanded', 'false');
    };
    const position = () => {
      const r = avatar.getBoundingClientRect();
      const top = Math.min(window.innerHeight - pop.offsetHeight - 12, r.bottom + 10);
      const left = Math.max(12, r.right - pop.offsetWidth);
      pop.style.top = `${Math.max(12, top)}px`;
      pop.style.left = `${left}px`;
    };
    const open = () => {
      pop.hidden = false;
      position();
      avatar.setAttribute('aria-expanded', 'true');
      safeMotion(pop, { opacity: [0, 1], y: [-8, 0], scale: [.97, 1] }, { type: 'spring', stiffness: 420, damping: 28 });
    };

    avatar.addEventListener('click', e => {
      e.preventDefault();
      e.stopImmediatePropagation();
      pop.hidden ? open() : close();
    }, true);

    pop.querySelector('.ax-ui-popover-close').addEventListener('click', close);
    pop.querySelectorAll('[data-profile-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.profileAction;
        if (action === 'settings' && window.AxiomOS?.openWorkspace) window.AxiomOS.openWorkspace('settings');
        if (action === 'wallpaper' && window.AxiomWallpaperEngine) window.AxiomWallpaperEngine.openPicker();
        if (action === 'control') document.getElementById('axControlCenterBtn')?.click();
        if (action === 'theme') {
          const select = document.getElementById('axProfileTheme');
          select?.focus();
        }
        if (action !== 'theme') close();
      });
    });

    const themeSelect = pop.querySelector('#axProfileTheme');
    const engine = window.AxiomThemeEngine;
    if (themeSelect && engine) {
      engine.getAllThemes().forEach(t => {
        const option = document.createElement('option');
        option.value = t.id;
        option.textContent = t.name;
        themeSelect.appendChild(option);
      });
      themeSelect.value = engine.getTheme();
      themeSelect.addEventListener('change', () => engine.applyTheme(themeSelect.value));
      engine.onChange(id => { themeSelect.value = id; });
    }

    document.addEventListener('click', e => {
      if (!pop.hidden && !pop.contains(e.target) && e.target !== avatar && !avatar.contains(e.target)) close();
    });
    window.addEventListener('resize', () => { if (!pop.hidden) position(); }, { passive: true });
  }

  function addWallpaperButton() {
    const panel = document.getElementById('axControlCenter');
    if (!panel || panel.querySelector('[data-ax-wallpaper-launcher]')) return;
    const section = document.createElement('div');
    section.className = 'ax-ui-section';
    section.innerHTML = `
      <div class="ax-ui-row">
        <label>Wallpaper Engine</label>
        <button type="button" class="ax-ui-button" data-ax-wallpaper-launcher>Open</button>
      </div>`;
    panel.querySelector('.ax-cc-body')?.appendChild(section);
    section.querySelector('[data-ax-wallpaper-launcher]')?.addEventListener('click', () => {
      window.AxiomWallpaperEngine?.openPicker();
    });
  }

  function upgradeControlCenter() {
    const panel = document.getElementById('axControlCenter');
    if (!panel) return;
    panel.classList.add('ax-ui-spotlight');
    addWallpaperButton();
  }

  function animateWorkspaceEntry() {
    const panels = document.querySelectorAll('.ax-db-panel');
    if (animeAnimate && animeStagger && !reduceMotion) {
      safeAnime(panels, {
        opacity: [0, 1],
        translateY: [14, 0],
        delay: animeStagger(65),
        duration: 520,
        ease: 'out(4)'
      });
    }
  }

  function wireWorkspaceTransitions() {
    document.addEventListener('click', e => {
      const target = e.target.closest('[data-workspace]');
      if (!target) return;
      if (target.closest('#axDock, .ax-acc-suggestion, .ax-qa-btn')) {
        const inner = document.getElementById('axWorkspaceInner');
        safeMotion(inner, { opacity: [0.72, 1], scale: [.992, 1] }, { duration: .28, ease: 'easeOut' });
      }
    }, true);
  }

  function boot() {
    addSpotlights();
    upgradeDock();
    upgradeMetrics();
    upgradeControlCenter();
    createProfilePopover();
    wireWorkspaceTransitions();
    animateWorkspaceEntry();

    window.AxiomPremiumUI = {
      motion: !!motionAnimate,
      anime: !!animeAnimate,
      libraries: {
        motion: 'Motion',
        anime: 'Anime.js',
        kokonut: 'KokonutUI-inspired surfaces',
        bklit: 'Bklit UI-inspired metrics'
      }
    };

    console.log('[AXIOM UI] Premium layer ready — Motion + Anime.js + KokonutUI/Bklit UI patterns');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
