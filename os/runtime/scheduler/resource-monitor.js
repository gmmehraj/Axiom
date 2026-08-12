// ============================================================
// AXIOM AI OS — Milestone 11: Resource Monitoring API
// ------------------------------------------------------------
// Objective 6: "Add resource monitoring APIs for agent activity,
// queue depth, task counts, latency, and available browser
// performance metrics."
//
// The Runtime Monitor (Milestone 8) already computes per-agent queue
// depth, task counters, and processing-time (avg/p95) latency from
// real task:started/completed/failed events. This module does not
// re-derive any of that — it is a thin AGGREGATOR that composes:
//   - AxiomRuntimeMonitor.report()   -> queue depth, task counts, latency
//   - AxiomAgentManager.snapshot()   -> live agent activity/health
//   - AxiomTaskScheduler.report()    -> scheduler-level queue depth/counts
//   - window.performance             -> actual browser performance metrics
// into one call, plus adds the ONE thing genuinely missing: browser
// performance metrics (memory, navigation/paint timing, frame rate).
//
// Reuses:
//   - AxiomRuntimeMonitor (Milestone 8) — not duplicated, only read.
//   - AxiomAgentManager (Milestone 4) — not duplicated, only read.
//   - AxiomTaskScheduler (Milestone 11) — not duplicated, only read.
//
// Public surface — window.AxiomResourceMonitor:
//   .report()                 -> full aggregated snapshot (synchronous)
//   .browserMetrics()         -> just the browser performance section
//   .sampleFrameRate(ms?, cb) -> async FPS sample over `ms` (default 1000)
// ============================================================
window.AxiomResourceMonitor = (function () {
  'use strict';

  var MGR = window.AxiomAgentManager;
  var MON = window.AxiomRuntimeMonitor;
  if (!MGR || !MON) {
    AxLogger.error('[AxiomResourceMonitor] requires agent-manager.js and the Milestone 8 runtime-monitor.js loaded first.');
    return null;
  }

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  // Best-effort, synchronous browser performance snapshot. Every field
  // degrades to null rather than throwing when the API isn't available
  // (jsdom/test harnesses, older browsers, or a locked-down embed) — the
  // brief says "available browser performance metrics", not "guaranteed".
  function browserMetrics() {
    var perf = (typeof window !== 'undefined') ? window.performance : null;
    var out = { now: safe(function () { return perf ? perf.now() : null; }, null), memory: null, navigation: null, paint: [] };
    if (!perf) return out;

    if (perf.memory) {
      out.memory = safe(function () {
        return {
          usedJSHeapSize: perf.memory.usedJSHeapSize,
          totalJSHeapSize: perf.memory.totalJSHeapSize,
          jsHeapSizeLimit: perf.memory.jsHeapSizeLimit
        };
      }, null);
    }

    out.navigation = safe(function () {
      if (typeof perf.getEntriesByType !== 'function') return null;
      var nav = perf.getEntriesByType('navigation')[0];
      if (!nav) return null;
      return { domContentLoaded: nav.domContentLoadedEventEnd, loadEvent: nav.loadEventEnd, ttfb: nav.responseStart };
    }, null);

    out.paint = safe(function () {
      if (typeof perf.getEntriesByType !== 'function') return [];
      return perf.getEntriesByType('paint').map(function (p) { return { name: p.name, startTime: p.startTime }; });
    }, []);

    return out;
  }

  // Frame rate is inherently async (it needs to observe real frames), so
  // it is a separate opt-in call rather than part of the synchronous
  // report() — a caller polling report() every few seconds should never
  // pay for a rAF sampling window it didn't ask for.
  function sampleFrameRate(ms, cb) {
    var duration = typeof ms === 'number' ? ms : 1000;
    if (typeof requestAnimationFrame !== 'function') {
      var result = { supported: false, fps: null };
      if (cb) cb(result);
      return Promise.resolve(result);
    }
    return new Promise(function (resolve) {
      var frames = 0;
      var start = performance.now();
      function step(t) {
        frames += 1;
        if (t - start < duration) {
          requestAnimationFrame(step);
        } else {
          var result = { supported: true, fps: Math.round((frames * 1000) / (t - start)) };
          if (cb) cb(result);
          resolve(result);
        }
      }
      requestAnimationFrame(step);
    });
  }

  function report() {
    var monitorReport = MON.report();
    var agentSnapshot = MGR.snapshot();
    var schedulerReport = window.AxiomTaskScheduler ? window.AxiomTaskScheduler.report() : null;

    return {
      at: Date.now(),
      agentActivity: {
        total: agentSnapshot.count,
        health: monitorReport.health,
        activeAgents: monitorReport.activeAgents,
        agents: agentSnapshot.agents.map(function (a) {
          return { id: a.id, status: a.status, queued: a.queued, current: a.current, processed: a.stats.processed, failed: a.stats.failed };
        })
      },
      queueDepth: monitorReport.queueSizes,
      taskCounts: monitorReport.taskCounters,
      latency: monitorReport.processingTime,
      scheduler: schedulerReport,
      browser: browserMetrics()
    };
  }

  return { report: report, browserMetrics: browserMetrics, sampleFrameRate: sampleFrameRate };
})();
