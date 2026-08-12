// ============================================================
// AXIOM AI OS — Milestone 9: Executive AI
// ------------------------------------------------------------
// The brief for this milestone is explicit: build ONE new brain
// layer above the Task Router that plans, coordinates and supervises
// — and NEVER executes anything itself. Every existing runtime
// module from Milestones 4 and 8 is reused exactly as-is:
//
//   Analyze intent            -> AxiomTaskPlanner.analyzeIntent/decompose
//   Decide agents needed      -> AxiomTaskRouter (via the planner)
//   Create execution strategy -> AxiomTaskPlanner.createExecutionPlan
//                                 (Executive only ANNOTATES the result —
//                                 sequential/parallel + concurrency/retry
//                                 hints — it never re-derives routing)
//   Execute                   -> AxiomJobManager -> AxiomOrchestrator
//                                 -> AxiomAgentManager.dispatch()
//   Monitor                   -> AxiomRuntimeMonitor + the Agent Event Bus
//   Recover a wedged agent    -> AxiomErrorRecovery (already exists)
//   Adapt a failed plan       -> AxiomJobManager.retryJob() (already
//                                 re-decomposes only the failed clauses —
//                                 Executive just decides WHETHER/HOW MANY
//                                 times to invoke it, and when to stop and
//                                 ask a human instead)
//   Recall memory             -> AxiomMemoryIntelligence.rankedRecall
//   Write memory              -> AxiomAgentManager.route() -> agent.memory
//                                 (a normal, structured dispatch — same
//                                 path any other caller uses)
//
// Nothing here calls an agent handler, touches storage, or reaches into
// another module's internals. Every capability Executive AI has is a
// call to something Milestones 4/8 already expose publicly.
//
// Public surface — window.AxiomExecutiveAI:
//   .handle(request, opts?)          -> { executiveId, status, jobId, planId, promise }
//   .resolveClarification(id, text)  -> same shape as handle()
//   .status(executiveId)             -> live supervision snapshot | null
//   .list()                          -> executiveId[]
//   .report()                        -> learning ledger + recent activity
//   .analyzeIntent(text)             -> AxiomTaskPlanner.analyzeIntent passthrough
//   .needsClarification(text)        -> { required, reason }
// ============================================================
window.AxiomExecutiveAI = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  var MGR = window.AxiomAgentManager;
  var ROUTER = window.AxiomTaskRouter;
  var PLANNER = window.AxiomTaskPlanner;
  var ORCH = window.AxiomOrchestrator;
  var JOBS = window.AxiomJobManager;
  var CTX = window.AxiomContextStore;
  var MEM = window.AxiomMemoryIntelligence;

  if (!RT || !MGR || !ROUTER || !PLANNER || !ORCH || !JOBS) {
    AxLogger.error('[AxiomExecutiveAI] requires the Milestone 4 runtime + Milestone 8 intelligence layer ' +
      '(task-planner.js, orchestrator.js, job-manager.js) loaded first.');
    return null;
  }
  var bus = RT.bus;

  var LEDGER_KEY = 'axiom-executive-ledger';
  var MAX_AUTO_RETRIES = 2;           // bounded — Executive escalates to clarification after this
  var MEMORY_SCOPE = 'agent.memory';  // same recall scope the Memory Agent uses on itself
  var MEMORY_RECALL_LIMIT = 5;

  var executions = new Map(); // executiveId -> record
  var pendingClarifications = new Map(); // executiveId -> original text
  var textFailStreak = new Map(); // normalized text -> consecutive terminal-failure count
  var uid = window.AxiomMakeSeqId('exec'); // see os/shared/id-factory.js
  function normalize(text) { return String(text || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function emit(type, executiveId, payload) {
    bus.emit(type, 'executive-ai', Object.assign({ executiveId: executiveId }, payload || {}));
  }

  // -------------------- Learning ledger (localStorage, bounded) ----------
  // Honest heuristic, not a trained model: a per-workflow-shape win/loss
  // tally (signature = the ordered agent chain a request decomposed into)
  // used to bias two decisions — whether to serialize a plan that would
  // otherwise run in parallel, and whether to ask for clarification before
  // even attempting a request whose shape has failed repeatedly.
  function loadLedger() {
    try { return JSON.parse(localStorage.getItem(LEDGER_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveLedger(ledger) {
    try { localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger)); }
    catch (e) { AxLogger.warn('[AxiomExecutiveAI] could not persist learning ledger:', e); }
  }
  function signatureOf(decomposition) {
    return decomposition.steps.map(function (s) { return s.agentId; }).join('>') || 'empty';
  }
  function ledgerStats(signature) {
    var ledger = loadLedger();
    return ledger[signature] || null;
  }
  function recordOutcome(signature, status, ms) {
    var ledger = loadLedger();
    var entry = ledger[signature] || { successCount: 0, failCount: 0, totalMs: 0, lastAt: 0 };
    if (status === 'completed') entry.successCount += 1; else entry.failCount += 1;
    entry.totalMs += (typeof ms === 'number' ? ms : 0);
    entry.lastAt = Date.now();
    entry.lastStatus = status;
    ledger[signature] = entry;
    saveLedger(ledger);
    return entry;
  }
  function failRate(entry) {
    var total = entry.successCount + entry.failCount;
    return total ? entry.failCount / total : 0;
  }

  // -------------------- 1. Analyze intent ---------------------------------
  function analyzeIntent(text) {
    return PLANNER.analyzeIntent(text);
  }

  // -------------------- 2. Decide whether clarification is required ------
  var VAGUE = /^(do it|fix it|fix that|handle it|handle that|do that|do this|continue|go on|keep going|make it better|improve it|try again)\.?$/i;

  function needsClarification(text) {
    var trimmed = String(text || '').trim();
    if (!trimmed) return { required: true, reason: 'The request was empty.' };
    if (VAGUE.test(trimmed)) {
      return { required: true, reason: 'The request only refers to "it"/"that" with nothing in this turn to resolve the reference to — Executive AI has no prior turn in this run to anchor it to.' };
    }
    var streak = textFailStreak.get(normalize(trimmed)) || 0;
    if (streak >= MAX_AUTO_RETRIES) {
      return { required: true, reason: 'This exact request has failed ' + streak + ' times in a row (see report()) — asking before trying again rather than repeating a losing plan.' };
    }
    return { required: false, reason: null };
  }

  // -------------------- 3/5. Build strategy + choose agents ---------------
  // Reuses AxiomTaskPlanner's decomposition/routing wholesale. The only
  // thing Executive adds is a supervisory judgement call: when the ledger
  // shows this exact agent-chain shape fails often, force a plan that would
  // otherwise run several independent hops in parallel to run one-at-a-time
  // instead (dependsOn chaining is the Orchestrator's own existing
  // mechanism — Executive just sets it), and lower retry/concurrency
  // accordingly. Nothing about routing or step content is changed.
  function buildStrategy(text) {
    var plan = PLANNER.createExecutionPlan(text); // also registers with AxiomPlanner (unchanged M8 behaviour)
    var signature = signatureOf(plan);
    var stats = ledgerStats(signature);
    var distinctAgents = Array.from(new Set(plan.steps.map(function (s) { return s.agentId; })));
    var naturallyParallel = plan.multiStep && plan.steps.every(function (s) { return !s.dependsOn.length; }) && distinctAgents.length > 1;

    var mode = !plan.multiStep ? 'single' : (naturallyParallel ? 'parallel' : 'sequential');
    var adapted = false;

    if (naturallyParallel && stats && stats.failCount + stats.successCount >= 2 && failRate(stats) > 0.5) {
      // Chain the previously-parallel steps into a sequence so a shared
      // resource collision (the most common real cause of two independent
      // agents both failing together) can no longer happen the same way.
      for (var i = 1; i < plan.steps.length; i++) {
        plan.steps[i].dependsOn = [plan.steps[i - 1].id];
      }
      mode = 'sequential';
      adapted = true;
    }

    var opts = {
      concurrency: mode === 'parallel' ? Math.min(distinctAgents.length, 4) : 1,
      retries: (stats && failRate(stats) > 0.3) ? 3 : 2
    };

    return { plan: plan, signature: signature, mode: mode, adaptedFromLedger: adapted, distinctAgents: distinctAgents, opts: opts };
  }

  // -------------------- 4. Load relevant memory automatically ------------
  function loadMemory(text) {
    if (!MEM) return Promise.resolve([]);
    return MEM.rankedRecall(MEMORY_SCOPE, text, MEMORY_RECALL_LIMIT).catch(function () { return []; });
  }

  // -------------------- Update memory automatically -----------------------
  // Goes through the same public entry point any other caller uses —
  // AxiomAgentManager.route() with an explicit agentId — which resolves
  // through the Task Router and dispatches through the Agent Manager,
  // exactly like the requirement demands. Executive never writes storage.
  function writeMemory(note) {
    try {
      MGR.route({ agentId: 'agent.memory', intent: 'memory', op: 'remember', note: note });
    } catch (e) { /* best-effort — a memory-write failure must not break supervision */ }
  }

  // -------------------- 6/7. Monitor + adapt a running job ----------------
  function attachRunIdCapture(record, goal) {
    var off = bus.on('orchestrator:run-started', function (env) {
      if (env.payload && env.payload.goal === goal && !record.runId) {
        record.runId = env.payload.runId;
        off();
        if (record.recalledMemories && record.recalledMemories.length && CTX) {
          CTX.merge(record.runId, { executiveRecalledMemory: record.recalledMemories }, { source: 'executive-ai' });
        }
      }
    });
  }

  function superviseJob(record) {
    var offProgress = bus.on('job:progress', function (env) {
      if (env.payload.jobId !== record.jobId) return;
      record.notes = (record.notes || []).concat(env.payload.notes || []).slice(-10);
    });

    function finalize(status, summaryOrError) {
      var ms = Date.now() - record.startedAt;
      if (status === 'completed') {
        offProgress();
        record.status = 'completed';
        textFailStreak.delete(normalize(record.goal));
        recordOutcome(record.signature, 'completed', ms);
        writeMemory('Executive AI completed "' + record.goal + '" via ' + record.signature + ' in ' + ms + 'ms.');
        emit('executive:completed', record.id, { jobId: record.jobId, ms: ms });
        record.resolve({ status: 'completed', executiveId: record.id, jobId: record.jobId, summary: summaryOrError });
        return;
      }

      // Failed or cancelled — decide whether to adapt (retry through the
      // EXISTING JobManager.retryJob, which re-decomposes only the failed
      // clauses) or to stop and ask for clarification instead of looping.
      recordOutcome(record.signature, 'failed', ms);
      if (status === 'cancelled' || record.autoRetries >= MAX_AUTO_RETRIES) {
        offProgress();
        var streak = (textFailStreak.get(normalize(record.goal)) || 0) + 1;
        textFailStreak.set(normalize(record.goal), streak);
        record.status = status === 'cancelled' ? 'cancelled' : 'needs-clarification';
        emit(status === 'cancelled' ? 'executive:cancelled' : 'executive:clarification-needed', record.id,
          { jobId: record.jobId, reason: 'Repeated failure after ' + record.autoRetries + ' automatic retries.' });
        record.resolve({ status: record.status, executiveId: record.id, jobId: record.jobId, error: summaryOrError });
        return;
      }

      record.autoRetries += 1;
      emit('executive:adapting', record.id, { jobId: record.jobId, attempt: record.autoRetries });
      var retried = JOBS.retryJob(record.jobId);
      if (!retried) {
        offProgress();
        record.status = 'needs-clarification';
        emit('executive:clarification-needed', record.id, { jobId: record.jobId, reason: 'Nothing retryable — the job left no failed-step summary to recover from.' });
        record.resolve({ status: 'needs-clarification', executiveId: record.id, jobId: record.jobId, error: summaryOrError });
        return;
      }
      // Still adapting — same record, new underlying job. offProgress stays
      // subscribed: its listener keys off record.jobId dynamically (read at
      // event time, not captured), so it keeps working once jobId is swapped.
      record.jobId = retried.id;
      wireJobOutcome(record);
    }

    wireJobOutcomeImpl(record, finalize);
  }

  function wireJobOutcome(record) { wireJobOutcomeImpl(record, record._finalize); }

  function wireJobOutcomeImpl(record, finalize) {
    record._finalize = finalize;
    var offDone = bus.on('job:completed', function (env) {
      if (env.payload.jobId !== record.jobId) return;
      offDone(); offFail(); offCancel();
      finalize('completed', env.payload.summary);
    });
    var offFail = bus.on('job:failed', function (env) {
      if (env.payload.jobId !== record.jobId) return;
      offDone(); offFail(); offCancel();
      finalize('failed', env.payload.error);
    });
    var offCancel = bus.on('job:cancelled', function (env) {
      if (env.payload.jobId !== record.jobId) return;
      offDone(); offFail(); offCancel();
      finalize('cancelled', null);
    });
  }

  // -------------------- Main entry point -----------------------------------
  function handle(request, opts) {
    opts = opts || {};
    var text = typeof request === 'string' ? request : String((request && (request.text || request.query || request.intent)) || '');
    var id = uid();

    var clarify = needsClarification(text);
    if (clarify.required && !opts.skipClarification) {
      pendingClarifications.set(id, text);
      var pendingRecord = { id: id, goal: text, status: 'needs-clarification', createdAt: Date.now(), startedAt: Date.now(), autoRetries: 0 };
      executions.set(id, pendingRecord);
      emit('executive:clarification-needed', id, { reason: clarify.reason });
      return { executiveId: id, status: 'needs-clarification', reason: clarify.reason, jobId: null, planId: null,
        promise: Promise.resolve({ status: 'needs-clarification', executiveId: id, reason: clarify.reason }) };
    }

    emit('executive:analyzing', id, { text: text });

    return {
      executiveId: id, status: 'running',
      jobId: null, planId: null,
      promise: loadMemory(text).then(function (recalledMemories) {
        emit('executive:memory-loaded', id, { count: recalledMemories.length });

        var strategy = buildStrategy(text);
        emit('executive:strategy-selected', id, { mode: strategy.mode, agents: strategy.distinctAgents, adaptedFromLedger: strategy.adaptedFromLedger });

        var record = {
          id: id, goal: text, signature: strategy.signature, status: 'running',
          createdAt: Date.now(), startedAt: Date.now(), autoRetries: 0,
          planId: strategy.plan.planId, jobId: null, runId: null,
          recalledMemories: recalledMemories, notes: [],
          resolve: null
        };
        var outcomePromise = new Promise(function (resolve) { record.resolve = resolve; });
        executions.set(id, record);

        attachRunIdCapture(record, strategy.plan.goal);
        var job = JOBS.createJob(strategy.plan, strategy.opts);
        record.jobId = job.id;
        emit('executive:submitted', id, { jobId: job.id, planId: record.planId, mode: strategy.mode });

        superviseJob(record);
        return outcomePromise;
      })
    };
  }

  function resolveClarification(executiveId, answerText) {
    var original = pendingClarifications.get(executiveId);
    if (original === undefined) return null;
    pendingClarifications.delete(executiveId);
    var combined = (original + ' ' + String(answerText || '')).trim();
    return handle(combined, { skipClarification: true });
  }

  // -------------------- Observability --------------------------------------
  function status(executiveId) {
    var r = executions.get(executiveId);
    if (!r) return null;
    return {
      executiveId: r.id, goal: r.goal, status: r.status, signature: r.signature,
      planId: r.planId, jobId: r.jobId, runId: r.runId, autoRetries: r.autoRetries,
      notes: (r.notes || []).slice(),
      orchestratorStatus: r.runId ? ORCH.status(r.runId) : null
    };
  }

  function list() { return Array.from(executions.keys()); }

  function report() {
    return {
      ledger: loadLedger(),
      activeStreaks: Array.from(textFailStreak.entries()).map(function (e) { return { text: e[0], consecutiveFailures: e[1] }; }),
      recent: Array.from(executions.values()).slice(-20).map(function (r) {
        return { executiveId: r.id, goal: r.goal, status: r.status, jobId: r.jobId, autoRetries: r.autoRetries };
      })
    };
  }

  return {
    handle: handle,
    resolveClarification: resolveClarification,
    status: status,
    list: list,
    report: report,
    analyzeIntent: analyzeIntent,
    needsClarification: needsClarification
  };
})();
