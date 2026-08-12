// ============================================================
// AXIOM — Block 2 / Step 6 / Part 3: Capability Routing & Intelligent
// Task Dispatch
// ------------------------------------------------------------
// Part 1 (os/core/orchestrator.js) built the registry/bus/scheduler.
// Part 2 (os/core/agent-registry-integration.js) populated the
// registry with the five real subsystems and added read-only
// discovery. Neither pass ever decided WHO should run a request —
// every caller still had to already know an agentId, or hand-pick a
// capability match themselves via dispatch()'s single "first healthy
// match" rule.
//
// This module is the routing brain. It sits entirely on top of the
// existing public AxiomOrchestrator API (registerAgent, listAgents,
// discoverAgents, listTasks, enqueue, on/emit, ...) — nothing here
// re-implements the registry, the bus, or the scheduler, and nothing
// here talks to a subsystem directly. It does three things, net-new:
//
//   1. Capability Router  — turns a loose request into a concrete,
//      deterministic choice of agent (analyzeRequest, resolveCapability,
//      selectAgent, resolvePriority, resolveExecutionPlan).
//   2. Execution Planner + Dispatch Pipeline — turns that choice into
//      an immutable execution plan and pushes it through the existing
//      Scheduler (validate -> prepare -> dispatch -> monitor ->
//      complete/fail/retry/cancel). No task ever bypasses
//      AxiomOrchestrator.enqueue().
//   3. Runtime monitoring + error routing — tracks queued/running/
//      completed/failed/retried/cancelled counts for routed requests,
//      and on failure tries an alternate healthy agent exposing the
//      same capability before giving up gracefully.
//
// What this module explicitly does NOT do:
//   - It does not modify os/core/orchestrator.js or
//     os/core/agent-registry-integration.js. Every capability below is
//     installed onto the existing AxiomOrchestrator object from the
//     outside, the same convention Part 2 used for its discovery API,
//     so Part 1's and Part 2's files and regression suites stay valid
//     and untouched.
//   - It does not talk to OpenRouter or any AI provider.
//   - It does not touch any .html file or any js/pages/* UI file.
//   - It does not hardcode any subsystem name. Every decision is made
//     by reading AxiomOrchestrator.listAgents()/discoverAgents() —
//     "browser", "brain", etc. never appear as literals in this file.
//
// Usage:
//   AxiomOrchestrator.route({ capability: 'navigate',
//     payload: { url: 'https://example.com' }, priority: 5 });
//   // -> { requestId, taskId, plan, accepted: true }
//
//   AxiomOrchestrator.getTaskStatus(requestId)
//   AxiomOrchestrator.getTaskMetrics()
//   AxiomOrchestrator.getExecutionHistory(20)
//   AxiomOrchestrator.getQueueStatus()
// ============================================================
(function (global) {
  'use strict';

  var Orchestrator = global.AxiomOrchestrator;

  function log(method, message, detail) {
    var l = global.AxLogger;
    if (l && typeof l[method] === 'function') {
      l[method]('[CapabilityRouter] ' + message, detail !== undefined ? detail : '');
      return;
    }
    try {
      // eslint-disable-next-line no-console
      console[method === 'error' ? 'error' : 'log']('[CapabilityRouter] ' + message, detail || '');
    } catch (e) { /* no console available — swallow */ }
  }

  if (!Orchestrator || typeof Orchestrator.registerAgent !== 'function' ||
      typeof Orchestrator.listAgents !== 'function' || typeof Orchestrator.enqueue !== 'function') {
    log('error', 'AxiomOrchestrator (os/core/orchestrator.js) not found — load it before capability-router.js.');
    return;
  }

  var API_VERSION = '1.0.0';

  // ------------------------------------------------------------
  // Small deterministic helpers
  // ------------------------------------------------------------
  var seq = 0;
  function makeRequestId() {
    seq += 1;
    return 'req-' + Date.now().toString(36) + '-' + seq;
  }

  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }

  // A "structural" error means the request itself was malformed —
  // the same class of caller bug AxiomOrchestrator.dispatch() already
  // throws synchronously for today. Anything else (agent temporarily
  // unavailable, no eligible candidate right now, ...) is a routing
  // outcome, not a caller bug, and route() converts it into a
  // standardized graceful failure instead (Part F).
  function structuralError(message) {
    var err = new Error(message);
    err.structural = true;
    return err;
  }

  // Simple prefix-wildcard permission match: an agent permission entry
  // of "browser:*" satisfies a required permission of "browser:navigate".
  // An exact string match always satisfies.
  function permissionSatisfies(granted, required) {
    if (granted === required) return true;
    if (granted.slice(-2) === ':*') {
      var prefix = granted.slice(0, -1); // "browser:"
      return required.slice(0, prefix.length) === prefix;
    }
    return false;
  }

  function hasPermission(agent, required) {
    if (!required) return true;
    return agent.permissions.some(function (p) { return permissionSatisfies(p, required); });
  }

  // ------------------------------------------------------------
  // Router-local agent priority weights (Part D). This is additive
  // metadata the router owns — it does NOT extend the Agent Registry's
  // record shape in orchestrator.js. Unset agents default to 0.
  // Higher priority wins when every other selection criterion ties.
  // ------------------------------------------------------------
  var agentPriority = Object.create(null);

  function setAgentPriority(agentId, priority) {
    if (!isNonEmptyString(agentId) || typeof priority !== 'number') return false;
    agentPriority[agentId] = priority;
    return true;
  }

  function getAgentPriority(agentId) {
    return typeof agentPriority[agentId] === 'number' ? agentPriority[agentId] : 0;
  }

  // ------------------------------------------------------------
  // PART A — Capability Router
  // ------------------------------------------------------------

  // analyzeRequest(): normalizes a loose caller-supplied request into a
  // stable shape. Throws only on structurally invalid input (same
  // validation posture as the rest of the codebase) — never touches
  // the registry or the scheduler.
  function analyzeRequest(request) {
    if (!request || typeof request !== 'object') {
      throw structuralError('AxiomOrchestrator.route: request object required.');
    }
    if (!request.agentId && !request.capability && !request.type) {
      throw structuralError('AxiomOrchestrator.route: request needs at least one of agentId, capability, or type.');
    }
    return {
      requestId: isNonEmptyString(request.requestId) ? request.requestId : makeRequestId(),
      agentId: isNonEmptyString(request.agentId) ? request.agentId : null,
      capability: isNonEmptyString(request.capability) ? request.capability : null,
      type: isNonEmptyString(request.type) ? request.type : 'default',
      payload: request.payload !== undefined ? request.payload : null,
      requiredPermission: isNonEmptyString(request.requiredPermission) ? request.requiredPermission : null,
      priorityHint: request.priority,
      timeoutHint: request.timeout,
      maxRetriesHint: request.maxRetries,
      retryDelayHint: request.retryDelay,
      allowFailover: request.allowFailover !== false, // default true
      excludeAgents: Array.isArray(request.excludeAgents) ? request.excludeAgents.slice() : []
    };
  }

  // resolveCapability(): decides which capability string the request
  // actually needs. An explicit agentId with no capability is honored
  // as-is (the caller already knows who); otherwise an explicit
  // capability wins; otherwise a request "type" that happens to match a
  // capability already known to the registry is treated as that
  // capability (this mirrors how existing agents name their task types
  // 1:1 with the capability they advertise, e.g. "navigate").
  // Built directly off AxiomOrchestrator.listAgents() rather than
  // reusing Part 2's discoverCapabilities() — the Router must not
  // depend on Part 2 being loaded, and must never hardcode a
  // subsystem/capability name itself.
  function allKnownCapabilities() {
    var set = Object.create(null);
    Orchestrator.listAgents().forEach(function (a) {
      a.capabilities.forEach(function (c) { set[c] = true; });
    });
    return Object.keys(set);
  }

  function resolveCapability(analyzed) {
    if (analyzed.capability) return analyzed.capability;
    if (analyzed.agentId) return null; // explicit routing, no capability lookup needed
    var known = allKnownCapabilities();
    if (known.indexOf(analyzed.type) !== -1) return analyzed.type;
    throw structuralError('AxiomOrchestrator.route: could not resolve a capability for request (no agentId, no capability, ' +
      'and type "' + analyzed.type + '" does not match any known capability).');
  }

  // selectAgent(): deterministic selection among every agent exposing
  // `capability`. Never random. Order of criteria:
  //   1. eligibility  — not disabled, health !== 'unhealthy', has the
  //      required permission (if any), not in excludeAgents
  //   2. health rank  — healthy before degraded
  //   3. availability — idle before busy before error
  //   4. workload     — fewer queued+running tasks first
  //   5. agent priority (router-local weight) — higher first
  //   6. agent id, lexical — final deterministic tiebreaker
  var HEALTH_RANK = { healthy: 0, degraded: 1, unhealthy: 2 };
  var STATUS_RANK = { idle: 0, busy: 1, error: 2, disabled: 3 };

  function currentWorkload(agentId) {
    var queued = Orchestrator.listTasks({ agentId: agentId, status: 'queued' }).length;
    var running = Orchestrator.listTasks({ agentId: agentId, status: 'running' }).length;
    return queued + running;
  }

  function selectAgent(capability, options) {
    options = options || {};
    var exclude = Array.isArray(options.excludeAgents) ? options.excludeAgents : [];
    var requiredPermission = options.requiredPermission || null;

    var candidates = Orchestrator.discoverAgents ?
      Orchestrator.discoverAgents({ capability: capability }) :
      Orchestrator.listAgents().filter(function (a) { return a.capabilities.indexOf(capability) !== -1; });

    var eligible = candidates.filter(function (a) {
      if (exclude.indexOf(a.id) !== -1) return false;
      if (a.status === 'disabled') return false;
      if (a.health === 'unhealthy') return false;
      if (!hasPermission(a, requiredPermission)) return false;
      return true;
    });

    if (!eligible.length) return null;

    eligible.sort(function (a, b) {
      var healthDiff = HEALTH_RANK[a.health] - HEALTH_RANK[b.health];
      if (healthDiff !== 0) return healthDiff;

      var statusDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (statusDiff !== 0) return statusDiff;

      var workloadDiff = currentWorkload(a.id) - currentWorkload(b.id);
      if (workloadDiff !== 0) return workloadDiff;

      var priorityDiff = getAgentPriority(b.id) - getAgentPriority(a.id); // higher first
      if (priorityDiff !== 0) return priorityDiff;

      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });

    return eligible[0];
  }

  // resolvePriority(): normalizes a request's priority into the
  // Scheduler's numeric convention (higher runs first), applying a
  // sane default and clamping obviously-invalid input rather than
  // silently misordering the queue.
  var DEFAULT_PRIORITY = 0;
  var MIN_PRIORITY = -100;
  var MAX_PRIORITY = 100;

  function resolvePriority(analyzed) {
    var p = analyzed.priorityHint;
    if (typeof p !== 'number' || isNaN(p)) return DEFAULT_PRIORITY;
    if (p < MIN_PRIORITY) return MIN_PRIORITY;
    if (p > MAX_PRIORITY) return MAX_PRIORITY;
    return p;
  }

  var DEFAULT_TIMEOUT = 30000;
  var DEFAULT_MAX_RETRIES = 1;
  var DEFAULT_RETRY_DELAY = 500;

  // resolveExecutionPlan(): the one function that turns a raw request
  // into a concrete, immutable plan. This is Part B's entry point,
  // built entirely out of Part A's own functions.
  function resolveExecutionPlan(request) {
    var analyzed = analyzeRequest(request);
    var capability = analyzed.agentId ? analyzed.capability : resolveCapability(analyzed);

    var agent;
    if (analyzed.agentId) {
      agent = Orchestrator.getAgent(analyzed.agentId);
      if (!agent) {
        throw new Error('AxiomOrchestrator.route: unknown agentId "' + analyzed.agentId + '".');
      }
    } else {
      agent = selectAgent(capability, {
        excludeAgents: analyzed.excludeAgents,
        requiredPermission: analyzed.requiredPermission
      });
      if (!agent) {
        throw new Error('AxiomOrchestrator.route: no eligible agent found for capability "' + capability + '".');
      }
    }

    var plan = {
      requestId: analyzed.requestId,
      agentId: agent.id,
      capability: capability || null,
      type: analyzed.type,
      payload: analyzed.payload,
      priority: resolvePriority(analyzed),
      timeout: typeof analyzed.timeoutHint === 'number' ? analyzed.timeoutHint : DEFAULT_TIMEOUT,
      retryPolicy: Object.freeze({
        maxRetries: typeof analyzed.maxRetriesHint === 'number' ? analyzed.maxRetriesHint : DEFAULT_MAX_RETRIES,
        retryDelay: typeof analyzed.retryDelayHint === 'number' ? analyzed.retryDelayHint : DEFAULT_RETRY_DELAY
      }),
      executionPath: Object.freeze([
        { step: 'capability_router', capability: capability || null, explicitAgent: !!analyzed.agentId },
        { step: 'agent_selected', agentId: agent.id },
        { step: 'scheduler_enqueue' }
      ]),
      allowFailover: analyzed.allowFailover && !analyzed.agentId, // explicit agentId requests never failover
      excludeAgents: Object.freeze(analyzed.excludeAgents.slice()),
      requiredPermission: analyzed.requiredPermission,
      createdAt: Date.now()
    };

    return Object.freeze(plan);
  }

  // ------------------------------------------------------------
  // PART C — Dispatch Pipeline + PART E — Runtime Monitoring state
  // ------------------------------------------------------------
  // requestsById tracks every request routed through this module,
  // independent of (but cross-referenced with) the Scheduler's own
  // tasksById — this is what powers getTaskStatus/getTaskMetrics/
  // getExecutionHistory/getQueueStatus without reaching into the
  // Scheduler's internals.
  var requestsById = Object.create(null);
  var taskIdToRequestId = Object.create(null);
  var history = []; // finished requests, newest first, bounded
  var HISTORY_LIMIT = 500;

  var metrics = {
    queued: 0, running: 0, completed: 0, failed: 0, retried: 0,
    cancelled: 0, failedOver: 0
  };

  var REQUEST_STATUS = {
    PLANNED: 'planned',
    QUEUED: 'queued',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
  };

  function recordHistory(entry) {
    history.unshift(entry);
    if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
  }

  // validate(): confirms a plan is still actionable right before it is
  // handed to the Scheduler — an agent can go unhealthy/disabled/
  // unregistered in the window between planning and dispatch.
  function validate(plan) {
    if (!plan || !plan.agentId) {
      return { valid: false, reason: 'Execution plan is missing an agentId.' };
    }
    var agent = Orchestrator.getAgent(plan.agentId);
    if (!agent) {
      return { valid: false, reason: 'Agent "' + plan.agentId + '" is no longer registered.' };
    }
    if (agent.status === 'disabled') {
      return { valid: false, reason: 'Agent "' + plan.agentId + '" is disabled.' };
    }
    if (agent.health === 'unhealthy') {
      return { valid: false, reason: 'Agent "' + plan.agentId + '" is unhealthy.' };
    }
    if (!hasPermission(agent, plan.requiredPermission)) {
      return { valid: false, reason: 'Agent "' + plan.agentId + '" lacks required permission "' + plan.requiredPermission + '".' };
    }
    return { valid: true };
  }

  // prepare(): turns an immutable plan into the mutable request shape
  // the Scheduler's enqueue() expects. Never mutates the plan itself.
  function prepare(plan) {
    return {
      agentId: plan.agentId,
      type: plan.type,
      payload: plan.payload,
      priority: plan.priority,
      timeout: plan.timeout,
      maxRetries: plan.retryPolicy.maxRetries,
      retryDelay: plan.retryPolicy.retryDelay
    };
  }

  // dispatch(): the only function in this module that hands work to
  // the Scheduler, and it always goes through AxiomOrchestrator.enqueue()
  // — the same public entry point orchestrator.js itself uses — never
  // a private/bypassed path.
  function dispatchPlan(plan) {
    var taskId = Orchestrator.enqueue(prepare(plan));
    taskIdToRequestId[taskId] = plan.requestId;
    var record = requestsById[plan.requestId];
    record.taskId = taskId;
    record.status = REQUEST_STATUS.QUEUED;
    metrics.queued += 1;
    return taskId;
  }

  // route(): the full Capability Router + Execution Planner + Dispatch
  // Pipeline pipeline, and the primary public entry point. Never
  // throws for routing/availability failures — those come back as a
  // standardized { accepted:false, error } result (Part F). It can
  // still throw on structurally invalid input, matching
  // AxiomOrchestrator.dispatch()'s own validation posture.
  function route(request) {
    var plan;
    try {
      plan = resolveExecutionPlan(request);
    } catch (err) {
      // Structurally invalid requests are a caller bug, same posture
      // as dispatch() today — surfaced immediately. Everything else
      // (unknown agentId, no eligible agent for a resolvable
      // capability, ...) is a routing/availability outcome, and Part F
      // requires that to come back as a standardized graceful failure
      // rather than an exception.
      if (err && err.structural) throw err;
      var requestId = (request && isNonEmptyString(request.requestId)) ? request.requestId : makeRequestId();
      requestsById[requestId] = requestsById[requestId] || {
        requestId: requestId, plan: null, taskId: null, status: REQUEST_STATUS.PLANNED,
        failoverCount: 0, triedAgents: [], startedAt: null, finishedAt: null, result: null, error: null
      };
      return standardizedFailure(requestId, (err && err.message) ? err.message : String(err));
    }

    requestsById[plan.requestId] = {
      requestId: plan.requestId,
      plan: plan,
      taskId: null,
      status: REQUEST_STATUS.PLANNED,
      failoverCount: 0,
      triedAgents: [plan.agentId],
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null
    };

    var check = validate(plan);
    if (!check.valid) {
      return standardizedFailure(plan.requestId, check.reason);
    }

    try {
      var taskId = dispatchPlan(plan);
      return { accepted: true, requestId: plan.requestId, taskId: taskId, agentId: plan.agentId, plan: plan };
    } catch (err) {
      var message = (err && err.message) ? err.message : String(err);
      return standardizedFailure(plan.requestId, message);
    }
  }

  function standardizedFailure(requestId, reason) {
    var record = requestsById[requestId];
    if (record) {
      record.status = REQUEST_STATUS.FAILED;
      record.error = reason;
      record.finishedAt = Date.now();
      metrics.failed += 1;
      recordHistory(snapshotRecord(record));
    }
    Orchestrator.emit('route_failed', { requestId: requestId, reason: reason });
    return { accepted: false, requestId: requestId, error: reason };
  }

  function snapshotRecord(record) {
    return {
      requestId: record.requestId,
      agentId: record.plan ? record.plan.agentId : null,
      capability: record.plan ? record.plan.capability : null,
      taskId: record.taskId,
      status: record.status,
      failoverCount: record.failoverCount,
      triedAgents: record.triedAgents.slice(),
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      result: record.result,
      error: record.error
    };
  }

  // monitor(): point-in-time status of a routed request, cross
  // referencing the Scheduler's own task record so callers never see
  // two sources of truth drift apart.
  function monitor(requestId) {
    var record = requestsById[requestId];
    if (!record) return null;
    var task = record.taskId ? Orchestrator.getTask(record.taskId) : null;
    return {
      requestId: requestId,
      agentId: record.plan ? record.plan.agentId : null,
      capability: record.plan ? record.plan.capability : null,
      taskId: record.taskId,
      status: record.status,
      task: task,
      failoverCount: record.failoverCount,
      triedAgents: record.triedAgents.slice()
    };
  }

  // cancel(): cancels the underlying task (through the Scheduler's own
  // cancel(), never a bypass) and marks the request terminal.
  function cancelRequest(requestId, reason) {
    var record = requestsById[requestId];
    if (!record) return false;
    if (!record.taskId) return false;
    var ok = Orchestrator.cancel(record.taskId, reason || 'cancelled_by_router');
    if (ok) {
      record.status = REQUEST_STATUS.CANCELLED;
      record.finishedAt = Date.now();
      metrics.cancelled += 1;
      recordHistory(snapshotRecord(record));
    }
    return ok;
  }

  // retry(): an explicit, caller-initiated re-attempt of a finished
  // (failed/cancelled) request. Re-runs the full planner so a
  // newly-healthy agent, or a newly-registered one, can be picked up —
  // this is deliberately distinct from the Scheduler's own same-agent
  // retry(), which only replays the exact task that failed.
  function retryRequest(requestId) {
    var record = requestsById[requestId];
    if (!record) return { accepted: false, requestId: requestId, error: 'Unknown requestId.' };
    if (record.status !== REQUEST_STATUS.FAILED && record.status !== REQUEST_STATUS.CANCELLED) {
      return { accepted: false, requestId: requestId, error: 'Request is not in a retryable state (' + record.status + ').' };
    }
    if (!record.plan) {
      return { accepted: false, requestId: requestId, error: 'Request never produced an execution plan; nothing to retry.' };
    }
    metrics.retried += 1;
    var nextRequest = {
      requestId: requestId,
      agentId: record.plan.agentId, // preserve original targeting unless it was capability-based
      capability: record.plan.capability,
      type: record.plan.type,
      payload: record.plan.payload,
      priority: record.plan.priority,
      timeout: record.plan.timeout,
      maxRetries: record.plan.retryPolicy.maxRetries,
      retryDelay: record.plan.retryPolicy.retryDelay,
      requiredPermission: record.plan.requiredPermission,
      allowFailover: record.plan.allowFailover,
      excludeAgents: []
    };
    // Explicit-agent plans stay pinned; capability plans are free to
    // re-resolve to any currently-eligible agent, including the
    // original one.
    if (record.plan.capability && !isPinnedToOriginalAgent(record)) {
      delete nextRequest.agentId;
    }
    return route(nextRequest);
  }

  function isPinnedToOriginalAgent(record) {
    // A plan was explicit-agent if capability_router's executionPath
    // step recorded explicitAgent:true.
    return record.plan.executionPath.some(function (step) {
      return step.step === 'capability_router' && step.explicitAgent === true;
    });
  }

  // ------------------------------------------------------------
  // PART F — Error Routing (alternate-agent failover)
  // ------------------------------------------------------------
  var MAX_FAILOVER_HOPS = 2;

  function attemptFailover(record, reason) {
    if (!record.plan.allowFailover) return false;
    if (record.failoverCount >= MAX_FAILOVER_HOPS) return false;
    if (!record.plan.capability) return false; // explicit-agent requests never failover

    var alternate = selectAgent(record.plan.capability, {
      excludeAgents: record.triedAgents,
      requiredPermission: record.plan.requiredPermission
    });
    if (!alternate) return false;

    record.failoverCount += 1;
    record.triedAgents.push(alternate.id);
    metrics.failedOver += 1;

    log('log', 'Failing over request "' + record.requestId + '" from agent unavailability (' + reason +
      ') to alternate agent "' + alternate.id + '".');

    var failoverRequest = {
      requestId: record.requestId,
      agentId: alternate.id,
      type: record.plan.type,
      payload: record.plan.payload,
      priority: record.plan.priority,
      timeout: record.plan.timeout,
      maxRetries: record.plan.retryPolicy.maxRetries,
      retryDelay: record.plan.retryPolicy.retryDelay,
      requiredPermission: record.plan.requiredPermission
    };

    var newPlan = resolveExecutionPlan(failoverRequest);
    // Preserve capability + failover eligibility + tried-agent history
    // on the record; only the plan's chosen agent actually changes.
    var mergedPlan = Object.freeze(Object.assign({}, newPlan, {
      capability: record.plan.capability,
      allowFailover: record.plan.allowFailover,
      executionPath: Object.freeze(record.plan.executionPath.concat([
        { step: 'failover', fromAgent: record.plan.agentId, toAgent: alternate.id, reason: reason }
      ]))
    }));
    record.plan = mergedPlan;

    var check = validate(mergedPlan);
    if (!check.valid) return false;

    try {
      dispatchPlan(mergedPlan);
      return true;
    } catch (err) {
      return false;
    }
  }

  // ------------------------------------------------------------
  // Lifecycle wiring — the ONLY place this module observes task
  // outcomes. It never polls; it reacts to the Scheduler's own
  // task_started/task_completed/task_failed events, which is also how
  // it guarantees it never bypasses the Scheduler.
  // ------------------------------------------------------------
  function onTaskStarted(payload) {
    var requestId = taskIdToRequestId[payload.task.id];
    if (!requestId) return;
    var record = requestsById[requestId];
    if (!record) return;
    record.status = REQUEST_STATUS.RUNNING;
    record.startedAt = payload.task.startedAt;
    metrics.queued = Math.max(0, metrics.queued - 1);
    metrics.running += 1;
  }

  function onTaskCompleted(payload) {
    var requestId = taskIdToRequestId[payload.task.id];
    if (!requestId) return;
    var record = requestsById[requestId];
    if (!record) return;
    record.status = REQUEST_STATUS.COMPLETED;
    record.result = payload.result;
    record.finishedAt = payload.task.finishedAt;
    metrics.running = Math.max(0, metrics.running - 1);
    metrics.completed += 1;
    recordHistory(snapshotRecord(record));
    Orchestrator.emit('route_completed', { requestId: requestId, result: payload.result });
  }

  function onTaskFailed(payload) {
    var requestId = taskIdToRequestId[payload.task.id];
    if (!requestId) return;
    var record = requestsById[requestId];
    if (!record) return;

    // A task that was cancelled via cancelRequest()/cancel() already
    // recorded its own terminal state — don't double-count it here.
    if (record.status === REQUEST_STATUS.CANCELLED) return;

    metrics.running = Math.max(0, metrics.running - 1);

    var failedOver = !payload.cancelled && attemptFailover(record, payload.reason);
    if (failedOver) return; // record stays non-terminal; new task is in flight

    record.status = REQUEST_STATUS.FAILED;
    record.error = payload.reason;
    record.finishedAt = payload.task.finishedAt;
    metrics.failed += 1;
    recordHistory(snapshotRecord(record));
    Orchestrator.emit('route_failed', { requestId: requestId, reason: payload.reason });
  }

  Orchestrator.on('task_started', onTaskStarted);
  Orchestrator.on('task_completed', onTaskCompleted);
  Orchestrator.on('task_failed', onTaskFailed);

  // ------------------------------------------------------------
  // PART E — Runtime Monitoring, public read APIs
  // ------------------------------------------------------------
  function getTaskStatus(requestId) {
    return monitor(requestId);
  }

  function getTaskMetrics() {
    return {
      queued: metrics.queued,
      running: metrics.running,
      completed: metrics.completed,
      failed: metrics.failed,
      retried: metrics.retried,
      cancelled: metrics.cancelled,
      failedOver: metrics.failedOver,
      totalRequests: Object.keys(requestsById).length
    };
  }

  function getExecutionHistory(limit) {
    var n = typeof limit === 'number' && limit > 0 ? limit : history.length;
    return history.slice(0, n);
  }

  function getQueueStatus() {
    var byAgent = Object.create(null);
    Orchestrator.listAgents().forEach(function (a) {
      byAgent[a.id] = {
        agentId: a.id,
        health: a.health,
        status: a.status,
        queued: Orchestrator.listTasks({ agentId: a.id, status: 'queued' }).length,
        running: Orchestrator.listTasks({ agentId: a.id, status: 'running' }).length
      };
    });
    return {
      byAgent: byAgent,
      totals: Orchestrator.getStats().tasks,
      timestamp: Date.now()
    };
  }

  // ------------------------------------------------------------
  // Install onto the existing AxiomOrchestrator object (additive
  // only — orchestrator.js itself is not edited, so Part 1/Part 2's
  // files and regression suites remain valid and untouched).
  // ------------------------------------------------------------
  function installRoutingApi() {
    if (typeof Orchestrator.route === 'function') return; // idempotent

    // Part A — Capability Router
    Orchestrator.analyzeRequest = analyzeRequest;
    Orchestrator.resolveCapability = function (request) { return resolveCapability(analyzeRequest(request)); };
    Orchestrator.selectAgent = selectAgent;
    Orchestrator.resolvePriority = function (request) { return resolvePriority(analyzeRequest(request)); };
    Orchestrator.resolveExecutionPlan = resolveExecutionPlan;
    Orchestrator.setAgentPriority = setAgentPriority;
    Orchestrator.getAgentPriority = getAgentPriority;

    // Part C — Dispatch Pipeline
    Orchestrator.route = route;
    Orchestrator.validateExecutionPlan = validate;
    Orchestrator.prepareExecutionPlan = prepare;
    Orchestrator.monitorRequest = monitor;
    Orchestrator.cancelRequest = cancelRequest;
    Orchestrator.retryRequest = retryRequest;

    // Part E — Runtime Monitoring
    Orchestrator.getTaskStatus = getTaskStatus;
    Orchestrator.getTaskMetrics = getTaskMetrics;
    Orchestrator.getExecutionHistory = getExecutionHistory;
    Orchestrator.getQueueStatus = getQueueStatus;
  }

  installRoutingApi();

  var AxiomCapabilityRouter = {
    API_VERSION: API_VERSION,
    // exposed directly too, for callers/tests that want the module
    // without going through the installed AxiomOrchestrator surface
    analyzeRequest: analyzeRequest,
    resolveCapability: function (request) { return resolveCapability(analyzeRequest(request)); },
    selectAgent: selectAgent,
    resolvePriority: function (request) { return resolvePriority(analyzeRequest(request)); },
    resolveExecutionPlan: resolveExecutionPlan,
    route: route,
    validate: validate,
    prepare: prepare,
    monitor: monitor,
    cancelRequest: cancelRequest,
    retryRequest: retryRequest,
    setAgentPriority: setAgentPriority,
    getAgentPriority: getAgentPriority,
    getTaskStatus: getTaskStatus,
    getTaskMetrics: getTaskMetrics,
    getExecutionHistory: getExecutionHistory,
    getQueueStatus: getQueueStatus
  };

  global.AxiomCapabilityRouter = AxiomCapabilityRouter;
})(window);
