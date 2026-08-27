/**
 * AXIOM — FLAGSHIP INTERACTIVE 3D ORB & HOLOGRAPHIC MATRIX ENGINE
 * Handles Canvas particle field, 3D mouse parallax tilt, audio synthesis, and interactive modals.
 */

(function () {
  'use strict';

  // --- AUDIO SYNTHESIZER (Procedural Web Audio API) ---
  let audioCtx = null;
  let isSoundMuted = false;

  function initAudio() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        audioCtx = new AudioContext();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playUiSound(type) {
    if (isSoundMuted) return;
    try {
      initAudio();
      if (!audioCtx) return;

      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'hover') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
        gain.gain.setValueAtTime(0.02, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === 'click') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(580, now);
        osc.frequency.exponentialRampToValueAtTime(1160, now + 0.12);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'core') {
        // Deep resonance sci-fi activation chime
        const subOsc = audioCtx.createOscillator();
        const subGain = audioCtx.createGain();
        subOsc.connect(subGain);
        subGain.connect(audioCtx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(523.25, now + 0.4);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(110, now);
        subGain.gain.setValueAtTime(0.05, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

        osc.start(now);
        subOsc.start(now);
        osc.stop(now + 0.5);
        subOsc.stop(now + 0.6);
      }
    } catch (e) {
      // Audio context might be restricted before interaction
    }
  }

  // --- CANVAS PARTICLE STARFIELD ---
  function initParticleCanvas() {
    const canvas = document.getElementById('axiom-bg-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    });

    const particles = [];
    const PARTICLE_COUNT = Math.min(120, Math.floor((width * height) / 12000));

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.7 + 0.2,
        speedX: (Math.random() - 0.5) * 0.25,
        speedY: (Math.random() - 0.5) * 0.25,
        pulseSpeed: Math.random() * 0.02 + 0.005,
        pulseVal: Math.random() * Math.PI,
        color: Math.random() > 0.3 ? '#00f0ff' : '#ffffff'
      });
    }

    let mouseX = width / 2;
    let mouseY = height / 2;

    window.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });

    function renderParticles() {
      ctx.clearRect(0, 0, width, height);

      // Draw subtle orbital particle dust
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.speedX;
        p.y += p.speedY;
        p.pulseVal += p.pulseSpeed;

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        const currentAlpha = p.alpha + Math.sin(p.pulseVal) * 0.25;
        const clampedAlpha = Math.max(0.1, Math.min(1, currentAlpha));

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = clampedAlpha;
        ctx.shadowBlur = p.radius > 1 ? 6 : 0;
        ctx.shadowColor = p.color;
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      requestAnimationFrame(renderParticles);
    }

    renderParticles();
  }

  // --- 3D MOUSE PARALLAX TILT ---
  function initParallaxTilt() {
    const orbitContainer = document.querySelector('.ax-orbit-container');
    const orbitStage = document.querySelector('.ax-orbit-stage');
    if (!orbitContainer || !orbitStage) return;

    let targetRotX = 0;
    let targetRotY = 0;
    let currentRotX = 0;
    let currentRotY = 0;

    window.addEventListener('mousemove', (e) => {
      const rect = orbitContainer.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const normX = (e.clientX - centerX) / (window.innerWidth / 2);
      const normY = (e.clientY - centerY) / (window.innerHeight / 2);

      targetRotX = -normY * 12; // Tilt up/down
      targetRotY = normX * 16;  // Tilt left/right
    });

    function updateTilt() {
      currentRotX += (targetRotX - currentRotX) * 0.08;
      currentRotY += (targetRotY - currentRotY) * 0.08;

      orbitStage.style.transform = `rotateX(${currentRotX}deg) rotateY(${currentRotY}deg)`;
      requestAnimationFrame(updateTilt);
    }

    updateTilt();
  }

  // --- CAPABILITY DATA & MODAL SYSTEM ---
  const capabilityData = {
    voice: {
      title: 'Axiom Voice Intelligence',
      badge: 'Real-Time Neural TTS & ASR',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`,
      desc: 'Zero-latency bidirectional voice streams with sub-180ms conversational turnarounds. Axiom understands nuance, accents, emotional pitch, and interruptions naturally.',
      terminal: `[VOICE_STREAM_INITIALIZED]
> Sampling Rate: 48kHz HD Studio Lossless
> Latency: 142ms round-trip
> Speaker Diarization: Active (Multi-Speaker Tracking)
> Emotion Engine: Calibrated (Attentive, Confident)`
    },
    vision: {
      title: 'Axiom Optical Vision',
      badge: 'Multimodal Spatial Perception',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
      desc: 'Real-time 60FPS screen and video feed comprehension. Axiom parses complex UI layouts, design mockups, code diffs, charts, and physical environment feeds instantaneously.',
      terminal: `[OPTICAL_MATRIX_RUNNING]
> OCR & Layout Resolution: 4K Spatial Mesh
> Object Segmentation: 99.4% confidence
> Active Eye Track: 60 FPS viewport scan
> Screen Context: Render Tree mapped to AST`
    },
    agents: {
      title: 'Axiom Autonomous Multi-Agents',
      badge: 'Hierarchical Swarm Orchestration',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 9h6v6H9z"/><path d="M9 3v6M15 3v6M9 15v6M15 15v6M3 9h6M3 15h6M15 9h6M15 15h6"/></svg>`,
      desc: 'Deconstruct massive goals into self-correcting subagent workflows. Axiom orchestrates specialized coding, research, debugging, and verification agents concurrently.',
      terminal: `[SWARM_ORCHESTRATOR_ONLINE]
> Active Agents: 6 Swarm Units
> Lead Planner: DAG execution node [OK]
> Verification Protocol: Double-pass code review
> Memory Shared Bus: Synced across 12 context blocks`
    },
    computer: {
      title: 'Axiom Computer Control',
      badge: 'OS & Browser Native Interaction',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>`,
      desc: 'Direct interaction with desktop applications, browsers, terminals, and filesystem APIs. Axiom clicks, types, navigates, tests, and deploys just like an engineer.',
      terminal: `[COMPUTER_BRIDGE_CONNECTED]
> OS Hook: Windows / Linux / macOS Native
> Shell Session: PTY Stream Active
> Browser Driver: Headless & Visible Chrome Subagents
> Keyboard / Mouse Synthesis: Low-level event dispatcher`
    },
    tools: {
      title: 'Axiom Tool Execution Engine',
      badge: 'Extensible MCP & API Registry',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
      desc: 'Connect Axiom to over 1,000+ API tools, Model Context Protocol (MCP) servers, databases, and custom webhooks with automated type verification and sandbox safety.',
      terminal: `[TOOL_REGISTRY_LOADED]
> Connected MCP Servers: 8 Loaded
> Native Tools: File System, Git, Docker, Postgres, HTTP
> Auto-Schema Validation: Strict JSON Schema v7
> Sandbox Security: Level 4 Isolated Execution`
    },
    files: {
      title: 'Axiom Neural Memory & Files',
      badge: 'Infinite Context Knowledge Vault',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`,
      desc: 'Vectorized semantic memory vault for codebases, documents, media, and persistent cross-session project contexts. Retrieve relevant code snippets in milliseconds.',
      terminal: `[NEURAL_VAULT_MOUNTED]
> Indexing: HNSW Vector Embeddings
> Context Capacity: 2,000,000 Tokens
> Hybrid Search: BM25 Keyword + Dense Cosine
> Status: 100% Synced & Encrypted (AES-256-GCM)`
    },
    core: {
      title: 'Axiom Unified Core Intelligence',
      badge: 'One Intelligence to Control Your World',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 L22 20 L2 20 Z"/><path d="M12 9 L16.5 17 L7.5 17 Z" fill="currentColor"/></svg>`,
      desc: 'Axiom synthesizes perception, reasoning, and real-world execution into a single harmonious cognitive engine. No fragmented plugins — just pure autonomous capability.',
      terminal: `[AXIOM_CORE_KERNEL_READY]
> Status: Fully Operational
> Architecture: Unified Multimodal Neural Mesh
> Control Surface: OS Shell, Workspace, Playground, Mobile
> Welcome to the Future.`
    }
  };

  function initModals() {
    const modalBackdrop = document.getElementById('axModalBackdrop');
    const modalClose = document.getElementById('axModalClose');
    const modalIcon = document.getElementById('axModalIcon');
    const modalTitle = document.getElementById('axModalTitle');
    const modalBadge = document.getElementById('axModalBadge');
    const modalDesc = document.getElementById('axModalDesc');
    const modalTerminal = document.getElementById('axModalTerminal');
    const modalLaunchBtn = document.getElementById('axModalLaunchBtn');

    if (!modalBackdrop) return;

    function openModal(key) {
      const data = capabilityData[key] || capabilityData.core;
      if (modalIcon) modalIcon.innerHTML = data.icon;
      if (modalTitle) modalTitle.textContent = data.title;
      if (modalBadge) modalBadge.textContent = data.badge;
      if (modalDesc) modalDesc.textContent = data.desc;
      if (modalTerminal) modalTerminal.textContent = data.terminal;

      modalBackdrop.classList.add('open');
      modalBackdrop.setAttribute('aria-hidden', 'false');
      playUiSound('core');
    }

    function closeModal() {
      modalBackdrop.classList.remove('open');
      modalBackdrop.setAttribute('aria-hidden', 'true');
      playUiSound('click');
    }

    if (modalClose) {
      modalClose.addEventListener('click', closeModal);
    }

    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalBackdrop.classList.contains('open')) {
        closeModal();
      }
    });

    // Attach click handlers to 6 Nodes & Center Sphere
    document.querySelectorAll('.ax-node').forEach((node) => {
      const capKey = node.getAttribute('data-capability');
      node.addEventListener('mouseenter', () => playUiSound('hover'));
      node.addEventListener('click', () => {
        if (capKey) openModal(capKey);
      });
    });

    const centerSphere = document.querySelector('.ax-crystal-sphere');
    if (centerSphere) {
      centerSphere.addEventListener('mouseenter', () => playUiSound('hover'));
      centerSphere.addEventListener('click', () => openModal('core'));
    }

    // Attach click sounds to buttons & pills
    document.querySelectorAll('.ax-btn-pill, .ax-feature-pill').forEach((el) => {
      el.addEventListener('mouseenter', () => playUiSound('hover'));
      el.addEventListener('click', () => playUiSound('click'));
    });
  }

  // --- SOUND TOGGLE ---
  function initSoundToggle() {
    const soundBtn = document.getElementById('axSoundToggle');
    if (!soundBtn) return;

    soundBtn.addEventListener('click', () => {
      isSoundMuted = !isSoundMuted;
      soundBtn.innerHTML = isSoundMuted
        ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>`
        : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
      soundBtn.title = isSoundMuted ? 'Unmute Audio' : 'Mute Audio';
      if (!isSoundMuted) playUiSound('click');
    });
  }

  // --- NAVBAR SCROLL EFFECT ---
  function initNavScroll() {
    const nav = document.querySelector('.ax-nav');
    if (!nav) return;
    window.addEventListener('scroll', () => {
      if (window.scrollY > 30) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
    });
  }

  // --- INITIALIZATION ---
  document.addEventListener('DOMContentLoaded', () => {
    initParticleCanvas();
    initParallaxTilt();
    initModals();
    initSoundToggle();
    initNavScroll();
  });
})();
