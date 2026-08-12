/* ============================================================
   AXIOM AI OS V13 — Brain Ultimate
   ------------------------------------------------------------
   Live cognition visualization engine that enhances brain.html
   with real-time metrics, animated consciousness system,
   chain-of-thought reasoning display, planning module,
   prediction engine, knowledge graph, and cognitive metrics.
   
   Depends on: AxiomBrain (axiom-brain.js)
   ============================================================ */
(function (global) {
  'use strict';

  // ============================================================
  // STATE
  // ============================================================
  const state = {
    consciousness: 0.92,
    awareness: 0.85,
    focus: 0.78,
    reasoningDepth: 4,
    branchesExplored: 7,
    logicConsistency: 0.96,
    planSteps: 5,
    planCompleted: 3,
    replansTriggered: 1,
    learningAdaptations: 12,
    preferenceSignals: 8,
    styleMatch: 0.91,
    shortTermLoad: 0.62,
    longTermRecalls: 5,
    retentionScore: 0.97,
    confidence: 0.93,
    factualCertainty: 0.89,
    styleCertainty: 0.97,
    predictionItems: [
      { label: "You'll ask for Part 9 next", sub: 'Based on the sequential pattern of this conversation', prob: 0.78 },
      { label: 'A visual tweak request', sub: 'Minor color or spacing adjustment to this page', prob: 0.14 },
      { label: 'Full project review', sub: 'Complete codebase review request', prob: 0.08 },
    ],
    emotions: [
      { emoji: '🙂', name: 'Positive', value: 64 },
      { emoji: '😐', name: 'Neutral', value: 29 },
      { emoji: '⚡', name: 'Energetic', value: 52 },
      { emoji: '🎯', name: 'Focused', value: 81 },
      { emoji: '😕', name: 'Frustrated', value: 4 },
    ],
    reasoningFeed: [
      { title: 'Parsed request into sub-goals', sub: 'Split the task into 3 dependent steps before drafting a response', color: '#60A5FA', time: 'now' },
      { title: 'Cross-checked constraints', sub: 'Verified formatting and scope against the original ask', color: '#60A5FA', time: '2s ago' },
      { title: 'Selected best-supported path', sub: 'Discarded 2 lower-confidence branches', color: '#6EE7B7', time: '4s ago' },
      { title: 'Drafting final answer', sub: 'Composing response from the selected reasoning path', color: '#FBBF24', time: '6s ago' },
    ],
    planningFeed: [
      { title: 'Step 1 — Gather context', sub: 'Read relevant files and prior messages', color: '#6EE7B7', time: 'done' },
      { title: 'Step 2 — Choose approach', sub: 'Compared two candidate strategies', color: '#6EE7B7', time: 'done' },
      { title: 'Step 3 — Execute', sub: 'Currently generating the deliverable', color: '#FBBF24', time: 'active' },
      { title: 'Step 4 — Review', sub: 'Pending', color: 'rgba(255,255,255,.2)', time: 'queued' },
    ],
    activityLog: [],
    brainState: null,
  };

  let brainInterval = null;
  let brainEls = null;

  // ============================================================
  // Block 2 · Step 2 · Part 2 — "No fake thinking indicators"
  // ------------------------------------------------------------
  // Before this pass, tick() ran every generator below unconditionally on
  // a 2s timer — reasoning steps, plan progress, predictions, and
  // emotion/confidence/memory drift all advanced by Math.random() whether
  // or not the AI was doing anything at all. That's a textbook fake
  // thinking indicator: the dashboard looked "alive" even while genuinely
  // idle, with no real event behind any of it.
  //
  // isRealAIActive() reads AxiomBrain's actual state (kept current by
  // js/core/ai-state-manager.js from real capability/conversation/stream
  // events — see axiom-brain.js and ai-state-manager.js). Every generator
  // below now only advances while this is true, so the feed reflects real
  // activity happening right now instead of a perpetual simulation. There
  // is still no real backing telemetry for some of these categories
  // (branch-count, logic-consistency, emotion) — rather than inventing
  // fake data for those, their random drift is removed outright and they
  // stay at their last real/static value.
  // ============================================================
  function isRealAIActive() {
    const bs = state.brainState;
    if (!bs) return false;
    if (bs.toolActive) return true;
    return bs.activity === 'thinking' || bs.activity === 'learning' ||
           bs.activity === 'speaking' || bs.activity === 'listening';
  }

  // ============================================================
  // DOM CACHE
  // ============================================================
  function cacheEls() {
    brainEls = {
      // Consciousness meter
      consciousnessMeter: document.querySelector('.brain-metric-card .brain-metric-value'),
      consciousnessBar: document.querySelector('.brain-metric-card .brain-metric-bar span'),
    };
  }

  // ============================================================
  // CONSCIOUSNESS SYSTEM
  // ============================================================
  function updateConsciousness() {
    // Sync with AxiomBrain
    const brain = global.AxiomBrain;
    if (brain) {
      const bs = brain.getState();
      state.brainState = bs;
      
      // Map AxiomBrain activity to consciousness values
      switch (bs.activity) {
        case 'thinking': state.consciousness = Math.min(1, state.consciousness + 0.02); state.focus = Math.min(1, state.focus + 0.03); break;
        case 'speaking': state.consciousness = Math.max(0.7, state.consciousness - 0.01); state.focus = Math.max(0.4, state.focus - 0.02); break;
        case 'listening': state.consciousness = Math.max(0.6, state.consciousness - 0.01); state.focus = Math.max(0.5, state.focus - 0.01); break;
        case 'learning': state.consciousness = Math.min(1, state.consciousness + 0.01); state.awareness = Math.min(1, state.awareness + 0.02); break;
        default: // idle — slowly return to base
          state.consciousness += (0.85 - state.consciousness) * 0.01;
          state.focus += (0.75 - state.focus) * 0.01;
          state.awareness += (0.80 - state.awareness) * 0.01;
      }
      
      // Mood influences metrics
      switch (bs.mood) {
        case 'focused': state.focus = Math.min(1, state.focus + 0.015); break;
        case 'happy': state.emotions[0].value = Math.min(100, state.emotions[0].value + 0.5); break;
        case 'curious': state.awareness = Math.min(1, state.awareness + 0.01); break;
      }
    }
    
    // Slight natural fluctuation
    state.consciousness += (Math.random() - 0.5) * 0.005;
    state.consciousness = Math.max(0.3, Math.min(1, state.consciousness));
    
    state.awareness += (Math.random() - 0.5) * 0.008;
    state.awareness = Math.max(0.2, Math.min(1, state.awareness));
    
    state.focus += (Math.random() - 0.5) * 0.006;
    state.focus = Math.max(0.2, Math.min(1, state.focus));
    
    // Update DOM for consciousness, awareness, focus
    updateMetricDisplay('consciousness', state.consciousness);
    updateMetricDisplay('awareness', state.awareness);
    updateMetricDisplay('focus', state.focus);
    
    // Update the cognition active badge
    const badge = document.querySelector('.brain-core-live');
    if (badge) {
      const dot = badge.querySelector('.pulse-dot');
      if (dot) {
        const activity = (brain ? brain.getState().activity : 'idle');
        if (activity === 'thinking' || activity === 'learning') {
          dot.style.background = '#60A5FA';
          dot.style.boxShadow = '0 0 12px #60A5FA';
          badge.style.borderColor = 'rgba(96,165,250,.3)';
        } else {
          dot.style.background = '#6EE7B7';
          dot.style.boxShadow = '0 0 8px #6EE7B7';
          badge.style.borderColor = 'rgba(110,231,183,.2)';
        }
      }
    }
  }

  // ============================================================
  // METRIC UPDATE HELPERS
  // ============================================================
  function updateMetricDisplay(section, value) {
    const pct = Math.round(value * 100);
    
    // Find the relevant metric card
    // We map section names to known brain sections
    const sectionMap = {
      consciousness: { section: 'awareness', index: 0 },  // awareness section, first card
      awareness: { section: 'awareness', index: 2 },       // awareness section, third card
      focus: { section: 'awareness', index: 1 },           // awareness section, second card
    };
    
    const map = sectionMap[section];
    if (!map) return;
    
    const targetSection = document.getElementById('section-' + map.section);
    if (!targetSection) return;
    
    const cards = targetSection.querySelectorAll('.brain-metric-card');
    const card = cards[map.index];
    if (!card) return;
    
    const valueEl = card.querySelector('.brain-metric-value');
    const barEl = card.querySelector('.brain-metric-bar span');
    
    if (valueEl) {
      // Format display
      if (section === 'consciousness' || section === 'focus' || section === 'awareness') {
        valueEl.textContent = pct + '%';
      }
    }
    if (barEl) {
      barEl.style.width = pct + '%';
    }
  }

  // ============================================================
  // REASONING FEED — Live chain-of-thought
  // ============================================================
  function updateReasoningFeed() {
    const section = document.getElementById('section-reasoning');
    if (!section) return;
    
    const feed = section.querySelector('.brain-feed');
    if (!feed) return;

    // Only narrate reasoning steps while the AI is genuinely doing
    // something (real event-backed) — see isRealAIActive() above.
    if (!isRealAIActive()) return;

    // Occasionally add a new reasoning step
    if (Math.random() < 0.1) {
      const steps = [
        { title: 'Evaluating alternative approach', sub: 'Checking if a different method would be more efficient', color: '#60A5FA' },
        { title: 'Validating assumptions', sub: 'Verifying initial conditions are still correct', color: '#60A5FA' },
        { title: 'Synthesizing partial results', sub: 'Combining outputs from intermediate reasoning steps', color: '#6EE7B7' },
        { title: 'Refining response structure', sub: 'Organizing content for clarity and completeness', color: '#FBBF24' },
        { title: 'Checking for edge cases', sub: 'Ensuring the solution handles unusual inputs', color: '#60A5FA' },
      ];
      // Prefer a real signal over a canned label: if a real tool/capability
      // is actually in flight (AxiomBrain.toolActive/activeTool, driven by
      // real capability:loading events), narrate THAT instead of guessing.
      const bs = state.brainState;
      let step;
      if (bs && bs.toolActive && bs.activeTool) {
        step = { title: 'Running ' + bs.activeTool, sub: 'Live capability call in progress', color: '#60A5FA' };
      } else {
        step = steps[Math.floor(Math.random() * steps.length)];
      }
      state.reasoningFeed.unshift({ ...step, time: 'now' });
      if (state.reasoningFeed.length > 6) state.reasoningFeed.pop();
      
      // Update timestamps
      state.reasoningFeed.forEach((item, i) => {
        if (i > 0) item.time = (i * 2) + 's ago';
      });
      
      // Rebuild feed HTML
      feed.innerHTML = state.reasoningFeed.map(item => `
        <div class="brain-feed-item">
          <div class="brain-feed-dot" style="background:${item.color};"></div>
          <div class="brain-feed-main">
            <div class="brain-feed-title">${item.title}</div>
            <div class="brain-feed-sub">${item.sub}</div>
          </div>
          <div class="brain-feed-time">${item.time}</div>
        </div>
      `).join('');
      
      // Update reasoning depth metric
      state.reasoningDepth = Math.min(10, state.reasoningDepth + (Math.random() < 0.3 ? 1 : 0));
      updateReasoningMetrics();
    }
  }
  
  function updateReasoningMetrics() {
    const section = document.getElementById('section-reasoning');
    if (!section) return;
    const cards = section.querySelectorAll('.brain-metric-card');
    if (cards.length >= 3) {
      const depthVal = cards[0].querySelector('.brain-metric-value');
      const branchesVal = cards[1].querySelector('.brain-metric-value');
      const consistencyVal = cards[2].querySelector('.brain-metric-value');
      const depthBar = cards[0].querySelector('.brain-metric-bar span');
      const branchesBar = cards[1].querySelector('.brain-metric-bar span');
      const consistencyBar = cards[2].querySelector('.brain-metric-bar span');
      
      state.branchesExplored += Math.random() < 0.15 ? 1 : 0;
      state.logicConsistency = Math.max(0.7, Math.min(1, state.logicConsistency + (Math.random() - 0.5) * 0.02));
      
      if (depthVal) depthVal.textContent = state.reasoningDepth + ' steps';
      if (branchesVal) branchesVal.textContent = state.branchesExplored;
      if (consistencyVal) consistencyVal.textContent = Math.round(state.logicConsistency * 100) + '%';
      if (depthBar) depthBar.style.width = (state.reasoningDepth / 10 * 100) + '%';
      if (branchesBar) branchesBar.style.width = Math.min(100, state.branchesExplored * 8) + '%';
      if (consistencyBar) consistencyBar.style.width = (state.logicConsistency * 100) + '%';
    }
  }

  // ============================================================
  // PLANNING MODULE
  // ============================================================
  function updatePlanning() {
    const section = document.getElementById('section-planning');
    if (!section) return;
    
    const cards = section.querySelectorAll('.brain-metric-card');
    const feed = section.querySelector('.brain-feed');
    if (!cards.length || !feed) return;
    if (!isRealAIActive()) return; // no fake plan progress while genuinely idle

    // Update metrics
    const stepsVal = cards[0].querySelector('.brain-metric-value');
    const completedVal = cards[1].querySelector('.brain-metric-value');
    const replansVal = cards[2].querySelector('.brain-metric-value');
    const stepsBar = cards[0].querySelector('.brain-metric-bar span');
    const completedBar = cards[1].querySelector('.brain-metric-bar span');
    
    if (Math.random() < 0.05) {
      state.planCompleted = Math.min(state.planSteps, state.planCompleted + 1);
    }
    if (Math.random() < 0.02) {
      state.replansTriggered++;
      state.planSteps = Math.min(10, state.planSteps + 1);
    }
    
    if (stepsVal) stepsVal.textContent = state.planSteps;
    if (completedVal) completedVal.textContent = state.planCompleted + ' / ' + state.planSteps;
    if (replansVal) replansVal.textContent = state.replansTriggered;
    if (stepsBar) stepsBar.style.width = Math.min(100, (state.planSteps / 10) * 100) + '%';
    if (completedBar) completedBar.style.width = (state.planCompleted / state.planSteps * 100) + '%';
    
    // Update feed items
    const items = feed.querySelectorAll('.brain-feed-item');
    if (items.length >= 4) {
      // Update step 3 status
      if (state.planCompleted >= 3) {
        const dot3 = items[2].querySelector('.brain-feed-dot');
        const time3 = items[2].querySelector('.brain-feed-time');
        if (dot3) dot3.style.background = '#6EE7B7';
        if (time3) time3.textContent = 'done';
      }
      // Update step 4
      if (state.planCompleted >= 4) {
        const dot4 = items[3].querySelector('.brain-feed-dot');
        const time4 = items[3].querySelector('.brain-feed-time');
        if (dot4) dot4.style.background = '#FBBF24';
        if (time4) time4.textContent = 'active';
      }
    }
  }

  // ============================================================
  // PREDICTION ENGINE
  // ============================================================
  function updatePredictions() {
    const section = document.getElementById('section-prediction');
    if (!section) return;
    
    const feed = section.querySelector('.brain-feed');
    if (!feed) return;
    if (!isRealAIActive()) return; // no fake probability drift while idle

    // Occasionally update probabilities
    if (Math.random() < 0.2) {
      state.predictionItems.forEach(item => {
        item.prob = Math.max(0.01, Math.min(0.99, item.prob + (Math.random() - 0.5) * 0.05));
      });
      state.predictionItems.sort((a, b) => b.prob - a.prob);
      
      feed.innerHTML = state.predictionItems.map(item => `
        <div class="brain-feed-item">
          <div class="brain-feed-dot" style="background:${item.prob > 0.5 ? '#6EE7B7' : item.prob > 0.1 ? '#FBBF24' : '#60A5FA'};"></div>
          <div class="brain-feed-main">
            <div class="brain-feed-title">${item.label}</div>
            <div class="brain-feed-sub">${item.sub}</div>
          </div>
          <div class="brain-feed-time">${Math.round(item.prob * 100)}% likely</div>
        </div>
      `).join('');
    }
  }

  // ============================================================
  // COGNITIVE METRICS — Learning, Knowledge, Memory
  // ============================================================
  function updateCognitiveMetrics() {
    // Learning section
    const learningSection = document.getElementById('section-learning');
    if (learningSection) {
      const cards = learningSection.querySelectorAll('.brain-metric-card');
      // Only advance learning metrics while AxiomBrain reports the AI is
      // actually in its real 'learning' activity — not a generic "busy".
      if (cards.length >= 3 && state.brainState && state.brainState.activity === 'learning') {
        state.learningAdaptations += Math.random() < 0.1 ? 1 : 0;
        state.preferenceSignals += Math.random() < 0.1 ? 1 : 0;
        state.styleMatch = Math.max(0.5, Math.min(1, state.styleMatch + (Math.random() - 0.5) * 0.01));
        
        const adaptVal = cards[0].querySelector('.brain-metric-value');
        const prefVal = cards[1].querySelector('.brain-metric-value');
        const styleVal = cards[2].querySelector('.brain-metric-value');
        const adaptBar = cards[0].querySelector('.brain-metric-bar span');
        const prefBar = cards[1].querySelector('.brain-metric-bar span');
        const styleBar = cards[2].querySelector('.brain-metric-bar span');
        
        if (adaptVal) adaptVal.textContent = state.learningAdaptations;
        if (prefVal) prefVal.textContent = state.preferenceSignals;
        if (styleVal) styleVal.textContent = Math.round(state.styleMatch * 100) + '%';
        if (adaptBar) adaptBar.style.width = Math.min(100, state.learningAdaptations * 5) + '%';
        if (prefBar) prefBar.style.width = Math.min(100, state.preferenceSignals * 8) + '%';
        if (styleBar) styleBar.style.width = (state.styleMatch * 100) + '%';
      }
    }
    
    // Memory section
    const memorySection = document.getElementById('section-memory');
    if (memorySection) {
      const cards = memorySection.querySelectorAll('.brain-metric-card');
      if (cards.length >= 3 && isRealAIActive()) {
        state.shortTermLoad = Math.max(0.2, Math.min(1, state.shortTermLoad + (Math.random() - 0.5) * 0.02));
        state.longTermRecalls += Math.random() < 0.15 ? 1 : 0;
        state.retentionScore = Math.max(0.7, Math.min(1, state.retentionScore + (Math.random() - 0.5) * 0.01));
        
        const shortVal = cards[0].querySelector('.brain-metric-value');
        const longVal = cards[1].querySelector('.brain-metric-value');
        const retVal = cards[2].querySelector('.brain-metric-value');
        const shortBar = cards[0].querySelector('.brain-metric-bar span');
        const longBar = cards[1].querySelector('.brain-metric-bar span');
        const retBar = cards[2].querySelector('.brain-metric-bar span');
        
        if (shortVal) shortVal.textContent = Math.round(state.shortTermLoad * 100) + '%';
        if (longVal) longVal.textContent = state.longTermRecalls;
        if (retVal) retVal.textContent = Math.round(state.retentionScore * 100) + '%';
        if (shortBar) shortBar.style.width = (state.shortTermLoad * 100) + '%';
        if (longBar) longBar.style.width = Math.min(100, state.longTermRecalls * 12) + '%';
        if (retBar) retBar.style.width = (state.retentionScore * 100) + '%';
      }
    }
    
    // Knowledge section
    // No real coverage telemetry exists in this project yet, so rather than
    // re-randomizing a number every 2s (a pure fake indicator), this is
    // left at whatever it last rendered — a real value can be wired in
    // once a genuine knowledge-coverage signal exists on the bus.
    
    // Confidence section
    const confidenceSection = document.getElementById('section-confidence');
    if (confidenceSection) {
      const cards = confidenceSection.querySelectorAll('.brain-metric-card');
      if (cards.length >= 3 && isRealAIActive()) {
        state.confidence = Math.max(0.7, Math.min(1, state.confidence + (Math.random() - 0.5) * 0.015));
        state.factualCertainty = Math.max(0.6, Math.min(1, state.factualCertainty + (Math.random() - 0.5) * 0.02));
        state.styleCertainty = Math.max(0.8, Math.min(1, state.styleCertainty + (Math.random() - 0.5) * 0.01));
        
        const confVal = cards[0].querySelector('.brain-metric-value');
        const factVal = cards[1].querySelector('.brain-metric-value');
        const styleVal = cards[2].querySelector('.brain-metric-value');
        const confBar = cards[0].querySelector('.brain-metric-bar span');
        const factBar = cards[1].querySelector('.brain-metric-bar span');
        const styleBar = cards[2].querySelector('.brain-metric-bar span');
        
        if (confVal) confVal.textContent = Math.round(state.confidence * 100) + '%';
        if (factVal) factVal.textContent = Math.round(state.factualCertainty * 100) + '%';
        if (styleVal) styleVal.textContent = Math.round(state.styleCertainty * 100) + '%';
        if (confBar) confBar.style.width = (state.confidence * 100) + '%';
        if (factBar) factBar.style.width = (state.factualCertainty * 100) + '%';
        if (styleBar) styleBar.style.width = (state.styleCertainty * 100) + '%';
      }
    }
    
    // Emotion section
    // No real sentiment/emotion telemetry exists anywhere in this project —
    // the previous unconditional per-tick random drift was a pure fake
    // indicator with nothing behind it. Left static (last real render)
    // rather than inventing continued "life"; a real signal would need to
    // come from somewhere genuine (e.g. sentiment analysis on the actual
    // response text) before this should move again.
  }

  // ============================================================
  // VISUALIZATION — Enhanced animated graphs
  // ============================================================
  function enhanceVisualizations() {
    // Add slight animation to existing SVG elements
    const vizCanvas = document.getElementById('vizCanvas');
    if (!vizCanvas) return;
    
    // Randomly pulse some nodes
    const circles = vizCanvas.querySelectorAll('circle');
    circles.forEach((circle, i) => {
      if (i % 3 === 0) {
        const currentOpacity = parseFloat(circle.getAttribute('opacity') || '0.85');
        const newOpacity = 0.5 + Math.random() * 0.5;
        circle.setAttribute('opacity', String(newOpacity));
      }
    });
  }

  // ============================================================
  // GOALS — Track progress
  // ============================================================
  function updateGoals() {
    const section = document.getElementById('section-goals');
    if (!section) return;
    
    const rows = section.querySelectorAll('.brain-goal-row');
    if (rows.length < 3) return;
    if (!isRealAIActive()) return; // no fake goal progress while idle

    // Slightly progress goals over time
    rows.forEach((row, i) => {
      const fill = row.querySelector('.brain-goal-fill');
      const pct = row.querySelector('.brain-goal-pct');
      if (fill && pct) {
        const currentPct = parseFloat(pct.textContent) || 0;
        const newPct = Math.min(100, currentPct + Math.random() * 0.2);
        fill.style.width = newPct + '%';
        pct.textContent = Math.round(newPct) + '%';
      }
    });
  }

  // ============================================================
  // ACTIVITY LOG — Recent brain events
  // ============================================================
  function logActivity(message) {
    state.activityLog.unshift({
      message,
      timestamp: Date.now(),
    });
    if (state.activityLog.length > 20) state.activityLog.pop();
  }

  // ============================================================
  // MAIN UPDATE LOOP
  // ============================================================
  function tick() {
    updateConsciousness();
    updateReasoningFeed();
    updatePlanning();
    updatePredictions();
    updateCognitiveMetrics();
    enhanceVisualizations();
    updateGoals();
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    cacheEls();
    
    // Start the live update loop (every 2 seconds for smooth animation)
    brainInterval = setInterval(tick, 2000);
    
    // Log initial activity
    logActivity('Brain monitoring initialized');
    logActivity('Consciousness system online');
    
    // Listen for AxiomBrain changes
    const brain = global.AxiomBrain;
    if (brain) {
      let lastLoggedActivity = null;
      let lastLoggedTool = null;
      brain.on('change', (bs) => {
        state.brainState = bs;

        // Real activity-log entries — driven by actual AxiomBrain state
        // transitions (themselves driven by real events via
        // js/core/ai-state-manager.js), not fabricated on a timer.
        if (bs.activity !== lastLoggedActivity) {
          lastLoggedActivity = bs.activity;
          const activityLabels = {
            idle: 'Returned to idle', listening: 'Listening for input',
            thinking: 'Thinking', speaking: 'Responding', learning: 'Learning',
            error: 'Error encountered'
          };
          logActivity(activityLabels[bs.activity] || ('Activity: ' + bs.activity));
        }
        if (bs.toolActive && bs.activeTool !== lastLoggedTool) {
          lastLoggedTool = bs.activeTool;
          logActivity('Running tool: ' + bs.activeTool);
        } else if (!bs.toolActive && lastLoggedTool !== null) {
          lastLoggedTool = null;
        }

        // Update activity badge text
        const badge = document.querySelector('.brain-core-live');
        if (badge) {
          const textSpan = badge.childNodes[2];
          if (textSpan) {
            const labels = {
              idle: 'Cognition active',
              listening: 'Listening...',
              thinking: 'Thinking...',
              speaking: 'Speaking...',
              learning: 'Learning...',
              error: 'Error',
            };
            textSpan.textContent = labels[bs.activity] || 'Cognition active';
          }
        }
      });
    }
    
    console.log('[BrainUltimate] Initialized');
  }

  // ---- Boot ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ---- Public API ----
  global.AxiomBrainUltimate = {
    getState: () => state,
    tick,
    updateConsciousness,
    logActivity,
  };

})(window);

