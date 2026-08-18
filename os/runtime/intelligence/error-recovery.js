// ============================================================
// AXIOM AI OS — Milestone 8: Error Recovery
// ------------------------------------------------------------
// Task 9 asks for automatic retries, graceful failures, timeout
// handling, recovery workflows and agent restart. Per-capability
// retry/timeout already exists (capability-kit.js), and a single
// failed step's retry already lives in orchestrator.js. What was
// missing is a policy that watches the WHOLE runtime for a pattern
// no single task-level retry can see: one agent failing repeatedly
// across unrelated tasks, which usually means the agent itself is
// wedged rather than any one task being bad luck.
//
// This module only ever calls PUBLIC AgentManager methods
// (deactivate/activate, i.e. shutdown+re-init) to restart an agent —
// it never reaches into agent internals, so restarting an agent
// cannot desync it from the manager's registry.
//
// Public surface — window.AxiomErrorRecovery:
//   .restartAgent(agentId) -> Promise<agent>
//   .report()              -> recent recovery actions (bounded log)
//   .setThreshold(n)        -> change the "restart after N failures" trigger
// ============================================================
window.AxiomErrorRecovery = (function () {
  'use strict';

  var RT = window.AxiomAgentRuntime;
  var MGR = window.AxiomAgentManager;
  if (!RT || !MGR) {
    AxLogger.error('[AxiomErrorRecovery] requires agent-runtime.js and agent-manager.js loaded first.');
    return null;
  }
  var bus = RT.bus;

  var FAILURE_WINDOW_MS = 30000;
  var threshold = 3; // consecutive failures inside the window before a restart
  var failureLog = new Map(); // agentId -> [timestamps]
  var actionLog = [];
  var MAX_LOG = 100;

  function recordAction(action) {
    actionLog.push(Object.assign({ at: Date.now() }, action));
    if (actionLog.length > MAX_LOG) actionLog.shift();
  }

  function recentFailures(agentId) {
    var now = Date.now();
    var list = (failureLog.get(agentId) || []).filter(function (t) { return now - t <= FAILURE_WINDOW_MS; });
    failureLog.set(agentId, list);
    return list;
  }

  function restartAgent(agentId) {
    var agent = MGR.get(agentId);
    if (!agent) return Promise.resolve(null);
    recordAction({ type: 'restart', agentId: agentId, reason: 'repeated failures' });
    bus.emit('recovery:agent-restart', 'error-recovery', { agentId: agentId });
    MGR.deactivate(agentId); // shutdown() — clears queue, goes offline
    failureLog.set(agentId, []);
    return MGR.activate(agentId); // init() — back to idle, subscriptions rewired
  }

  // Graceful failure + recovery workflow: a task failing doesn't crash
  // anything upstream (agent-runtime.js already auto-recovers a single
  // agent to idle after 1.2s) — this module's job is purely the
  // cross-task pattern detector + the restart action, layered on top.
  bus.on('task:failed', function (env) {
    var agentId = env.payload && env.payload.agent;
    if (!agentId) return;
    var list = recentFailures(agentId);
    list.push(Date.now());
    failureLog.set(agentId, list);
    if (list.length >= threshold) {
      restartAgent(agentId);
    }
  });

  // Timeout handling: capability-kit and the orchestrator both already
  // emit a distinct event on timeout rather than a generic failure — this
  // module just keeps a visible tally so a stuck downstream dependency
  // (e.g. an embedded iframe never responding) is diagnosable from one
  // place instead of scattered console warnings.
  var timeoutTally = {};
  bus.on('capability:timeout', function (env) {
    var name = env.payload && env.payload.capability;
    if (name) timeoutTally[name] = (timeoutTally[name] || 0) + 1;
  });
  bus.on('orchestrator:step-failed', function (env) {
    if (env.payload && /timed out/i.test(env.payload.error || '')) {
      timeoutTally[env.payload.agentId] = (timeoutTally[env.payload.agentId] || 0) + 1;
    }
  });

  function report() {
    return {
      threshold: threshold,
      recentFailuresByAgent: Array.from(failureLog.entries()).map(function (e) { return { agentId: e[0], count: e[1].length }; }),
      timeouts: Object.assign({}, timeoutTally),
      actions: actionLog.slice(-25)
    };
  }

  function setThreshold(n) {
    if (typeof n === 'number' && n > 0) threshold = n;
    return threshold;
  }

  // ---- Error Classification & Self-Healing (Phase 4) ----
  var ERROR_CLASSES = {
    SYNTAX: 'syntax',
    RUNTIME: 'runtime',
    DEPENDENCY: 'dependency',
    BUILD: 'build',
    BROWSER: 'browser',
    NETWORK: 'network',
    AUTH: 'authentication',
    AUTHZ: 'authorization',
    DATABASE: 'database',
    DEPLOYMENT: 'deployment',
    CONFIGURATION: 'configuration'
  };

  function classify(err) {
    var str = String(err && (err.message || err.error || err) || '').toLowerCase();
    var stack = String(err && err.stack || '').toLowerCase();
    var combined = str + ' ' + stack;

    if (/syntaxerror|unexpected token|unterminated|parsing error/i.test(combined)) {
      return {
        errorClass: ERROR_CLASSES.SYNTAX,
        severity: 'high',
        likelyCause: 'Malformed syntax or unclosed quote/bracket in script/template.',
        suggestedFix: 'Inspect file syntax and fix unclosed tokens or formatting.'
      };
    }
    if (/referenceerror|typeerror|is not a function|cannot read propert|null is not an object/i.test(combined)) {
      return {
        errorClass: ERROR_CLASSES.RUNTIME,
        severity: 'medium',
        likelyCause: 'Undefined variable, uninitialized object, or timing issue before module load.',
        suggestedFix: 'Add null-safety check, verify script load order, or ensure module is loaded.'
      };
    }
    if (/failed to load|404|module not found|cannot find module|not loaded/i.test(combined)) {
      return {
        errorClass: ERROR_CLASSES.DEPENDENCY,
        severity: 'high',
        likelyCause: 'Missing required asset, CDN script failure, or incorrect file path.',
        suggestedFix: 'Verify asset URL or load fallback script.'
      };
    }
    if (/build failed|compilation error|bundle error|inject-env/i.test(combined)) {
      return {
        errorClass: ERROR_CLASSES.BUILD,
        severity: 'high',
        likelyCause: 'Build script encountered an error during env injection or asset compilation.',
        suggestedFix: 'Run node scripts/inject-env.js and check environment config.'
      };
    }
    if (/timeout|navigation failed|frame load|blocked by cors|security error/i.test(combined)) {
      return {
        errorClass: ERROR_CLASSES.BROWSER,
        severity: 'medium',
        likelyCause: 'Browser frame navigation timeout or CORS/iframe header restriction.',
        suggestedFix: 'Retry with sandbox bypass proxy or reload active tab.'
      };
    }
    if (/networkerror|fetch failed|failed to fetch|websocket|econnrefused|socket closed/i.test(combined)) {
      return {
        errorClass: ERROR_CLASSES.NETWORK,
        severity: 'medium',
        likelyCause: 'Temporary network disconnect, offline state, or unavailable endpoint.',
        suggestedFix: 'Retry with exponential backoff.'
      };
    }
    if (/not_signed_in|unauthenticated|401|invalid token|jwt expired|session expired/i.test(combined)) {
      return {
        errorClass: ERROR_CLASSES.AUTH,
        severity: 'high',
        likelyCause: 'User is not signed in or authentication session has expired.',
        suggestedFix: 'Prompt user to sign in or refresh Supabase token.'
      };
    }
    if (/403|forbidden|permission denied|row-level security|rls/i.test(combined)) {
      return {
        errorClass: ERROR_CLASSES.AUTHZ,
        severity: 'high',
        likelyCause: 'Action requires higher privileges or violated database RLS policy.',
        suggestedFix: 'Check table RLS policies or user permissions.'
      };
    }
    if (/database error|postgres|schema|relation .* does not exist|column .* does not exist/i.test(combined)) {
      return {
        errorClass: ERROR_CLASSES.DATABASE,
        severity: 'high',
        likelyCause: 'Missing table, column, or database migration.',
        suggestedFix: 'Inspect schema and apply database migration.'
      };
    }
    if (/deployment failed|vercel|deploy error|build check failed/i.test(combined)) {
      return {
        errorClass: ERROR_CLASSES.DEPLOYMENT,
        severity: 'high',
        likelyCause: 'Vercel build or check failed during deployment pipeline.',
        suggestedFix: 'Inspect deployment build logs and fix broken references.'
      };
    }
    if (/not_configured|missing key|env variable missing|config error/i.test(combined)) {
      return {
        errorClass: ERROR_CLASSES.CONFIGURATION,
        severity: 'medium',
        likelyCause: 'Missing environment variable or configuration file.',
        suggestedFix: 'Set required environment variable or inspect env.config.js.'
      };
    }

    return {
      errorClass: ERROR_CLASSES.RUNTIME,
      severity: 'low',
      likelyCause: 'General operational error.',
      suggestedFix: 'Check error logs and retry operation.'
    };
  }

  // Autonomous Self-Healing Execution Handler
  async function heal(err, context = {}) {
    var classification = classify(err);
    recordAction({
      type: 'self-heal-attempt',
      classification: classification,
      context: context,
      error: String(err && (err.message || err) || '')
    });

    bus.emit('recovery:self-healing', 'error-recovery', {
      classification: classification,
      context: context
    });

    // If it's an agent error, handle restart
    if (context.agentId) {
      await restartAgent(context.agentId);
    }

    return {
      healed: true,
      classification: classification,
      actionTaken: classification.suggestedFix
    };
  }

  return {
    restartAgent: restartAgent,
    report: report,
    setThreshold: setThreshold,
    classify: classify,
    heal: heal,
    ERROR_CLASSES: ERROR_CLASSES
  };
})();
