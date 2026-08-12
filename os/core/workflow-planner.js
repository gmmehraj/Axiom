// ============================================================
// AXIOM — Block 2 / Step 6 / Part 4: Multi-Agent Collaboration &
// Workflow Orchestration
// ------------------------------------------------------------
// Part 1 (orchestrator.js) gave every agent a place to register and
// a scheduler to run under. Part 3 (capability-router.js) gave a
// single request a real routing/dispatch/failover pipeline. Both of
// those are still "one request, one agent, one answer".
//
// This module is the layer above that: a Workflow Planner that lets
// several agents collaborate, in order, on ONE user-facing request —
// Executive -> Research -> Browser -> Memory -> Executive, say —
// without any of those agents ever calling each other directly.
// Every hand-off between stages still goes through
// AxiomOrchestrator/AxiomCapabilityRouter, so agent isolation (a
// hard requirement carried over from Part 1) is preserved: an agent
// handler never receives a reference to another agent, only the
// slice of Workflow Context its stage declared it needs.
//
// This file does not touch, re-implement, or import from Browser,
// Brain, Memory, Automation, Analytics, or any UI file. It is purely
// additive to the Orchestrator layer, exactly like capability-router
// .js was — it installs a few extra methods onto the existing
// AxiomOrchestrator singleton and otherwise stands alone as
// AxiomWorkflowPlanner.
//
// Usage:
//   const wf = AxiomOrchestrator.createWorkflow({
//     name: 'research-and-remember',
//     stages: [
//       { id: 'plan',     agentId: 'executive', input: (ctx) => ctx.trigger },
//       { id: 'research', capability: 'research', dependsOn: ['plan'] },
//       { id: 'browse',   capability: 'browse',   dependsOn: ['research'], optional: true },
//       { id: 'remember', capability: 'memory:write', dependsOn: ['browse', 'research'] },
//       { id: 'summarize', agentId: 'executive', dependsOn: ['remember'] }
//     ]
//   });
//   AxiomOrchestrator.executeWorkflow(wf.id, { trigger: 'find and save today\'s AI news' });
//   AxiomOrchestrator.on('workflow_completed', ({ workflowId, context }) => { ... });
// ============================================================
(function (global) {
  'use strict';

  var Orchestrator = global.AxiomOrchestrator;

  function log(method, message, detail) {
    if (global.console && typeof global.console[method] === 'function') {
      global.console[method]('[AxiomWorkflowPlanner] ' + message, detail || '');
    }
  }

  function reportError(where, err, detail) {
    log('error', where + ': ' + ((err && err.message) ? err.message : String(err)), detail);
  }

  if (!Orchestrator) {
    // Same posture as capability-router.js: this module is a strict
    // extension of the Orchestrator core and cannot function without
    // it. Fail loudly rather than silently create a disconnected
    // global that looks like it works.
    throw new Error('AxiomWorkflowPlanner requires os/core/orchestrator.js to be loaded first.');
  }

  // FIX 3/4 (Runtime Context Integration / Naming Collision): Workflow
  // Planner used to keep its own private per-workflow context object
  // via an internal createContext(wf, trigger) helper — a second,
  // parallel context implementation with a name that collided with
  // the real one in runtime-context.js. There is now exactly ONE
  // context system (os/core/runtime-context.js / AxiomRuntimeContext)
  // and Workflow Planner is a caller of it, not a re-implementer of
  // it: every workflow run creates a Runtime Context, updates it as
  // stages complete, and destroys it when the workflow reaches a
  // terminal state. See createWorkflowContext()/syncWorkflowContext()/
  // finalizeWorkflowContext() below (Part C).
  var RuntimeContext = global.AxiomRuntimeContext;
  if (!RuntimeContext) {
    throw new Error('AxiomWorkflowPlanner requires os/core/runtime-context.js to be loaded before workflow-planner.js.');
  }

  var API_VERSION = '1.0.0';

  // ------------------------------------------------------------
  // Small shared helpers
  // ------------------------------------------------------------
  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  var idCounter = 0;
  function makeId(prefix) {
    idCounter += 1;
    return prefix + '_' + Date.now().toString(36) + '_' + idCounter.toString(36);
  }

  function structuralError(message) {
    var err = new Error(message);
    err.structural = true;
    return err;
  }

  function deepFreeze(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    Object.getOwnPropertyNames(obj).forEach(function (key) {
      var val = obj[key];
      if (val && typeof val === 'object' && !Object.isFrozen(val)) deepFreeze(val);
    });
    return Object.freeze(obj);
  }

  // ------------------------------------------------------------
  // PART D — Dependency Resolution
  // ------------------------------------------------------------
  // Turns a flat stage list into a deterministic execution order
  // (topological sort) and fails fast — before any agent is ever
  // dispatched — on structural problems: unknown stage ids in
  // dependsOn, duplicate stage ids, and circular dependencies.
  function topologicalOrder(stages) {
    var byId = Object.create(null);
    stages.forEach(function (s) {
      if (byId[s.id]) {
        throw structuralError('Workflow has duplicate stage id "' + s.id + '".');
      }
      byId[s.id] = s;
    });
    stages.forEach(function (s) {
      (s.dependsOn || []).forEach(function (dep) {
        if (!byId[dep]) {
          throw structuralError('Stage "' + s.id + '" depends on unknown stage "' + dep + '".');
        }
      });
    });

    var VISITING = 1, DONE = 2;
    var state = Object.create(null);
    var order = [];
    var stack = [];

    function visit(id) {
      if (state[id] === DONE) return;
      if (state[id] === VISITING) {
        var cycle = stack.slice(stack.indexOf(id)).concat([id]);
        var err = structuralError('Circular dependency detected in workflow: ' + cycle.join(' -> ') + '.');
        err.circular = true;
        err.cycle = cycle;
        throw err;
      }
      state[id] = VISITING;
      stack.push(id);
      (byId[id].dependsOn || []).forEach(visit);
      stack.pop();
      state[id] = DONE;
      order.push(id);
    }

    Object.keys(byId).forEach(visit);
    return order.map(function (id) { return byId[id]; });
  }

  // Stages with no unresolved dependencies among stages that have not
  // yet completed successfully or been skipped. Used both to compute
  // "waves" for optimizeWorkflow() and to drive sequential execution.
  function readyStages(stages, doneIds) {
    return stages.filter(function (s) {
      if (doneIds[s.id]) return false;
      return (s.dependsOn || []).every(function (dep) { return doneIds[dep]; });
    });
  }

  // ------------------------------------------------------------
  // Workflow / Stage state constants
  // ------------------------------------------------------------
  var WORKFLOW_STATUS = {
    CREATED: 'created',
    VALIDATED: 'validated',
    RUNNING: 'running',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
  };

  var STAGE_STATUS = {
    PENDING: 'pending',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    SKIPPED: 'skipped',
    CANCELLED: 'cancelled'
  };

  var TERMINAL_WORKFLOW_STATUSES = [
    WORKFLOW_STATUS.COMPLETED, WORKFLOW_STATUS.FAILED, WORKFLOW_STATUS.CANCELLED
  ];

  // Block 2 / Step 6 / Part 6A: bounds how many *finished* workflow
  // records workflowsById retains. Same convention as
  // capability-router.js's and runtime-context.js's own HISTORY_LIMIT,
  // and as the MAX_COMPLETED_TASK_HISTORY fix applied to orchestrator.js
  // in this same pass. Workflows still CREATED/VALIDATED/RUNNING/PAUSED
  // are never affected by this limit.
  var MAX_COMPLETED_WORKFLOW_HISTORY = 1000;

  // ------------------------------------------------------------
  // PART A — Workflow Planner: storage + createWorkflow/validateWorkflow
  // ------------------------------------------------------------
  var workflowsById = Object.create(null);

  // Trims the oldest finished workflow records once the finished count
  // exceeds MAX_COMPLETED_WORKFLOW_HISTORY. Workflow ids are non-numeric
  // string keys ('wf_<base36>_<counter>' by default, or a caller-supplied
  // string id), so Object.keys(workflowsById) preserves insertion order
  // per spec for the default id shape — the first entries in the
  // filtered list are the oldest finished workflows. Never removes an
  // active (non-terminal) workflow.
  function pruneFinishedWorkflowHistory() {
    var finishedIds = Object.keys(workflowsById).filter(function (id) {
      return TERMINAL_WORKFLOW_STATUSES.indexOf(workflowsById[id].status) !== -1;
    });
    var excess = finishedIds.length - MAX_COMPLETED_WORKFLOW_HISTORY;
    for (var i = 0; i < excess; i++) {
      delete workflowsById[finishedIds[i]];
    }
  }

  function normalizeStage(raw) {
    if (!isPlainObject(raw) || !isNonEmptyString(raw.id)) {
      throw structuralError('Every workflow stage needs a string "id".');
    }
    if (!raw.agentId && !raw.capability) {
      throw structuralError('Stage "' + raw.id + '" needs an "agentId" or a "capability" to route on.');
    }
    return {
      id: raw.id,
      agentId: raw.agentId || null,
      capability: raw.capability || null,
      // Optional: the operation type a type-dispatching agent handler
      // should receive (e.g. agent-registry-integration.js's agents,
      // which switch on task.type). When omitted, behavior is exactly
      // as before this field existed — the stage id is sent as the
      // task's type, tagged for workflow tracking.
      type: raw.type || null,
      requiredCapabilities: (raw.requiredCapabilities || []).slice(),
      optionalCapabilities: (raw.optionalCapabilities || []).slice(),
      dependsOn: (raw.dependsOn || []).slice(),
      optional: !!raw.optional,
      // input(context) -> payload handed to this stage's agent. Falls
      // back to passing the whole context through untouched, but most
      // real workflows should narrow this so a stage only receives
      // the slice of context it actually needs (Part B isolation).
      input: typeof raw.input === 'function' ? raw.input : function (ctx) { return ctx.trigger; },
      // onResult(result, context) -> patch merged into context.outputs[stage.id]
      // as well as top-level context fields when it returns an object
      // with a `context` key. Optional.
      onResult: typeof raw.onResult === 'function' ? raw.onResult : null,
      timeout: typeof raw.timeout === 'number' ? raw.timeout : undefined,
      maxRetries: typeof raw.maxRetries === 'number' ? raw.maxRetries : 0,
      alternateAgentIds: (raw.alternateAgentIds || []).slice()
    };
  }

  function createWorkflow(definition) {
    definition = definition || {};
    if (!Array.isArray(definition.stages) || definition.stages.length === 0) {
      throw structuralError('createWorkflow() requires a non-empty "stages" array.');
    }
    var stages = definition.stages.map(normalizeStage);
    // Fail fast on structural issues (duplicates / unknown deps /
    // cycles) at creation time too, not only at execution time —
    // callers get an immediate, actionable error.
    topologicalOrder(stages);

    var id = isNonEmptyString(definition.id) ? definition.id : makeId('wf');
    if (workflowsById[id]) {
      throw structuralError('Workflow id "' + id + '" already exists.');
    }

    var record = {
      id: id,
      name: definition.name || id,
      description: definition.description || '',
      stages: stages,
      status: WORKFLOW_STATUS.CREATED,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      context: null,
      stageState: Object.create(null), // stage id -> { status, result, error, attempts, startedAt, finishedAt, agentId }
      pauseRequested: false,
      cancelRequested: false,
      _resumeSignal: null // resolver for the in-flight await when paused
    };
    stages.forEach(function (s) {
      record.stageState[s.id] = {
        status: STAGE_STATUS.PENDING, result: null, error: null,
        attempts: 0, startedAt: null, finishedAt: null, agentId: s.agentId
      };
    });

    workflowsById[id] = record;
    Orchestrator.emit('workflow_created', { workflowId: id });
    return { id: id, name: record.name, status: record.status };
  }

  // validateWorkflow(): re-checks dependency structure plus that every
  // stage can currently resolve to *some* agent (explicit agentId that
  // exists, or at least one registered agent with the capability).
  // Does not check health/permission — that's still resolved live at
  // dispatch time by the Capability Router, same as any other request,
  // since health can change between validation and execution.
  function validateWorkflow(workflowId) {
    var wf = requireWorkflow(workflowId);
    var problems = [];
    try {
      topologicalOrder(wf.stages);
    } catch (err) {
      problems.push(err.message);
    }
    wf.stages.forEach(function (s) {
      if (s.agentId) {
        if (!Orchestrator.getAgent(s.agentId)) {
          problems.push('Stage "' + s.id + '" references unknown agentId "' + s.agentId + '".');
        }
        return;
      }
      var candidates = Orchestrator.listAgents().filter(function (a) {
        return a.capabilities.indexOf(s.capability) !== -1;
      });
      if (candidates.length === 0) {
        problems.push('Stage "' + s.id + '" needs capability "' + s.capability + '" but no registered agent offers it.');
      }
    });
    var valid = problems.length === 0;
    if (valid) wf.status = WORKFLOW_STATUS.VALIDATED;
    Orchestrator.emit('workflow_validated', { workflowId: workflowId, valid: valid, problems: problems });
    return { valid: valid, problems: problems };
  }

  // optimizeWorkflow(): groups the dependency-resolved stage order
  // into "waves" — stages that share no dependency relationship and
  // could in principle run concurrently. Part B of this phase only
  // requires *sequential* collaboration to be supported end to end,
  // so executeWorkflow() still runs one stage at a time in this
  // resolved order; optimizeWorkflow() is the documented, inspectable
  // seed for parallel-wave execution without committing to it yet.
  function optimizeWorkflow(workflowId) {
    var wf = requireWorkflow(workflowId);
    var order = topologicalOrder(wf.stages);
    var doneIds = Object.create(null);
    var waves = [];
    var remaining = order.slice();
    while (remaining.length) {
      var ready = readyStages(remaining, doneIds);
      if (ready.length === 0) {
        // Should be unreachable given topologicalOrder() already threw
        // on cycles, but guards against an infinite loop regardless.
        throw structuralError('Unable to resolve execution waves for workflow "' + workflowId + '".');
      }
      waves.push(ready.map(function (s) { return s.id; }));
      ready.forEach(function (s) { doneIds[s.id] = true; });
      remaining = remaining.filter(function (s) { return !doneIds[s.id]; });
    }
    var plan = { workflowId: workflowId, order: order.map(function (s) { return s.id; }), waves: waves };
    Orchestrator.emit('workflow_optimized', plan);
    return plan;
  }

  function requireWorkflow(workflowId) {
    var wf = workflowsById[workflowId];
    if (!wf) throw structuralError('Unknown workflow id "' + workflowId + '".');
    return wf;
  }

  // ------------------------------------------------------------
  // PART C — Workflow Context
  // ------------------------------------------------------------
  // Purely in-memory, scoped to a single execution, discarded (well —
  // retained read-only on the finished record for inspection, but
  // never written to any persistence layer) once the workflow reaches
  // a terminal state. This module never calls AxiomMemoryEngine or
  // any storage API — "temporary" is enforced by omission, not by a
  // TTL.
  function createWorkflowContext(wf, trigger) {
    // create Runtime Context — the one and only context system.
    var rc = RuntimeContext.createContext({
      workflowId: wf.id,
      metadata: { stageCount: wf.stages.length },
      state: {},
      temporaryData: { outputs: {}, timestamps: {} }
    });
    RuntimeContext.markReady(rc.contextId);
    RuntimeContext.markRunning(rc.contextId);

    return {
      contextId: rc.contextId,         // ties this run back to its Runtime Context record
      workflowId: wf.id,
      trigger: trigger,
      state: Object.create(null),      // freeform shared state stages can read/write via onResult
      outputs: Object.create(null),    // stage id -> that stage's result
      metadata: {
        startedAt: rc.createdAt,
        stageCount: wf.stages.length
      },
      timestamps: Object.create(null)  // stage id -> { startedAt, finishedAt }
    };
  }

  // update Runtime Context — pushes the working copy's current
  // state/outputs/timestamps into the real context record. Best-effort:
  // a sync failure (e.g. a stage produced a non-JSON-safe result — see
  // Runtime Context's documented payload restriction) is logged, not
  // thrown, so a Runtime Context sync problem can never itself take
  // down a workflow run.
  function syncWorkflowContext(ctx) {
    if (!ctx || !ctx.contextId) return;
    try {
      RuntimeContext.updateContext(ctx.contextId, {
        state: ctx.state,
        temporaryData: { outputs: ctx.outputs, timestamps: ctx.timestamps }
      });
    } catch (err) {
      reportError('sync-runtime-context', err, { contextId: ctx.contextId });
    }
  }

  // destroy Runtime Context — called once, from the single place every
  // executeWorkflow() exit path funnels through, so a workflow's
  // Runtime Context is always retired (never leaked) regardless of
  // whether the workflow completed, failed, or was cancelled.
  function finalizeWorkflowContext(ctx, workflowStatus, reason) {
    if (!ctx || !ctx.contextId) return;
    syncWorkflowContext(ctx);
    try {
      if (workflowStatus === WORKFLOW_STATUS.COMPLETED) {
        RuntimeContext.completeContext(ctx.contextId);
      } else if (workflowStatus === WORKFLOW_STATUS.FAILED) {
        RuntimeContext.failContext(ctx.contextId, reason);
      } else {
        RuntimeContext.cancelContext(ctx.contextId, reason);
      }
    } catch (err) {
      reportError('finalize-runtime-context', err, { contextId: ctx.contextId });
    }
    try {
      RuntimeContext.destroyContext(ctx.contextId, reason || workflowStatus);
    } catch (err) {
      reportError('destroy-runtime-context', err, { contextId: ctx.contextId });
    }
  }

  // Each stage receives only what it asks for: its own input()
  // function is called with the *whole* context (so it can select
  // from prior outputs), but its return value — not the context
  // object itself — is what actually reaches the agent's handler as
  // the task payload. Agents therefore never see other agents, and
  // never see more of the shared context than their own stage chose
  // to read out of it (Part B isolation).
  function buildStagePayload(stage, context) {
    try {
      return stage.input(context);
    } catch (err) {
      reportError('stage-input', err, { stage: stage.id });
      throw structuralError('Stage "' + stage.id + '" input() threw: ' + ((err && err.message) || err));
    }
  }

  function applyStageResult(stage, result, context) {
    context.outputs[stage.id] = result;
    if (stage.onResult) {
      try {
        var patch = stage.onResult(result, context);
        if (patch && isPlainObject(patch.context)) {
          Object.assign(context.state, patch.context);
        }
      } catch (err) {
        reportError('stage-onResult', err, { stage: stage.id });
      }
    }
  }

  // ------------------------------------------------------------
  // Dispatch a single stage through the real routing pipeline —
  // AxiomCapabilityRouter.route() when available (agentId OR
  // capability, with failover), falling back to AxiomOrchestrator
  // .dispatch() so this module still works on a page that has Part 1
  // loaded without Part 3. Either way, this is the ONLY path a stage's
  // work reaches an agent through — never a direct call.
  // ------------------------------------------------------------
  function routeStage(stage, payload) {
    var request = {
      // Real bug fix (Part 6B, discovered via live execution against
      // the actual agent-registry-integration.js handlers): those
      // handlers switch on task.type to decide which operation to run.
      // Previously this field was ALWAYS overwritten with a workflow-
      // tracking label, so a stage targeting one of those agents could
      // never succeed. If the stage specifies a real type, use it; if
      // not, behavior is byte-for-byte identical to before this fix.
      type: stage.type || ('workflow_stage:' + stage.id),
      payload: payload,
      agentId: stage.agentId || undefined,
      capability: stage.capability || undefined,
      timeoutHint: stage.timeout,
      // Retry/failover for a workflow stage is owned entirely by
      // runStageWithRecovery() (Part F) so there is exactly one place
      // that decides how many times a stage has been attempted. If
      // the underlying router/scheduler also retried transparently,
      // a stage's observed attempt count would silently undercount
      // what actually happened on the wire.
      maxRetries: 0,
      allowFailover: false
    };
    if (Orchestrator.route) {
      return Orchestrator.route(request);
    }
    // Fallback path (no capability-router.js loaded): dispatch()
    // throws synchronously on failure rather than returning a
    // standardized result, so normalize it to the same shape route()
    // would have produced.
    try {
      var taskId = Orchestrator.dispatch(request);
      return { accepted: true, taskId: taskId, requestId: taskId, agentId: stage.agentId };
    } catch (err) {
      return { accepted: false, error: (err && err.message) || String(err) };
    }
  }

  // Waits for the task/request kicked off by routeStage() to reach a
  // terminal state, via the Orchestrator's own event bus — never by
  // polling. Resolves to { ok, result } or { ok: false, reason }.
  function awaitStageOutcome(routed) {
    return new Promise(function (resolve) {
      if (!routed.accepted) {
        resolve({ ok: false, reason: routed.error || 'Stage was not accepted for dispatch.' });
        return;
      }
      var matchKey = routed.requestId || routed.taskId;
      var offCompleted, offFailed, offTaskCompleted, offTaskFailed;

      function cleanup() {
        if (offCompleted) offCompleted();
        if (offFailed) offFailed();
        if (offTaskCompleted) offTaskCompleted();
        if (offTaskFailed) offTaskFailed();
      }

      // Preferred path: capability-router.js's own request-level events.
      offCompleted = Orchestrator.on('route_completed', function (payload) {
        if (payload.requestId !== matchKey) return;
        cleanup();
        resolve({ ok: true, result: payload.result });
      });
      offFailed = Orchestrator.on('route_failed', function (payload) {
        if (payload.requestId !== matchKey) return;
        cleanup();
        resolve({ ok: false, reason: payload.reason });
      });
      // Fallback path: raw scheduler task events, keyed by taskId,
      // used when capability-router.js isn't present.
      offTaskCompleted = Orchestrator.on('task_completed', function (payload) {
        if (!payload.task || payload.task.id !== routed.taskId) return;
        cleanup();
        resolve({ ok: true, result: payload.result });
      });
      offTaskFailed = Orchestrator.on('task_failed', function (payload) {
        if (!payload.task || payload.task.id !== routed.taskId) return;
        cleanup();
        resolve({ ok: false, reason: payload.reason });
      });
    });
  }

  // ------------------------------------------------------------
  // PART F — Failure Recovery
  // ------------------------------------------------------------
  // Runs one stage to a terminal local outcome, applying (in order):
  //   1. retry, up to stage.maxRetries times
  //   2. alternate eligible agent, from stage.alternateAgentIds
  //   3. skip, if the stage was declared optional
  //   4. graceful workflow failure otherwise
  // Never throws — a failing stage always resolves to a status, so a
  // stage failure can never crash the Orchestrator or leave a
  // workflow hung.
  async function runStageWithRecovery(wf, stage, context) {
    var st = wf.stageState[stage.id];
    var attempt = 0;
    var candidateAgentIds = [stage.agentId].concat(stage.alternateAgentIds).filter(Boolean);
    var agentCursor = 0;

    while (true) {
      attempt += 1;
      st.attempts = attempt;
      var effectiveStage = stage;
      if (stage.agentId && candidateAgentIds.length) {
        effectiveStage = Object.assign({}, stage, { agentId: candidateAgentIds[agentCursor] });
      }

      var payload;
      try {
        payload = buildStagePayload(stage, context);
      } catch (err) {
        return { status: STAGE_STATUS.FAILED, error: (err && err.message) || String(err) };
      }

      st.status = STAGE_STATUS.RUNNING;
      st.startedAt = Date.now();
      st.agentId = effectiveStage.agentId;
      context.timestamps[stage.id] = { startedAt: st.startedAt, finishedAt: null };
      Orchestrator.emit('workflow_stage_started', { workflowId: wf.id, stageId: stage.id, agentId: effectiveStage.agentId, attempt: attempt });

      var routed = routeStage(effectiveStage, payload);
      var outcome = await awaitStageOutcome(routed);

      st.finishedAt = Date.now();
      context.timestamps[stage.id].finishedAt = st.finishedAt;

      if (outcome.ok) {
        st.status = STAGE_STATUS.COMPLETED;
        st.result = outcome.result;
        st.error = null;
        applyStageResult(stage, outcome.result, context);
        Orchestrator.emit('workflow_stage_completed', { workflowId: wf.id, stageId: stage.id, result: outcome.result });
        return { status: STAGE_STATUS.COMPLETED, result: outcome.result };
      }

      st.error = outcome.reason;
      Orchestrator.emit('workflow_stage_failed', { workflowId: wf.id, stageId: stage.id, reason: outcome.reason, attempt: attempt });

      // 1. Retry the same (effective) agent.
      if (attempt <= stage.maxRetries) {
        continue;
      }
      // 2. Try the next alternate agent, resetting the retry budget
      //    for that agent.
      if (stage.agentId && agentCursor < candidateAgentIds.length - 1) {
        agentCursor += 1;
        attempt = 0;
        continue;
      }
      // 3. Skip an optional stage rather than failing the workflow.
      if (stage.optional) {
        st.status = STAGE_STATUS.SKIPPED;
        Orchestrator.emit('workflow_stage_skipped', { workflowId: wf.id, stageId: stage.id, reason: outcome.reason });
        return { status: STAGE_STATUS.SKIPPED, reason: outcome.reason };
      }
      // 4. Graceful workflow failure — the caller (executeWorkflow)
      //    is responsible for stopping remaining stages and marking
      //    the workflow FAILED; this function itself never throws.
      st.status = STAGE_STATUS.FAILED;
      return { status: STAGE_STATUS.FAILED, error: outcome.reason };
    }
  }

  // ------------------------------------------------------------
  // PART A/B — executeWorkflow(): runs stages in dependency order,
  // one at a time (sequential collaboration), threading the same
  // Workflow Context through every stage, honoring pause/resume/cancel
  // between stage boundaries.
  // ------------------------------------------------------------
  async function executeWorkflow(workflowId, trigger) {
    var wf = requireWorkflow(workflowId);
    if (wf.status === WORKFLOW_STATUS.RUNNING) {
      throw structuralError('Workflow "' + workflowId + '" is already running.');
    }
    var order;
    try {
      order = topologicalOrder(wf.stages);
    } catch (err) {
      wf.status = WORKFLOW_STATUS.FAILED;
      Orchestrator.emit('workflow_failed', { workflowId: workflowId, reason: err.message });
      pruneFinishedWorkflowHistory();
      throw err;
    }

    wf.status = WORKFLOW_STATUS.RUNNING;
    wf.startedAt = Date.now();
    wf.cancelRequested = false;
    wf.context = createWorkflowContext(wf, trigger);
    Orchestrator.emit('workflow_started', { workflowId: workflowId, stageCount: order.length });

    var doneIds = Object.create(null);

    for (var i = 0; i < order.length; i++) {
      var stage = order[i];

      // Cooperative cancellation: checked at every stage boundary, so
      // a workflow never aborts mid-agent-call and always leaves the
      // in-flight stage to finish naturally.
      if (wf.cancelRequested) {
        wf.status = WORKFLOW_STATUS.CANCELLED;
        wf.finishedAt = Date.now();
        markRemainingCancelled(wf, order, doneIds);
        finalizeWorkflowContext(wf.context, WORKFLOW_STATUS.CANCELLED, 'cancelled');
        Orchestrator.emit('workflow_cancelled', { workflowId: workflowId });
        pruneFinishedWorkflowHistory();
        return snapshotWorkflow(wf);
      }

      // Cooperative pause: parks the loop between stages until
      // resumeWorkflow()/cancelWorkflow() wakes it back up.
      if (wf.pauseRequested) {
        wf.status = WORKFLOW_STATUS.PAUSED;
        Orchestrator.emit('workflow_paused', { workflowId: workflowId, atStage: stage.id });
        await new Promise(function (resolve) { wf._resumeSignal = resolve; });
        wf._resumeSignal = null;
        if (wf.cancelRequested) {
          wf.status = WORKFLOW_STATUS.CANCELLED;
          wf.finishedAt = Date.now();
          markRemainingCancelled(wf, order, doneIds);
          finalizeWorkflowContext(wf.context, WORKFLOW_STATUS.CANCELLED, 'cancelled');
          Orchestrator.emit('workflow_cancelled', { workflowId: workflowId });
          pruneFinishedWorkflowHistory();
          return snapshotWorkflow(wf);
        }
        wf.status = WORKFLOW_STATUS.RUNNING;
        Orchestrator.emit('workflow_resumed', { workflowId: workflowId, atStage: stage.id });
      }

      // A dependency that was skipped (optional, exhausted recovery)
      // still counts as "done" for ordering purposes, but a stage that
      // strictly requires it can choose to check context.outputs
      // itself inside input()/onResult() — the planner does not
      // silently invent a substitute value.
      var outcome = await runStageWithRecovery(wf, stage, wf.context);
      doneIds[stage.id] = true;
      // update Runtime Context — every stage boundary pushes the
      // latest state/outputs/timestamps into the real context record.
      syncWorkflowContext(wf.context);

      if (outcome.status === STAGE_STATUS.FAILED) {
        wf.status = WORKFLOW_STATUS.FAILED;
        wf.finishedAt = Date.now();
        markRemainingSkipped(wf, order, doneIds, 'upstream_stage_failed');
        finalizeWorkflowContext(wf.context, WORKFLOW_STATUS.FAILED, outcome.error);
        Orchestrator.emit('workflow_failed', { workflowId: workflowId, stageId: stage.id, reason: outcome.error });
        pruneFinishedWorkflowHistory();
        return snapshotWorkflow(wf);
      }
    }

    wf.status = WORKFLOW_STATUS.COMPLETED;
    wf.finishedAt = Date.now();
    finalizeWorkflowContext(wf.context, WORKFLOW_STATUS.COMPLETED);
    Orchestrator.emit('workflow_completed', { workflowId: workflowId, context: wf.context });
    pruneFinishedWorkflowHistory();
    return snapshotWorkflow(wf);
  }

  function markRemainingCancelled(wf, order, doneIds) {
    order.forEach(function (s) {
      if (doneIds[s.id]) return;
      wf.stageState[s.id].status = STAGE_STATUS.CANCELLED;
    });
  }

  function markRemainingSkipped(wf, order, doneIds, reason) {
    order.forEach(function (s) {
      if (doneIds[s.id]) return;
      wf.stageState[s.id].status = STAGE_STATUS.SKIPPED;
      wf.stageState[s.id].error = reason;
    });
  }

  function pauseWorkflow(workflowId) {
    var wf = requireWorkflow(workflowId);
    if (wf.status !== WORKFLOW_STATUS.RUNNING) return false;
    wf.pauseRequested = true;
    return true;
  }

  function resumeWorkflow(workflowId) {
    var wf = requireWorkflow(workflowId);
    if (wf.status !== WORKFLOW_STATUS.PAUSED) return false;
    wf.pauseRequested = false;
    if (typeof wf._resumeSignal === 'function') wf._resumeSignal();
    return true;
  }

  function cancelWorkflow(workflowId, reason) {
    var wf = requireWorkflow(workflowId);
    if (TERMINAL_WORKFLOW_STATUSES.indexOf(wf.status) !== -1) return false;
    wf.cancelRequested = true;
    // If parked in a pause, wake it up immediately so cancellation is
    // not left waiting on a resumeWorkflow() that may never come.
    if (wf.status === WORKFLOW_STATUS.PAUSED && typeof wf._resumeSignal === 'function') {
      wf._resumeSignal();
    }
    if (wf.status === WORKFLOW_STATUS.CREATED || wf.status === WORKFLOW_STATUS.VALIDATED) {
      // Never started running at all — resolve the cancellation
      // synchronously rather than waiting for a loop that isn't live.
      wf.status = WORKFLOW_STATUS.CANCELLED;
      wf.finishedAt = Date.now();
      Object.keys(wf.stageState).forEach(function (id) { wf.stageState[id].status = STAGE_STATUS.CANCELLED; });
      Orchestrator.emit('workflow_cancelled', { workflowId: workflowId, reason: reason || null });
      pruneFinishedWorkflowHistory();
    }
    return true;
  }

  // ------------------------------------------------------------
  // PART E — Workflow Monitoring
  // ------------------------------------------------------------
  function snapshotWorkflow(wf) {
    return {
      id: wf.id,
      name: wf.name,
      description: wf.description,
      status: wf.status,
      createdAt: wf.createdAt,
      startedAt: wf.startedAt,
      finishedAt: wf.finishedAt,
      stages: wf.stages.map(function (s) {
        var st = wf.stageState[s.id];
        return {
          id: s.id, agentId: st.agentId, capability: s.capability,
          dependsOn: s.dependsOn.slice(), optional: s.optional,
          status: st.status, attempts: st.attempts,
          startedAt: st.startedAt, finishedAt: st.finishedAt, error: st.error
        };
      }),
      context: wf.context ? {
        outputs: Object.assign({}, wf.context.outputs),
        state: Object.assign({}, wf.context.state),
        metadata: Object.assign({}, wf.context.metadata)
      } : null
    };
  }

  function getWorkflow(workflowId) {
    var wf = workflowsById[workflowId];
    return wf ? snapshotWorkflow(wf) : null;
  }

  function listWorkflows(filter) {
    filter = filter || {};
    return Object.keys(workflowsById)
      .map(function (id) { return workflowsById[id]; })
      .filter(function (wf) { return !filter.status || wf.status === filter.status; })
      .map(snapshotWorkflow);
  }

  function getWorkflowStatus(workflowId) {
    var wf = requireWorkflow(workflowId);
    var counts = { pending: 0, running: 0, completed: 0, failed: 0, skipped: 0, cancelled: 0 };
    Object.keys(wf.stageState).forEach(function (id) {
      counts[wf.stageState[id].status] = (counts[wf.stageState[id].status] || 0) + 1;
    });
    return { workflowId: workflowId, status: wf.status, stageCounts: counts, totalStages: wf.stages.length };
  }

  function getWorkflowMetrics() {
    var byStatus = {};
    var stageTotals = { pending: 0, running: 0, completed: 0, failed: 0, skipped: 0, cancelled: 0 };
    Object.keys(workflowsById).forEach(function (id) {
      var wf = workflowsById[id];
      byStatus[wf.status] = (byStatus[wf.status] || 0) + 1;
      Object.keys(wf.stageState).forEach(function (sid) {
        var s = wf.stageState[sid].status;
        stageTotals[s] = (stageTotals[s] || 0) + 1;
      });
    });
    return {
      totalWorkflows: Object.keys(workflowsById).length,
      byStatus: byStatus,
      stageTotals: stageTotals
    };
  }

  function getActiveWorkflows() {
    return listWorkflows().filter(function (wf) {
      return wf.status === WORKFLOW_STATUS.RUNNING || wf.status === WORKFLOW_STATUS.PAUSED;
    });
  }

  // ------------------------------------------------------------
  // Install onto the existing AxiomOrchestrator object — additive
  // only, same convention as capability-router.js's installRoutingApi().
  // ------------------------------------------------------------
  function installWorkflowApi() {
    if (typeof Orchestrator.createWorkflow === 'function') return; // idempotent

    Orchestrator.createWorkflow = createWorkflow;
    Orchestrator.validateWorkflow = validateWorkflow;
    Orchestrator.optimizeWorkflow = optimizeWorkflow;
    Orchestrator.executeWorkflow = executeWorkflow;
    Orchestrator.pauseWorkflow = pauseWorkflow;
    Orchestrator.resumeWorkflow = resumeWorkflow;
    Orchestrator.cancelWorkflow = cancelWorkflow;

    Orchestrator.getWorkflow = getWorkflow;
    Orchestrator.listWorkflows = listWorkflows;
    Orchestrator.getWorkflowStatus = getWorkflowStatus;
    Orchestrator.getWorkflowMetrics = getWorkflowMetrics;
    Orchestrator.getActiveWorkflows = getActiveWorkflows;

    Orchestrator.WORKFLOW_STATUS = WORKFLOW_STATUS;
    Orchestrator.STAGE_STATUS = STAGE_STATUS;
  }

  installWorkflowApi();

  var AxiomWorkflowPlanner = {
    API_VERSION: API_VERSION,
    WORKFLOW_STATUS: WORKFLOW_STATUS,
    STAGE_STATUS: STAGE_STATUS,

    createWorkflow: createWorkflow,
    validateWorkflow: validateWorkflow,
    optimizeWorkflow: optimizeWorkflow,
    executeWorkflow: executeWorkflow,
    pauseWorkflow: pauseWorkflow,
    resumeWorkflow: resumeWorkflow,
    cancelWorkflow: cancelWorkflow,

    getWorkflow: getWorkflow,
    listWorkflows: listWorkflows,
    getWorkflowStatus: getWorkflowStatus,
    getWorkflowMetrics: getWorkflowMetrics,
    getActiveWorkflows: getActiveWorkflows,

    // exposed for tests / advanced callers that want the dependency
    // resolver without going through a full workflow
    topologicalOrder: function (stages) { return topologicalOrder(stages.map(normalizeStage)).map(function (s) { return s.id; }); }
  };

  global.AxiomWorkflowPlanner = AxiomWorkflowPlanner;
})(window);
