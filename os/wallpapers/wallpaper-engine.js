// ============================================================
// AXIOM AI OS X — Part 6: Wallpaper Engine
// Static wallpapers + canvas-based dynamic/live wallpapers.
// ============================================================
window.AxiomWallpaperEngine = (function () {
  'use strict';

  const STORAGE_KEY = 'axiom.wallpaper';
  let canvas, ctx, rafId = null, timeoutId = null;
  let staticLayer;
  let picker = null;
  let current = { type: 'dynamic', id: 'aurora-flow' };

  const STATIC = [
    { id: 'graphite',  label: 'Graphite',  css: 'linear-gradient(160deg,#0c0c0e,#1c1c1e)' },
    { id: 'titanium',  label: 'Titanium',  css: 'linear-gradient(160deg,#2a2a2c,#111113)' },
    { id: 'aurora-static', label: 'Aurora (still)', css: 'radial-gradient(circle at 30% 20%,#3a2a5c,transparent 60%),radial-gradient(circle at 75% 65%,#1a4a5c,transparent 55%),#0b0b0d' },
    { id: 'sunset',    label: 'Sunset',    css: 'linear-gradient(160deg,#3a1c2c,#12141c)' },
    { id: 'arctic',    label: 'Arctic',    css: 'linear-gradient(160deg,#1b2630,#0b0e12)' },
    { id: 'obsidian',  label: 'Obsidian',  css: 'linear-gradient(160deg,#000,#0a0a0c)' },
  ];

  const DYNAMIC = [
    { id: 'aurora-flow',  label: 'Aurora Flow' },
    { id: 'particles',    label: 'Particle Field' },
    { id: 'gradient-mesh', label: 'Gradient Drift' },
    { id: 'time-of-day',  label: 'Time of Day' },
  ];

  function icon(name, size) {
    return window.AxiomIcons ? window.AxiomIcons.svg(name, size || 16) : '';
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) current = JSON.parse(raw);
    } catch (e) {}
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch (e) {}
  }

  function ensureLayers() {
    if (canvas) return;
    staticLayer = document.createElement('div');
    staticLayer.id = 'axWallpaperStatic';
    staticLayer.style.cssText = 'position:fixed;inset:0;z-index:0;';

    canvas = document.createElement('canvas');
    canvas.id = 'axWallpaperCanvas';
    canvas.style.cssText = 'position:fixed;inset:0;z-index:0;width:100%;height:100%;';
    ctx = canvas.getContext('2d');

    const os = document.getElementById('axOS') || document.body;
    os.insertBefore(canvas, os.firstChild);
    os.insertBefore(staticLayer, os.firstChild);

    window.addEventListener('resize', resize);
    resize();
  }

  function resize() {
    if (!canvas) return;
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function stopAnim() {
    if (rafId) cancelAnimationFrame(rafId);
    if (timeoutId) clearTimeout(timeoutId);
    rafId = null;
    timeoutId = null;
  }

  // ---- DYNAMIC WALLPAPER RENDERERS ----
  function runAuroraFlow() {
    let t = 0;
    const blobs = [
      { hue: 265, r: 0.55 },
      { hue: 190, r: 0.45 },
      { hue: 320, r: 0.4 },
    ];
    function frame() {
      t += 0.0035;
      const w = window.innerWidth, h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#07070a';
      ctx.fillRect(0, 0, w, h);
      blobs.forEach((b, i) => {
        const x = w * (0.5 + 0.4 * Math.sin(t * (0.6 + i * 0.3) + i * 2));
        const y = h * (0.5 + 0.4 * Math.cos(t * (0.5 + i * 0.2) + i));
        const r = Math.min(w, h) * b.r;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `hsla(${b.hue},70%,55%,0.35)`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      });
      rafId = requestAnimationFrame(frame);
    }
    frame();
  }

  function runParticles() {
    const w = window.innerWidth, h = window.innerHeight;
    const N = Math.min(90, Math.floor((w * h) / 14000));
    const pts = Array.from({ length: N }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
    }));
    function frame() {
      const ww = window.innerWidth, hh = window.innerHeight;
      ctx.fillStyle = '#08080b';
      ctx.fillRect(0, 0, ww, hh);
      pts.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > ww) p.vx *= -1;
        if (p.y < 0 || p.y > hh) p.vy *= -1;
      });
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 140) {
            ctx.strokeStyle = `rgba(255,255,255,${0.08 * (1 - d / 140)})`;
            ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
          }
        }
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, 1.6, 0, Math.PI * 2); ctx.fill();
      }
      rafId = requestAnimationFrame(frame);
    }
    frame();
  }

  function runGradientMesh() {
    let t = 0;
    function frame() {
      t += 0.002;
      const w = window.innerWidth, h = window.innerHeight;
      const g = ctx.createLinearGradient(
        w * (0.5 + 0.5 * Math.sin(t)), 0,
        w * (0.5 - 0.5 * Math.sin(t)), h
      );
      g.addColorStop(0, `hsl(${240 + 40 * Math.sin(t)},55%,14%)`);
      g.addColorStop(0.5, `hsl(${280 + 30 * Math.cos(t * 0.8)},45%,10%)`);
      g.addColorStop(1, `hsl(${200 + 30 * Math.sin(t * 1.2)},50%,8%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      rafId = requestAnimationFrame(frame);
    }
    frame();
  }

  function runTimeOfDay() {
    function paint() {
      const w = window.innerWidth, h = window.innerHeight;
      const hr = new Date().getHours() + new Date().getMinutes() / 60;
      // 0-6 night, 6-12 morning, 12-18 day, 18-24 evening
      const palettes = [
        [0, '#03030a', '#0a0a18'],   // midnight
        [6, '#1a1030', '#2c1a3c'],   // dawn
        [9, '#25314a', '#0e1420'],   // morning
        [13, '#1c2838', '#0a0e16'],  // day
        [18, '#3a1c2c', '#12141c'],  // sunset
        [21, '#0d0a1c', '#050508'],  // dusk
        [24, '#03030a', '#0a0a18'],
      ];
      let a = palettes[0], b = palettes[palettes.length - 1];
      for (let i = 0; i < palettes.length - 1; i++) {
        if (hr >= palettes[i][0] && hr <= palettes[i + 1][0]) { a = palettes[i]; b = palettes[i + 1]; break; }
      }
      const f = (hr - a[0]) / (b[0] - a[0] || 1);
      const lerp = (c1, c2, t) => {
        const p = c1.match(/\w\w/g).map(x => parseInt(x, 16));
        const q = c2.match(/\w\w/g).map(x => parseInt(x, 16));
        const r = p.map((v, i2) => Math.round(v + (q[i2] - v) * t));
        return `rgb(${r[0]},${r[1]},${r[2]})`;
      };
      const top = lerp(a[1], b[1], f), bottom = lerp(a[2], b[2], f);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, top); g.addColorStop(1, bottom);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      timeoutId = setTimeout(paint, 30000);
    }
    paint();
  }

  const RENDERERS = {
    'aurora-flow': runAuroraFlow,
    'particles': runParticles,
    'gradient-mesh': runGradientMesh,
    'time-of-day': runTimeOfDay,
  };

  function apply(wallpaper) {
    ensureLayers();
    stopAnim();
    if (wallpaper.type === 'static') {
      canvas.style.display = 'none';
      staticLayer.style.display = 'block';
      const def = STATIC.find(s => s.id === wallpaper.id) || STATIC[0];
      staticLayer.style.background = def.css;
    } else {
      staticLayer.style.display = 'none';
      canvas.style.display = 'block';
      resize();
      (RENDERERS[wallpaper.id] || runAuroraFlow)();
    }
    current = wallpaper;
    persist();
  }

  function setWallpaper(type, id) {
    apply({ type, id });
    if (picker) renderPicker();
  }

  // ---- PICKER UI ----
  function ensurePicker() {
    if (picker) return picker;
    picker = document.createElement('div');
    picker.className = 'ax-wp-overlay';
    document.body.appendChild(picker);
    picker.addEventListener('click', (e) => { if (e.target === picker) closePicker(); });
    return picker;
  }

  function renderPicker() {
    picker.innerHTML = `
      <div class="ax-wp-panel">
        <div class="ax-wp-header">
          ${icon('wallpaper', 16)}<span>Wallpaper Engine</span>
          <div class="ax-wp-close" id="axWpClose">${icon('plus', 14)}</div>
        </div>
        <div class="ax-wp-section-title">Dynamic Wallpapers</div>
        <div class="ax-wp-grid">
          ${DYNAMIC.map(d => `
            <div class="ax-wp-card ${current.type === 'dynamic' && current.id === d.id ? 'active' : ''}" data-type="dynamic" data-id="${d.id}">
              <div class="ax-wp-thumb ax-wp-thumb-${d.id}"></div>
              <span>${d.label}</span>
            </div>`).join('')}
        </div>
        <div class="ax-wp-section-title">Static Wallpapers</div>
        <div class="ax-wp-grid">
          ${STATIC.map(s => `
            <div class="ax-wp-card ${current.type === 'static' && current.id === s.id ? 'active' : ''}" data-type="static" data-id="${s.id}">
              <div class="ax-wp-thumb" style="background:${s.css}"></div>
              <span>${s.label}</span>
            </div>`).join('')}
        </div>
      </div>`;
    picker.querySelector('#axWpClose').onclick = closePicker;
    picker.querySelectorAll('.ax-wp-card').forEach(card => {
      card.addEventListener('click', () => setWallpaper(card.dataset.type, card.dataset.id));
    });
  }

  function openPicker() {
    ensurePicker();
    renderPicker();
    picker.classList.add('active');
  }
  function closePicker() {
    if (picker) picker.classList.remove('active');
  }

  function init() {
    load();
    ensureLayers();
    apply(current);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && picker && picker.classList.contains('active')) closePicker();
    });
    // A backgrounded/minimized tab has no visible wallpaper, so there's
    // no reason to keep its rAF/timeout loop running — pause on hide,
    // resume the same dynamic renderer on return.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopAnim();
      } else if (!rafId && !timeoutId && current.type === 'dynamic') {
        (RENDERERS[current.id] || runAuroraFlow)();
      }
    });
  }

  return { init, openPicker, closePicker, setWallpaper };
})();

if (document.readyState !== 'loading') window.AxiomWallpaperEngine.init();
else document.addEventListener('DOMContentLoaded', () => window.AxiomWallpaperEngine.init());
