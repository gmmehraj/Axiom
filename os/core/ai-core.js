// ============================================================
// AXIOM AI OS — Living AI Core (Phase 2: AI Core Evolution)
// 14 states, always moving. Layers, back to front:
// - Dynamic Lighting  (ambient glow, per-state color)
// - Energy Platform   (holographic ground glow)
// - Bloom             (real blur+composite light bleed)
// - Ribbon Trails      (energy streams with fading trails)
// - Memory Crystals    (orbiting faceted shards, blooms in 'memory')
// - Liquid Plasma Center
// - Particle field
// - Quantum Halo       (outer rotating arcs)
// - Neural Halo        (node web with flickering synapses)
// - Agent Ring         (lit markers = active sub-agents)
// - Prediction Ring    (ghost arc anticipating the next move)
// - Voice Wave         (state-shaped waveform)
// - Reflection         (sweeping specular highlight, clipped to sphere)
// - Mouse interaction + camera breathing throughout
// ============================================================
window.AxiomAICore = (function() {
  'use strict';

  // ---- State Configurations ----
  const STATES = {
    idle: {
      label: 'Idle',
      particles: 40,
      ringSpeed: 0.3,
      ringColor: 'rgba(168,85,247,.08)',
      plasmaColor: 'rgba(168,85,247,.03)',
      glowColor: 'rgba(168,85,247,.02)',
      energy: 0.1,
      lighting: 'subtle',
      pulse: false,
      waveform: null,
    },
    thinking: {
      label: 'Thinking',
      particles: 120,
      ringSpeed: 1.4,
      ringColor: 'rgba(147,51,234,.4)',
      plasmaColor: 'rgba(147,51,234,.12)',
      glowColor: 'rgba(147,51,234,.08)',
      energy: 0.7,
      lighting: 'focus',
      pulse: true,
      waveform: 'slow',
    },
    speaking: {
      label: 'Speaking',
      particles: 80,
      ringSpeed: 0.9,
      ringColor: 'rgba(217,70,239,.4)',
      plasmaColor: 'rgba(217,70,239,.12)',
      glowColor: 'rgba(217,70,239,.08)',
      energy: 0.6,
      lighting: 'warm',
      pulse: true,
      waveform: 'active',
    },
    listening: {
      label: 'Listening',
      particles: 160,
      ringSpeed: 1.7,
      ringColor: 'rgba(129,140,248,.4)',
      plasmaColor: 'rgba(129,140,248,.15)',
      glowColor: 'rgba(129,140,248,.1)',
      energy: 0.8,
      lighting: 'focus',
      pulse: true,
      waveform: 'rapid',
    },
    researching: {
      label: 'Researching',
      particles: 100,
      ringSpeed: 1.2,
      ringColor: 'rgba(99,102,241,.3)',
      plasmaColor: 'rgba(99,102,241,.08)',
      glowColor: 'rgba(99,102,241,.05)',
      energy: 0.6,
      lighting: 'cool',
      pulse: true,
      waveform: 'search',
    },
    coding: {
      label: 'Coding',
      particles: 90,
      ringSpeed: 1.3,
      ringColor: 'rgba(124,58,237,.5)',
      plasmaColor: 'rgba(124,58,237,.15)',
      glowColor: 'rgba(124,58,237,.1)',
      energy: 0.7,
      lighting: 'cool',
      pulse: true,
      waveform: 'code',
    },
    generating: {
      label: 'Generating',
      particles: 140,
      ringSpeed: 1.6,
      ringColor: 'rgba(233,213,255,.4)',
      plasmaColor: 'rgba(233,213,255,.14)',
      glowColor: 'rgba(233,213,255,.1)',
      energy: 0.85,
      lighting: 'vibrant',
      pulse: true,
      waveform: 'creating',
    },
    automation: {
      label: 'Automation',
      particles: 50,
      ringSpeed: 0.9,
      ringColor: 'rgba(168,85,247,.28)',
      plasmaColor: 'rgba(168,85,247,.08)',
      glowColor: 'rgba(168,85,247,.05)',
      energy: 0.4,
      lighting: 'subtle',
      pulse: false,
      waveform: 'steady',
    },
    memory: {
      label: 'Memory',
      particles: 45,
      ringSpeed: 0.5,
      ringColor: 'rgba(196,181,253,.25)',
      plasmaColor: 'rgba(196,181,253,.08)',
      glowColor: 'rgba(196,181,253,.05)',
      energy: 0.3,
      lighting: 'soft',
      pulse: false,
      waveform: null,
    },
    warning: {
      label: 'Warning',
      particles: 40,
      ringSpeed: 0.6,
      ringColor: 'rgba(251,191,36,.5)',
      plasmaColor: 'rgba(251,191,36,.15)',
      glowColor: 'rgba(251,191,36,.1)',
      energy: 0.4,
      lighting: 'caution',
      pulse: true,
      waveform: 'error',
    },
    error: {
      label: 'Error',
      particles: 25,
      ringSpeed: 0.2,
      ringColor: 'rgba(239,68,68,.5)',
      plasmaColor: 'rgba(239,68,68,.15)',
      glowColor: 'rgba(239,68,68,.1)',
      energy: 0.2,
      lighting: 'alert',
      pulse: true,
      waveform: 'error',
    },
    offline: {
      label: 'Offline',
      particles: 12,
      ringSpeed: 0.1,
      ringColor: 'rgba(156,163,175,.3)',
      plasmaColor: 'rgba(156,163,175,.04)',
      glowColor: 'rgba(156,163,175,.02)',
      energy: 0.1,
      lighting: 'dim',
      pulse: false,
      waveform: null,
    },
    sleep: {
      label: 'Sleep',
      particles: 8,
      ringSpeed: 0.1,
      ringColor: 'rgba(168,85,247,.06)',
      plasmaColor: 'rgba(168,85,247,.02)',
      glowColor: 'rgba(168,85,247,.015)',
      energy: 0.05,
      lighting: 'dim',
      pulse: false,
      waveform: null,
    },
    learning: {
      label: 'Learning',
      particles: 80,
      ringSpeed: 1.3,
      ringColor: 'rgba(192,132,252,.5)',
      plasmaColor: 'rgba(192,132,252,.14)',
      glowColor: 'rgba(192,132,252,.09)',
      energy: 0.7,
      lighting: 'warm',
      pulse: true,
      waveform: 'learning',
    },
    wake: {
      label: 'Listening',
      particles: 150,
      ringSpeed: 1.8,
      ringColor: 'rgba(56,189,248,.6)',
      plasmaColor: 'rgba(56,189,248,.18)',
      glowColor: 'rgba(56,189,248,.12)',
      energy: 0.85,
      lighting: 'vibrant',
      pulse: true,
      waveform: 'rapid',
    },
    vision: {
      label: 'Vision',
      particles: 110,
      ringSpeed: 1.3,
      ringColor: 'rgba(45,212,191,.5)',
      plasmaColor: 'rgba(45,212,191,.15)',
      glowColor: 'rgba(45,212,191,.1)',
      energy: 0.7,
      lighting: 'cool',
      pulse: true,
      waveform: 'search',
    },
    analyzing_image: {
      label: 'Analyzing Image',
      particles: 130,
      ringSpeed: 1.5,
      ringColor: 'rgba(20,184,166,.55)',
      plasmaColor: 'rgba(20,184,166,.16)',
      glowColor: 'rgba(20,184,166,.1)',
      energy: 0.75,
      lighting: 'vibrant',
      pulse: true,
      waveform: 'creating',
    },
    analyzing_video: {
      label: 'Analyzing Video',
      particles: 140,
      ringSpeed: 1.6,
      ringColor: 'rgba(6,182,212,.6)',
      plasmaColor: 'rgba(6,182,212,.18)',
      glowColor: 'rgba(6,182,212,.12)',
      energy: 0.8,
      lighting: 'vibrant',
      pulse: true,
      waveform: 'active',
    },
    executing: {
      label: 'Executing',
      particles: 120,
      ringSpeed: 1.5,
      ringColor: 'rgba(168,85,247,.5)',
      plasmaColor: 'rgba(168,85,247,.16)',
      glowColor: 'rgba(168,85,247,.1)',
      energy: 0.75,
      lighting: 'focus',
      pulse: true,
      waveform: 'code',
    },
    browser: {
      label: 'Browser',
      particles: 100,
      ringSpeed: 1.2,
      ringColor: 'rgba(59,130,246,.5)',
      plasmaColor: 'rgba(59,130,246,.14)',
      glowColor: 'rgba(59,130,246,.08)',
      energy: 0.65,
      lighting: 'cool',
      pulse: true,
      waveform: 'steady',
    },
    building: {
      label: 'Building',
      particles: 130,
      ringSpeed: 1.6,
      ringColor: 'rgba(245,158,11,.5)',
      plasmaColor: 'rgba(245,158,11,.15)',
      glowColor: 'rgba(245,158,11,.1)',
      energy: 0.8,
      lighting: 'vibrant',
      pulse: true,
      waveform: 'code',
    },
    testing: {
      label: 'Testing & QA',
      particles: 110,
      ringSpeed: 1.4,
      ringColor: 'rgba(16,185,129,.5)',
      plasmaColor: 'rgba(16,185,129,.15)',
      glowColor: 'rgba(16,185,129,.1)',
      energy: 0.7,
      lighting: 'focus',
      pulse: true,
      waveform: 'search',
    },
    deploying: {
      label: 'Deploying',
      particles: 150,
      ringSpeed: 1.8,
      ringColor: 'rgba(139,92,246,.6)',
      plasmaColor: 'rgba(139,92,246,.2)',
      glowColor: 'rgba(139,92,246,.12)',
      energy: 0.9,
      lighting: 'vibrant',
      pulse: true,
      waveform: 'creating',
    },
  };

  // State alias normalization map
  const STATE_ALIASES = {
    'analyzing-image': 'analyzing_image',
    'image-analysis': 'analyzing_image',
    'analyzing-video': 'analyzing_video',
    'video-analysis': 'analyzing_video',
    'browsing': 'browser',
    'build': 'building',
    'test': 'testing',
    'deploy': 'deploying',
    'execute': 'executing',
    'listen': 'listening',
    'think': 'thinking',
    'speak': 'speaking',
  };

  let currentState = 'idle';
  let listeners = [];
  let animFrame = null;
  let particles = [];
  let ribbons = [];
  let canvas = null;
  let ctx = null;
  let ringAngle = 0;
  let breathPhase = 0;
  let mouseX = 0, mouseY = 0;
  let time = 0;

  // ---- Reduced Motion (Phase 3 · Part 2) ----
  // The Core's spin/breathe/drift is entirely canvas-driven (a plain
  // rAF loop), so it's invisible to the CSS `prefers-reduced-motion`
  // rules already covering the rest of the app (ax-redesign.css /
  // os-shell.css) — those only touch `animation`/`transition`
  // properties, never a hand-rolled requestAnimationFrame loop. This
  // is the JS-side equivalent: continuous decorative movement (ring
  // rotation, breathing scale, particle drift) is scaled down to a
  // slow crawl rather than removed outright, so every state is still
  // reachable and tellable apart by its color/particle
  // density/pulse — just calm instead of busy. Live-updates if the
  // user flips the OS setting mid-session; nothing else about the
  // render pipeline (particle counts, colors, energy, lighting,
  // waveform) is touched.
  const reducedMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reducedMotion = !!(reducedMotionQuery && reducedMotionQuery.matches);
  function motionScale() { return reducedMotion ? 0.18 : 1; }
  if (reducedMotionQuery) {
    const onMotionChange = e => { reducedMotion = e.matches; };
    if (reducedMotionQuery.addEventListener) reducedMotionQuery.addEventListener('change', onMotionChange);
    else if (reducedMotionQuery.addListener) reducedMotionQuery.addListener(onMotionChange); // Safari <14 fallback
  }

  // ---- Public API ----
  function getState() { return currentState; }
  function getStateInfo(state) { return STATES[state] || STATES.idle; }

  function setState(newState) {
    if (!newState) return;
    const raw = String(newState).trim().toLowerCase();
    const resolved = STATE_ALIASES[raw] || raw;
    if (!STATES[resolved]) return;
    const prev = currentState;
    currentState = resolved;
    
    listeners.forEach(fn => fn(resolved, prev, STATES[resolved]));
    
    document.dispatchEvent(new CustomEvent('ax-core-state', {
      detail: { state: resolved, prev, config: STATES[resolved] }
    }));
    
    // Update DOM
    const coreEl = document.getElementById('axiomCore');
    if (coreEl) {
      coreEl.dataset.coreState = newState;
      const labelEl = coreEl.querySelector('.ax-core-state-label');
      if (labelEl) labelEl.textContent = STATES[newState].label;
      // The visual state label is always small/low-opacity by design
      // (it's ambient chrome, not a headline). A hover title gives a
      // first-time user an unambiguous, zero-design-risk way to
      // confirm what a given glow/color means before they've learned
      // the palette.
      coreEl.setAttribute('title', 'AXIOM AI — ' + STATES[newState].label);
      coreEl.setAttribute('aria-label', 'AXIOM AI status: ' + STATES[newState].label);
    }

    // Restart animation if was paused
    if ((newState === 'sleep' || newState === 'offline') && animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    } else if (!animFrame) {
      animate();
    }
  }

  function initCore(canvasId) {
    canvas = document.getElementById(canvasId || 'axiomCoreCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    
    resize();
    // Debounced: resize fires continuously while a window is being
    // dragged/dragged-to-resize, and each call reallocates the canvas
    // backing store + resets the transform — genuinely expensive to run
    // on every event rather than once movement settles.
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 120);
    });
    document.addEventListener('mousemove', onMouseMove, { passive: true });

    // Pause the render loop entirely while the tab isn't visible so a
    // backgrounded page doesn't keep burning CPU/GPU and battery on an
    // animation nobody can see — same pattern used by os-environment.js
    // and the OS shell's other continuous canvas loops.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
      } else if (!animFrame && currentState !== 'sleep' && currentState !== 'offline') {
        animate();
      }
    });
    
    createParticles(STATES[currentState].particles);
    createRibbons(6);
    animate();
  }

  function resize() {
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function onMouseMove(e) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    mouseX = (e.clientX - rect.left) / rect.width - 0.5;
    mouseY = (e.clientY - rect.top) / rect.height - 0.5;
  }

  // ---- Particle System (2x density) ----
  function createParticles(count) {
    if (!canvas) return;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    particles = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5,
        size: Math.random() * 2.5 + 0.5,
        life: Math.random() * 100,
        maxLife: 80 + Math.random() * 80,
        originX: Math.random() * w,
        originY: Math.random() * h,
      });
    }
  }

  // ---- Energy Ribbons ----
  function createRibbons(count) {
    ribbons = [];
    for (let i = 0; i < count; i++) {
      ribbons.push({
        phase: (i / count) * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.4,
        radius: 0.2 + Math.random() * 0.15,
        width: 1 + Math.random() * 2,
        opacity: 0.1 + Math.random() * 0.2,
      });
    }
  }

  // ---- Drawing: Liquid Plasma Center ----
  function drawPlasmaCenter(config) {
    if (!canvas || !ctx) return;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const cx = w / 2 + mouseX * w * 0.02;
    const cy = h / 2 + mouseY * h * 0.02;
    const maxR = Math.min(w, h) * 0.2;
    
    // Core glow (radial gradient)
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 2);
    const energy = config.energy;
    
    // Parse plasmaColor to get RGB components
    const match = config.plasmaColor.match(/rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)/);
    let r = 255, g = 255, b = 255;
    if (match) {
      r = parseInt(match[1]);
      g = parseInt(match[2]);
      b = parseInt(match[3]);
    }
    
    const a1 = energy * 0.15;
    const a2 = energy * 0.06;
    glow.addColorStop(0, `rgba(${r},${g},${b},${a1.toFixed(3)})`);
    glow.addColorStop(0.4, `rgba(${r},${g},${b},${a2.toFixed(3)})`);
    glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
    
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Plasma core (animated liquid effect)
    const plasmaPulse = Math.sin(time * 0.02) * 0.15 + 0.85;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * plasmaPulse, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${(energy * 0.2).toFixed(3)})`;
    ctx.fill();
    ctx.restore();
  }

  // ---- Drawing: Quantum Halo + Neural Ring ----
  function drawRings(config) {
    if (!canvas || !ctx) return;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const cx = w / 2 + mouseX * w * 0.01;
    const cy = h / 2 + mouseY * h * 0.01;
    const maxR = Math.min(w, h) * 0.35;
    const breathScale = 1 + Math.sin(breathPhase) * 0.015;
    
    ringAngle += config.ringSpeed * 0.02 * motionScale();
    breathPhase += 0.008 * motionScale();
    time += motionScale();
    
    // Quantum Halo (outer, faint, always rotating)
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * breathScale * 1.1, ringAngle * 0.5, ringAngle * 0.5 + Math.PI * 2);
    ctx.strokeStyle = config.ringColor;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.3;
    ctx.stroke();
    ctx.globalAlpha = 1;
    
    // Neural Ring (primary) — dashed line that rotates
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * breathScale, ringAngle, ringAngle + Math.PI * 1.8);
    ctx.strokeStyle = config.ringColor;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Inner ring (counter-rotating, solid)
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * 0.65 * breathScale, -ringAngle * 0.7, -ringAngle * 0.7 + Math.PI * 1.2);
    ctx.strokeStyle = config.ringColor;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    
    // Pulse ring (if state is pulsing)
    if (config.pulse) {
      const pulse = Math.sin(time * 0.02) * 0.5 + 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * (1 + pulse * 0.06) * breathScale, 0, Math.PI * 2);
      ctx.strokeStyle = config.ringColor;
      ctx.lineWidth = 1;
      ctx.globalAlpha = pulse * 0.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // ---- Drawing: Neural Halo ----
  // A web of small "neuron" nodes on a slowly counter-rotating
  // halo, connected by faint synapse lines that flicker at
  // random. Distinct from the Quantum Halo (plain arcs) above —
  // this one reads as thought/cognition rather than energy.
  function drawNeuralHalo(config) {
    if (!canvas || !ctx) return;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const cx = w / 2 + mouseX * w * 0.015;
    const cy = h / 2 + mouseY * h * 0.015;
    const r = Math.min(w, h) * 0.44;
    const nodeCount = 9;
    const rot = -ringAngle * 0.6;

    const match = config.ringColor.match(/rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)/);
    let cr = 255, cg = 255, cb = 255;
    if (match) { cr = parseInt(match[1]); cg = parseInt(match[2]); cb = parseInt(match[3]); }

    const nodes = [];
    for (let i = 0; i < nodeCount; i++) {
      const a = rot + (i / nodeCount) * Math.PI * 2;
      nodes.push({
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r * 0.94,
        flicker: (Math.sin(time * 0.03 + i * 1.7) * 0.5 + 0.5),
      });
    }

    // synapse lines — each node connects to its neighbor + one
    // cross-halo node so the web reads as a network, not a ring
    ctx.lineWidth = 1;
    for (let i = 0; i < nodeCount; i++) {
      const a = nodes[i];
      const b = nodes[(i + 1) % nodeCount];
      const c = nodes[(i + Math.floor(nodeCount / 2)) % nodeCount];
      const alpha1 = 0.12 + a.flicker * 0.18 * config.energy;
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha1.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      if (a.flicker > 0.8) {
        const alpha2 = (a.flicker - 0.8) * 2 * 0.3 * config.energy;
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha2.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      }
    }

    // node points themselves
    nodes.forEach(n => {
      const size = 1 + n.flicker * 1.6;
      ctx.beginPath();
      ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${(0.25 + n.flicker * 0.55).toFixed(3)})`;
      ctx.fill();
    });
  }

  // ---- Drawing: Agent Ring ----
  // Evenly spaced markers representing active sub-agents /
  // parallel processes. Lit markers = agents currently working.
  // Only meaningful (and only drawn) for multi-agent states.
  const AGENT_RING_STATES = {
    automation:  4,
    coding:      3,
    researching: 5,
    generating:  3,
    listening:   2,
  };
  function drawAgentRing(config) {
    if (!canvas || !ctx) return;
    const total = 8;
    const active = AGENT_RING_STATES[currentState] || 0;
    if (active === 0) return;

    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.5;
    const rot = ringAngle * 0.35;

    for (let i = 0; i < total; i++) {
      const a = rot + (i / total) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 0.94;
      const isActive = i < active;
      const pulse = isActive ? (Math.sin(time * 0.05 + i) * 0.3 + 0.7) : 0.25;
      const size = isActive ? 2.4 : 1.2;

      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = isActive
        ? `rgba(255,255,255,${(pulse * 0.7).toFixed(3)})`
        : `rgba(255,255,255,${(pulse * 0.15).toFixed(3)})`;
      ctx.fill();

      if (isActive) {
        ctx.beginPath();
        ctx.arc(x, y, size + 3, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${(pulse * 0.2).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  // ---- Drawing: Prediction Ring ----
  // A ghost arc that runs slightly AHEAD of the neural ring's
  // rotation — reads as the core "anticipating" its next move.
  // Only shown for states where the Core is actively reasoning.
  const PREDICTION_STATES = ['thinking', 'researching', 'generating', 'coding', 'listening'];
  function drawPredictionRing(config) {
    if (!canvas || !ctx) return;
    if (!PREDICTION_STATES.includes(currentState)) return;

    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) * 0.35;
    const lead = 0.9; // radians ahead of the neural ring
    const sweep = 0.5 + Math.sin(time * 0.03) * 0.15;

    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * 1.18, ringAngle + lead, ringAngle + lead + sweep);
    ctx.strokeStyle = config.ringColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.35 * config.energy;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // ---- Drawing: Energy Ribbons / Streams ----
  function drawRibbons(config) {
    if (!canvas || !ctx) return;
    if (config.energy < 0.2) return;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const cx = w / 2 + mouseX * w * 0.01;
    const cy = h / 2 + mouseY * h * 0.01;
    
    const match = config.ringColor.match(/rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)/);
    let r = 255, g = 255, b = 255;
    if (match) {
      r = parseInt(match[1]);
      g = parseInt(match[2]);
      b = parseInt(match[3]);
    }
    
    ctx.lineWidth = 1;
    ribbons.forEach(ribbon => {
      const angle = time * 0.01 * ribbon.speed + ribbon.phase;
      const radius = Math.min(w, h) * ribbon.radius;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle * 0.7) * radius * 0.5;
      
      ctx.beginPath();
      ctx.arc(x, y, ribbon.width, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${(config.energy * ribbon.opacity).toFixed(3)})`;
      ctx.fill();
      
      // Stream trail
      const trailLen = 6;
      for (let t = 1; t <= trailLen; t++) {
        const tAngle = (time * 0.01 * ribbon.speed + ribbon.phase) - t * 0.05;
        const tx = cx + Math.cos(tAngle) * radius;
        const ty = cy + Math.sin(tAngle * 0.7) * radius * 0.5;
        ctx.beginPath();
        ctx.arc(tx, ty, ribbon.width * (1 - t / (trailLen + 1)), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${(config.energy * ribbon.opacity * (1 - t / (trailLen + 1))).toFixed(3)})`;
        ctx.fill();
      }
    });
  }

  // ---- Drawing: Particles ----
  function drawParticles(config) {
    if (!canvas || !ctx) return;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const targetCount = config.particles;

    while (particles.length < targetCount) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5,
        size: Math.random() * 2.5 + 0.5,
        life: 0,
        maxLife: 80 + Math.random() * 80,
        originX: Math.random() * w,
        originY: Math.random() * h,
      });
    }
    // A state change that lowers the particle target (e.g.
    // thinking -> idle, 120 -> 40) used to `pop()` the excess off
    // instantly — a hard cut, the opposite of how new particles
    // already ease in via the life-based alpha ramp below. Instead,
    // mark the excess as dying and let them age out through that
    // same alpha curve, then remove them once they've faded; the
    // count still converges to targetCount, just over roughly a
    // second instead of one frame.
    if (particles.length > targetCount) {
      const excess = particles.length - targetCount;
      for (let i = particles.length - excess; i < particles.length; i++) {
        particles[i].dying = true;
      }
    }

    ctx.beginPath();
    particles.forEach(p => {
      p.x += p.vx * config.energy * 0.8 * motionScale();
      p.y += p.vy * config.energy * 0.8 * motionScale();
      p.life += motionScale() * (p.dying ? 3 : 1);

      if (!p.dying && (p.life > p.maxLife || p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10)) {
        p.x = Math.random() * w;
        p.y = Math.random() * h;
        p.life = 0;
      }

      const alpha = Math.min(1, p.life / 20) * (1 - p.life / p.maxLife) * 0.5;
      p._alpha = alpha;

      if (alpha > 0.01) {
        ctx.moveTo(p.x, p.y);
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      }
    });

    if (particles.some(p => p.dying)) {
      particles = particles.filter(p => !(p.dying && p.life >= p.maxLife));
    }

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fill();
  }

  // ---- Drawing: Holographic Platform ----
  function drawPlatform(config) {
    if (!canvas || !ctx) return;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const cx = w / 2;
    const cy = h / 2 + h * 0.15;
    const energy = config.energy;
    
    const match = config.glowColor.match(/rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)/);
    let r = 255, g = 255, b = 255;
    if (match) {
      r = parseInt(match[1]);
      g = parseInt(match[2]);
      b = parseInt(match[3]);
    }
    
    // Platform glow (horizontal ellipse beneath the core)
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.25);
    grad.addColorStop(0, `rgba(${r},${g},${b},${(energy * 0.1).toFixed(3)})`);
    grad.addColorStop(0.5, `rgba(${r},${g},${b},${(energy * 0.04).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, w * 0.25, h * 0.04, 0, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  // ---- Drawing: Memory Crystals ----
  // Small faceted shards orbiting at a lazy, independent radius —
  // each one a "stored memory" catching the light as it drifts.
  // Present at low density in every state; blooms in 'memory'.
  let crystals = null;
  function ensureCrystals() {
    if (crystals) return;
    crystals = [];
    const count = 7;
    for (let i = 0; i < count; i++) {
      crystals.push({
        phase: (i / count) * Math.PI * 2,
        speed: 0.15 + Math.random() * 0.2,
        radius: 0.55 + Math.random() * 0.2,
        size: 3 + Math.random() * 3,
        tilt: Math.random() * Math.PI,
        spin: 0.4 + Math.random() * 0.6,
        bob: Math.random() * Math.PI * 2,
      });
    }
  }
  function drawMemoryCrystals(config) {
    if (!canvas || !ctx) return;
    ensureCrystals();
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) * 0.5;
    const isMemory = currentState === 'memory';
    const baseAlpha = isMemory ? 0.55 : 0.16;
    const amberR = 251, amberG = 191, amberB = 36;

    crystals.forEach(c => {
      const a = time * 0.006 * c.speed + c.phase;
      const bobY = Math.sin(time * 0.02 + c.bob) * 6;
      const x = cx + Math.cos(a) * maxR * c.radius;
      const y = cy + Math.sin(a) * maxR * c.radius * 0.9 + bobY;
      const spin = time * 0.01 * c.spin + c.tilt;
      const s = c.size * (isMemory ? 1.3 : 1);
      const twinkle = Math.sin(time * 0.04 + c.phase * 3) * 0.3 + 0.7;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(spin);
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.6, 0);
      ctx.lineTo(0, s);
      ctx.lineTo(-s * 0.6, 0);
      ctx.closePath();
      ctx.fillStyle = `rgba(${amberR},${amberG},${amberB},${(baseAlpha * twinkle).toFixed(3)})`;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(0, s);
      ctx.strokeStyle = `rgba(255,255,255,${(baseAlpha * twinkle * 0.5).toFixed(3)})`;
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.restore();
    });
  }

  // ---- Drawing: Ambient Glow ----
  function drawAmbientGlow(config) {
    if (!canvas || !ctx) return;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const cx = w / 2;
    const cy = h / 2;
    
    const match = config.glowColor.match(/rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)/);
    let r = 255, g = 255, b = 255;
    if (match) {
      r = parseInt(match[1]);
      g = parseInt(match[2]);
      b = parseInt(match[3]);
    }
    
    // Large ambient glow
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.6);
    grad.addColorStop(0, `rgba(${r},${g},${b},${(config.energy * 0.04).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // ---- Drawing: Waveform ----
  function drawWaveform(config) {
    if (!config.waveform || !canvas || !ctx) return;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const cx = w / 2;
    const cy = h * 0.78;
    const width = w * 0.35;
    const bars = 30;
    const barWidth = width / bars;

    const t = Date.now() * 0.005;
    const speed = config.waveform === 'rapid' ? 2 : config.waveform === 'active' ? 1.5 : 1;

    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    for (let i = 0; i < bars; i++) {
      let height;
      const x = cx - width / 2 + i * barWidth;
      
      switch(config.waveform) {
        case 'slow':
          height = Math.sin(t + i * 0.3) * 10 + 12;
          break;
        case 'active':
          height = (Math.sin(t * speed + i * 0.4) * 0.5 + Math.sin(t * 1.7 + i * 0.2) * 0.5) * 14 + 12;
          break;
        case 'rapid':
          height = (Math.sin(t * 3 + i * 0.5) * 0.7 + Math.random() * 0.3) * 14 + 8;
          break;
        case 'search':
          height = Math.sin(t * 0.5 + i * 0.2) * 8 + 8 + (i === Math.floor((t * 2) % bars) ? 16 : 0);
          break;
        case 'code':
          height = (Math.sin(t + i * 0.5) > 0 ? 16 : 4) + Math.sin(t * 0.5 + i * 0.3) * 4;
          break;
        case 'creating':
          height = Math.abs(Math.sin(t * 1.2 + i * 0.3)) * 18 + 4;
          break;
        case 'steady':
          height = 10 + Math.sin(t * 0.3 + i * 0.2) * 4;
          break;
        case 'error':
          height = Math.random() > 0.7 ? 22 : 4;
          break;
        case 'learning':
          height = (Math.sin(t * 0.8 + i * 0.5) * 0.6 + Math.sin(t * 1.5 + i * 0.3) * 0.4) * 14 + 8;
          break;
        default:
          height = 8;
      }

      const alpha = 0.15 + (height / 30) * 0.35;
      ctx.globalAlpha = alpha;
      ctx.fillRect(x, cy - height / 2, Math.max(1, barWidth - 1.5), height);
    }
    ctx.globalAlpha = 1;
  }

  // ---- Drawing: Bloom ----
  // True soft-light bleed: a bright core disc is drawn onto an
  // offscreen canvas, blurred, then composited back underneath
  // at additive ('lighter') blend — a real bloom pass, not just
  // another radial gradient.
  let bloomCanvas = null, bloomCtx = null;
  let bloomBlurCanvas = null, bloomBlurCtx = null;
  let bloomCacheKey = null;
  function ensureBloomCanvas() {
    if (bloomCanvas) return;
    bloomCanvas = document.createElement('canvas');
    bloomCtx = bloomCanvas.getContext('2d');
    bloomBlurCanvas = document.createElement('canvas');
    bloomBlurCtx = bloomBlurCanvas.getContext('2d');
  }
  // Perf: the `ctx.filter = blur(...)` pass below is by far the most
  // expensive operation in the whole render loop (a full-canvas Gaussian
  // blur), yet its input — a solid disc sized/colored from the current
  // state's config — never changes between frames; only `energy` and
  // `plasmaColor` (both fixed per state) and canvas size affect it. So
  // instead of re-blurring on every one of the ~60 frames/sec, the blurred
  // bitmap is computed once and cached in `bloomBlurCanvas`, keyed on the
  // inputs that actually affect it — recomputed only on a state change or
  // a resize, then just composited (cheap) every frame after that. Pixel
  // output is identical to before; only the redundant recomputation is
  // removed.
  function drawBloom(config) {
    if (!canvas || !ctx) return;
    ensureBloomCanvas();
    const w = canvas.width;
    const h = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const cw = w / dpr;
    const ch = h / dpr;
    const cx = cw / 2;
    const cy = ch / 2;
    const maxR = Math.min(cw, ch) * 0.22;

    const match = config.plasmaColor.match(/rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)/);
    let r = 255, g = 255, b = 255;
    if (match) { r = parseInt(match[1]); g = parseInt(match[2]); b = parseInt(match[3]); }

    const blurPx = (14 + config.energy * 18).toFixed(0);
    const cacheKey = w + '|' + h + '|' + r + '|' + g + '|' + b + '|' + config.energy.toFixed(3);

    if (bloomCacheKey !== cacheKey) {
      if (bloomCanvas.width !== w || bloomCanvas.height !== h) {
        bloomCanvas.width = w;
        bloomCanvas.height = h;
        bloomBlurCanvas.width = w;
        bloomBlurCanvas.height = h;
      }

      bloomCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bloomCtx.clearRect(0, 0, cw, ch);
      bloomCtx.beginPath();
      bloomCtx.arc(cx, cy, maxR * (0.9 + config.energy * 0.4), 0, Math.PI * 2);
      bloomCtx.fillStyle = `rgba(${r},${g},${b},${(0.5 + config.energy * 0.3).toFixed(3)})`;
      bloomCtx.fill();

      // Blur once, in raw device pixels (no CSS-pixel transform needed
      // here since it's a 1:1 copy from bloomCanvas).
      bloomBlurCtx.setTransform(1, 0, 0, 1, 0, 0);
      bloomBlurCtx.clearRect(0, 0, w, h);
      bloomBlurCtx.filter = `blur(${blurPx}px)`;
      bloomBlurCtx.drawImage(bloomCanvas, 0, 0);
      bloomBlurCtx.filter = 'none';

      bloomCacheKey = cacheKey;
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(bloomBlurCanvas, 0, 0, w, h, 0, 0, cw, ch);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---- Drawing: Reflection ----
  // A soft diagonal highlight that sweeps across the sphere, as
  // if a light source were slowly circling it — clipped to the
  // core's circle and layered on top of everything else.
  function drawReflection(config) {
    if (!canvas || !ctx) return;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.5;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    const sweep = (time * 0.004) % (Math.PI * 2);
    const sx = cx + Math.cos(sweep) * r * 1.4;
    const sy = cy + Math.sin(sweep) * r * 1.4 - r * 0.6;

    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 1.6);
    grad.addColorStop(0, 'rgba(255,255,255,.16)');
    grad.addColorStop(0.4, 'rgba(255,255,255,.05)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');

    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.96, sweep - 0.5, sweep + 0.1);
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  // ---- Main Animation Loop ----
  function animate() {
    if (!ctx || !canvas) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const config = STATES[currentState];
    
    // Draw order for depth (back to front)
    drawAmbientGlow(config);      // Dynamic Lighting
    drawPlatform(config);         // Energy Platform
    drawBloom(config);            // Bloom
    drawRibbons(config);          // Ribbon Trails
    drawMemoryCrystals(config);   // Memory Crystals
    drawPlasmaCenter(config);
    drawParticles(config);
    drawRings(config);            // Quantum Halo
    drawNeuralHalo(config);       // Neural Halo
    drawAgentRing(config);        // Agent Ring
    drawPredictionRing(config);   // Prediction Ring
    drawWaveform(config);         // Voice Wave
    drawReflection(config);       // Reflection

    animFrame = requestAnimationFrame(animate);
  }

  // ---- Performance Optimization: Pause rAF when tab is hidden ----
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (animFrame) {
          cancelAnimationFrame(animFrame);
          animFrame = null;
        }
      } else {
        if (!animFrame && canvas && ctx && currentState !== 'sleep' && currentState !== 'offline') {
          animate();
        }
      }
    });

    // ---- Auto-Init ----
    document.addEventListener('DOMContentLoaded', () => {
      const el = document.getElementById('axiomCoreCanvas');
      if (el) initCore('axiomCoreCanvas');
    });

    if (document.getElementById('axiomCoreCanvas')) {
      initCore('axiomCoreCanvas');
    }
  }

  // ---- Event System ----
  function onChange(fn) {
    listeners.push(fn);
    return () => { listeners = listeners.filter(l => l !== fn); };
  }

  return {
    setState,
    getState,
    getStateInfo,
    getStates: () => STATES,
    initCore,
    onChange,
  };
})();
