// ============================================================
// AXIOM — Module 10: Holographic Environment
// ------------------------------------------------------------
// Mounts the three ambient layers described in
// styles/os-environment.css and drives the one that needs a JS
// loop (the particle canvas). Everything here is created once,
// reused every frame, and disposed on pagehide — no per-frame
// allocations in the hot path.
//
// Reacts to window.AxiomOSState (os-state-engine.js, load this
// file after it). Does not touch the Reactor, Face, Bridge, Auth,
// Routing, DB, Memory, Projects, or Agents in any way — purely
// adds new DOM nodes and paints a new <canvas>.
// ============================================================
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // Only activates inside the app shell (dashboard/agent-library/
  // billing/playground/settings/workspace) — components/premium-shell.js
  // already tags those pages with one of these two body classes.
  function isShellPage() {
    return document.body.classList.contains('premium-app-page') ||
           document.body.classList.contains('dashboard-page');
  }

  ready(function () {
    if (!isShellPage()) return;
    mountLighting();
    // mountHoloField() intentionally not called — the ring/grid overlay
    // around the Core is disabled so the sphere floats free with no
    // visible boundary, matching the reference look. The function and
    // its CSS are left in place in case this is wanted back later.
    mountParticles();
  });

  // ---- 1. Lighting wash --------------------------------------------
  function mountLighting() {
    if (document.getElementById('axiomOsLighting')) return;
    var el = document.createElement('div');
    el.id = 'axiomOsLighting';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }

  // ---- 2. Holographic ring field (only where the Core lives) --------
  function mountHoloField() {
    var wrap = document.querySelector('.core-hero-canvas-wrap');
    if (!wrap || document.getElementById('axiomOsHolo')) return;
    var field = document.createElement('div');
    field.id = 'axiomOsHolo';
    field.className = 'ax-holo-field';
    field.setAttribute('aria-hidden', 'true');
    field.innerHTML =
      '<div class="ax-holo-grid"></div>' +
      '<div class="ax-holo-ring ax-holo-ring-2"></div>' +
      '<div class="ax-holo-data-circle"></div>' +
      '<div class="ax-holo-ring ax-holo-ring-1"></div>' +
      '<div class="ax-holo-hud core-hud-layer"></div>';
    // Inserted as the FIRST child so the Reactor/Face (which paint
    // their own canvases right after) stay visually on top.
    wrap.insertBefore(field, wrap.firstChild);
  }

  // ---- 3. Reactive particle canvas ------------------------------------
var PARTICLE_COLORS = {
    idle: 'rgba(255,255,255,ALPHA)',
    listening: 'rgba(96,165,250,ALPHA)',
    thinking: 'rgba(200,200,255,ALPHA)',
    speaking: 'rgba(255,205,140,ALPHA)',
    heavy: 'rgba(255,255,255,ALPHA)',
    error: 'rgba(255,90,90,ALPHA)',
    sleeping: 'rgba(200,200,200,ALPHA)',
  };
  var PARTICLE_COUNT = { idle: 40, listening: 46, thinking: 55, speaking: 50, heavy: 85, error: 40, sleeping: 14 };

  function mountParticles() {
    if (document.getElementById('axiomOsParticles')) return;
    var reduced = window.AxiomOSState && window.AxiomOSState.isReducedMotion();

    var canvas = document.createElement('canvas');
    canvas.id = 'axiomOsParticles';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    if (!ctx) return; // no canvas support — the lighting wash alone still carries the ambience

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0;
    var particles = [];
    var raf = null;
    var t = 0;
    var state = (window.AxiomOSState && window.AxiomOSState.getState()) || 'idle';

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawn(p) {
      p = p || {};
      p.x = Math.random() * w;
      p.y = Math.random() * h;
      p.r = 0.8 + Math.random() * 1.6;
      p.a = 0.15 + Math.random() * 0.5;
      p.vx = (Math.random() - 0.5) * 0.12;
      p.vy = (Math.random() - 0.5) * 0.12;
      p.phase = Math.random() * Math.PI * 2;
      p.lane = Math.random() * h;
      return p;
    }

    function setPopulation(target) {
      while (particles.length < target) particles.push(spawn({}));
      if (particles.length > target) particles.length = target;
    }

    function colorFor(alpha) {
      var tpl = PARTICLE_COLORS[state] || PARTICLE_COLORS.idle;
      return tpl.replace('ALPHA', alpha.toFixed(3));
    }

    function step(p) {
      switch (state) {
        case 'thinking':
          // Organized flow: gentle horizontal lanes with a slow sine drift.
          p.x += 0.55;
          p.y = p.lane + Math.sin((p.x * 0.01) + p.phase) * 10;
          if (p.x > w + 10) p.x = -10;
          break;
        case 'speaking': {
          // Gentle expansion outward from the viewport center.
          var cx = w / 2, cy = h * 0.32;
          var dx = p.x - cx, dy = p.y - cy;
          var dist = Math.max(1, Math.hypot(dx, dy));
          p.x += (dx / dist) * 0.35;
          p.y += (dy / dist) * 0.35;
          if (dist > Math.max(w, h) * 0.75) { p.x = cx; p.y = cy; }
          break;
        }
        case 'heavy':
          p.x += p.vx * 3.2;
          p.y += p.vy * 3.2;
          break;
        case 'error':
          p.x += p.vx * 2.2 + (Math.random() - 0.5) * 0.6;
          p.y += p.vy * 2.2 + (Math.random() - 0.5) * 0.6;
          break;
        case 'listening':
          p.x += p.vx * 0.6;
          p.y += p.vy * 0.6 - 0.08; // gentle upward drift, as if attentive
          break;
        case 'sleeping':
          p.x += p.vx * 0.08;
          p.y += p.vy * 0.08;
          break;
        default: // idle
          p.x += p.vx;
          p.y += p.vy;
      }
      if (p.x < -20) p.x = w + 20; else if (p.x > w + 20) p.x = -20;
      if (p.y < -20) p.y = h + 20; else if (p.y > h + 20) p.y = -20;
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      var breathe = state === 'sleeping' ? 1 : 0.85 + Math.sin(t * 0.02) * 0.15;
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        step(p);
        ctx.beginPath();
        ctx.fillStyle = colorFor(p.a * breathe);
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      t++;
    }

    function loop() {
      draw();
      raf = requestAnimationFrame(loop);
    }

    function applyState(next) {
      state = next;
      setPopulation(PARTICLE_COUNT[state] || PARTICLE_COUNT.idle);
      if (state === 'thinking') particles.forEach(function (p) { p.lane = p.y; });
    }

    resize();
    setPopulation(PARTICLE_COUNT[state] || PARTICLE_COUNT.idle);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; }
      else if (!raf && !reduced) loop();
    });

    if (window.AxiomOSState) window.AxiomOSState.onChange(applyState);

    if (!reduced) {
      loop();
    } else {
      // Respect reduced motion: paint one static, calmer frame instead
      // of animating, rather than showing nothing at all.
      draw();
    }

    window.addEventListener('pagehide', function () {
      if (raf) cancelAnimationFrame(raf);
    });
  }
})();
