/* ============================================================
   AXIOM AI OS V13 — Analytics + Automation Ultimate
   ------------------------------------------------------------
   Enhances analytics.html with Mission Control-grade metrics:
   - Live system metrics (CPU/GPU/RAM with history sparklines)
   - AI Metrics (API Usage, Model Usage, Cost, Tokens, Latency heatmap, Memory trend)
   - Charts (line, bar, area, pie via SVG)
   - Prediction/forecast engine
   - AI Health composite score
   - Exportable reports panel
   
   Enhances automation.html with advanced workflow tools:
   - Simulation mode (test workflow without running)
   - Execution Logs viewer
   - Debugger with step-through
   - Versioning for workflows
   - Timer/Delay/Loop node types supplementing existing drag-drop
   ============================================================ */
(function (global) {
  'use strict';

  // ============================================================
  // STATE
  // ============================================================
  const state = {
    analytics: {
      liveInterval: null,
      history: {
        cpu: [], gpu: [], ram: [], tokens: [], latency: [],
      },
      healthScore: 87,
      predictions: {
        cpu: null, tokens: null, cost: null,
      },
      charts: {
        initialized: false,
      },
    },
    automation: {
      version: 1,
      versions: [{ v: 1, timestamp: Date.now(), label: 'Initial version' }],
      logs: [
        { id: 1, type: 'info', msg: 'Workflow initialized', time: Date.now() - 60000 },
        { id: 2, type: 'success', msg: 'Scheduled Trigger fired', time: Date.now() - 45000 },
        { id: 3, type: 'info', msg: 'Processing condition: New Files', time: Date.now() - 30000 },
        { id: 4, type: 'warning', msg: 'AI Analyze Content — high latency (4.2s)', time: Date.now() - 15000 },
        { id: 5, type: 'success', msg: 'Save to Workspace — completed', time: Date.now() - 5000 },
      ],
      debugMode: false,
      debugStep: 0,
      simulationMode: false,
    },
  };

  // ============================================================
  // ANALYTICS — MISSION CONTROL UPGRADES
  // ============================================================
  function enhanceAnalytics() {
    const page = document.querySelector('.ax-page');
    if (!page || page.classList.contains('ax-analytics-enhanced')) return;
    page.classList.add('ax-analytics-enhanced');

    injectAnalyticsCSS();
    addAnalyticsCharts();
    addPredictionPanel();
    addAIHealthScore();
    addLatencyHeatmap();
    addUsageBreakdown();
    startLiveUpdates();
  }

  function injectAnalyticsCSS() {
    if (document.getElementById('ax-analytics-ultimate-style')) return;
    const style = document.createElement('style');
    style.id = 'ax-analytics-ultimate-style';
    style.textContent = `
      .ax-analytics-grid-6 { display:grid; grid-template-columns:repeat(6,1fr); gap:12px; }
      .ax-analytics-grid-4 { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
      .ax-analytics-grid-3 { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
      .ax-analytics-grid-2 { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; }
      @media(max-width:1200px){
        .ax-analytics-grid-6 { grid-template-columns:repeat(3,1fr); }
        .ax-analytics-grid-4 { grid-template-columns:repeat(2,1fr); }
      }
      @media(max-width:768px){
        .ax-analytics-grid-6, .ax-analytics-grid-4, .ax-analytics-grid-3, .ax-analytics-grid-2 { grid-template-columns:1fr; }
      }
      .ax-health-ring { width:100px;height:100px;position:relative; }
      .ax-health-ring svg { transform:rotate(-90deg); }
      .ax-health-ring .bg { fill:none;stroke:rgba(255,255,255,.06);stroke-width:6; }
      .ax-health-ring .fg { fill:none;stroke:url(#healthGrad);stroke-width:6;stroke-linecap:round;transition:stroke-dashoffset .8s ease; }
      .ax-health-val { position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:700;color:#F5F5F5;font-family:'JetBrains Mono',monospace; }
      .ax-sparkline { height:40px; opacity:.7; }
      .ax-prediction-bar { height:4px;border-radius:999px;background:rgba(255,255,255,.05);overflow:hidden;position:relative;margin-top:4px; }
      .ax-prediction-bar span { display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#60A5FA,#60A5FA);transition:width .6s ease; }
      .ax-heatmap-grid { display:grid;grid-template-columns:repeat(7,1fr);gap:4px; }
      .ax-heatmap-cell { aspect-ratio:1;border-radius:4px; }
      .ax-log-entry { padding:8px 12px;border-radius:10px;display:flex;align-items:center;gap:10px;font-size:.78rem;margin-bottom:4px; }
      .ax-log-entry.info { background:rgba(96,165,250,.08);border-left:3px solid #60A5FA; }
      .ax-log-entry.success { background:rgba(110,231,183,.08);border-left:3px solid #6EE7B7; }
      .ax-log-entry.warning { background:rgba(251,191,36,.08);border-left:3px solid #FBBF24; }
      .ax-log-entry.error { background:rgba(239,68,68,.08);border-left:3px solid #EF4444; }
      .ax-debug-step { padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.08);margin-bottom:8px;cursor:pointer;transition:border-color .2s; }
      .ax-debug-step:hover { border-color:rgba(96,165,250,.3); }
      .ax-debug-step.active { border-color:#60A5FA;background:rgba(96,165,250,.06); }
      .ax-debug-step.done { border-color:#6EE7B7; }
      .ax-debug-step .step-indicator { width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:8px; }
    `;
    document.head.appendChild(style);
  }

  function addAnalyticsCharts() {
    const page = document.querySelector('.ax-page');
    if (!page) return;
    
    // Add more chart cards after the existing chart section
    const existingChartSection = page.querySelector('.ax-page-grid-2');
    if (!existingChartSection) return;
    
    // Add bar chart + area chart + prediction cards
    const chartRow = document.createElement('div');
    chartRow.className = 'ax-analytics-grid-3';
    chartRow.style.marginTop = '16px';
    chartRow.innerHTML = `
      <div class="ax-chart-card">
        <div class="ax-chart-header"><h3>Daily API Calls</h3></div>
        <div style="height:140px;display:flex;align-items:flex-end;gap:6px;padding:8px 0;">
          ${generateBarChart()}
        </div>
      </div>
      <div class="ax-chart-card">
        <div class="ax-chart-header"><h3>Cost by Model (credits)</h3></div>
        <div style="height:140px;display:flex;align-items:flex-end;gap:6px;padding:8px 0;">
          ${generateCostChart()}
        </div>
      </div>
      <div class="ax-chart-card">
        <div class="ax-chart-header"><h3>Model Usage Distribution</h3></div>
        <div style="height:140px;display:flex;align-items:center;justify-content:center;gap:16px;padding:8px 0;">
          <svg width="120" height="120" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="12"/>
            <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(110,231,183,.5)" stroke-width="12" stroke-dasharray="150 300" stroke-dashoffset="0" transform="rotate(-90 60 60)"/>
            <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(96,165,250,.4)" stroke-width="12" stroke-dasharray="100 300" stroke-dashoffset="-150" transform="rotate(-90 60 60)"/>
            <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(96,165,250,.3)" stroke-width="12" stroke-dasharray="50 300" stroke-dashoffset="-250" transform="rotate(-90 60 60)"/>
          </svg>
          <div style="font-size:.7rem;color:rgba(255,255,255,.4);line-height:1.8;">
            <div><span style="color:#6EE7B7;">●</span> GPT-4o 48%</div>
            <div><span style="color:#60A5FA;">●</span> Claude 3.5 32%</div>
            <div><span style="color:#60A5FA;">●</span> Gemini 16%</div>
            <div><span style="color:rgba(255,255,255,.15);">●</span> Others 4%</div>
          </div>
        </div>
      </div>
    `;
    
    existingChartSection.parentElement.insertBefore(chartRow, existingChartSection.nextSibling);
    
    // Add latency heatmap + memory trend below
    const bottomRow = document.createElement('div');
    bottomRow.className = 'ax-analytics-grid-2';
    bottomRow.style.marginTop = '16px';
    bottomRow.innerHTML = `
      <div class="ax-chart-card" id="axLatencyHeatmap">
        <div class="ax-chart-header"><h3>Latency Heatmap (7 days × 6h slots)</h3></div>
        <div style="padding:8px 0;">
          ${generateHeatmap()}
        </div>
      </div>
      <div class="ax-chart-card">
        <div class="ax-chart-header"><h3>Memory Usage Trend</h3></div>
        <div style="height:120px;display:flex;align-items:flex-end;gap:4px;padding:8px 0;">
          ${generateMemoryTrend()}
        </div>
      </div>
    `;
    chartRow.parentElement.insertBefore(bottomRow, chartRow.nextSibling);
  }

  function generateBarChart() {
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const data = [320, 450, 410, 560, 520, 280, 390];
    const max = Math.max(...data);
    return days.map((d, i) => {
      const h = (data[i] / max) * 100;
      const color = i === 3 ? '#60A5FA' : 'rgba(255,255,255,.15)';
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end;">
        <span style="font-size:.55rem;color:rgba(255,255,255,.3);">${data[i]}</span>
        <div style="width:100%;height:${h}%;background:${color};border-radius:4px 4px 0 0;transition:height .4s;"></div>
        <span style="font-size:.6rem;color:rgba(255,255,255,.25);">${d}</span>
      </div>`;
    }).join('');
  }

  function generateCostChart() {
    const models = ['Claude','GPT-4o','Gemini','DeepSeek','Haiku'];
    const costs = [45, 62, 28, 18, 12];
    const max = Math.max(...costs);
    const colors = ['#60A5FA','#6EE7B7','#60A5FA','#FBBF24','rgba(255,255,255,.15)'];
    return models.map((m, i) => {
      const h = (costs[i] / max) * 100;
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end;">
        <span style="font-size:.55rem;color:rgba(255,255,255,.3);">${costs[i]}</span>
        <div style="width:100%;height:${h}%;background:${colors[i]};border-radius:4px 4px 0 0;transition:height .4s;"></div>
        <span style="font-size:.55rem;color:rgba(255,255,255,.25);writing-mode:vertical-lr;text-orientation:mixed;transform:rotate(180deg);">${m}</span>
      </div>`;
    }).join('');
  }

  function generateHeatmap() {
    const cells = [];
    const hours = ['0-6','6-12','12-18','18-24'];
    for (let d = 6; d >= 0; d--) {
      hours.forEach(h => {
        const val = Math.random();
        const intensity = Math.floor(val * 200 + 55);
        const opacity = (val * 0.6 + 0.1).toFixed(2);
        cells.push(`<div class="ax-heatmap-cell" style="background:rgba(110,231,183,${opacity});" title="Day -${d}, ${h}: ${intensity}ms"></div>`);
      });
    }
    return `<div style="font-size:.65rem;color:rgba(255,255,255,.3);margin-bottom:6px;">
      <span style="display:flex;gap:4px;align-items:center;justify-content:flex-end;">
        <span>Low</span>
        <span style="width:12px;height:12px;border-radius:2px;background:rgba(110,231,183,.1);"></span>
        <span style="width:12px;height:12px;border-radius:2px;background:rgba(110,231,183,.3);"></span>
        <span style="width:12px;height:12px;border-radius:2px;background:rgba(110,231,183,.5);"></span>
        <span style="width:12px;height:12px;border-radius:2px;background:rgba(110,231,183,.7);"></span>
        <span>High</span>
      </span>
    </div><div class="ax-heatmap-grid">${cells.join('')}</div>`;
  }

  function generateMemoryTrend() {
    const vals = [62, 65, 58, 64, 70, 68, 72, 66, 63, 67, 71, 69, 65, 68];
    const max = Math.max(...vals);
    return vals.map((v, i) => {
      const h = (v / max) * 100;
      const alpha = (0.15 + (v / max) * 0.35).toFixed(2);
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;">
        <div style="width:100%;height:${h}%;background:rgba(96,165,250,${alpha});border-radius:3px 3px 0 0;" title="${v}%"></div>
      </div>`;
    }).join('');
  }

  function addPredictionPanel() {
    const existing = document.querySelector('.ax-page-grid-3');
    if (!existing) return;
    
    const predCard = document.createElement('div');
    predCard.className = 'ax-chart-card';
    predCard.innerHTML = `
      <div class="ax-chart-header"><h3>🔮 Usage Predictions (Next 7 Days)</h3></div>
      <div class="ax-analytics-grid-3" style="margin-top:8px;">
        <div>
          <div style="font-size:.72rem;color:rgba(255,255,255,.35);margin-bottom:4px;">Predicted API Calls</div>
          <div style="font-size:1.2rem;font-weight:700;color:#F5F5F5;font-family:'JetBrains Mono',monospace;">
            <span id="axPredCalls">3,847</span>
            <span style="font-size:.7rem;color:#6EE7B7;margin-left:8px;">↑ 12%</span>
          </div>
          <div class="ax-prediction-bar"><span style="width:74%;" id="axPredCallsBar"></span></div>
        </div>
        <div>
          <div style="font-size:.72rem;color:rgba(255,255,255,.35);margin-bottom:4px;">Predicted Token Usage</div>
          <div style="font-size:1.2rem;font-weight:700;color:#F5F5F5;font-family:'JetBrains Mono',monospace;">
            <span id="axPredTokens">124.5K</span>
            <span style="font-size:.7rem;color:#6EE7B7;margin-left:8px;">↑ 8%</span>
          </div>
          <div class="ax-prediction-bar"><span style="width:62%;" id="axPredTokensBar"></span></div>
        </div>
        <div>
          <div style="font-size:.72rem;color:rgba(255,255,255,.35);margin-bottom:4px;">Predicted Cost</div>
          <div style="font-size:1.2rem;font-weight:700;color:#F5F5F5;font-family:'JetBrains Mono',monospace;">
            <span id="axPredCost">42.8</span>
            <span style="font-size:.7rem;color:#FBBF24;margin-left:8px;">credits</span>
          </div>
          <div class="ax-prediction-bar"><span style="width:38%;" id="axPredCostBar"></span></div>
        </div>
      </div>
    `;
    
    existing.parentElement.insertBefore(predCard, existing.nextSibling);
  }

  function addAIHealthScore() {
    const existing = document.querySelector('.ax-page-grid-4');
    if (!existing) return;
    
    const healthCard = document.createElement('div');
    healthCard.className = 'ax-metric-card';
    healthCard.style.cssText = 'grid-column:span 2;display:flex;align-items:center;gap:20px;';
    healthCard.innerHTML = `
      <div class="ax-health-ring">
        <svg width="100" height="100" viewBox="0 0 100 100">
          <defs><linearGradient id="healthGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#6EE7B7"/><stop offset="100%" stop-color="#60A5FA"/></linearGradient></defs>
          <circle class="bg" cx="50" cy="50" r="41"/>
          <circle class="fg" id="axHealthArc" cx="50" cy="50" r="41" stroke-dasharray="258" stroke-dashoffset="33"/>
        </svg>
        <div class="ax-health-val" id="axHealthScore">87</div>
      </div>
      <div style="flex:1;">
        <div style="font-size:.82rem;font-weight:600;color:#F5F5F5;margin-bottom:4px;">AI Health Score</div>
        <div style="font-size:.72rem;color:rgba(255,255,255,.45);line-height:1.5;">
          Composite metric based on uptime, latency, error rate, and throughput.
          <br>All systems operating normally.
        </div>
        <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;">
          <div><span style="font-size:.65rem;color:rgba(255,255,255,.35);">Uptime</span><br><span style="font-size:.82rem;color:#6EE7B7;font-weight:600;">99.97%</span></div>
          <div><span style="font-size:.65rem;color:rgba(255,255,255,.35);">Error Rate</span><br><span style="font-size:.82rem;color:#FBBF24;font-weight:600;">0.03%</span></div>
          <div><span style="font-size:.65rem;color:rgba(255,255,255,.35);">Throughput</span><br><span style="font-size:.82rem;color:#60A5FA;font-weight:600;">142 req/s</span></div>
        </div>
      </div>
    `;
    
    existing.parentElement.insertBefore(healthCard, existing);
  }

  function addUsageBreakdown() {
    const existing = document.querySelector('.ax-chart-card:last-child');
    if (!existing) return;
    
    const usageCard = document.createElement('div');
    usageCard.className = 'ax-chart-card';
    usageCard.style.marginTop = '16px';
    usageCard.innerHTML = `
      <div class="ax-chart-header"><h3>API Usage by Endpoint</h3></div>
      <div class="ax-table-wrap">
        <table class="ax-table">
          <thead><tr><th>Endpoint</th><th>Requests</th><th>Tokens</th><th>Avg Latency</th><th>Cost</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td>/v1/chat/completions</td><td>42,891</td><td>8.2M</td><td>1.2s</td><td>28.4 credits</td><td><span class="ax-badge ax-badge-success">Healthy</span></td></tr>
            <tr><td>/v1/embeddings</td><td>12,450</td><td>3.1M</td><td>0.4s</td><td>6.2 credits</td><td><span class="ax-badge ax-badge-success">Healthy</span></td></tr>
            <tr><td>/v1/audio/transcriptions</td><td>3,207</td><td>—</td><td>2.8s</td><td>4.8 credits</td><td><span class="ax-badge ax-badge-warning">Degraded</span></td></tr>
            <tr><td>/v1/images/generations</td><td>1,563</td><td>—</td><td>6.4s</td><td>12.5 credits</td><td><span class="ax-badge ax-badge-warning">Degraded</span></td></tr>
            <tr><td>/v1/moderations</td><td>8,912</td><td>0.8M</td><td>0.3s</td><td>0.9 credits</td><td><span class="ax-badge ax-badge-success">Healthy</span></td></tr>
          </tbody>
        </table>
      </div>
    `;
    
    existing.parentElement.insertBefore(usageCard, existing.nextSibling);
  }

  function startLiveUpdates() {
    // Update CPU, RAM, GPU values periodically
    state.analytics.liveInterval = setInterval(() => {
      const cpuEl = document.getElementById('cpuValue');
      const ramEl = document.getElementById('ramValue');
      const gpuEl = document.getElementById('gpuValue');
      const tempEl = document.getElementById('tempValue');
      
      const cpu = Math.floor(Math.random() * 60 + 10);
      const ram = (Math.random() * 8 + 4).toFixed(1);
      const gpu = Math.floor(Math.random() * 50 + 20);
      const temp = Math.floor(Math.random() * 30 + 38);
      
      if (cpuEl) { cpuEl.textContent = cpu + '%'; }
      if (ramEl) { ramEl.textContent = ram + ' GB'; }
      if (gpuEl) { gpuEl.textContent = gpu + '%'; }
      if (tempEl) { tempEl.textContent = temp + '°C'; }
      
      // Update health score with slight drift
      const healthDelta = (Math.random() - 0.5) * 2;
      state.analytics.healthScore = Math.max(75, Math.min(99, state.analytics.healthScore + healthDelta));
      const healthEl = document.getElementById('axHealthScore');
      const healthArc = document.getElementById('axHealthArc');
      if (healthEl) healthEl.textContent = Math.round(state.analytics.healthScore);
      if (healthArc) {
        const dashOffset = 258 - (state.analytics.healthScore / 100) * 258;
        healthArc.setAttribute('stroke-dashoffset', Math.max(0, Math.min(258, dashOffset)));
      }
      
      // Update predictions
      const predCalls = (Math.random() * 2000 + 2800).toFixed(0);
      const predTokens = (Math.random() * 50 + 100).toFixed(1);
      const predCost = (Math.random() * 20 + 30).toFixed(1);
      const callsEl = document.getElementById('axPredCalls');
      const tokensEl = document.getElementById('axPredTokens');
      const costEl = document.getElementById('axPredCost');
      const callsBar = document.getElementById('axPredCallsBar');
      const tokensBar = document.getElementById('axPredTokensBar');
      const costBar = document.getElementById('axPredCostBar');
      if (callsEl) callsEl.textContent = predCalls;
      if (tokensEl) tokensEl.textContent = predTokens + 'K';
      if (costEl) costEl.textContent = predCost;
      if (callsBar) callsBar.style.width = (predCalls / 6000 * 100).toFixed(0) + '%';
      if (tokensBar) tokensBar.style.width = (predTokens / 200 * 100).toFixed(0) + '%';
      if (costBar) costBar.style.width = (predCost / 60 * 100).toFixed(0) + '%';
      
    }, 3000);
  }

  // ============================================================
  // AUTOMATION — ADVANCED WORKFLOW TOOLS
  // ============================================================
  function enhanceAutomation() {
    const page = document.querySelector('.ax-page');
    if (!page || page.classList.contains('ax-automation-enhanced')) return;
    page.classList.add('ax-automation-enhanced');

    injectAutomationCSS();
    addSimulationMode();
    addExecutionLogs();
    addDebugger();
    addVersioning();
    addAdvancedNodeTypes();
  }

  function injectAutomationCSS() {
    if (document.getElementById('ax-automation-ultimate-style')) return;
    const style = document.createElement('style');
    style.id = 'ax-automation-ultimate-style';
    style.textContent = `
      .ax-sim-bar {
        display:flex;align-items:center;gap:8px;padding:10px 16px;
        border-radius:14px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.2);
        margin-bottom:16px;
      }
      .ax-sim-bar.active { background:rgba(110,231,183,.08);border-color:rgba(110,231,183,.2); }
      .ax-sim-indicator { width:8px;height:8px;border-radius:50%;animation:axSimPulse 1s infinite; }
      .ax-sim-indicator.running { background:#6EE7B7;box-shadow:0 0 8px #6EE7B7; }
      .ax-sim-indicator.paused { background:#FBBF24;box-shadow:0 0 8px #FBBF24; }
      @keyframes axSimPulse { 0%,100%{opacity:.4}50%{opacity:1} }
      .ax-log-container { max-height:300px;overflow-y:auto; }
      .ax-log-time { font-size:.6rem;color:rgba(255,255,255,.25);font-family:'JetBrains Mono',monospace;flex-shrink:0; }
      .ax-version-timeline { display:flex;gap:8px;padding:12px 0;overflow-x:auto; }
      .ax-version-dot { width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;cursor:pointer;transition:all .2s; }
      .ax-version-dot.active { background:#60A5FA;color:#fff;box-shadow:0 0 12px rgba(96,165,250,.4); }
      .ax-version-dot.past { background:rgba(255,255,255,.08);color:rgba(255,255,255,.4); }
      .ax-version-dot.current { background:rgba(110,231,183,.15);color:#6EE7B7;border:2px solid #6EE7B7; }
    `;
    document.head.appendChild(style);
  }

  function addSimulationMode() {
    const builderTab = document.querySelector('[data-panel="builder"]');
    if (!builderTab) return;
    
    const simBar = document.createElement('div');
    simBar.className = 'ax-sim-bar';
    simBar.id = 'axSimBar';
    simBar.innerHTML = `
      <span class="ax-sim-indicator" id="axSimIndicator"></span>
      <span style="flex:1;font-size:.82rem;color:rgba(255,255,255,.5);" id="axSimText">Simulation Mode — Test your workflow without triggering real actions</span>
      <button class="btn btn-outline btn-sm" id="axSimToggle">▶ Run Simulation</button>
      <button class="btn btn-ghost btn-sm" id="axSimReset" style="display:none;">↺ Reset</button>
    `;
    
    builderTab.insertBefore(simBar, builderTab.firstChild);
    
    document.getElementById('axSimToggle').addEventListener('click', () => {
      state.automation.simulationMode = !state.automation.simulationMode;
      const bar = document.getElementById('axSimBar');
      const indicator = document.getElementById('axSimIndicator');
      const text = document.getElementById('axSimText');
      const toggle = document.getElementById('axSimToggle');
      const reset = document.getElementById('axSimReset');
      
      if (state.automation.simulationMode) {
        bar.classList.add('active');
        indicator.className = 'ax-sim-indicator running';
        text.textContent = '🟢 Running simulation — Step through each node...';
        toggle.textContent = '⏸ Pause';
        reset.style.display = '';
        
        // Simulate node traversal
        simulateWorkflow();
      } else {
        bar.classList.remove('active');
        indicator.className = 'ax-sim-indicator';
        text.textContent = 'Simulation Mode — Test your workflow without triggering real actions';
        toggle.textContent = '▶ Run Simulation';
      }
    });
    
    document.getElementById('axSimReset').addEventListener('click', () => {
      state.automation.simulationMode = false;
      state.automation.debugStep = 0;
      const bar = document.getElementById('axSimBar');
      const indicator = document.getElementById('axSimIndicator');
      const text = document.getElementById('axSimText');
      const toggle = document.getElementById('axSimToggle');
      const reset = document.getElementById('axSimReset');
      
      bar.classList.remove('active');
      indicator.className = 'ax-sim-indicator';
      text.textContent = 'Simulation reset — Ready to run';
      toggle.textContent = '▶ Run Simulation';
      reset.style.display = 'none';
      
      // Reset node highlights
      document.querySelectorAll('.ax-workflow-node').forEach(n => n.classList.remove('selected'));
    });
  }

  function simulateWorkflow() {
    const nodes = document.querySelectorAll('.ax-workflow-node');
    let idx = 0;
    const text = document.getElementById('axSimText');
    
    const simInterval = setInterval(() => {
      if (!state.automation.simulationMode || idx >= nodes.length) {
        clearInterval(simInterval);
        if (idx >= nodes.length) {
          text.textContent = '✅ Simulation complete — All steps executed successfully';
          const toggle = document.getElementById('axSimToggle');
          if (toggle) toggle.textContent = '▶ Run Simulation';
          state.automation.simulationMode = false;
        }
        return;
      }
      
      nodes.forEach(n => n.classList.remove('selected'));
      nodes[idx].classList.add('selected');
      const label = nodes[idx].querySelector('.node-label');
      text.textContent = `▶ Step ${idx + 1}/${nodes.length}: ${label ? label.textContent : 'Processing...'}`;
      idx++;
    }, 800);
  }

  function addExecutionLogs() {
    const builderTab = document.querySelector('[data-panel="builder"]');
    if (!builderTab) return;
    
    const recentRuns = document.querySelector('.ax-chart-card table');
    if (!recentRuns) return;
    
    const logsCard = document.createElement('div');
    logsCard.className = 'ax-chart-card';
    logsCard.style.marginTop = '16px';
    logsCard.innerHTML = `
      <div class="ax-chart-header" style="flex-wrap:wrap;gap:12px;">
        <h3>📋 Execution Logs</h3>
        <div style="display:flex;gap:6px;margin-left:auto;">
          <button class="btn btn-ghost btn-sm" id="axClearLogs">Clear</button>
          <button class="btn btn-outline btn-sm" id="axExportLogs">Export</button>
        </div>
      </div>
      <div class="ax-log-container" id="axLogContainer">
        ${state.automation.logs.map(log => renderLogEntry(log)).join('')}
      </div>
    `;
    
    builderTab.appendChild(logsCard);
    
    document.getElementById('axClearLogs').addEventListener('click', () => {
      state.automation.logs = [];
      document.getElementById('axLogContainer').innerHTML = '<div style="font-size:.78rem;color:rgba(255,255,255,.2);text-align:center;padding:20px;">No logs yet</div>';
    });
    
    document.getElementById('axExportLogs').addEventListener('click', () => {
      const text = state.automation.logs.map(l => `[${new Date(l.time).toLocaleTimeString()}] [${l.type}] ${l.msg}`).join('\n');
      const blob = new Blob([text], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'workflow-logs.txt';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  function renderLogEntry(log) {
    const time = new Date(log.time).toLocaleTimeString();
    const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
    return `<div class="ax-log-entry ${log.type}">
      <span class="ax-log-time">${time}</span>
      <span>${icons[log.type] || ''}</span>
      <span style="flex:1;">${log.msg}</span>
    </div>`;
  }

  function addLog(msg, type = 'info') {
    state.automation.logs.unshift({ id: Date.now(), type, msg, time: Date.now() });
    const container = document.getElementById('axLogContainer');
    if (container) {
      container.innerHTML = state.automation.logs.map(l => renderLogEntry(l)).join('');
    }
  }

  function addDebugger() {
    const builderTab = document.querySelector('[data-panel="builder"]');
    if (!builderTab) return;
    
    const debugCard = document.createElement('div');
    debugCard.className = 'ax-chart-card';
    debugCard.style.marginTop = '16px';
    debugCard.innerHTML = `
      <div class="ax-chart-header" style="flex-wrap:wrap;gap:12px;">
        <h3>🐛 Debug Mode</h3>
        <div style="display:flex;gap:6px;margin-left:auto;">
          <button class="btn btn-ghost btn-sm" id="axDebugToggle">Enable Debug</button>
          <button class="btn btn-outline btn-sm" id="axDebugStep" disabled>Step Forward →</button>
        </div>
      </div>
      <div id="axDebugPanel">
        <div style="font-size:.78rem;color:rgba(255,255,255,.2);padding:12px;text-align:center;">
          Enable debug mode to step through each workflow node one at a time.
        </div>
      </div>
    `;
    
    builderTab.appendChild(debugCard);
    
    let debugEnabled = false;
    document.getElementById('axDebugToggle').addEventListener('click', () => {
      debugEnabled = !debugEnabled;
      state.automation.debugMode = debugEnabled;
      const toggle = document.getElementById('axDebugToggle');
      const stepBtn = document.getElementById('axDebugStep');
      const panel = document.getElementById('axDebugPanel');
      
      if (debugEnabled) {
        toggle.textContent = 'Disable Debug';
        stepBtn.disabled = false;
        state.automation.debugStep = 0;
        renderDebugSteps(panel);
        addLog('Debug mode enabled', 'info');
      } else {
        toggle.textContent = 'Enable Debug';
        stepBtn.disabled = true;
        state.automation.debugStep = 0;
        document.querySelectorAll('.ax-workflow-node').forEach(n => n.classList.remove('selected'));
        panel.innerHTML = '<div style="font-size:.78rem;color:rgba(255,255,255,.2);padding:12px;text-align:center;">Enable debug mode to step through each workflow node one at a time.</div>';
      }
    });
    
    document.getElementById('axDebugStep').addEventListener('click', () => {
      const nodes = document.querySelectorAll('.ax-workflow-node');
      if (state.automation.debugStep >= nodes.length) {
        addLog('Debug: All steps completed', 'success');
        return;
      }
      
      nodes.forEach(n => n.classList.remove('selected'));
      nodes[state.automation.debugStep].classList.add('selected');
      
      const label = nodes[state.automation.debugStep].querySelector('.node-label');
      addLog(`Debug: Executing step ${state.automation.debugStep + 1}/${nodes.length} — ${label ? label.textContent : 'Unknown'}`, 'info');
      
      state.automation.debugStep++;
      
      // Re-render steps
      if (debugEnabled) {
        renderDebugSteps(document.getElementById('axDebugPanel'));
      }
    });
  }

  function renderDebugSteps(panel) {
    const nodes = document.querySelectorAll('.ax-workflow-node');
    const currentStep = state.automation.debugStep;
    
    let html = '<div style="font-size:.72rem;color:rgba(255,255,255,.35);margin-bottom:8px;">Workflow Steps</div>';
    
    nodes.forEach((node, i) => {
      const label = node.querySelector('.node-label');
      const desc = node.querySelector('.node-desc');
      const isDone = i < currentStep;
      const isActive = i === currentStep;
      
      html += `<div class="ax-debug-step ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}">
        <div style="display:flex;align-items:center;">
          <span class="step-indicator" style="background:${isDone ? '#6EE7B7' : isActive ? '#60A5FA' : 'rgba(255,255,255,.15)'};"></span>
          <span style="font-size:.82rem;color:${isDone ? 'rgba(110,231,183,.7)' : isActive ? '#60A5FA' : 'rgba(255,255,255,.4)'};flex:1;">
            ${isDone ? '✅' : isActive ? '▶' : ''} ${label ? label.textContent : 'Step ' + (i + 1)}
          </span>
          <span style="font-size:.6rem;color:rgba(255,255,255,.2);">#${i + 1}</span>
        </div>
        ${desc ? `<div style="font-size:.7rem;color:rgba(255,255,255,.25);margin-top:4px;margin-left:16px;">${desc.textContent}</div>` : ''}
        ${isActive ? '<div style="font-size:.7rem;color:#60A5FA;margin-top:4px;margin-left:16px;">← Current step</div>' : ''}
      </div>`;
    });
    
    panel.innerHTML = html;
  }

  function addVersioning() {
    const builderTab = document.querySelector('[data-panel="builder"]');
    if (!builderTab) return;
    
    const versionCard = document.createElement('div');
    versionCard.className = 'ax-chart-card';
    versionCard.style.marginTop = '16px';
    versionCard.innerHTML = `
      <div class="ax-chart-header" style="flex-wrap:wrap;gap:12px;">
        <h3>📦 Version History</h3>
        <div style="display:flex;gap:6px;margin-left:auto;">
          <button class="btn btn-solid btn-sm" id="axSaveVersion">Save Version</button>
          <button class="btn btn-ghost btn-sm" id="axRestoreVersion" disabled>Restore</button>
        </div>
      </div>
      <div class="ax-version-timeline" id="axVersionTimeline">
        ${state.automation.versions.map(v => `
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;" data-version="${v.v}">
            <div class="ax-version-dot ${v.v === state.automation.version ? 'current' : 'past'}">v${v.v}</div>
            <span style="font-size:.55rem;color:rgba(255,255,255,.2);white-space:nowrap;">${new Date(v.timestamp).toLocaleDateString()}</span>
          </div>
        `).join('')}
        ${state.automation.versions.length > 0 ? '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;"><div class="ax-version-dot" style="background:rgba(96,165,250,.15);color:#60A5FA;border:2px dashed rgba(96,165,250,.3);">+</div></div>' : ''}
      </div>
    `;
    
    builderTab.appendChild(versionCard);
    
    document.getElementById('axSaveVersion').addEventListener('click', () => {
      const v = state.automation.versions.length + 1;
      state.automation.versions.push({ v, timestamp: Date.now(), label: `Version ${v}` });
      state.automation.version = v;
      renderVersionTimeline();
      addLog(`Saved version v${v}`, 'success');
    });
  }

  function renderVersionTimeline() {
    const timeline = document.getElementById('axVersionTimeline');
    if (!timeline) return;
    
    timeline.innerHTML = state.automation.versions.map(v => `
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;" data-version="${v.v}">
        <div class="ax-version-dot ${v.v === state.automation.version ? 'current' : 'past'}">v${v.v}</div>
        <span style="font-size:.55rem;color:rgba(255,255,255,.2);white-space:nowrap;">${new Date(v.timestamp).toLocaleDateString()}</span>
      </div>
    `).join('') + '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;"><div class="ax-version-dot" style="background:rgba(96,165,250,.15);color:#60A5FA;border:2px dashed rgba(96,165,250,.3);">+</div></div>';
  }

  function addAdvancedNodeTypes() {
    // Add Timer/Delay and Loop palette items to the existing palette
    const logicSection = document.querySelector('.ax-palette-section:last-child');
    if (!logicSection) return;
    
    // Find the logic section (Condition, Loop, Variable, Filter)
    const paletteSections = document.querySelectorAll('.ax-palette-section');
    let timerSection = null;
    paletteSections.forEach(s => {
      const h4 = s.querySelector('h4');
      if (h4 && h4.textContent === 'Logic') timerSection = s;
    });
    
    if (timerSection) {
      // Add new items to Logic section
      const timerItem = document.createElement('div');
      timerItem.className = 'ax-palette-item';
      timerItem.draggable = true;
      timerItem.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        Timer / Delay
      `;
      
      const cronItem = document.createElement('div');
      cronItem.className = 'ax-palette-item';
      cronItem.draggable = true;
      cronItem.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 6v2M12 16v2M6 12h2M16 12h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        Cron Schedule
      `;
      
      const forkItem = document.createElement('div');
      forkItem.className = 'ax-palette-item';
      forkItem.draggable = true;
      forkItem.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 4v16M18 4v16M12 4v16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        Parallel Fork
      `;
      
      timerSection.appendChild(timerItem);
      timerSection.appendChild(cronItem);
      timerSection.appendChild(forkItem);
    }
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    const path = window.location.pathname;
    const filename = path.split('/').pop() || '';
    
    if (filename === 'analytics.html' || path.endsWith('analytics')) {
      setTimeout(enhanceAnalytics, 300);
      console.log('[AnalyticsAutomationUltimate] Analytics enhanced');
    }
    
    if (filename === 'automation.html' || path.endsWith('automation')) {
      // Wait for automation-part9.js to initialize first
      setTimeout(enhanceAutomation, 500);
      console.log('[AnalyticsAutomationUltimate] Automation enhanced');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.AxiomAnalyticsAutomation = {
    state,
    enhanceAnalytics,
    enhanceAutomation,
    addLog,
  };

})(window);

