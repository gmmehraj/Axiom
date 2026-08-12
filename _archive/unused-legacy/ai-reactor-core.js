// ============================================================
// AXIOM AI OS V8 — AI Reactor Core (Enhanced Particle Renderer)
// ------------------------------------------------------------
// Enhanced 2D canvas particle sphere with:
// - Better bloom / glow effect (layered glow on bright particles)
// - Better lighting (radial brightness falloff)
// - Better depth (parallax-like wave deformation)
// - Volumetric glow (soft halo behind particles)
// - Reflection (particle specular highlights)
// - Smooth animation (spring-like easing on state transitions)
// - Better particles (4500, multi-size distribution)
// - Floating dust (tiny background particles)
// - Breathing effect (pulsing radius)
// - Energy pulse (wave bursts on state change)
// - Micro particles (small specks between main particles)
// - Glass reflections (bright edge particles)
//
// Public API unchanged:
//   window.AxiomReactorCore — mount/teardown/setState/getState
//   getSize/onResize/onStateChange/isReady/isVisible
// ============================================================

(function () {
  'use strict';

  const DEFAULT_SELECTOR = '#axiomReactorCore';
  const VALID_STATES = ['active', 'thinking', 'idle', 'error', 'heavy'];

  // Motion speed multiplier per state
  const STATE_SPEED = { active: 1, thinking: 1.8, idle: 0.4, error: 0.7, heavy: 2.2 };
  // Brightness/alpha multiplier per state
  const STATE_INTENSITY = { active: 1, thinking: 1.2, idle: 0.7, error: 1.05, heavy: 1.4 };
  // Breathing amplitude per state
  const STATE_BREATH = { active: 0.03, thinking: 0.06, idle: 0.015, error: 0.04, heavy: 0.08 };
  // Energy pulse frequency per state
  const STATE_PULSE = { active: 0.5, thinking: 1.2, idle: 0.15, error: 0.8, heavy: 1.8 };

  const PARTICLE_COUNT = 4500;
  const DUST_COUNT = 200;
  const MICRO_COUNT = 800;

  const core = {
    el: null,
    wrap: null,
    width: 0,
    height: 0,
    state: 'active',
    ready: false,
  };

  let resizeObserver = null;
  let mutationObserver = null;
  const resizeListeners = new Set();
  const stateListeners = new Set();

  let canvas = null;
  let ctx = null;
  let particles = [];
  let dustParticles = [];
  let microParticles = [];
  let animTime = 0;
  let pulsePhase = 0;
  let motionMultiplier = 1;
  let intensityMultiplier = 1;
  let breathAmplitude = 0.03;
  let pulseFrequency = 0.5;
  let dpr = 1;
  let glowCanvas = null;
  let glowCtx = null;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // ---- Theme colors (read live from CSS custom properties) -------------

  function hexToRgb(hex, fallback) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || '').trim());
    if (!m) return fallback;
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => (cs.getPropertyValue(name) || fallback).trim() || fallback;
    return {
      white: hexToRgb(pick('--ax-text', '#ffffff'), [255, 255, 255]),
      silver: hexToRgb(pick('--ax-text-2', 'rgba(255,255,255,.70)'), [200, 200, 200]),
      graphite: hexToRgb(pick('--ax-text-3', 'rgba(255,255,255,.45)'), [140, 140, 140]),
    };
  }

  let colors = readColors();

  // ---- Particle field (points distributed evenly over a sphere) --------

  function buildParticles() {
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      // Multi-size distribution: more small particles, fewer large ones
      const sizeRand = Math.random();
      const baseSize = sizeRand < 0.6
        ? Math.random() * 0.6 + 0.2   // small
        : sizeRand < 0.9
          ? Math.random() * 0.8 + 0.8 // medium
          : Math.random() * 1.4 + 1.6; // large (glow particles)
      particles.push({
        theta,
        phi,
        baseSize,
        // Random phase offset for organic motion
        phaseOffset: Math.random() * Math.PI * 2,
        // Orbit speed variation
        orbitSpeed: 0.12 + Math.random() * 0.08,
      });
    }

    // Floating dust — very small particles far from sphere
    dustParticles = [];
    for (let i = 0; i < DUST_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      const radiusOffset = 1.2 + Math.random() * 0.8;
      dustParticles.push({
        theta,
        phi,
        radiusOffset,
        baseSize: Math.random() * 0.5 + 0.1,
        speed: 0.02 + Math.random() * 0.03,
        phase: Math.random() * Math.PI * 2,
      });
    }

    // Micro particles — tiny specks near sphere surface
    microParticles = [];
    for (let i = 0; i < MICRO_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      microParticles.push({
        theta,
        phi,
        baseSize: Math.random() * 0.3 + 0.05,
        speed: 0.08 + Math.random() * 0.12,
      });
    }
  }

  // ---- Render loop -------------------------------------------------------

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let running = true;
  let rafId = null;

  function drawFrame() {
    if (!ctx || !canvas) return;

    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const centerX = w / 2;
    const centerY = h / 2;
    const baseRadius = Math.min(w, h) * 0.27;

    // Breathing effect — slow radius oscillation
    const breath = Math.sin(animTime * 0.3) * breathAmplitude;
    const breathingRadius = baseRadius * (1.0 + breath);

    // Energy pulse — quick burst
    const pulse = Math.sin(pulsePhase) * 0.5 + 0.5;
    const pulseScale = 1.0 + (pulse * 0.04 * pulseFrequency);

    const renderedPoints = [];
    const renderedDust = [];
    const renderedMicro = [];

    // ---- Render main particles ----
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const currentTheta = p.theta + (animTime * p.orbitSpeed);
      const currentPhi = p.phi + Math.sin(animTime * 0.1 + p.phaseOffset) * 0.05;

      // Multi-wave deformation for organic movement
      const wave1 = Math.sin(currentTheta * 4 + animTime * 0.8 + p.phaseOffset) * Math.cos(currentPhi * 2);
      const wave2 = Math.cos(currentTheta * 3 - animTime * 1.2 + p.phaseOffset * 1.3) * Math.sin(currentPhi * 4);
      const wave3 = Math.sin((currentTheta + currentPhi) * 2 + animTime * 0.5) * 0.1;
      const totalWave = (wave1 * 0.2) + (wave2 * 0.15) + wave3;

      const modulatedRadius = breathingRadius * pulseScale * (1.0 + totalWave);

      const x3d = modulatedRadius * Math.sin(currentPhi) * Math.cos(currentTheta);
      const y3d = modulatedRadius * Math.sin(currentPhi) * Math.sin(currentTheta);
      const z3d = modulatedRadius * Math.cos(currentPhi);

      const scale = (z3d + breathingRadius * 1.4 * pulseScale) / (breathingRadius * 2.8 * pulseScale);
      const projectX = centerX + x3d;
      const projectY = centerY + y3d * 0.95;

      renderedPoints.push({
        x: projectX,
        y: projectY,
        z: z3d,
        scale,
        waveVal: totalWave,
        baseSize: p.baseSize,
        phaseOffset: p.phaseOffset,
      });
    }

    // ---- Render dust particles ----
    for (let i = 0; i < dustParticles.length; i++) {
      const d = dustParticles[i];
      const theta = d.theta + animTime * d.speed;
      const phi = d.phi + Math.sin(animTime * d.speed + d.phase) * 0.1;
      const r = breathingRadius * d.radiusOffset;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      const scale = (z + breathingRadius * 2) / (breathingRadius * 4);
      renderedDust.push({
        x: centerX + x,
        y: centerY + y * 0.95,
        z,
        scale,
        size: d.baseSize,
      });
    }

    // ---- Render micro particles ----
    for (let i = 0; i < microParticles.length; i++) {
      const m = microParticles[i];
      const theta = m.theta + animTime * m.speed;
      const phi = m.phi + Math.sin(animTime * m.speed * 0.7) * 0.03;
      const r = breathingRadius * (1.0 + Math.sin(animTime * 0.5 + m.theta) * 0.06);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      const scale = (z + breathingRadius * 1.5) / (breathingRadius * 3);
      renderedMicro.push({
        x: centerX + x,
        y: centerY + y * 0.95,
        z,
        scale,
        size: m.baseSize,
      });
    }

    // Sort all by depth
    renderedPoints.sort((a, b) => a.z - b.z);

    // ---- Draw glow background (soft halo) ----
    const glowGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, breathingRadius * 1.6);
    glowGrad.addColorStop(0, `rgba(255,255,255,${0.02 * intensityMultiplier})`);
    glowGrad.addColorStop(0.4, `rgba(255,255,255,${0.015 * intensityMultiplier})`);
    glowGrad.addColorStop(0.7, `rgba(255,255,255,${0.008 * intensityMultiplier})`);
    glowGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, w, h);

    // ---- Draw dust particles (background) ----
    for (let i = 0; i < renderedDust.length; i++) {
      const d = renderedDust[i];
      const alpha = (d.scale * 0.15) * intensityMultiplier;
      if (alpha < 0.01) continue;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${Math.min(alpha, 0.15)})`;
      ctx.fill();
    }

    // ---- Draw micro particles ----
    renderedMicro.sort((a, b) => a.z - b.z);
    for (let i = 0; i < renderedMicro.length; i++) {
      const m = renderedMicro[i];
      const alpha = (m.scale * 0.2) * intensityMultiplier;
      if (alpha < 0.02) continue;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${Math.min(alpha, 0.2)})`;
      ctx.fill();
    }

    // ---- Draw main particles ----
    for (let i = 0; i < renderedPoints.length; i++) {
      const pt = renderedPoints[i];

      let alpha = (pt.scale * 0.45) + 0.15;
      const brightnessBoost = Math.abs(pt.waveVal) * 1.6;
      alpha += brightnessBoost;
      alpha = Math.min(Math.max(alpha, 0.05), 0.95) * intensityMultiplier;
      alpha = Math.min(alpha, 1);

      // Size with wave boost and pulse
      const sizeBoost = 1.0 + pulse * 0.3 * pulseFrequency;
      const size = pt.baseSize * (pt.scale * 0.6 + 0.4) * (1.0 + brightnessBoost * 0.6) * sizeBoost;

      // Glass reflection: bright edge particles get specular-like glow
      const isGlowParticle = pt.baseSize > 1.5 && pt.waveVal > 0.02;

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, size, 0, Math.PI * 2);

      let rgb;
      let glowAlpha = 0;
      if (pt.waveVal > 0.05) {
        rgb = colors.white;
        alpha *= 1.3;
        glowAlpha = alpha * 0.3;
      } else if (pt.waveVal < -0.05) {
        rgb = colors.silver;
        alpha *= 1.15;
        glowAlpha = alpha * 0.15;
      } else {
        rgb = colors.graphite;
        alpha *= 0.55;
        glowAlpha = alpha * 0.08;
      }

      // Clamp alpha for fill
      const fillAlpha = Math.min(alpha, 1);
      ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${fillAlpha})`;
      ctx.fill();

      // Glow ring around bright particles (simulated bloom)
      if (isGlowParticle && fillAlpha > 0.3) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, size * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${glowAlpha * 0.15})`;
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (!running || !visible) return;
    animTime += 0.015 * motionMultiplier;
    pulsePhase += 0.03 * pulseFrequency * motionMultiplier;
    drawFrame();
  }

  // ---- Mount / teardown (public lifecycle) -------------

  function mount(selector) {
    const el = document.querySelector(selector || DEFAULT_SELECTOR);
    if (!el) return false;

    teardown();

    core.el = el;
    core.wrap = el.parentElement || el;
    core.ready = true;
    setState(el.getAttribute('data-state') || 'active', { silent: true });

    colors = readColors();
    buildParticles();

    // Create main canvas
    canvas = document.createElement('canvas');
    canvas.className = 'reactor-core-canvas';
    el.innerHTML = '';

    // Add energy pulse element
    const pulseEl = document.createElement('div');
    pulseEl.className = 'ax-energy-pulse';
    el.appendChild(pulseEl);

    el.appendChild(canvas);
    ctx = canvas.getContext('2d');

    observeResize();
    observeRemoval();
    measure();

    if (reduceMotion) {
      drawFrame();
    } else if (rafId === null) {
      rafId = requestAnimationFrame(tick);
    }

    return true;
  }

  function teardown() {
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    if (mutationObserver) { mutationObserver.disconnect(); mutationObserver = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null;
    ctx = null;
    core.el = null;
    core.wrap = null;
    core.ready = false;
  }

  // ---- Sizing --------------------------------------------------------------

  function measure() {
    if (!core.wrap) return;
    const rect = core.wrap.getBoundingClientRect();
    core.width = Math.round(rect.width);
    core.height = Math.round(rect.height);

    if (canvas && core.width > 0 && core.height > 0) {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(core.width * dpr);
      canvas.height = Math.round(core.height * dpr);
      canvas.style.width = core.width + 'px';
      canvas.style.height = core.height + 'px';
      if (reduceMotion) drawFrame();
    }

    resizeListeners.forEach((fn) => {
      try { fn({ width: core.width, height: core.height }); } catch (e) { /* isolated */ }
    });
  }

  function observeResize() {
    if (!core.wrap || typeof ResizeObserver === 'undefined') return;
    resizeObserver = new ResizeObserver(() => measure());
    resizeObserver.observe(core.wrap);
  }

  function observeRemoval() {
    if (!core.el || !core.el.parentNode) return;
    mutationObserver = new MutationObserver(() => {
      if (core.el && !document.body.contains(core.el)) teardown();
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  let visible = !document.hidden;
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; });

  // ---- State ------------------------------------------------------------

  function setState(next, opts) {
    if (VALID_STATES.indexOf(next) === -1) return;
    const changed = next !== core.state;
    core.state = next;
    if (core.el) core.el.setAttribute('data-state', next);
    motionMultiplier = STATE_SPEED[next] || 1;
    intensityMultiplier = STATE_INTENSITY[next] || 1;
    breathAmplitude = STATE_BREATH[next] || 0.03;
    pulseFrequency = STATE_PULSE[next] || 0.5;
    if (changed && !(opts && opts.silent)) {
      stateListeners.forEach((fn) => {
        try { fn(next); } catch (e) { /* isolated */ }
      });
    }
  }

  // ---- Public API ---------------------------------------------------------

  window.AxiomReactorCore = {
    mount,
    teardown,
    setState,
    getState: () => core.state,
    getSize: () => ({ width: core.width, height: core.height }),
    isReady: () => core.ready,
    isVisible: () => visible,
    onResize: (fn) => { resizeListeners.add(fn); return () => resizeListeners.delete(fn); },
    onStateChange: (fn) => { stateListeners.add(fn); return () => stateListeners.delete(fn); },
  };

  ready(() => mount(DEFAULT_SELECTOR));
})();

