// ============================================================
// AXIOM AI OS — Milestone 4: Agent Runtime (core)
// ------------------------------------------------------------
// The foundational layer of the multi-agent runtime. It defines
// three things and nothing else:
//
//   1. AGENT_STATES  — the canonical agent lifecycle vocabulary.
//   2. AgentEventBus — the event-driven communication backbone
//      that agents use to talk to each other. It extends the
//      exact pattern Milestone 3 established for AI state
//      (a single document CustomEvent + a callback registry +
//      cross-tab BroadcastChannel relay) to structured,
//      addressable agent messages.
//   3. Agent         — the base class every concrete agent
//      (Assistant, Browser, Memory, …) is an instance of. All
//      shared behaviour (status transitions, task queue,
//      subscriptions, lifecycle) lives here so no concrete agent
//      re-implements it. That is the "no duplicated agent logic"
//      requirement, enforced structurally.
//
// This file is presentation-free and framework-free: it never
// touches the DOM layout, the AI Core visuals, or any CSS. It
// only speaks events. The bootstrap layer (runtime-bootstrap.js)
// is what connects this runtime to the Milestone 3 canonical
// AI-state system.
//
// Public surface — window.AxiomAgentRuntime:
//   .STATES                     -> frozen AGENT_STATES map
//   .bus                        -> the shared AgentEventBus singleton
//   .Agent                      -> the base Agent class
//   .createBus()                -> factory (used internally / tests)
// ============================================================
window.AxiomAgentRuntime = (function () {
  'use strict';

  // ---- 1. Canonical agent lifecycle states -----------------------------
  // Exactly the nine states the milestone brief requires. Kept as a frozen
  // object so a typo like AGENT_STATES.WORKNIG throws at author time
  // instead of silently producing an invalid status string.
  var AGENT_STATES = Object.freeze({
    OFFLINE: 'offline',
    INITIALIZING: 'initializing',
    IDLE: 'idle',
    LISTENING: 'listening',
    THINKING: 'thinking',
    WORKING: 'working',
    WAITING: 'waiting',
    COMPLETED: 'completed',
    ERROR: 'error'
  });

  // Legal transitions. The runtime never hard-fails on an illegal move
  // (an agent library should be forgiving), but it warns, so bugs surface
  // in the console during development without crashing the OS.
  var TRANSITIONS = {
    offline:      ['initializing'],
    initializing: ['idle', 'error', 'offline'],
    idle:         ['listening', 'thinking', 'working', 'waiting', 'offline', 'error'],
    listening:    ['thinking', 'working', 'idle', 'error', 'offline'],
    thinking:     ['working', 'waiting', 'completed', 'idle', 'error', 'offline'],
    working:      ['waiting', 'completed', 'thinking', 'error', 'idle', 'offline'],
    waiting:      ['working', 'thinking', 'completed', 'idle', 'error', 'offline'],
    completed:    ['idle', 'thinking', 'working', 'offline'],
    error:        ['idle', 'initializing', 'offline']
  };

  function isValidTransition(from, to) {
    if (from === to) return true;
    return !!(TRANSITIONS[from] && TRANSITIONS[from].indexOf(to) !== -1);
  }

  // ---- 2. AgentEventBus ------------------------------------------------
  // One shared bus per tab. Every structured message an agent emits flows
  // through here; agents never call each other's methods directly. This
  // is the "agents exchange structured events rather than directly calling
  // each other" requirement.
  //
  // Event envelope shape (stable contract):
  //   {
  //     type:    string,   // e.g. 'task:queued', 'agent:status', 'agent:message'
  //     source:  string,   // agent id (or 'system' / 'router' / 'manager')
  //     target:  string?,  // agent id for directed messages, else undefined
  //     payload: object,   // type-specific data
  //     ts:      number,   // Date.now()
  //     id:      string    // unique envelope id
  //   }
  function createBus() {
    var CHANNEL_NAME = 'axiom-agent-bus';
    var STORAGE_KEY = 'axiom:agent-bus-relay';
    var TAB_ID = Date.now().toString(36) + Math.random().toString(36).slice(2);

    // wildcard '*' listeners see every event; typed listeners see one type.
    var typed = Object.create(null); // type -> Set<fn>
    var wildcard = new Set();
    var log = [];                    // bounded ring buffer for debugging/health
    var LOG_MAX = 200;
    var seq = 0;

    var channel = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL_NAME);
    } catch (e) { channel = null; }

    function nextId() {
      seq += 1;
      return TAB_ID + '-' + seq.toString(36);
    }

    function record(envelope) {
      log.push(envelope);
      if (log.length > LOG_MAX) log.shift();
    }

    function deliverLocal(envelope) {
      record(envelope);
      var set = typed[envelope.type];
      if (set) {
        set.forEach(function (fn) {
          try { fn(envelope); } catch (e) { /* one bad listener never breaks the bus */ }
        });
      }
      wildcard.forEach(function (fn) {
        try { fn(envelope); } catch (e) { /* isolated */ }
      });
      // Also surface on the DOM, mirroring Milestone 3's single-event style,
      // so non-runtime code can observe agent traffic without importing the bus.
      try {
        document.dispatchEvent(new CustomEvent('axiom:agent-event', { detail: envelope }));
      } catch (e) { /* isolated */ }
    }

    function relay(envelope) {
      try {
        var withOrigin = Object.assign({}, envelope, { origin: TAB_ID });
        if (channel) channel.postMessage(withOrigin);
        else if (window.localStorage) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign({}, withOrigin, { _t: Date.now() })));
        }
      } catch (e) { /* relay unavailable — local delivery already happened */ }
    }

    function handleRemote(payload) {
      if (!payload || payload.origin === TAB_ID) return;
      // Remote events are delivered locally but NOT re-relayed (no echo loop).
      deliverLocal(payload);
    }

    if (channel) channel.addEventListener('message', function (e) { handleRemote(e.data); });
    window.addEventListener('storage', function (e) {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try { handleRemote(JSON.parse(e.newValue)); } catch (err) { /* malformed */ }
    });

    return {
      TAB_ID: TAB_ID,

      // Publish a structured event. `opts.crossTab` (default false) also
      // relays it to other tabs/OS-windows. Returns the full envelope.
      emit: function (type, source, payload, opts) {
        opts = opts || {};
        var envelope = {
          type: type,
          source: source || 'system',
          target: opts.target,
          payload: payload || {},
          ts: Date.now(),
          id: nextId()
        };
        deliverLocal(envelope);
        if (opts.crossTab) relay(envelope);
        return envelope;
      },

      // Subscribe to a single event type, or '*' for everything.
      // Returns an unsubscribe function.
      on: function (type, fn) {
        if (typeof fn !== 'function') return function () {};
        if (type === '*') { wildcard.add(fn); return function () { wildcard.delete(fn); }; }
        (typed[type] || (typed[type] = new Set())).add(fn);
        return function () { if (typed[type]) typed[type].delete(fn); };
      },

      // One-shot listener.
      once: function (type, fn) {
        var off = this.on(type, function (env) { off(); fn(env); });
        return off;
      },

      recentEvents: function (n) {
        return log.slice(-(n || 50));
      }
    };
  }

  var bus = createBus();

  // ---- 3. Agent base class ---------------------------------------------
  // Every concrete agent is an Agent instance. Concrete behaviour is
  // supplied purely as data + an optional `handler(task, ctx)` in the spec,
  // so specialised agents add capability WITHOUT subclassing or copying
  // lifecycle/queue code. That keeps the "no duplicated agent logic" rule
  // structurally guaranteed rather than merely hoped for.
  /**
   * @param {object} spec - agent definition (id, name, capabilities, tools,
   *   subscriptions, canonicalState, optional async handler(task, ctx)).
   * @throws {Error} if spec.id is missing
   */
  function Agent(spec) {
    if (!spec || !spec.id) throw new Error('[AxiomAgentRuntime] Agent spec requires a unique id.');
    this.id = spec.id;
    this.name = spec.name || spec.id;
    this.description = spec.description || '';
    this.icon = spec.icon || null;

    this.capabilities = (spec.capabilities || []).slice();
    this.tools = (spec.tools || []).slice();
    this.subscriptions = (spec.subscriptions || []).slice(); // event types this agent reacts to

    this.status = AGENT_STATES.OFFLINE;
    this.taskQueue = [];
    this.currentTask = null;
    this.stats = { processed: 0, failed: 0, lastActiveAt: 0, lastError: null };

    // How this agent's *working* status maps onto the Milestone 3 canonical
    // AI-state vocabulary, so agent activity lights up the OS AI Core / Brain
    // through the existing centralized system (set by the manager/bootstrap).
    this.canonicalState = spec.canonicalState || 'thinking';

    this._handler = typeof spec.handler === 'function' ? spec.handler : null;
    this._bus = spec.bus || bus;
    this._manager = null; // set by AgentManager.register
    this._unsub = [];     // subscription teardown fns
    this._processing = false;
  }

  Agent.prototype._emit = function (type, payload, opts) {
    return this._bus.emit(type, this.id, payload, opts);
  };

  /**
   * Central status transition — the ONE place a status ever changes.
   * Ignores unknown status values; warns (but still allows) an unusual
   * transition. Emits 'agent:status' on every actual change.
   * @param {string} next - one of AGENT_STATES
   * @param {object} [meta]
   */
  Agent.prototype.setStatus = function (next, meta) {
    if (Object.values(AGENT_STATES).indexOf(next) === -1) {
      AxLogger.warn('[AxiomAgentRuntime] "' + this.id + '" ignored unknown status:', next);
      return;
    }
    var prev = this.status;
    if (prev === next) return;
    if (!isValidTransition(prev, next)) {
      AxLogger.warn('[AxiomAgentRuntime] "' + this.id + '" unusual transition ' + prev + ' -> ' + next);
    }
    this.status = next;
    if (next !== AGENT_STATES.OFFLINE && next !== AGENT_STATES.IDLE) this.stats.lastActiveAt = Date.now();
    // Structured status event — this is how the Manager, the OS, and other
    // agents learn about a status change (never by reading a property poll).
    this._emit('agent:status', { id: this.id, prev: prev, status: next, meta: meta || null }, { crossTab: true });
  };

  // ---- Lifecycle -------------------------------------------------------
  /**
   * Bring the agent online: OFFLINE -> INITIALIZING -> IDLE, running the
   * optional onInit() hook and wiring event subscriptions along the way.
   * A failure during init is routed through fail() rather than rejecting,
   * so a caller awaiting this promise always gets the agent back.
   * @returns {Promise<Agent>}
   */
  Agent.prototype.init = function () {
    if (this.status !== AGENT_STATES.OFFLINE) return Promise.resolve(this);
    this.setStatus(AGENT_STATES.INITIALIZING);
    var self = this;
    return Promise.resolve()
      .then(function () { return self.onInit ? self.onInit() : null; })
      .then(function () {
        self._wireSubscriptions();
        self.setStatus(AGENT_STATES.IDLE);
        self._emit('agent:ready', { id: self.id });
        return self;
      })
      .catch(function (err) {
        self.fail(err);
        return self;
      });
  };

  /** Tear down subscriptions, clear the queue, and go OFFLINE. */
  Agent.prototype.shutdown = function () {
    this._unsub.forEach(function (off) { try { off(); } catch (e) {} });
    this._unsub = [];
    this.taskQueue = [];
    this.currentTask = null;
    this.setStatus(AGENT_STATES.OFFLINE);
  };

  Agent.prototype._wireSubscriptions = function () {
    var self = this;
    this.subscriptions.forEach(function (type) {
      self._unsub.push(self._bus.on(type, function (env) {
        // Never react to our own emissions.
        if (env.source === self.id) return;
        // Directed messages only reach their target.
        if (env.target && env.target !== self.id) return;
        try { self.onEvent(env); } catch (e) { self.fail(e); }
      }));
    });
  };

  // Default reaction to a subscribed event: if it is a task addressed to us,
  // enqueue it. Concrete agents can override onEvent for richer collaboration.
  Agent.prototype.onEvent = function (env) {
    if (env.type === 'task:assign' && env.target === this.id) {
      this.enqueue(env.payload);
    }
  };

  // ---- Task queue ------------------------------------------------------
  /**
   * Queue a task for this agent (assigning an id if it doesn't have one)
   * and kick off draining. Safe to call while the agent is already busy —
   * the task simply waits its turn.
   * @param {object} task
   * @returns {string} the task id (existing or newly assigned)
   */
  Agent.prototype.enqueue = function (task) {
    task = task || {};
    task.id = task.id || (this.id + ':' + (Date.now().toString(36)) + Math.random().toString(36).slice(2, 6));
    task.enqueuedAt = Date.now();
    this.taskQueue.push(task);
    this._emit('task:queued', { agent: this.id, task: task });
    this._drain();
    return task.id;
  };

  Agent.prototype._drain = function () {
    if (this._processing) return;
    var self = this;
    if (!this.taskQueue.length) return;
    this._processing = true;

    var task = this.taskQueue.shift();
    this.currentTask = task;
    this.setStatus(AGENT_STATES.THINKING, { task: task.id });
    this._emit('task:started', { agent: this.id, task: task });

    Promise.resolve()
      .then(function () {
        self.setStatus(AGENT_STATES.WORKING, { task: task.id });
        var ctx = { agent: self, bus: self._bus, manager: self._manager };
        if (self._handler) return self._handler(task, ctx);
        // No specialised handler: a generic, deterministic acknowledgement so
        // routing/orchestration is fully testable before real backends exist.
        return { ok: true, note: self.name + ' handled "' + (task.intent || task.type || 'task') + '"', echo: task };
      })
      .then(function (result) {
        self.stats.processed += 1;
        self.currentTask = null;
        self.setStatus(AGENT_STATES.COMPLETED, { task: task.id });
        self._emit('task:completed', { agent: self.id, task: task, result: result });
        self._processing = false;
        if (self.taskQueue.length) self._drain();
        else self.setStatus(AGENT_STATES.IDLE);
      })
      .catch(function (err) {
        self.stats.failed += 1;
        self.currentTask = null;
        self._emit('task:failed', { agent: self.id, task: task, error: String(err && err.message || err) });
        self.fail(err);
        self._processing = false;
        if (self.taskQueue.length) self._drain();
      });
  };

  // ---- Cancellation (Milestone 5, Step 6) -------------------------------
  // Cooperative: a queued task is simply removed; a task already in flight
  // is flagged `cancelled` so the capability wrapper running it (see
  // capability-kit.js) can stop honouring its result instead of the
  // runtime trying to forcibly abort arbitrary async work.
  /** @param {string} taskId @returns {boolean} true if a queued task was removed */
  Agent.prototype.cancelQueued = function (taskId) {
    var idx = -1;
    for (var i = 0; i < this.taskQueue.length; i++) { if (this.taskQueue[i].id === taskId) { idx = i; break; } }
    if (idx === -1) return false;
    var task = this.taskQueue.splice(idx, 1)[0];
    this._emit('task:cancelled', { agent: this.id, task: task });
    return true;
  };

  /** @returns {boolean} true if there was an in-flight task to flag cancelled */
  Agent.prototype.cancelCurrent = function () {
    if (!this.currentTask) return false;
    this.currentTask.cancelled = true;
    this._emit('task:cancel-requested', { agent: this.id, task: this.currentTask });
    return true;
  };

  /**
   * Cancel a task by id if queued, or the current task if no id (or the
   * id matches it) is given.
   * @param {string} [taskId]
   * @returns {boolean}
   */
  Agent.prototype.cancel = function (taskId) {
    if (taskId) return this.cancelQueued(taskId) || (this.currentTask && this.currentTask.id === taskId && this.cancelCurrent());
    return this.cancelCurrent();
  };

  /**
   * Record an error, go to ERROR status, then auto-recover to IDLE after
   * a short delay so one failed task never wedges the agent forever.
   * @param {Error|string} err
   */
  Agent.prototype.fail = function (err) {
    this.stats.lastError = String(err && err.message || err);
    this.setStatus(AGENT_STATES.ERROR, { error: this.stats.lastError });
    // Auto-recover to idle so one failed task never wedges the agent forever.
    var self = this;
    setTimeout(function () {
      if (self.status === AGENT_STATES.ERROR) self.setStatus(AGENT_STATES.IDLE);
    }, 1200);
  };

  /**
   * A compact, serialisable snapshot used by discovery, the manager, and
   * any future UI — never exposes internal refs (_bus/_manager/_handler).
   * @returns {object}
   */
  Agent.prototype.describe = function () {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      status: this.status,
      capabilities: this.capabilities.slice(),
      tools: this.tools.slice(),
      subscriptions: this.subscriptions.slice(),
      queued: this.taskQueue.length,
      current: this.currentTask ? this.currentTask.id : null,
      canonicalState: this.canonicalState,
      stats: Object.assign({}, this.stats)
    };
  };

  return {
    STATES: AGENT_STATES,
    isValidTransition: isValidTransition,
    bus: bus,
    createBus: createBus,
    Agent: Agent
  };
})();
