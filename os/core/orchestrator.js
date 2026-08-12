// ============================================================
// AXIOM — Block 2 / Step 6 / Part 1: Agent Orchestrator Core
// ------------------------------------------------------------
// Every subsystem built so far (Brain, Memory, Automation, Browser)
// exists as its own independent global (AxiomBrain, AxiomMemoryEngine,
// AxiomAutomationManager, AxiomBrowserManager, ...) plus a handful of
// point-to-point bridge files that wire two of those globals together
// at a time (browser-brain-bridge.js, automation-memory-bridge.js,
// etc). That works, but it means there is no single place that knows
// "what agents exist", "what is running right now across the whole
// app", or "route this request to whoever should handle it" — every
// caller has to already know which specific global to reach for.
//
// This module is that single place. It is a coordination layer that
// sits ABOVE the existing subsystems, not a replacement for any of
// them:
//   - It does not re-implement browser automation, memory storage,
//     automation execution, or brain state. Those engines are frozen
//     and untouched.
//   - It does not talk to OpenRouter or any AI provider directly.
//     (Extension points for that are documented, but nothing in this
//     file makes a network call.)
//   - It does not touch any .html file or any js/pages/* UI file.
//
// What it adds, net-new:
//   - AgentRegistry  — a place for agents to register themselves and
//     be discovered, with a real health/status model.
//   - EventBus       — a small decoupled pub/sub bus (emit/on/off/once)
//     independent of the DOM, so orchestration events don't have to
//     be modeled as CustomEvents.
//   - TaskScheduler  — a queue that orchestration requests flow
//     through. Nothing the Orchestrator hands out executes
//     synchronously/immediately; it is enqueued, scheduled, and run
//     with priority, timeout, cancel and retry support.
//   - Runtime lifecycle — startup/shutdown plus the task/agent
//     lifecycle events, all delivered through the EventBus.
//
// Usage:
//   AxiomOrchestrator.registerAgent({ id: 'browser', name: 'Browser Agent',
//     capabilities: ['navigate', 'extract'], permissions: ['browser:*'],
//     tools: ['browser.navigate'], handler: async (task) => { ... } });
//
//   AxiomOrchestrator.on('task_completed', ({ task, result }) => { ... });
//
//   AxiomOrchestrator.dispatch({ agentId: 'browser', type: 'navigate',
//     payload: { url: 'https://example.com' }, priority: 5 });
//
//   AxiomOrchestrator.getHealthyAgents();
//   AxiomOrchestrator.shutdown();
// ============================================================
(function (global) {
  'use strict';

  var API_VERSION = '1.0.0';

  // ------------------------------------------------------------
  // Event Bus (Part C)
  // ------------------------------------------------------------
  // Intentionally NOT window.dispatchEvent/CustomEvent-based. Existing
  // bridges already use DOM/BroadcastChannel events for cross-tab sync
  // (that's a Brain/Memory concern and is untouched here); the
  // Orchestrator's bus is an in-process pub/sub used for coordination
  // *within* a single runtime, with duplicate-subscription protection
  // and a real off()/once() contract, which CustomEvent alone doesn't
  // give us cleanly.
  function createEventBus() {
    var listeners = Object.create(null); // event name -> [{ fn, once }]

    function on(event, fn) {
      if (typeof fn !== 'function') return function () {};
      var list = listeners[event] || (listeners[event] = []);
      var already = list.some(function (entry) { return entry.fn === fn; });
      if (!already) list.push({ fn: fn, once: false });
      return function unsubscribe() { off(event, fn); };
    }

    function once(event, fn) {
      if (typeof fn !== 'function') return function () {};
      var list = listeners[event] || (listeners[event] = []);
      var already = list.some(function (entry) { return entry.fn === fn; });
      if (!already) list.push({ fn: fn, once: true });
      return function unsubscribe() { off(event, fn); };
    }

    function off(event, fn) {
      var list = listeners[event];
      if (!list) return;
      if (typeof fn !== 'function') {
        delete listeners[event];
        return;
      }
      listeners[event] = list.filter(function (entry) { return entry.fn !== fn; });
    }

    function emit(event, payload) {
      var list = listeners[event];
      if (!list || !list.length) return;
      // Snapshot before iterating: a listener that calls off()/once()
      // during emit must not corrupt the in-flight iteration.
      var snapshot = list.slice();
      var toRemove = [];
      for (var i = 0; i < snapshot.length; i++) {
        var entry = snapshot[i];
        try {
          entry.fn(payload, event);
        } catch (err) {
          // A misbehaving listener must never break the bus for
          // everyone else, or for the caller that triggered emit().
          reportError('event-bus-listener', err, { event: event });
        }
        if (entry.once) toRemove.push(entry.fn);
      }
      if (toRemove.length) {
        listeners[event] = (listeners[event] || []).filter(function (entry) {
          return toRemove.indexOf(entry.fn) === -1;
        });
      }
    }

    function clear(event) {
      if (event) delete listeners[event];
      else listeners = Object.create(null);
    }

    return { on: on, once: once, off: off, emit: emit, clear: clear };
  }

  var bus = createEventBus();

  function reportError(source, err, context) {
    try {
      // eslint-disable-next-line no-console
      console.error('[AxiomOrchestrator]', source, err, context || '');
    } catch (e) { /* no console available — swallow */ }
  }

  // ------------------------------------------------------------
  // Agent Registry (Part B)
  // ------------------------------------------------------------
  var STATUS = { IDLE: 'idle', BUSY: 'busy', DISABLED: 'disabled', ERROR: 'error' };
  var HEALTH = { HEALTHY: 'healthy', DEGRADED: 'degraded', UNHEALTHY: 'unhealthy' };

  var agents = Object.create(null); // id -> agent record

  function makeAgentId(prefix) {
    return (prefix || 'agent') + '-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 8);
  }

  function registerAgent(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('AxiomOrchestrator.registerAgent: config object required.');
    }
    var id = config.id || makeAgentId(config.name);
    if (agents[id]) {
      throw new Error('AxiomOrchestrator.registerAgent: agent id "' + id + '" is already registered.');
    }
    if (typeof config.handler !== 'function') {
      throw new Error('AxiomOrchestrator.registerAgent: agent "' + id + '" must provide a handler(task) function.');
    }

    var record = {
      id: id,
      name: config.name || id,
      capabilities: Array.isArray(config.capabilities) ? config.capabilities.slice() : [],
      permissions: Array.isArray(config.permissions) ? config.permissions.slice() : [],
      tools: Array.isArray(config.tools || config.supportedTools) ?
        (config.tools || config.supportedTools).slice() : [],
      status: STATUS.IDLE,
      health: HEALTH.HEALTHY,
      handler: config.handler,
      registeredAt: Date.now(),
      lastActiveAt: null,
      stats: { completed: 0, failed: 0 }
    };

    agents[id] = record;
    emitLifecycle('agent_registered', { agentId: id, agent: publicAgent(record) });
    return publicAgent(record);
  }

  function unregisterAgent(id) {
    var record = agents[id];
    if (!record) return false;
    delete agents[id];
    // Any queued/pending tasks addressed to this agent are cancelled
    // rather than left to fail silently against a handler that no
    // longer exists.
    scheduler.cancelByAgent(id, 'agent_unregistered');
    emitLifecycle('agent_removed', { agentId: id });
    return true;
  }

  function getAgent(id) {
    var record = agents[id];
    return record ? publicAgent(record) : null;
  }

  function listAgents() {
    return Object.keys(agents).map(function (id) { return publicAgent(agents[id]); });
  }

  function getHealthyAgents() {
    return listAgents().filter(function (a) {
      return a.health === HEALTH.HEALTHY && a.status !== STATUS.DISABLED;
    });
  }

  function setAgentHealth(id, health) {
    var record = agents[id];
    if (!record) return false;
    record.health = health;
    return true;
  }

  function setAgentStatus(id, status) {
    var record = agents[id];
    if (!record) return false;
    record.status = status;
    return true;
  }

  function publicAgent(record) {
    // Never leak the raw handler function or internal record reference
    // through the public API — callers get a data snapshot.
    return {
      id: record.id,
      name: record.name,
      capabilities: record.capabilities.slice(),
      permissions: record.permissions.slice(),
      tools: record.tools.slice(),
      status: record.status,
      health: record.health,
      registeredAt: record.registeredAt,
      lastActiveAt: record.lastActiveAt,
      stats: { completed: record.stats.completed, failed: record.stats.failed }
    };
  }

  // ------------------------------------------------------------
  // Task Scheduler (Part D)
  // ------------------------------------------------------------
  // Tasks never execute the instant they're handed to the Orchestrator.
  // dispatch()/enqueue() only ever queues; a scheduler loop (a
  // zero-delay-but-async drain, not a synchronous call) is what
  // actually invokes agent handlers. This keeps dispatch() callers'
  // stacks from ever containing agent-handler code, and gives
  // priority/timeout/retry/cancel one real place to apply.
  var TASK_STATUS = {
    QUEUED: 'queued',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    TIMED_OUT: 'timed_out'
  };

  // Block 2 / Step 6 / Part 6A: bounds how many *finished* (completed /
  // failed / cancelled / timed_out) task records the Scheduler retains.
  // Queued and running tasks are never affected by this limit — only
  // terminal-state history is pruned, oldest first, same convention as
  // capability-router.js's and runtime-context.js's own HISTORY_LIMIT.
  var MAX_COMPLETED_TASK_HISTORY = 1000;

  function createScheduler() {
    var queue = [];           // pending tasks, kept priority-sorted
    var tasksById = Object.create(null);
    var running = Object.create(null); // taskId -> { timeoutHandle }
    var draining = false;
    var seq = 0;

    function isFinishedStatus(status) {
      return status === TASK_STATUS.COMPLETED || status === TASK_STATUS.FAILED ||
        status === TASK_STATUS.CANCELLED || status === TASK_STATUS.TIMED_OUT;
    }

    // Trims the oldest finished task records once the finished count
    // exceeds MAX_COMPLETED_TASK_HISTORY. Task ids are non-numeric
    // string keys ('task-<base36>-<seq>'), so Object.keys(tasksById)
    // reliably preserves insertion order per spec — the first entries
    // in the filtered list are the oldest finished tasks. Never removes
    // a queued or running task.
    function pruneFinishedTaskHistory() {
      var finishedIds = Object.keys(tasksById).filter(function (id) {
        return isFinishedStatus(tasksById[id].status);
      });
      var excess = finishedIds.length - MAX_COMPLETED_TASK_HISTORY;
      for (var i = 0; i < excess; i++) {
        delete tasksById[finishedIds[i]];
      }
    }

    function makeTaskId() {
      seq += 1;
      return 'task-' + Date.now().toString(36) + '-' + seq;
    }

    function enqueue(request) {
      if (!request || typeof request !== 'object') {
        throw new Error('AxiomOrchestrator: task request object required.');
      }
      if (!request.agentId) {
        throw new Error('AxiomOrchestrator: task.agentId is required.');
      }
      var task = {
        id: request.id || makeTaskId(),
        agentId: request.agentId,
        type: request.type || 'default',
        payload: request.payload !== undefined ? request.payload : null,
        priority: typeof request.priority === 'number' ? request.priority : 0, // higher runs first
        timeout: typeof request.timeout === 'number' ? request.timeout : 30000,
        maxRetries: typeof request.maxRetries === 'number' ? request.maxRetries : 0,
        retryDelay: typeof request.retryDelay === 'number' ? request.retryDelay : 500,
        attempt: 0,
        status: TASK_STATUS.QUEUED,
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        result: null,
        error: null,
        onComplete: typeof request.onComplete === 'function' ? request.onComplete : null,
        onError: typeof request.onError === 'function' ? request.onError : null
      };
      tasksById[task.id] = task;
      insertByPriority(task);
      scheduleDrain();
      return task.id;
    }

    function insertByPriority(task) {
      var i = 0;
      while (i < queue.length && queue[i].priority >= task.priority) i++;
      queue.splice(i, 0, task);
    }

    function cancel(taskId, reason) {
      var task = tasksById[taskId];
      if (!task) return false;
      if (task.status === TASK_STATUS.COMPLETED || task.status === TASK_STATUS.FAILED ||
          task.status === TASK_STATUS.CANCELLED) {
        return false;
      }
      if (task.status === TASK_STATUS.QUEUED) {
        queue = queue.filter(function (t) { return t.id !== taskId; });
      }
      // Tasks already RUNNING are marked cancelled; the in-flight
      // handler promise is not force-killed (JS can't preempt a
      // running promise), but its eventual resolution is ignored and
      // no completed/failed lifecycle event is emitted for it.
      task.status = TASK_STATUS.CANCELLED;
      task.finishedAt = Date.now();
      task.error = reason || 'cancelled';
      emitLifecycle('task_failed', { task: publicTask(task), reason: task.error, cancelled: true });
      pruneFinishedTaskHistory();
      return true;
    }

    function cancelByAgent(agentId, reason) {
      var ids = Object.keys(tasksById).filter(function (id) {
        var t = tasksById[id];
        return t.agentId === agentId &&
          (t.status === TASK_STATUS.QUEUED || t.status === TASK_STATUS.RUNNING);
      });
      ids.forEach(function (id) { cancel(id, reason); });
      return ids.length;
    }

    function retry(taskId) {
      var task = tasksById[taskId];
      if (!task) return false;
      if (task.status !== TASK_STATUS.FAILED && task.status !== TASK_STATUS.TIMED_OUT) {
        return false;
      }
      task.status = TASK_STATUS.QUEUED;
      task.error = null;
      task.startedAt = null;
      task.finishedAt = null;
      insertByPriority(task);
      scheduleDrain();
      return true;
    }

    function scheduleDrain() {
      if (draining) return;
      draining = true;
      // Defer to a microtask/macrotask boundary rather than draining
      // synchronously inside enqueue()'s call stack.
      var schedule = (typeof global.setTimeout === 'function') ?
        function (fn) { global.setTimeout(fn, 0); } :
        function (fn) { fn(); };
      schedule(drain);
    }

    function drain() {
      draining = false;
      if (!queue.length) return;
      var task = queue.shift();
      if (task.status === TASK_STATUS.CANCELLED) {
        if (queue.length) scheduleDrain();
        return;
      }
      runTask(task);
      if (queue.length) scheduleDrain();
    }

    function runTask(task) {
      var agent = agents[task.agentId];
      if (!agent) {
        task.status = TASK_STATUS.FAILED;
        task.error = 'Unknown agent: ' + task.agentId;
        task.finishedAt = Date.now();
        emitLifecycle('task_failed', { task: publicTask(task), reason: task.error });
        if (task.onError) safeCall(task.onError, task.error, task);
        pruneFinishedTaskHistory();
        return;
      }
      if (agent.status === STATUS.DISABLED) {
        task.status = TASK_STATUS.FAILED;
        task.error = 'Agent disabled: ' + task.agentId;
        task.finishedAt = Date.now();
        emitLifecycle('task_failed', { task: publicTask(task), reason: task.error });
        if (task.onError) safeCall(task.onError, task.error, task);
        pruneFinishedTaskHistory();
        return;
      }

      task.attempt += 1;
      task.status = TASK_STATUS.RUNNING;
      task.startedAt = Date.now();
      agent.status = STATUS.BUSY;
      agent.lastActiveAt = Date.now();
      emitLifecycle('task_started', { task: publicTask(task) });

      var settled = false;
      var timeoutHandle = null;

      function finishSuccess(result) {
        if (settled) return;
        settled = true;
        if (timeoutHandle) global.clearTimeout(timeoutHandle);
        if (task.status === TASK_STATUS.CANCELLED) return; // ignore late resolution
        task.status = TASK_STATUS.COMPLETED;
        task.result = result;
        task.finishedAt = Date.now();
        agent.status = STATUS.IDLE;
        agent.stats.completed += 1;
        emitLifecycle('task_completed', { task: publicTask(task), result: result });
        if (task.onComplete) safeCall(task.onComplete, result, task);
        pruneFinishedTaskHistory();
      }

      function finishFailure(err, isTimeout) {
        if (settled) return;
        settled = true;
        if (timeoutHandle) global.clearTimeout(timeoutHandle);
        if (task.status === TASK_STATUS.CANCELLED) return; // ignore late rejection
        var message = (err && err.message) ? err.message : String(err);

        if (task.attempt <= task.maxRetries) {
          task.status = TASK_STATUS.QUEUED;
          agent.status = STATUS.IDLE;
          var delay = task.retryDelay;
          var schedule = (typeof global.setTimeout === 'function') ?
            function (fn) { global.setTimeout(fn, delay); } :
            function (fn) { fn(); };
          schedule(function () { insertByPriority(task); scheduleDrain(); });
          return;
        }

        task.status = isTimeout ? TASK_STATUS.TIMED_OUT : TASK_STATUS.FAILED;
        task.error = message;
        task.finishedAt = Date.now();
        agent.status = STATUS.IDLE;
        agent.stats.failed += 1;
        if (isTimeout) agent.health = HEALTH.DEGRADED;
        emitLifecycle('task_failed', { task: publicTask(task), reason: message, timedOut: !!isTimeout });
        if (task.onError) safeCall(task.onError, message, task);
        pruneFinishedTaskHistory();
      }

      if (task.timeout > 0 && typeof global.setTimeout === 'function') {
        timeoutHandle = global.setTimeout(function () {
          finishFailure(new Error('Task timed out after ' + task.timeout + 'ms'), true);
        }, task.timeout);
      }

      try {
        var maybePromise = agent.handler(publicTask(task));
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(finishSuccess, finishFailure);
        } else {
          finishSuccess(maybePromise);
        }
      } catch (err) {
        finishFailure(err, false);
      }
    }

    function safeCall(fn, a, b) {
      try { fn(a, b); } catch (err) { reportError('task-callback', err); }
    }

    function getTask(taskId) {
      var task = tasksById[taskId];
      return task ? publicTask(task) : null;
    }

    function listTasks(filter) {
      var all = Object.keys(tasksById).map(function (id) { return tasksById[id]; });
      if (filter && filter.status) all = all.filter(function (t) { return t.status === filter.status; });
      if (filter && filter.agentId) all = all.filter(function (t) { return t.agentId === filter.agentId; });
      return all.map(publicTask);
    }

    function publicTask(task) {
      return {
        id: task.id,
        agentId: task.agentId,
        type: task.type,
        payload: task.payload,
        priority: task.priority,
        status: task.status,
        attempt: task.attempt,
        maxRetries: task.maxRetries,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        result: task.result,
        error: task.error
      };
    }

    function stats() {
      var byStatus = {};
      Object.keys(tasksById).forEach(function (id) {
        var s = tasksById[id].status;
        byStatus[s] = (byStatus[s] || 0) + 1;
      });
      return { queued: queue.length, total: Object.keys(tasksById).length, byStatus: byStatus };
    }

    function clearHistory() {
      // Drops finished task records to bound memory; queued/running
      // tasks are left untouched. Manual/full-clear counterpart to the
      // automatic pruneFinishedTaskHistory() bound above.
      Object.keys(tasksById).forEach(function (id) {
        if (isFinishedStatus(tasksById[id].status)) {
          delete tasksById[id];
        }
      });
    }

    return {
      enqueue: enqueue,
      cancel: cancel,
      cancelByAgent: cancelByAgent,
      retry: retry,
      getTask: getTask,
      listTasks: listTasks,
      stats: stats,
      clearHistory: clearHistory
    };
  }

  var scheduler = createScheduler();

  // ------------------------------------------------------------
  // Runtime Lifecycle (Part E)
  // ------------------------------------------------------------
  var LIFECYCLE_EVENTS = [
    'startup', 'shutdown', 'agent_registered', 'agent_removed',
    'task_started', 'task_completed', 'task_failed'
  ];

  var runtimeState = 'stopped'; // stopped | running

  function emitLifecycle(event, payload) {
    bus.emit(event, payload);
    // Also emit a namespaced wildcard-style event so a single listener
    // can observe every lifecycle event without subscribing to all of
    // them individually.
    bus.emit('lifecycle', { event: event, payload: payload });
  }

  function startup() {
    if (runtimeState === 'running') return false;
    runtimeState = 'running';
    emitLifecycle('startup', { at: Date.now(), apiVersion: API_VERSION });
    return true;
  }

  function shutdown() {
    if (runtimeState !== 'running') return false;
    // Best-effort cancel of anything still in flight so a shutdown
    // doesn't leave dangling handlers reporting into a stopped runtime.
    Object.keys(agents).forEach(function (id) { scheduler.cancelByAgent(id, 'orchestrator_shutdown'); });
    runtimeState = 'stopped';
    emitLifecycle('shutdown', { at: Date.now() });
    return true;
  }

  // ------------------------------------------------------------
  // Part A — Orchestrator Core / Request Routing
  // ------------------------------------------------------------
  // dispatch() is the one public entry point every subsystem should
  // use instead of calling another subsystem's global directly. It
  // resolves which agent should handle a request (by explicit agentId,
  // or by capability match) and hands it to the scheduler.
  function resolveAgentId(request) {
    if (request.agentId) return request.agentId;
    if (request.capability) {
      var match = listAgents().find(function (a) {
        return a.capabilities.indexOf(request.capability) !== -1 &&
          a.health === HEALTH.HEALTHY && a.status !== STATUS.DISABLED;
      });
      if (match) return match.id;
    }
    return null;
  }

  function dispatch(request) {
    if (runtimeState !== 'running') {
      throw new Error('AxiomOrchestrator: cannot dispatch before startup() or after shutdown().');
    }
    request = request || {};
    var agentId = resolveAgentId(request);
    if (!agentId) {
      throw new Error('AxiomOrchestrator.dispatch: no agentId given and no healthy agent matches capability "' +
        request.capability + '".');
    }
    return scheduler.enqueue(Object.assign({}, request, { agentId: agentId }));
  }

  function init(options) {
    options = options || {};
    if (options.agents && Array.isArray(options.agents)) {
      options.agents.forEach(function (a) {
        try { registerAgent(a); } catch (err) { reportError('init-register-agent', err, a); }
      });
    }
    startup();
    return AxiomOrchestrator;
  }

  // ------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------
  var AxiomOrchestrator = {
    API_VERSION: API_VERSION,
    STATUS: STATUS,
    HEALTH: HEALTH,
    TASK_STATUS: TASK_STATUS,
    LIFECYCLE_EVENTS: LIFECYCLE_EVENTS,

    // lifecycle
    init: init,
    startup: startup,
    shutdown: shutdown,
    getRuntimeState: function () { return runtimeState; },

    // agent registry
    registerAgent: registerAgent,
    unregisterAgent: unregisterAgent,
    getAgent: getAgent,
    listAgents: listAgents,
    getHealthyAgents: getHealthyAgents,
    setAgentHealth: setAgentHealth,
    setAgentStatus: setAgentStatus,

    // routing / scheduling
    dispatch: dispatch,
    enqueue: scheduler.enqueue,
    cancel: scheduler.cancel,
    retry: scheduler.retry,
    getTask: scheduler.getTask,
    listTasks: scheduler.listTasks,
    getStats: function () {
      return { agents: listAgents().length, healthyAgents: getHealthyAgents().length, tasks: scheduler.stats() };
    },
    clearTaskHistory: scheduler.clearHistory,

    // event bus
    on: bus.on,
    once: bus.once,
    off: bus.off,
    emit: bus.emit
  };

  global.AxiomOrchestrator = AxiomOrchestrator;

  // Auto-start on load, same convention as the other os/core singletons
  // (AxiomBrain etc.) — startup() is idempotent so a page that also
  // calls init() explicitly is safe.
  if (typeof document !== 'undefined' && document.readyState !== 'loading') {
    startup();
  } else if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', startup);
  } else {
    startup();
  }
})(window);
