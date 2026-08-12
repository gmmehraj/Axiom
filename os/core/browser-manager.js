// ============================================================
// AXIOM — Block 2 / Step 5 / Part 4: Browser Manager
// ------------------------------------------------------------
// Single public entry point for browser operations and automation.
//
// All browser operations initiated by callers, Automation Engine,
// Browser Agent, or External Bridges MUST route through BrowserManager.
//
// BrowserManager wraps AxiomBrowserEngine (os/core/browser-engine.js)
// and exposes:
//   - Navigation API (navigate, back, forward, refresh, stop, redirect, getCurrentUrl, getNavigationStatus)
//   - Session API (createSession, closeSession, restoreSession, switchSession, getActiveSession, getSessionMetadata)
//   - History API (readHistory, clearHistory, getRecentPages, getNavigationTimeline, getHistoryMetadata)
//   - Browser Events API (on, off, emit, with normalized browser events for Automation)
//   - Tab API (createTab, closeTab, switchTab, getActiveTab, listTabs, duplicateTab, reorderTabs)
//   - Metrics API (getMetrics, getStats)
//   - Execution Helper (executeBrowserOp)
//
// Explicitly NOT in this pass:
//   - No direct DOM / iframe manipulation (that remains in renderer browser-live.js)
//   - No OpenRouter / AI browsing (reserved for future AI passes)
// ============================================================
(function (global) {
  'use strict';

  var Engine = global.AxiomBrowserEngine;
  var Brain = global.AxiomBrain;
  var Memory = global.AxiomMemoryEngine;

  function log(method, message, detail) {
    var l = global.AxLogger;
    if (l && typeof l[method] === 'function') {
      l[method]('[BrowserManager] ' + message, detail !== undefined ? detail : '');
    }
  }

  /* ---------------- Part 6B: Standardized Error Envelope ----------------
   * Every BrowserManager entry point is wrapped so a thrown exception from
   * the Engine, Sandbox, Brain, or Memory layer can never propagate as an
   * uncaught exception / unhandled rejection to Automation, BrowserAgent,
   * or the renderer. safeCall() runs fn and, on throw, logs the failure
   * and returns a caller-supplied fallback value instead. errEnvelope()
   * produces the standardized shape used by executeBrowserOp and any call
   * site that already speaks in { ok, reason } objects.
   */
  function errEnvelope(code, reason, extra) {
    var env = { ok: false, code: code, reason: reason, error: reason };
    if (extra) {
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) env[k] = extra[k];
    }
    return env;
  }

  function safeCall(op, fn, fallback) {
    try {
      return fn();
    } catch (e) {
      log('error', 'Unhandled exception in "' + op + '"', e);
      emit('browser:error', { type: 'internal_error', op: op, reason: e && e.message ? e.message : String(e) });
      return typeof fallback === 'function' ? fallback(e) : fallback;
    }
  }

  /* ---------------- Event Bus & Subscriptions ---------------- */
  var listeners = new Set();
  var metrics = {
    totalNavigations: 0,
    successfulNavigations: 0,
    failedNavigations: 0,
    sessionsCreated: 0,
    sessionsClosed: 0,
    historyReads: 0,
    lastNavigationTime: null
  };
  var initTime = Date.now();

  /* ---------------- Part D: Diagnostics — Performance Tracking ----------
   * Lightweight, in-memory only (never persisted, never grows unbounded):
   * one open timestamp per in-flight tab navigation, plus a fixed-size
   * ring buffer of the last N completed navigation durations. This is
   * purely additive instrumentation around the existing Engine.onChange
   * handler below — it does not change any navigation behavior.
   */
  var PERF_SAMPLE_CAP = 50;
  var navStartTimes = new Map(); // tabId -> ms timestamp, cleared on settle
  var navDurations = []; // ring buffer of last PERF_SAMPLE_CAP durations (ms)
  var tabSwitchCount = 0;
  var sessionSwitchCount = 0;

  // Part 6B / Part A: browser timeout handling. The Engine already emits
  // navigation:completed / navigation:failed / navigation:cancelled to
  // settle a nav start time, but if the Engine (or a hung iframe/renderer)
  // never emits any settling event, navStartTimes would grow stale
  // entries forever and diagnostics() would keep reporting a phantom
  // in-flight navigation. getStaleNavigations() surfaces those without
  // mutating engine state, and sweepStaleNavigations() clears our own
  // bookkeeping (never the Engine's) and emits a browser:error so
  // Automation/UI can react — this is bookkeeping recovery only, not a
  // new cancellation feature.
  var NAV_TIMEOUT_MS = 30000;

  function getStaleNavigations(now) {
    now = now || Date.now();
    var stale = [];
    navStartTimes.forEach(function (startedAt, tabId) {
      if (now - startedAt > NAV_TIMEOUT_MS) {
        stale.push({ tabId: tabId, startedAt: startedAt, elapsedMs: now - startedAt });
      }
    });
    return stale;
  }

  function sweepStaleNavigations() {
    var stale = getStaleNavigations();
    stale.forEach(function (entry) {
      navStartTimes.delete(entry.tabId);
      metrics.failedNavigations++;
      emit('navigation:failed', { tabId: entry.tabId, reason: 'timeout' });
      emit('browser:error', { type: 'navigation_timeout', tabId: entry.tabId, elapsedMs: entry.elapsedMs });
    });
    return stale.length;
  }

  function recordNavDuration(ms) {
    navDurations.push(ms);
    if (navDurations.length > PERF_SAMPLE_CAP) navDurations.shift();
  }

  function emit(event, detail) {
    listeners.forEach(function (fn) {
      try {
        fn({ type: event, detail: detail, timestamp: Date.now() });
      } catch (e) {
        log('warn', 'Event listener error', e);
      }
    });
  }

  function on(eventOrFn, fn) {
    if (typeof eventOrFn === 'function') {
      listeners.add(eventOrFn);
      return function () { listeners.delete(eventOrFn); };
    }
    if (typeof fn === 'function') {
      var wrapper = function (evt) {
        if (evt.type === eventOrFn || eventOrFn === '*') {
          fn(evt.detail, evt);
        }
      };
      wrapper._orig = fn;
      listeners.add(wrapper);
      return function () { listeners.delete(wrapper); };
    }
    return function () {};
  }

  function off(fn) {
    listeners.forEach(function (l) {
      if (l === fn || l._orig === fn) {
        listeners.delete(l);
      }
    });
  }

  // Subscribe to underlying AxiomBrowserEngine changes to surface normalized events
  if (Engine && typeof Engine.onChange === 'function') {
    Engine.onChange(function (type, detail) {
      detail = detail || {};
      switch (type) {
        case 'navigation:started':
          metrics.totalNavigations++;
          metrics.lastNavigationTime = Date.now();
          if (detail.tabId) navStartTimes.set(detail.tabId, metrics.lastNavigationTime);
          emit('navigation:started', detail);
          emit('loading:progress', { phase: 'started', tabId: detail.tabId, url: detail.input });
          break;
        case 'navigation:completed':
          metrics.successfulNavigations++;
          if (detail.tabId && navStartTimes.has(detail.tabId)) {
            recordNavDuration(Date.now() - navStartTimes.get(detail.tabId));
            navStartTimes.delete(detail.tabId);
          }
          emit('navigation:completed', detail);
          emit('page:loaded', { tabId: detail.tabId, url: detail.url, title: detail.title });
          emit('loading:progress', { phase: 'completed', tabId: detail.tabId, url: detail.url });
          break;
        case 'navigation:failed':
        case 'navigation:cancelled':
          metrics.failedNavigations++;
          if (detail.tabId) navStartTimes.delete(detail.tabId);
          emit('navigation:failed', detail);
          emit('browser:error', { type: 'navigation_error', reason: detail.reason || 'cancelled', tabId: detail.tabId });
          emit('loading:progress', { phase: 'failed', tabId: detail.tabId, reason: detail.reason });
          break;
        case 'session:started':
        case 'session:activated':
        case 'session:ended':
        case 'session:restored':
          if (type === 'session:activated') sessionSwitchCount++;
          emit('session:changed', { action: type, sessionId: detail.sessionId || detail });
          break;
        case 'tab:created':
        case 'tab:switched':
        case 'tab:closed':
          if (type === 'tab:switched') tabSwitchCount++;
          if (type === 'tab:closed' && detail.tabId) navStartTimes.delete(detail.tabId);
          emit('tab:changed', { action: type, detail: detail });
          break;
        case 'lifecycle:phase':
          emit('loading:progress', detail);
          break;
        default:
          break;
      }
    });
  }

  /* ---------------- Active Session & Tab Resolvers ---------------- */
  function resolveSessionId(sid) {
    if (sid) return sid;
    return safeCall('resolveSessionId', function () {
      if (Engine && typeof Engine.getActiveSessionId === 'function') {
        return Engine.getActiveSessionId();
      }
      if (Engine && typeof Engine.getDefaultSessionId === 'function') {
        return Engine.getDefaultSessionId();
      }
      return 'default';
    }, 'default');
  }

  function resolveTabId(sid, tid) {
    if (tid) return tid;
    sid = resolveSessionId(sid);
    return safeCall('resolveTabId', function () {
      if (Engine && typeof Engine.getActiveTab === 'function') {
        var tab = Engine.getActiveTab(sid);
        return tab ? tab.id : null;
      }
      return null;
    }, null);
  }

  /* ---------------- Security & Sandbox Helper ---------------- */
  function sandbox() {
    return global.AxiomBrowserSandbox || global.BrowserSandbox || null;
  }

  /* ---------------- Navigation API ---------------- */
  const NavigationAPI = {
    navigate: function (url, opts) {
      opts = opts || {};
      var sid = resolveSessionId(opts.sessionId);
      var tid = resolveTabId(sid, opts.tabId);

      if (!Engine) {
        log('error', 'AxiomBrowserEngine not loaded');
        return { ok: false, reason: 'engine_missing' };
      }

      return safeCall('navigate', function () {
        // Security & Sandbox check
        var sb = sandbox();
        if (sb) {
          var sbVal = sb.validateUrl(url);
          if (!sbVal.valid) {
            emit('navigation:failed', { sessionId: sid, tabId: tid, reason: sbVal.reason, input: url });
            return { ok: false, url: null, reason: sbVal.reason };
          }
          var perm = sb.checkPermission('navigate', { url: sbVal.sanitizedUrl || url });
          if (!perm.ok) {
            emit('navigation:failed', { sessionId: sid, tabId: tid, reason: perm.reason, input: url });
            return { ok: false, url: null, reason: perm.reason };
          }
          url = sbVal.sanitizedUrl || url;
        }

        // Check protocol & validate via Engine
        var check = Engine.validateUrl ? Engine.validateUrl(url) : { valid: true, url: url };
        if (!check.valid) {
          emit('navigation:failed', { sessionId: sid, tabId: tid, reason: check.reason, input: url });
          return { ok: false, url: null, reason: check.reason };
        }

        if (!tid) {
          emit('navigation:failed', { sessionId: sid, tabId: tid, reason: 'no_active_tab', input: url });
          return { ok: false, url: null, reason: 'no_active_tab' };
        }

        // Route through Engine Navigation Manager or Engine flat method
        //
        // Audit fix (Block 2 / Step 5 / Part 6A): this call passed arguments
        // as (url, sid, tid), but Engine.navigation.navigate()'s real
        // signature — see NavigationManager in browser-engine.js — is
        // (sessionId, tabId, input). The swapped order meant every
        // navigation that took this branch was silently broken (it always
        // returned { ok: false, reason: 'navigation-failed' }, so the
        // fallback flat-method branch below never even got exercised by
        // existing tests, since neither browser-manager.js nor its callers
        // had a regression suite driving BrowserManager.navigate() itself
        // — see the new Part 6A regression suite). Fixed to the correct
        // (sessionId, tabId, input) order.
        var res;
        if (Engine.navigation && typeof Engine.navigation.navigate === 'function') {
          res = Engine.navigation.navigate(sid, tid, url);
        } else {
          var nav = Engine.navigate(sid, tid, url);
          res = nav ? { ok: true, url: nav.url, reason: null } : { ok: false, url: null, reason: 'navigation_failed' };
        }
        return res || { ok: false, url: null, reason: 'navigation_failed' };
      }, function (e) {
        emit('navigation:failed', { sessionId: sid, tabId: tid, reason: 'engine_exception', input: url });
        return { ok: false, url: null, reason: 'engine_exception: ' + (e && e.message ? e.message : String(e)) };
      });
    },

    back: function (sessionId, tabId) {
      var sid = resolveSessionId(sessionId);
      var tid = resolveTabId(sid, tabId);
      if (!Engine || !tid) return false;
      return safeCall('back', function () {
        return Engine.goBack ? Engine.goBack(sid, tid) : false;
      }, false);
    },

    forward: function (sessionId, tabId) {
      var sid = resolveSessionId(sessionId);
      var tid = resolveTabId(sid, tabId);
      if (!Engine || !tid) return false;
      return safeCall('forward', function () {
        return Engine.goForward ? Engine.goForward(sid, tid) : false;
      }, false);
    },

    refresh: function (sessionId, tabId) {
      var sid = resolveSessionId(sessionId);
      var tid = resolveTabId(sid, tabId);
      if (!Engine || !tid) return false;
      return safeCall('refresh', function () {
        return Engine.refresh ? Engine.refresh(sid, tid) : false;
      }, false);
    },

    stop: function (sessionId, tabId) {
      var sid = resolveSessionId(sessionId);
      var tid = resolveTabId(sid, tabId);
      if (!Engine || !tid) return false;
      return safeCall('stop', function () {
        return Engine.stopLoading ? Engine.stopLoading(sid, tid) : false;
      }, false);
    },

    redirect: function (url, sessionId, tabId) {
      var sid = resolveSessionId(sessionId);
      var tid = resolveTabId(sid, tabId);
      if (!Engine || !tid) return false;
      return safeCall('redirect', function () {
        return Engine.reportRedirect ? Engine.reportRedirect(sid, tid, url) : false;
      }, false);
    },

    getCurrentUrl: function (sessionId, tabId) {
      var sid = resolveSessionId(sessionId);
      var tid = resolveTabId(sid, tabId);
      if (!Engine) return null;
      return safeCall('getCurrentUrl', function () {
        if (Engine.navigation && typeof Engine.navigation.getCurrentUrl === 'function') {
          return Engine.navigation.getCurrentUrl(sid, tid);
        }
        var tab = Engine.getTab ? Engine.getTab(tid) : null;
        return tab ? tab.url : null;
      }, null);
    },

    getNavigationStatus: function (sessionId, tabId) {
      var sid = resolveSessionId(sessionId);
      var tid = resolveTabId(sid, tabId);
      if (!Engine) return { navigating: false, phase: 'idle', url: null };
      return safeCall('getNavigationStatus', function () {
        var tab = Engine.getTab ? Engine.getTab(tid) : null;
        var brainState = Brain && typeof Brain.getState === 'function' ? (Brain.getState().browser || {}) : {};
        return {
          sessionId: sid,
          tabId: tid,
          navigating: !!brainState.navigating,
          phase: Engine.getPhase ? Engine.getPhase(tid) : (tab ? tab.status : 'idle'),
          url: tab ? tab.url : null,
          title: tab ? tab.title : null,
          status: tab ? tab.status : 'empty',
          canGoBack: Engine.canGoBack ? Engine.canGoBack(sid, tid) : (tab ? tab.histIndex > 0 : false),
          canGoForward: Engine.canGoForward ? Engine.canGoForward(sid, tid) : (tab ? tab.histIndex < tab.hist.length - 1 : false),
          error: brainState.lastError || null
        };
      }, { sessionId: sid, tabId: tid, navigating: false, phase: 'error', url: null, error: 'status_unavailable' });
    }
  };

  /* ---------------- Session API ---------------- */
  const SessionAPI = {
    createSession: function (opts) {
      opts = opts || {};
      if (!Engine) return null;
      return safeCall('createSession', function () {
        var sess = Engine.createSession ? Engine.createSession(opts.label, opts.metadata) : null;
        if (sess) {
          metrics.sessionsCreated++;
          emit('session:changed', { action: 'create', session: sess });
        }
        return sess;
      }, null);
    },

    closeSession: function (sessionId) {
      var sid = resolveSessionId(sessionId);
      if (!Engine || !sid) return false;
      return safeCall('closeSession', function () {
        var ok = Engine.endSession ? Engine.endSession(sid) : false;
        if (ok) {
          metrics.sessionsClosed++;
          emit('session:changed', { action: 'close', sessionId: sid });
        }
        return ok;
      }, false);
    },

    // Part 6B: restoreSession is the primary "browser restart" recovery
    // path, so a malformed/corrupt snapshot must never throw past this
    // boundary — it should fail safe and let the caller fall back to a
    // fresh session instead of taking down the caller (app-init, agent
    // startup, etc).
    restoreSession: function (snapshot) {
      if (!Engine || !snapshot || typeof snapshot !== 'object') {
        return null;
      }
      return safeCall('restoreSession', function () {
        var sess = Engine.restoreSession ? Engine.restoreSession(snapshot) : null;
        if (sess) {
          emit('session:changed', { action: 'restore', session: sess });
        } else {
          emit('session:changed', { action: 'restore-failed', reason: 'invalid_snapshot' });
        }
        return sess;
      }, function () {
        emit('session:changed', { action: 'restore-failed', reason: 'restore_exception' });
        return null;
      });
    },

    switchSession: function (sessionId) {
      if (!Engine || !sessionId) return false;
      return safeCall('switchSession', function () {
        if (Engine.setActiveSessionId) {
          Engine.setActiveSessionId(sessionId);
          emit('session:changed', { action: 'switch', sessionId: sessionId });
          return true;
        }
        return false;
      }, false);
    },

    getActiveSession: function () {
      if (!Engine) return null;
      var sid = resolveSessionId();
      return safeCall('getActiveSession', function () {
        var sess = Engine.getSession ? Engine.getSession(sid) : null;
        return sess || { id: sid, label: 'Default Session', tabs: [] };
      }, { id: sid, label: 'Default Session', tabs: [] });
    },

    getSessionMetadata: function (sessionId) {
      var sid = resolveSessionId(sessionId);
      if (!Engine) return null;
      return safeCall('getSessionMetadata', function () {
        var sess = Engine.getSession ? Engine.getSession(sid) : null;
        return sess ? (sess.metadata || {}) : null;
      }, null);
    }
  };

  /* ---------------- History API ---------------- */
  const HistoryAPI = {
    readHistory: function (opts) {
      opts = opts || {};
      metrics.historyReads++;
      var limit = typeof opts.limit === 'number' ? opts.limit : 50;
      if (!Engine) return { history: [], total: 0 };
      return safeCall('readHistory', function () {
        var raw = Engine.listHistory ? Engine.listHistory(limit) : [];
        if (!Array.isArray(raw)) raw = [];
        if (opts.query) {
          var q = String(opts.query).toLowerCase();
          raw = raw.filter(function (h) {
            return (h.url && h.url.toLowerCase().indexOf(q) !== -1) ||
                   (h.title && h.title.toLowerCase().indexOf(q) !== -1);
          });
        }
        return { history: raw, total: raw.length };
      }, { history: [], total: 0 });
    },

    clearHistory: function () {
      if (!Engine) return false;
      return safeCall('clearHistory', function () {
        if (Engine.clearHistory) {
          Engine.clearHistory();
          emit('history:cleared', {});
          return true;
        }
        return false;
      }, false);
    },

    getRecentPages: function (limit) {
      var res = HistoryAPI.readHistory({ limit: limit || 10 });
      return res.history;
    },

    getNavigationTimeline: function (opts) {
      opts = opts || {};
      var res = HistoryAPI.readHistory({ limit: opts.limit || 100 });
      var timeline = res.history.slice().sort(function (a, b) {
        return (b.time || b.timestamp || 0) - (a.time || a.timestamp || 0);
      });
      return timeline;
    },

    getHistoryMetadata: function () {
      if (!Engine) return { totalVisits: 0, uniqueDomains: 0 };
      if (Engine.history && typeof Engine.history.stats === 'function') {
        return Engine.history.stats();
      }
      var res = HistoryAPI.readHistory({ limit: 200 });
      var domains = new Set();
      res.history.forEach(function (h) {
        try {
          if (h.url) domains.add(new URL(h.url).hostname);
        } catch (e) {}
      });
      return {
        totalVisits: res.history.length,
        uniqueDomains: domains.size
      };
    }
  };

  /* ---------------- Tab API ---------------- */
  const TabAPI = {
    create: function (sessionId, url) {
      var sid = resolveSessionId(sessionId);
      if (!Engine) return null;
      return safeCall('createTab', function () {
        return Engine.createTab ? Engine.createTab(sid, url) : null;
      }, null);
    },

    close: function (sessionId, tabId) {
      var sid = resolveSessionId(sessionId);
      if (!Engine || !tabId) return false;
      return safeCall('closeTab', function () {
        return Engine.closeTab ? Engine.closeTab(sid, tabId) : false;
      }, false);
    },

    switch: function (sessionId, tabId) {
      var sid = resolveSessionId(sessionId);
      if (!Engine || !tabId) return false;
      return safeCall('switchTab', function () {
        return Engine.switchTab ? Engine.switchTab(sid, tabId) : false;
      }, false);
    },

    getActive: function (sessionId) {
      var sid = resolveSessionId(sessionId);
      if (!Engine) return null;
      return safeCall('getActiveTab', function () {
        return Engine.getActiveTab ? Engine.getActiveTab(sid) : null;
      }, null);
    },

    list: function (sessionId) {
      var sid = resolveSessionId(sessionId);
      if (!Engine) return [];
      return safeCall('listTabs', function () {
        var t = Engine.listTabs ? Engine.listTabs(sid) : [];
        return Array.isArray(t) ? t : [];
      }, []);
    },

    duplicate: function (sessionId, tabId) {
      var sid = resolveSessionId(sessionId);
      var tid = resolveTabId(sid, tabId);
      if (!Engine || !tid) return null;
      return safeCall('duplicateTab', function () {
        return Engine.duplicateTab ? Engine.duplicateTab(sid, tid) : null;
      }, null);
    },

    reorder: function (sessionId, tabId, index) {
      var sid = resolveSessionId(sessionId);
      if (!Engine || !tabId) return false;
      return safeCall('reorderTabs', function () {
        return Engine.reorderTabs ? Engine.reorderTabs(sid, tabId, index) : false;
      }, false);
    }
  };

  /* ---------------- Metrics & Status ---------------- */
  // Audit fix (Block 2 / Step 5 / Part 6A): SessionAPI.getActiveSession()
  // returns the real Engine session record when one exists, and that
  // record's tabs live under `tabIds` — never `tabs`. Only the no-session
  // fallback object ({ id, label, tabs: [] }) uses `tabs`. getMetrics()
  // previously checked `activeSession.tabs` unconditionally, so against a
  // real session it always read `undefined` and silently reported 0
  // active tabs regardless of how many tabs were actually open. Fixed by
  // checking both shapes.
  function activeTabCount(session) {
    if (!session) return 0;
    if (Array.isArray(session.tabIds)) return session.tabIds.length;
    if (Array.isArray(session.tabs)) return session.tabs.length;
    return 0;
  }

  function getMetrics() {
    var activeSession = SessionAPI.getActiveSession();
    var activeTabs = activeTabCount(activeSession);
    return {
      totalNavigations: metrics.totalNavigations,
      successfulNavigations: metrics.successfulNavigations,
      failedNavigations: metrics.failedNavigations,
      sessionsCreated: metrics.sessionsCreated,
      sessionsClosed: metrics.sessionsClosed,
      historyReads: metrics.historyReads,
      activeTabs: activeTabs,
      lastNavigationTime: metrics.lastNavigationTime
    };
  }

  function getSnapshot() {
    if (Engine && typeof Engine.getSnapshot === 'function') {
      return Engine.getSnapshot();
    }
    return {
      session: SessionAPI.getActiveSession(),
      navigation: NavigationAPI.getNavigationStatus(),
      metrics: getMetrics()
    };
  }

  /* ---------------- Part D: Browser Diagnostics APIs ---------------- */
  function health() {
    var engineOk = !!Engine;
    var sb = sandbox();
    var checks = {
      engine: engineOk,
      sandbox: !!sb,
      brainBridge: !!Brain,
      memoryBridge: !!Memory
    };
    var criticalOk = checks.engine; // Engine is the only hard dependency
    var allOk = checks.engine && checks.sandbox;
    return {
      status: !criticalOk ? 'unavailable' : (allOk ? 'healthy' : 'degraded'),
      checks: checks,
      timestamp: Date.now()
    };
  }

  function diagnostics() {
    // Part 6B: sweep timed-out navigations before reporting, so
    // diagnostics never shows a phantom in-flight navigation forever.
    var timedOutCount = sweepStaleNavigations();
    var activeSession = SessionAPI.getActiveSession();
    var sessions = Engine && typeof Engine.listSessions === 'function'
      ? safeCall('listSessions', function () { return Engine.listSessions(); }, [])
      : [];
    if (!Array.isArray(sessions)) sessions = [];
    return {
      health: health(),
      activeSessions: sessions.length,
      activeTabs: activeTabCount(activeSession),
      totalTabsAcrossSessions: sessions.reduce(function (sum, s) {
        return sum + (Array.isArray(s.tabIds) ? s.tabIds.length : 0);
      }, 0),
      eventListenerCount: listeners.size,
      inFlightNavigations: navStartTimes.size,
      timedOutNavigationsSwept: timedOutCount,
      metrics: getMetrics(),
      performance: getPerformance(),
      engineStats: Engine && typeof Engine.getStats === 'function'
        ? safeCall('engineGetStats', function () { return Engine.getStats(); }, null)
        : null,
      timestamp: Date.now()
    };
  }

  function getPerformance() {
    var count = navDurations.length;
    var sum = 0, min = null, max = null;
    for (var i = 0; i < count; i++) {
      var d = navDurations[i];
      sum += d;
      if (min === null || d < min) min = d;
      if (max === null || d > max) max = d;
    }
    return {
      navigation: {
        sampleCount: count,
        lastMs: count ? navDurations[count - 1] : null,
        avgMs: count ? Math.round(sum / count) : null,
        minMs: min,
        maxMs: max
      },
      tabSwitchCount: tabSwitchCount,
      sessionSwitchCount: sessionSwitchCount,
      totalNavigations: metrics.totalNavigations,
      successRate: metrics.totalNavigations
        ? Math.round((metrics.successfulNavigations / metrics.totalNavigations) * 1000) / 10
        : null
    };
  }

  function getRuntimeInfo() {
    return {
      apiVersion: BrowserManager.API_VERSION,
      engineLoaded: !!Engine,
      sandboxLoaded: !!sandbox(),
      uptimeMs: Date.now() - initTime,
      startedAt: initTime,
      userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || null,
      activeSessionId: resolveSessionId()
    };
  }

  /* ---------------- Execution Helper for Automation Engine & Agents ---------------- */
  function executeBrowserOp(op, params) {
    params = params || {};
    // Part 6B: the whole dispatch is wrapped in try/catch (synchronous
    // Engine calls can throw) and the returned promise always resolves —
    // callers (Automation Engine, BrowserAgent) get a standardized
    // { ok:false, code, reason } envelope on failure instead of a
    // rejected promise they may not be catching.
    return Promise.resolve().then(function () {
      try {
        return dispatchBrowserOp(op, params);
      } catch (e) {
        return errEnvelope('op_exception', (e && e.message) || String(e), { op: op });
      }
    }).catch(function (e) {
      return errEnvelope('op_exception', (e && e.message) || String(e), { op: op });
    });
  }

  function dispatchBrowserOp(op, params) {
    {
      switch (op) {
        case 'navigate':
          return NavigationAPI.navigate(params.url, params);
        case 'back':
        case 'go-back':
          return { ok: NavigationAPI.back(params.sessionId, params.tabId) };
        case 'forward':
        case 'go-forward':
          return { ok: NavigationAPI.forward(params.sessionId, params.tabId) };
        case 'refresh':
          return { ok: NavigationAPI.refresh(params.sessionId, params.tabId) };
        case 'stop':
        case 'stop-loading':
          return { ok: NavigationAPI.stop(params.sessionId, params.tabId) };
        case 'redirect':
          return { ok: NavigationAPI.redirect(params.url, params.sessionId, params.tabId) };
        case 'get-url':
        case 'current-url':
          return { url: NavigationAPI.getCurrentUrl(params.sessionId, params.tabId) };
        case 'get-status':
        case 'navigation-status':
          return NavigationAPI.getNavigationStatus(params.sessionId, params.tabId);

        // Sessions
        case 'create-session':
          return { session: SessionAPI.createSession(params) };
        case 'close-session':
          return { ok: SessionAPI.closeSession(params.sessionId) };
        case 'restore-session':
          return { session: SessionAPI.restoreSession(params.snapshot) };
        case 'switch-session':
          return { ok: SessionAPI.switchSession(params.sessionId) };
        case 'get-active-session':
          return { session: SessionAPI.getActiveSession() };

        // History
        case 'read-history':
          return HistoryAPI.readHistory(params);
        case 'clear-history':
          return { ok: HistoryAPI.clearHistory() };
        case 'get-recent-pages':
          return { pages: HistoryAPI.getRecentPages(params.limit) };
        case 'get-timeline':
          return { timeline: HistoryAPI.getNavigationTimeline(params) };

        // Tabs
        case 'create-tab':
        case 'new-tab':
          return { tab: TabAPI.create(params.sessionId, params.url) };
        case 'close-tab':
          return { ok: TabAPI.close(params.sessionId, params.tabId) };
        case 'switch-tab':
          return { ok: TabAPI.switch(params.sessionId, params.tabId) };
        case 'duplicate-tab':
          return { tab: TabAPI.duplicate(params.sessionId, params.tabId) };
        case 'reorder-tab':
          return { ok: TabAPI.reorder(params.sessionId, params.tabId, params.index) };

        default:
          throw new Error('Unsupported BrowserManager operation "' + op + '".');
      }
    }
  }

  /* ---------------- Public Surface ---------------- */
  var BrowserManager = {
    API_VERSION: '1.2.0',
    sandbox: sandbox,

    // Sub-APIs
    navigation: NavigationAPI,
    sessions: SessionAPI,
    history: HistoryAPI,
    tabs: TabAPI,
    events: {
      on: on,
      off: off,
      emit: emit
    },

    // Convenient Top-Level Delegates
    navigate: NavigationAPI.navigate,
    back: NavigationAPI.back,
    forward: NavigationAPI.forward,
    refresh: NavigationAPI.refresh,
    stop: NavigationAPI.stop,
    redirect: NavigationAPI.redirect,
    getCurrentUrl: NavigationAPI.getCurrentUrl,
    getNavigationStatus: NavigationAPI.getNavigationStatus,

    createSession: SessionAPI.createSession,
    closeSession: SessionAPI.closeSession,
    restoreSession: SessionAPI.restoreSession,
    switchSession: SessionAPI.switchSession,
    getActiveSession: SessionAPI.getActiveSession,
    getSessionMetadata: SessionAPI.getSessionMetadata,

    readHistory: HistoryAPI.readHistory,
    clearHistory: HistoryAPI.clearHistory,
    getRecentPages: HistoryAPI.getRecentPages,
    getNavigationTimeline: HistoryAPI.getNavigationTimeline,
    getHistoryMetadata: HistoryAPI.getHistoryMetadata,

    on: on,
    off: off,
    emit: emit,

    getMetrics: getMetrics,
    getStats: getMetrics,
    getSnapshot: getSnapshot,
    executeBrowserOp: executeBrowserOp,

    // Part D — Browser Diagnostics
    health: health,
    diagnostics: diagnostics,
    getPerformance: getPerformance,
    getRuntimeInfo: getRuntimeInfo,
    getStaleNavigations: getStaleNavigations,
    sweepStaleNavigations: sweepStaleNavigations
  };

  global.AxiomBrowserManager = BrowserManager;
  global.BrowserManager = BrowserManager;

  log('info', 'BrowserManager initialized as single public browser entry point.');
})(typeof window !== 'undefined' ? window : this);
