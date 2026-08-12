// ============================================================
// AXIOM — Block 2 / Step 8 / Part 1: Cognitive Decision Engine
// (Foundation)
// ------------------------------------------------------------
// Everything built through Step 7 either executes work someone has
// already fully specified (task-planner.js's decomposeGoal() still
// needs a caller-authored free-text GOAL string; workflow-planner.js
// still needs caller-authored stages; capability-router.js still
// needs an explicit capability/type) or decides WHICH already-queued
// goal runs next (autonomous-decision-engine.js, `window.
// AxiomDecisionEngine`, Step 7 Part 3C — a goal-graph/capacity
// scheduler). Nothing in the stack looks at a raw, unstructured user
// REQUEST and works out what the person actually wants before any of
// that machinery is invoked. This module is that missing front door:
// intent detection + context extraction + (read-only) goal/
// capability/agent recommendation, run BEFORE Goal Manager or Task
// Planner ever execute anything.
//
// Naming collision, called out explicitly: Step 7 Part 3C already
// claims `window.AxiomDecisionEngine` for a *different* concept (goal
// -graph admission scheduling — see os/core/autonomous-decision-
// engine.js). This Part's brief asks for the same global name, but
// installing onto it here would silently overwrite or be silently
// blocked by Part 3C depending on <script> load order — exactly the
// class of bug goal-manager.js's own header documents avoiding
// (RUNTIME_CONTEXT.md FIX 4, "Naming Collision") by picking a
// disjoint name instead of reusing one already claimed on the shared
// global surface. Following that same, already-established project
// convention, this module installs as the disjoint
// `window.AxiomCognitiveDecisionEngine` instead. Every event this
// module emits (`decision_started` / `decision_completed` /
// `decision_failed`) is likewise a bare, previously-unused name —
// verified against every existing `emit('...')` call in os/core
// (Part 3C's own events are all `decisionengine_*`, a different,
// non-colliding namespace).
//
// What this module IS, concretely:
//   1. Intent Detection    — detectIntent(text): scores the request
//      against a fixed, named taxonomy (INTENT_CATEGORIES below),
//      supports more than one intent per request, and returns a
//      confidence per intent. Plain keyword/phrase scoring, exactly
//      the same "no model, no training step" posture Part 3F's own
//      validation report documents for its own decision logic — this
//      module contains no machine learning.
//   2. Context Extraction  — extractContext(text): entities,
//      keywords, imperative commands, URLs, file names, application
//      names, dates, times. Application-name extraction is matched
//      against the LIVE agent registry (`AxiomOrchestrator.
//      listAgents()`) first, exactly like capability-router.js /
//      task-planner.js already do for capabilities, so a newly
//      registered agent's name becomes recognizable with zero code
//      change here.
//   3. Goal Generation      — decide() hands every detected intent to
//      `AxiomGoalManager.createGoal()` UNCHANGED. No goal data model,
//      status machine, or Runtime Context wiring is reimplemented;
//      Part 3A's own createGoal() already does all of that, including
//      minting the goal's own Runtime Context record.
//   4. Capability Discovery — matchCapabilities() below is the same
//      live-registry word-overlap scorer task-planner.js's own
//      matchCapabilities() already uses
//      (`AxiomOrchestrator.discoverCapabilities()` at call time,
//      never a hardcoded capability list), rewritten here as this
//      module's own tiny copy — the same "own tiny copy rather than
//      reach into another module's internals" convention goal-
//      manager.js's header documents for its own shared helpers.
//   5. Agent Recommendation — capability-router.js's own
//      `selectAgent(capability, options)` is called VERBATIM to name
//      the best current agent for a recommended capability. This
//      module never calls `route()`, `dispatch()`, `prepare()`, or
//      any agent handler — recommendation only, never dispatch.
//   6. Decision Object      — decide() returns one structured, frozen
//      record combining all of the above plus a short human-readable
//      reasoning summary.
//
// What this module explicitly does NOT do:
//   - It does not decompose a goal into an ordered/parallel task
//     graph. That is task-planner.js's decomposeGoal()/planGoal(),
//     untouched, and this module never calls it.
//   - It does not pick which already-created goal runs next out of a
//     queue. That is Part 3C's `window.AxiomDecisionEngine.
//     selectNextGoal()`/`runDecisionCycle()`, untouched.
//   - It does not route, dispatch, retry, or execute any capability
//     request. `capability-router.js`'s route()/dispatch pipeline is
//     never invoked from this file — `selectAgent()` (a pure,
//     read-only lookup) is the only Router entry point this module
//     calls.
//   - It does not implement machine learning. Every score in this
//     file is a plain keyword/phrase match count.
//
// Usage:
//   const decision = AxiomCognitiveDecisionEngine.decide(
//     'open github.com and search for react hooks tomorrow at 3pm'
//   );
//   // -> { decisionId, intents, primaryIntent, confidence, context,
//   //      goals, capabilities, agents, reasoning, contextId, ... }
//
//   AxiomCognitiveDecisionEngine.detectIntent('remind me to call Sam');
//   AxiomCognitiveDecisionEngine.extractContext('open report.pdf at 5pm');
//   AxiomOrchestrator.on('decision_completed', ({ decisionId }) => { ... });
//
// ------------------------------------------------------------
// Block 2 / Step 8 / Part 2 addendum — Intelligent Planning.
// ------------------------------------------------------------
// Part 1 (above) stops at recommendation: a Decision Object names
// candidate capabilities/agents and creates independent Goal Manager
// records, but never says in what ORDER, or how much in parallel,
// those goals should actually run, nor which of several valid
// execution shapes is the best bet before anything is dispatched.
// This Part adds that layer — still analysis/recommendation only:
//
//   1. Execution Plan Generation — generateExecutionPlan(input, opts)
//      turns a Decision Object (or a bare `{ goalIds: [...] }`) into
//      an ordered ExecutionPlan of steps. The authoritative order and
//      dependency-cycle guard are `AxiomGoalManager.
//      getGoalExecutionOrder()` UNCHANGED (Part 3B) — this module
//      never re-implements topological sort or admission. `parallel`
//      strategy groups that SAME authoritative order into dependency-
//      safe waves (a goal's wave = 1 + the deepest wave among its own
//      in-set prerequisites, read via `GoalManager.
//      getGoalDependencies()`), so goals with no path between them
//      share a step while a real dependency still forces its own
//      later step. `sequential` gives one goal per step. `learning`
//      defers entirely to `AxiomGoalManagerLearning.
//      recommendGoalOrder()` (Part 3E) when that module is loaded —
//      the SAME dependency-safety-guarded reordering Part 3E already
//      uses for live goal admission, reused verbatim here for a
//      read-only plan instead.
//   2. Alternative Plan Generation — generateAlternativePlans(input,
//      opts) builds every strategy above that's currently available,
//      scores each (see §4), and returns all of them plus which one
//      scored highest and why the others didn't (§5).
//   3. Planning Factors — evaluatePlan() reads: execution cost +
//      dependency complexity (from the same dependency graph the
//      layering above already reads); capability/agent availability
//      (`AxiomOrchestrator.discoverCapabilities()` /
//      `AxiomCapabilityRouter.selectAgent()`, the SAME calls Part 1
//      already makes — never a hardcoded list); estimated duration +
//      historical success rate (`AxiomGoalManagerLearning.
//      getStrategyStats()` when loaded, neutral 0.5/default-duration
//      otherwise — no separate learning ledger is created here);
//      system load (`AxiomOrchestrator.getStats()` +
//      `AxiomRuntimeContext.getContextMetrics()`, both pre-existing
//      read-only getters).
//   4. Plan Scoring — scorePlan()/evaluatePlan() combine the factors
//      above into reliability, efficiency, completion probability,
//      resource usage, and an overall confidence — every plan this
//      module returns carries a score, not just the selected one.
//   5. Decision Explanation — explainPlan() is a plain string builder
//      (no model) describing why the selected plan won, why each
//      alternative didn't, the step-by-step execution path, and the
//      estimated completion time.
//   6. Planning Events — `planning_started` / `planning_completed` /
//      `planning_failed` / `plan_selected`, emitted through the same
//      `AxiomOrchestrator` Event Bus Part 1 already uses, all bare
//      previously-unused names (verified against every existing
//      `emit('...')` call in os/core, including Part 1's own
//      `decision_*` names — a disjoint namespace, same convention as
//      Part 1's header documents for `decisionengine_*` vs
//      `decision_*`).
//
// What this addendum explicitly does NOT do:
//   - It does not dispatch, execute, admit, or retry any goal or
//     task. No call in this file's new code reaches `route()`,
//     `dispatch()`, `prepare()`, `enqueue()`, `markGoalRunning()`, or
//     any agent handler — `generateExecutionPlan()`'s only side
//     effect is reading already-published state and, like `decide()`,
//     opening/closing exactly one Runtime Context record for the
//     planning call itself.
//   - It does not re-implement Goal Manager's dependency graph,
//     topological sort, or cycle detection. `getGoalExecutionOrder()`
//     is the single source of truth for valid order and the single
//     place a cycle is ever detected (its own thrown error propagates
//     out of `generateExecutionPlan()` unchanged); this file's wave-
//     grouping is a pure, read-only reinterpretation of that already-
//     validated order via `getGoalDependencies()`, never a second
//     scheduler.
//   - It does not re-implement Goal Manager Learning's strategy
//     ledger, scoring, or reordering. `getStrategyStats()` and
//     `recommendGoalOrder()` are called verbatim; no second
//     success/failure counter is kept anywhere in this file.
//   - It does not add a new Analytics integration. Like Part 1,
//     Analytics is reachable only indirectly — as whatever capability
//     an `analytics`-classified goal's plan step happens to recommend
//     — through the exact same `discoverCapabilities()`/
//     `selectAgent()` calls every other capability goes through.
//
// Usage:
//   const decision = AxiomCognitiveDecisionEngine.decide('open github.com and debug the login bug');
//   const planning = AxiomCognitiveDecisionEngine.plan(decision);
//   // -> { planningId, plans: [...], selected, rejected: [...], explanation, ... }
//
//   AxiomCognitiveDecisionEngine.generateExecutionPlan({ goalIds: [...] }, { strategy: 'parallel' });
//   AxiomCognitiveDecisionEngine.generateAlternativePlans(decision);
//   AxiomCognitiveDecisionEngine.scorePlan(plan);
//   AxiomOrchestrator.on('plan_selected', ({ planId, strategy }) => { ... });
// ============================================================
(function (global) {
  'use strict';

  var Orchestrator = global.AxiomOrchestrator;
  var RuntimeContext = global.AxiomRuntimeContext;
  var GoalManager = global.AxiomGoalManager;
  var CapabilityRouter = global.AxiomCapabilityRouter;
  // Soft dependency, same posture as Part 1's own agent-registry-
  // integration.js relationship: Goal Manager Learning (Step 7 Part
  // 3E) enriches planning (historical success rate, learned goal
  // ordering) when it happens to be loaded, but every planning
  // function degrades gracefully (neutral 0.5 score, default duration,
  // 'learning' strategy simply unavailable) rather than failing
  // without it.
  var GoalManagerLearning = global.AxiomGoalManagerLearning;

  function log(method, message, detail) {
    var l = global.AxLogger;
    if (l && typeof l[method] === 'function') {
      l[method]('[AxiomCognitiveDecisionEngine] ' + message, detail !== undefined ? detail : '');
      return;
    }
    try {
      // eslint-disable-next-line no-console
      console[method === 'error' ? 'error' : 'log']('[AxiomCognitiveDecisionEngine] ' + message, detail || '');
    } catch (e) { /* no console available — swallow */ }
  }

  if (!Orchestrator || typeof Orchestrator.emit !== 'function' || typeof Orchestrator.on !== 'function') {
    log('error', 'requires os/core/orchestrator.js (Event Bus) loaded first.');
    return;
  }
  if (!RuntimeContext || typeof RuntimeContext.createContext !== 'function') {
    log('error', 'requires os/core/runtime-context.js loaded first.');
    return;
  }
  if (!GoalManager || typeof GoalManager.createGoal !== 'function') {
    log('error', 'requires os/core/goal-manager.js loaded first.');
    return;
  }
  if (!CapabilityRouter || typeof CapabilityRouter.selectAgent !== 'function') {
    log('error', 'requires os/core/capability-router.js loaded first.');
    return;
  }

  var API_VERSION = '1.0.0';

  // ------------------------------------------------------------
  // Small shared helpers — same ES5 / no-external-deps / own-tiny-
  // copy conventions every prior os/core/*.js Part already uses.
  // ------------------------------------------------------------
  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function now() { return Date.now(); }

  function deepFreeze(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    Object.getOwnPropertyNames(obj).forEach(function (key) {
      var val = obj[key];
      if (val && typeof val === 'object' && !Object.isFrozen(val)) deepFreeze(val);
    });
    return Object.freeze(obj);
  }

  var idCounter = 0;
  function makeId(prefix) {
    idCounter += 1;
    return prefix + '_' + now().toString(36) + '_' + idCounter.toString(36);
  }

  function structuralError(message) {
    var err = new Error('[AxiomCognitiveDecisionEngine] ' + message);
    err.structural = true;
    return err;
  }

  function emit(event, payload) {
    try {
      Orchestrator.emit(event, payload);
    } catch (err) {
      log('error', 'emit:' + event + ' failed', err && err.message);
    }
  }

  function unique(arr) {
    var seen = Object.create(null);
    var out = [];
    arr.forEach(function (v) {
      var k = String(v).toLowerCase();
      if (!seen[k]) { seen[k] = true; out.push(v); }
    });
    return out;
  }

  function tokenize(s) {
    return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }

  // ------------------------------------------------------------
  // PART A — Intent taxonomy + keyword/phrase lexicon.
  //
  // This IS a hardcoded table, deliberately — it is the fixed,
  // caller-facing taxonomy the brief requires ("Support at minimum:
  // conversation, browser, ..."), a closed category set exactly like
  // GOAL_STATUS/GOAL_PRIORITY are closed enums elsewhere in os/core/.
  // It is NOT the thing the brief's "do not hardcode capability
  // names" instruction is about — that instruction governs Capability
  // Discovery (PART D below), which reads capability names only from
  // the live registry, never from this table.
  // ------------------------------------------------------------
  var INTENT_CATEGORIES = {
    CONVERSATION: 'conversation',
    BROWSER: 'browser',
    AUTOMATION: 'automation',
    WORKSPACE: 'workspace',
    MEMORY: 'memory',
    REASONING: 'reasoning',
    CODING: 'coding',
    RESEARCH: 'research',
    PLANNING: 'planning',
    SEARCH: 'search',
    ANALYTICS: 'analytics',
    SYSTEM: 'system',
    UNKNOWN: 'unknown'
  };

  var VALID_INTENT_CATEGORIES = Object.keys(INTENT_CATEGORIES).map(function (k) { return INTENT_CATEGORIES[k]; });

  // Each entry: phrases scored highest first are listed first only
  // for readability — scoring itself does not depend on order.
  var INTENT_LEXICON = {
    conversation: [
      'hello', 'hi there', 'hey', 'good morning', 'good evening', 'how are you',
      'thanks', 'thank you', 'chat', 'talk to me', 'joke',
      'tell me a joke', 'goodbye', 'bye', 'nice to meet you'
    ],
    browser: [
      'browse', 'browser', 'open tab', 'new tab', 'navigate to', 'navigate',
      'website', 'webpage', 'web page', 'visit', 'go to', 'open the browser',
      'bookmark', 'refresh the page', 'close tab'
    ],
    automation: [
      'automate', 'automation', 'workflow', 'trigger', 'macro', 'recurring',
      'every day', 'every morning', 'run script', 'schedule a task',
      'set up a rule', 'whenever', 'auto-run'
    ],
    workspace: [
      'workspace', 'window', 'desktop', 'arrange windows', 'organize windows',
      'snap window', 'layout', 'launch app', 'open app', 'minimize', 'maximize',
      'switch app', 'close window'
    ],
    memory: [
      'remember', 'remember that', 'memory', 'recall', 'forget', 'save this',
      'take a note', 'note that', 'memorize', 'store this', 'what did i say',
      'my notes'
    ],
    reasoning: [
      'why', 'explain', 'explain why', 'reason about', 'analyze', 'think through',
      'because', 'compare', 'evaluate', 'pros and cons', 'help me decide',
      'what should i do', 'logic behind'
    ],
    coding: [
      'code', 'function', 'bug', 'debug', 'fix the bug', 'write a program',
      'python', 'javascript', 'compile', 'repository', 'repo', 'git commit',
      'variable', 'class definition', 'api endpoint', 'unit test', 'refactor'
    ],
    research: [
      'research', 'find information', 'look up', 'look into', 'investigate',
      'study', 'sources', 'find an article', 'learn about', 'gather information',
      'background on'
    ],
    planning: [
      'plan', 'make a plan', 'schedule', 'itinerary', 'roadmap', 'outline',
      'strategy', 'to-do list', 'todo list', 'plan my day', 'plan a trip',
      'next steps'
    ],
    search: [
      'search', 'search for', 'find', 'find me', 'look for', 'locate',
      'where is', 'query'
    ],
    analytics: [
      'analytics', 'metrics', 'report', 'statistics', 'dashboard', 'chart',
      'graph', 'trend', 'kpi', 'data on', 'show me the numbers', 'usage stats'
    ],
    system: [
      'system settings', 'settings', 'restart', 'reboot', 'shut down', 'shutdown',
      'update the system', 'install', 'configure', 'permission', 'diagnostics',
      'system status', 'check status'
    ]
  };

  // Longer phrases are worth more than single generic words — a hit
  // on "tell me a joke" is much stronger evidence of `conversation`
  // than a bare, highly ambiguous "please".
  function phraseWeight(phrase) {
    var words = tokenize(phrase).length;
    return words >= 3 ? 3 : (words === 2 ? 2 : 1);
  }

  function scoreIntents(normalizedText) {
    var scores = [];
    Object.keys(INTENT_LEXICON).forEach(function (category) {
      var matched = [];
      var score = 0;
      INTENT_LEXICON[category].forEach(function (phrase) {
        if (normalizedText.indexOf(phrase) !== -1) {
          score += phraseWeight(phrase);
          matched.push(phrase);
        }
      });
      if (score > 0) scores.push({ category: category, score: score, matchedKeywords: matched });
    });
    scores.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.category < b.category ? -1 : (a.category > b.category ? 1 : 0);
    });
    return scores;
  }

  // Confidence: normalized against the strongest match in THIS
  // request (so a single strong hit is high-confidence even in a
  // short request), floored/ceilinged into a readable 0..1 range.
  // Secondary intents are scaled relative to the top score so a much
  // weaker secondary hit reads as lower-confidence than the primary.
  function scoresToIntents(scores, options) {
    options = options || {};
    var minSecondaryScore = options.minSecondaryScore || 1;
    var maxIntents = options.maxIntents || 5;

    if (!scores.length) {
      return [{ category: INTENT_CATEGORIES.UNKNOWN, confidence: 0.2, isPrimary: true, matchedKeywords: [] }];
    }

    var topScore = scores[0].score;
    var out = scores.slice(0, maxIntents).filter(function (s, i) {
      return i === 0 || s.score >= minSecondaryScore;
    }).map(function (s, i) {
      var raw = 0.5 + 0.5 * (s.score / (topScore + 2)); // asymptotic toward 1, never hits it
      var confidence = Math.max(0.3, Math.min(0.95, raw));
      return {
        category: s.category,
        confidence: Math.round(confidence * 100) / 100,
        isPrimary: i === 0,
        matchedKeywords: s.matchedKeywords
      };
    });
    return out;
  }

  function detectIntent(text) {
    if (!isNonEmptyString(text)) {
      throw structuralError('detectIntent: non-empty text string required.');
    }
    var normalized = ' ' + text.toLowerCase() + ' ';
    var scores = scoreIntents(normalized);
    var intents = scoresToIntents(scores);
    return {
      intents: intents,
      primaryIntent: intents[0].category,
      confidence: intents[0].confidence
    };
  }

  // ------------------------------------------------------------
  // PART B — Context extraction.
  // ------------------------------------------------------------
  var STOPWORDS = Object.create(null);
  [
    'a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or', 'but',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that', 'these',
    'those', 'i', 'me', 'my', 'you', 'your', 'it', 'its', 'with', 'as', 'by',
    'from', 'up', 'about', 'into', 'then', 'than', 'so', 'do', 'does', 'did',
    'can', 'could', 'will', 'would', 'should', 'please', 'just', 'also', 'not'
  ].forEach(function (w) { STOPWORDS[w] = true; });

  var ACTION_VERBS = [
    'open', 'close', 'create', 'delete', 'remove', 'save', 'load', 'send',
    'write', 'read', 'run', 'execute', 'start', 'stop', 'pause', 'resume',
    'search', 'find', 'navigate', 'go', 'launch', 'install', 'update',
    'schedule', 'remind', 'show', 'list', 'generate', 'build', 'analyze',
    'plan', 'organize', 'fetch', 'download', 'upload', 'copy', 'move',
    'rename', 'refresh', 'restart', 'summarize', 'translate', 'compare'
  ];

  var URL_PATTERN = /\bhttps?:\/\/[^\s)"'<>]+|\bwww\.[^\s)"'<>]+/gi;
  var FILE_PATTERN = /\b[\w][\w\-]*\.(?:js|jsx|ts|tsx|py|json|md|txt|csv|pdf|docx|doc|xlsx|xls|pptx|ppt|html|css|png|jpe?g|gif|svg|zip|mp4|mp3|wav|yaml|yml|xml|log|sql|sh)\b/gi;
  var TIME_PATTERN = /\b(?:[01]?\d|2[0-3])[:.][0-5]\d\s?(?:am|pm)?\b|\b\d{1,2}\s?(?:am|pm)\b|\b(?:noon|midnight|morning|afternoon|evening|tonight)\b/gi;
  var DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(?:today|tomorrow|yesterday|tonight|next week|this week|next month|next monday|next tuesday|next wednesday|next thursday|next friday|next saturday|next sunday|this weekend)\b/gi;
  var QUOTED_PATTERN = /"([^"]+)"|'([^']+)'/g;
  var CAP_WORD_PATTERN = /\b([A-Z][a-zA-Z0-9]*(?:\s+[A-Z][a-zA-Z0-9]*)*)\b/g;

  function extractByPattern(text, pattern) {
    var out = [];
    var m;
    pattern.lastIndex = 0;
    while ((m = pattern.exec(text)) !== null) {
      out.push(m[0].replace(/[),.;:!?'"]+$/, '')); // trailing sentence punctuation, not part of the match
      if (pattern.lastIndex === m.index) pattern.lastIndex++; // safety against zero-width loops
    }
    return unique(out);
  }

  function extractCommands(text) {
    var words = text.split(/\s+/);
    var lowerWords = words.map(function (w) { return w.toLowerCase().replace(/[^a-z0-9]/g, ''); });
    var commands = [];
    lowerWords.forEach(function (w, i) {
      if (ACTION_VERBS.indexOf(w) === -1) return;
      var slice = words.slice(i, i + 6).join(' ')
        .split(/[,.;!?]/)[0]
        .trim();
      if (slice) commands.push(slice);
    });
    return unique(commands);
  }

  function extractEntities(text) {
    var quoted = [];
    var m;
    QUOTED_PATTERN.lastIndex = 0;
    while ((m = QUOTED_PATTERN.exec(text)) !== null) {
      quoted.push(m[1] !== undefined ? m[1] : m[2]);
    }
    var words = text.split(/\s+/);
    var capPhrases = [];
    CAP_WORD_PATTERN.lastIndex = 0;
    while ((m = CAP_WORD_PATTERN.exec(text)) !== null) {
      var idx = text.slice(0, m.index).split(/\s+/).length - 1;
      var isSentenceStart = idx === 0 || /[.!?]\s*$/.test(text.slice(0, m.index).trim());
      var phrase = m[1];
      if (isSentenceStart && phrase.indexOf(' ') === -1) continue; // single leading word — likely just capitalization, skip
      capPhrases.push(phrase);
    }
    return unique(quoted.concat(capPhrases)).filter(function (e) { return e && e.length > 1; });
  }

  function extractKeywords(text, limit) {
    limit = limit || 10;
    var tokens = tokenize(text).filter(function (w) { return w.length > 2 && !STOPWORDS[w]; });
    var freq = Object.create(null);
    var order = [];
    tokens.forEach(function (w) {
      if (freq[w] === undefined) { freq[w] = 0; order.push(w); }
      freq[w] += 1;
    });
    order.sort(function (a, b) { return freq[b] - freq[a]; });
    return order.slice(0, limit);
  }

  function extractApplicationNames(text) {
    var lower = text.toLowerCase();
    var found = [];
    if (Orchestrator && typeof Orchestrator.listAgents === 'function') {
      Orchestrator.listAgents().forEach(function (agent) {
        var nameWords = tokenize(agent.name).filter(function (w) { return w.length > 2; });
        var hit = nameWords.some(function (w) { return lower.indexOf(w) !== -1; });
        if (hit) found.push(agent.name);
      });
    }
    // Small, generic, non-capability vocabulary (common nouns for
    // everyday apps a request might name informally) — not a routed
    // capability name, purely a context-extraction convenience.
    ['browser', 'terminal', 'calculator', 'calendar', 'email', 'notes', 'spotify', 'code editor']
      .forEach(function (w) { if (lower.indexOf(w) !== -1) found.push(w); });
    return unique(found);
  }

  function extractContext(text) {
    if (!isNonEmptyString(text)) {
      throw structuralError('extractContext: non-empty text string required.');
    }
    return {
      entities: extractEntities(text),
      keywords: extractKeywords(text),
      commands: extractCommands(text),
      urls: extractByPattern(text, URL_PATTERN),
      fileNames: extractByPattern(text, FILE_PATTERN),
      applicationNames: extractApplicationNames(text),
      dates: extractByPattern(text, DATE_PATTERN),
      times: extractByPattern(text, TIME_PATTERN)
    };
  }

  // ------------------------------------------------------------
  // PART C — Capability discovery. Same live-registry word-overlap
  // scorer task-planner.js's own matchCapabilities() already uses —
  // see file header for why this is a tiny independent copy rather
  // than a call into task-planner.js's internals (that function is
  // not exported, and reaching into another module's closure is
  // exactly what every os/core/*.js Part already avoids).
  // ------------------------------------------------------------
  function matchCapabilities(words, limit) {
    limit = limit || 3;
    if (!Orchestrator || typeof Orchestrator.discoverCapabilities !== 'function') return [];
    var known = Orchestrator.discoverCapabilities();
    var wordSet = Object.create(null);
    words.forEach(function (w) { wordSet[String(w).toLowerCase()] = true; });

    var scored = known.map(function (capability) {
      var capWords = tokenize(capability);
      var score = capWords.reduce(function (n, w) { return n + (wordSet[w] ? 1 : 0); }, 0);
      return { capability: capability, score: score };
    }).filter(function (m) { return m.score > 0; });

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.capability < b.capability ? -1 : (a.capability > b.capability ? 1 : 0);
    });
    return scored.slice(0, limit);
  }

  // ------------------------------------------------------------
  // PART D — Decision history (bounded, same posture as goal-
  // manager.js's own bounded goal history log).
  // ------------------------------------------------------------
  var MAX_HISTORY = 500;
  var decisionsById = Object.create(null);
  var decisionOrder = [];
  var metrics = { startedCount: 0, completedCount: 0, failedCount: 0 };

  function recordDecision(d) {
    decisionsById[d.decisionId] = d;
    decisionOrder.push(d.decisionId);
    if (decisionOrder.length > MAX_HISTORY) {
      var evicted = decisionOrder.shift();
      delete decisionsById[evicted];
    }
  }

  function getDecision(decisionId) {
    return (isNonEmptyString(decisionId) && decisionsById[decisionId]) || null;
  }

  function getDecisionHistory(filter) {
    filter = filter || {};
    var ids = decisionOrder.slice();
    if (isNonEmptyString(filter.primaryIntent)) {
      ids = ids.filter(function (id) { return decisionsById[id].primaryIntent === filter.primaryIntent; });
    }
    var limit = typeof filter.limit === 'number' ? filter.limit : ids.length;
    return ids.slice(-limit).map(function (id) { return decisionsById[id]; });
  }

  function getMetrics() {
    return {
      startedCount: metrics.startedCount,
      completedCount: metrics.completedCount,
      failedCount: metrics.failedCount,
      historySize: decisionOrder.length
    };
  }

  // ------------------------------------------------------------
  // PART E — Reasoning summary (plain string assembly, no model).
  // ------------------------------------------------------------
  function buildReasoningSummary(input) {
    var parts = [];
    parts.push('Detected primary intent "' + input.primaryIntent + '" (confidence ' +
      input.confidence.toFixed(2) + ').');
    if (input.secondaryIntents.length) {
      parts.push('Secondary intent(s): ' + input.secondaryIntents.map(function (i) {
        return '"' + i.category + '" (' + i.confidence.toFixed(2) + ')';
      }).join(', ') + '.');
    }
    parts.push('Extracted ' + input.context.keywords.length + ' keyword(s), ' +
      input.context.entities.length + ' entit(y/ies), ' +
      input.context.urls.length + ' URL(s), ' +
      input.context.fileNames.length + ' file name(s), ' +
      input.context.applicationNames.length + ' application name(s), ' +
      input.context.dates.length + ' date reference(s), ' +
      input.context.times.length + ' time reference(s).');
    if (input.capabilities.length) {
      input.capabilities.forEach(function (c) {
        if (c.recommended.length) {
          parts.push('For "' + c.intent + '", recommended capabilit(y/ies): ' +
            c.recommended.map(function (r) { return r.capability; }).join(', ') + '.');
        } else {
          parts.push('For "' + c.intent + '", no matching capability found in the live registry.');
        }
      });
    }
    if (input.agents.length) {
      input.agents.forEach(function (a) {
        if (a.recommendedAgent) {
          parts.push('Recommended agent for "' + a.intent + '": ' + a.recommendedAgent.name +
            ' (' + a.recommendedAgent.health + ').');
        }
      });
    }
    parts.push(input.goals.length + ' goal(s) created in Goal Manager.');
    return parts.join(' ');
  }

  // ------------------------------------------------------------
  // PART F — decide(): the main entry point. Analysis + read-only
  // recommendation ONLY — never dispatches, executes, or admits a
  // goal into RUNNING.
  // ------------------------------------------------------------
  function decide(text, options) {
    options = isPlainObject(options) ? options : {};
    if (!isNonEmptyString(text)) {
      throw structuralError('decide: non-empty text string required.');
    }

    var decisionId = makeId('decision');
    var startedAt = now();
    metrics.startedCount += 1;
    emit('decision_started', { decisionId: decisionId, input: text, timestamp: startedAt });

    var contextRecordId = null;
    try {
      contextRecordId = RuntimeContext.createContext({
        metadata: { decisionId: decisionId, source: 'decision-engine' },
        state: { status: 'analyzing' },
        temporaryData: { input: text }
      }).contextId;
      RuntimeContext.markReady(contextRecordId);
      RuntimeContext.markRunning(contextRecordId);
    } catch (err) {
      log('error', 'runtime context creation failed', { decisionId: decisionId, message: err && err.message });
      contextRecordId = null;
    }

    try {
      var intentResult = detectIntent(text);
      var context = extractContext(text);

      var intentsToProcess = typeof options.maxIntents === 'number'
        ? intentResult.intents.slice(0, options.maxIntents)
        : intentResult.intents;

      var capabilities = [];
      var agents = [];
      var goals = [];

      intentsToProcess.forEach(function (intent) {
        // Word set is scoped to what actually evidenced THIS intent
        // (its own matched lexicon phrases + its category name) rather
        // than every keyword in the whole request, so a multi-intent
        // request doesn't have one intent's capability recommendation
        // contaminated by another intent's vocabulary.
        var matchedTokens = [];
        (intent.matchedKeywords || []).forEach(function (phrase) {
          tokenize(phrase).forEach(function (t) { matchedTokens.push(t); });
        });
        var words = unique(matchedTokens.concat(tokenize(intent.category)));
        var capMatches = matchCapabilities(words, options.capabilityLimit || 3);
        // Fall back to the request's full keyword set only when the
        // narrow, intent-specific word set found nothing at all — so
        // a single-intent request still gets its best-effort match,
        // without letting a strong secondary intent's vocabulary
        // routinely outrank the primary intent's own evidence.
        if (!capMatches.length) {
          capMatches = matchCapabilities(unique(words.concat(context.keywords)), options.capabilityLimit || 3);
        }
        capabilities.push({ intent: intent.category, recommended: capMatches });

        var topCapability = capMatches.length ? capMatches[0].capability : null;
        var recommendedAgent = null;
        if (topCapability) {
          var agent = CapabilityRouter.selectAgent(topCapability, {});
          if (agent) {
            recommendedAgent = { id: agent.id, name: agent.name, health: agent.health, status: agent.status };
          }
        }
        agents.push({ intent: intent.category, capability: topCapability, recommendedAgent: recommendedAgent });

        if (!options.dryRun) {
          var goal = GoalManager.createGoal({
            title: 'Decision Engine: ' + intent.category + ' — ' + text.slice(0, 60),
            description: text,
            metadata: {
              source: 'decision-engine',
              decisionId: decisionId,
              intent: intent.category,
              confidence: intent.confidence,
              isPrimary: intent.isPrimary,
              recommendedCapability: topCapability,
              recommendedAgentId: recommendedAgent ? recommendedAgent.id : null
            }
          });
          goals.push(goal);
        }
      });

      var secondaryIntents = intentResult.intents.filter(function (i) { return !i.isPrimary; });

      var decisionObject = {
        decisionId: decisionId,
        apiVersion: API_VERSION,
        input: text,
        timestamp: startedAt,
        intents: intentResult.intents,
        primaryIntent: intentResult.primaryIntent,
        confidence: intentResult.confidence,
        context: context,
        goals: goals,
        capabilities: capabilities,
        agents: agents,
        contextId: contextRecordId,
        reasoning: null // filled below, after summary is built
      };
      decisionObject.reasoning = buildReasoningSummary({
        primaryIntent: decisionObject.primaryIntent,
        confidence: decisionObject.confidence,
        secondaryIntents: secondaryIntents,
        context: context,
        capabilities: capabilities,
        agents: agents,
        goals: goals
      });

      if (contextRecordId) {
        try { RuntimeContext.completeContext(contextRecordId, { primaryIntent: decisionObject.primaryIntent }); }
        catch (err) { log('error', 'runtime context completion failed', err && err.message); }
      }

      metrics.completedCount += 1;
      recordDecision(decisionObject);
      emit('decision_completed', {
        decisionId: decisionId,
        primaryIntent: decisionObject.primaryIntent,
        confidence: decisionObject.confidence,
        intentCount: decisionObject.intents.length,
        goalIds: goals.map(function (g) { return g.id; }),
        timestamp: now()
      });

      return deepFreeze(decisionObject);
    } catch (err) {
      metrics.failedCount += 1;
      if (contextRecordId) {
        try { RuntimeContext.failContext(contextRecordId, err && err.message); }
        catch (e2) { /* swallow — best-effort cleanup */ }
      }
      emit('decision_failed', { decisionId: decisionId, error: err && err.message, timestamp: now() });
      throw err;
    }
  }

  // ============================================================
  // BLOCK 2 / STEP 8 / PART 2 — Intelligent Planning
  // ============================================================

  // ------------------------------------------------------------
  // PART G — Small shared helpers for planning (own tiny additions,
  // same convention as PART A/H helpers above).
  // ------------------------------------------------------------
  var PLAN_STRATEGIES = {
    SEQUENTIAL: 'sequential',
    PARALLEL: 'parallel',
    LEARNING: 'learning'
  };
  var VALID_PLAN_STRATEGIES = Object.keys(PLAN_STRATEGIES).map(function (k) { return PLAN_STRATEGIES[k]; });

  // Neutral baseline duration used only when Goal Manager Learning has
  // no sample yet for a capability (or is not loaded at all) — the
  // same "brand-new strategy" neutrality Part 3E's own
  // snapshotStrategy() documents for its 0.5 score, mirrored here for
  // duration.
  var DEFAULT_STRATEGY_DURATION_MS = 5000;
  // Divides observed queued+running tasks / active contexts down to a
  // 0..1 load figure. Not a claim about real system capacity — a
  // fixed, documented normalizer, same posture as any other bounded
  // heuristic in this file (e.g. MAX_HISTORY).
  var SYSTEM_LOAD_NORMALIZER = 20;

  function clamp01(n) {
    return (typeof n === 'number' && isFinite(n)) ? Math.max(0, Math.min(1, n)) : 0;
  }

  // ------------------------------------------------------------
  // PART H — Plan input normalization. Accepts either a full Decision
  // Object (from decide(), read via its `goals`/`decisionId` fields)
  // or a bare `{ goalIds: [...] }` / `{ goals: [...] }`, so planning
  // can run standalone against goals this module never created (the
  // "dependency planning" case a caller sets up directly via
  // `AxiomGoalManager.addGoalDependency()`).
  // ------------------------------------------------------------
  function normalizePlanInput(input) {
    if (!isPlainObject(input)) {
      throw structuralError('expected a decision object or { goalIds: [...] } / { goals: [...] }.');
    }
    var goalIds = [];
    if (Array.isArray(input.goalIds)) {
      goalIds = input.goalIds.filter(isNonEmptyString);
    } else if (Array.isArray(input.goals)) {
      goalIds = input.goals.map(function (g) {
        return isNonEmptyString(g) ? g : (isPlainObject(g) ? g.id : null);
      }).filter(isNonEmptyString);
    }
    if (!goalIds.length) {
      throw structuralError('at least one goal (via goals[] or goalIds[]) is required to plan.');
    }
    return {
      goalIds: unique(goalIds),
      decisionId: isNonEmptyString(input.decisionId) ? input.decisionId : null
    };
  }

  // ------------------------------------------------------------
  // PART I — Capability/agent resolution per goal for planning.
  // Prefers the goal's OWN metadata (set by decide() for goals this
  // module created); falls back to the same live-registry
  // matchCapabilities()/selectAgent() calls decide() already makes,
  // for goals created some other way (e.g. directly via
  // AxiomGoalManager.createGoal(), as the regression suite's
  // dependency-planning tests do).
  // ------------------------------------------------------------
  function resolveGoalPlanInfo(goal) {
    var meta = isPlainObject(goal.metadata) ? goal.metadata : {};
    var capability = isNonEmptyString(meta.recommendedCapability) ? meta.recommendedCapability : null;
    if (!capability) {
      var words = unique(tokenize(goal.title).concat(tokenize(goal.description || '')));
      var matches = matchCapabilities(words, 1);
      capability = matches.length ? matches[0].capability : null;
    }
    var agent = null;
    if (capability && CapabilityRouter && typeof CapabilityRouter.selectAgent === 'function') {
      agent = CapabilityRouter.selectAgent(capability, {});
    }
    return {
      capability: capability,
      agentId: agent ? agent.id : (isNonEmptyString(meta.recommendedAgentId) ? meta.recommendedAgentId : null),
      intent: isNonEmptyString(meta.intent) ? meta.intent : null
    };
  }

  function goalHistoricalStats(capability) {
    if (!capability || !GoalManagerLearning || typeof GoalManagerLearning.getStrategyStats !== 'function') {
      return { score: 0.5, avgDurationMs: null, attempts: 0 };
    }
    return GoalManagerLearning.getStrategyStats(capability);
  }

  function estimateGoalDurationMs(stats) {
    return (stats && typeof stats.avgDurationMs === 'number') ? stats.avgDurationMs : DEFAULT_STRATEGY_DURATION_MS;
  }

  function computeSystemLoad() {
    var queuedAndRunning = 0;
    if (Orchestrator && typeof Orchestrator.getStats === 'function') {
      var stats = Orchestrator.getStats();
      var tasks = (stats && stats.tasks) || {};
      var byStatus = tasks.byStatus || {};
      queuedAndRunning = (tasks.queued || 0) + (byStatus.running || 0);
    }
    var active = 0;
    if (RuntimeContext && typeof RuntimeContext.getContextMetrics === 'function') {
      active = RuntimeContext.getContextMetrics().active || 0;
    }
    return clamp01((queuedAndRunning + active) / SYSTEM_LOAD_NORMALIZER);
  }

  function stepGoal(g, planInfoCache) {
    var info = planInfoCache[g.id] || (planInfoCache[g.id] = resolveGoalPlanInfo(g));
    var dependsOn = GoalManager.getGoalDependencies(g.id).map(function (d) { return d.goalId; });
    return {
      goalId: g.id,
      title: g.title,
      intent: info.intent,
      capability: info.capability,
      agentId: info.agentId,
      priority: g.priority,
      dependsOn: dependsOn
    };
  }

  // ------------------------------------------------------------
  // PART J — Ordering strategies.
  //
  // sequential: one goal per step, in Goal Manager's OWN authoritative
  // order (getGoalExecutionOrder) — never recomputed here.
  //
  // parallel: groups that SAME authoritative order into dependency-
  // safe waves. A single forward pass over an already-valid
  // topological order is sufficient (a prerequisite is guaranteed to
  // appear earlier in `flatOrder` than any goal that depends on it,
  // since that is exactly what getGoalExecutionOrder()'s own Kahn's-
  // algorithm guarantees) — this is a read of the dependency graph
  // GoalManager.getGoalDependencies() already exposes, not a second
  // topological sort.
  //
  // learning: defers entirely to AxiomGoalManagerLearning.
  // recommendGoalOrder() (Part 3E) — the same dependency-safety-
  // guarded, historically-informed reorder Part 3E already uses live.
  // ------------------------------------------------------------
  function buildSequentialSteps(flatOrder, planInfoCache) {
    return flatOrder.map(function (g, i) {
      return { stepId: makeId('step'), order: i, mode: 'sequential', goals: [stepGoal(g, planInfoCache)] };
    });
  }

  function computeWaves(flatOrder) {
    var idSet = Object.create(null);
    flatOrder.forEach(function (g) { idSet[g.id] = true; });

    var waveOf = Object.create(null);
    var waves = [];
    flatOrder.forEach(function (g) {
      var deps = GoalManager.getGoalDependencies(g.id).filter(function (d) { return idSet[d.goalId]; });
      var waveIndex = 0;
      deps.forEach(function (d) {
        var depWave = waveOf[d.goalId];
        if (typeof depWave === 'number' && depWave + 1 > waveIndex) waveIndex = depWave + 1;
      });
      waveOf[g.id] = waveIndex;
      if (!waves[waveIndex]) waves[waveIndex] = [];
      waves[waveIndex].push(g);
    });
    return waves;
  }

  function buildParallelSteps(flatOrder, planInfoCache) {
    var waves = computeWaves(flatOrder);
    return waves.map(function (waveGoals, i) {
      return {
        stepId: makeId('step'),
        order: i,
        mode: waveGoals.length > 1 ? 'parallel' : 'sequential',
        goals: waveGoals.map(function (g) { return stepGoal(g, planInfoCache); })
      };
    });
  }

  function buildLearningSteps(goalIds, planInfoCache) {
    if (!GoalManagerLearning || typeof GoalManagerLearning.recommendGoalOrder !== 'function') return null;
    var order = GoalManagerLearning.recommendGoalOrder({ goalIds: goalIds });
    return order.map(function (g, i) {
      return { stepId: makeId('step'), order: i, mode: 'sequential', goals: [stepGoal(g, planInfoCache)] };
    });
  }

  // ------------------------------------------------------------
  // PART K — Planning factors + scoring (Requirements 3 & 4).
  // Pure function of a goal set + the steps already built for it —
  // no side effects, safe to call more than once per plan (scorePlan()
  // re-derives fresh factors from live state rather than trusting a
  // stale cached score).
  // ------------------------------------------------------------
  function evaluatePlan(goalSnapshots, steps, planInfoCache) {
    planInfoCache = planInfoCache || Object.create(null);
    var n = goalSnapshots.length;
    var idSet = Object.create(null);
    goalSnapshots.forEach(function (g) { idSet[g.id] = true; });

    var totalDeps = 0, capHits = 0, agentHits = 0, successSum = 0, totalCost = 0;
    var durationById = Object.create(null);

    goalSnapshots.forEach(function (g) {
      var info = planInfoCache[g.id] || (planInfoCache[g.id] = resolveGoalPlanInfo(g));
      var deps = GoalManager.getGoalDependencies(g.id).filter(function (d) { return idSet[d.goalId]; }).length;
      totalDeps += deps;
      if (info.capability) capHits += 1;
      if (info.agentId) agentHits += 1;

      var stats = goalHistoricalStats(info.capability);
      successSum += (stats && typeof stats.score === 'number') ? stats.score : 0.5;
      var dur = estimateGoalDurationMs(stats);
      durationById[g.id] = dur;
      totalCost += 1 + (deps * 0.5) + (info.agentId ? 0 : 1);
    });

    var stepDurationMs = steps.reduce(function (sum, step) {
      var stepMax = step.goals.reduce(function (m, sg) {
        var d = durationById[sg.goalId];
        return Math.max(m, typeof d === 'number' ? d : DEFAULT_STRATEGY_DURATION_MS);
      }, 0);
      return sum + stepMax;
    }, 0);

    var maxParallelism = steps.reduce(function (m, step) { return Math.max(m, step.goals.length); }, 0);

    var factors = {
      executionCost: totalCost,
      estimatedDurationMs: stepDurationMs,
      capabilityAvailability: n ? capHits / n : 0,
      agentAvailability: n ? agentHits / n : 0,
      dependencyComplexity: n > 1 ? clamp01(totalDeps / (n - 1)) : 0,
      systemLoad: computeSystemLoad(),
      historicalSuccessRate: n ? clamp01(successSum / n) : 0.5
    };

    var reliability = clamp01(
      factors.historicalSuccessRate * 0.5 +
      factors.capabilityAvailability * 0.25 +
      factors.agentAvailability * 0.25
    );
    var resourceUsage = n ? clamp01(maxParallelism / n) : 0;
    var completionProbability = clamp01(
      reliability *
      (1 - factors.dependencyComplexity * 0.25) *
      (1 - factors.systemLoad * resourceUsage * 0.3)
    );

    var durationBaseline = Math.max(1, n) * DEFAULT_STRATEGY_DURATION_MS * 2;
    var costBaseline = Math.max(1, n) * 2 * 2;
    var effDuration = clamp01(1 - factors.estimatedDurationMs / durationBaseline);
    var effCost = clamp01(1 - factors.executionCost / costBaseline);
    var efficiency = clamp01(effDuration * 0.6 + effCost * 0.4);

    var confidence = clamp01((reliability + completionProbability + (1 - factors.dependencyComplexity)) / 3);
    var overall = clamp01(reliability * 0.35 + efficiency * 0.30 + completionProbability * 0.35);

    return {
      factors: factors,
      score: {
        reliability: reliability,
        efficiency: efficiency,
        completionProbability: completionProbability,
        resourceUsage: resourceUsage,
        confidence: confidence,
        overall: overall
      }
    };
  }

  function scorePlan(planObject) {
    if (!isPlainObject(planObject) || !Array.isArray(planObject.goalIds) || !Array.isArray(planObject.steps)) {
      throw structuralError('scorePlan: expected a plan object with goalIds[] and steps[] (as returned by generateExecutionPlan()).');
    }
    var goalSnapshots = planObject.goalIds.map(function (id) { return GoalManager.getGoal(id); }).filter(Boolean);
    return evaluatePlan(goalSnapshots, planObject.steps, Object.create(null)).score;
  }

  // ------------------------------------------------------------
  // PART L — Execution Plan Generation (Requirement 1).
  // ------------------------------------------------------------
  function generateExecutionPlan(input, options) {
    options = isPlainObject(options) ? options : {};
    var normalized = normalizePlanInput(input);
    var strategy = VALID_PLAN_STRATEGIES.indexOf(options.strategy) !== -1
      ? options.strategy
      : PLAN_STRATEGIES.SEQUENTIAL;

    if (strategy === PLAN_STRATEGIES.LEARNING &&
        (!GoalManagerLearning || typeof GoalManagerLearning.recommendGoalOrder !== 'function')) {
      throw structuralError('generateExecutionPlan: strategy "learning" requires os/core/goal-manager-learning.js to be loaded.');
    }

    // Single source of truth for order AND for the cycle guard —
    // never recomputed by this file (see PART J header).
    var flatOrder = GoalManager.getGoalExecutionOrder({ goalIds: normalized.goalIds });
    if (!flatOrder.length) {
      throw structuralError('generateExecutionPlan: no non-terminal goals among the given goalIds to plan for.');
    }

    var planInfoCache = Object.create(null);
    flatOrder.forEach(function (g) { planInfoCache[g.id] = resolveGoalPlanInfo(g); });

    var steps;
    if (strategy === PLAN_STRATEGIES.PARALLEL) {
      steps = buildParallelSteps(flatOrder, planInfoCache);
    } else if (strategy === PLAN_STRATEGIES.LEARNING) {
      steps = buildLearningSteps(normalized.goalIds, planInfoCache);
    } else {
      steps = buildSequentialSteps(flatOrder, planInfoCache);
    }

    var evaluation = evaluatePlan(flatOrder, steps, planInfoCache);

    var planObject = {
      planId: makeId('plan'),
      decisionId: normalized.decisionId,
      strategy: strategy,
      goalIds: flatOrder.map(function (g) { return g.id; }),
      steps: steps,
      factors: evaluation.factors,
      score: evaluation.score,
      createdAt: now()
    };
    return deepFreeze(planObject);
  }

  // ------------------------------------------------------------
  // PART M — Alternative Plan Generation + selection (Requirement 2).
  // ------------------------------------------------------------
  function buildRejectionReason(rejected, selected) {
    var delta = selected.score.overall - rejected.score.overall;
    if (delta < 0.0005) {
      return 'scored effectively equally to the selected "' + selected.strategy +
        '" plan (overall ' + rejected.score.overall.toFixed(2) + ' vs ' + selected.score.overall.toFixed(2) +
        ') but ranked lower on tie-break.';
    }
    var dims = [
      { name: 'reliability', d: selected.score.reliability - rejected.score.reliability },
      { name: 'efficiency', d: selected.score.efficiency - rejected.score.efficiency },
      { name: 'completion probability', d: selected.score.completionProbability - rejected.score.completionProbability }
    ].sort(function (a, b) { return b.d - a.d; });
    var top = dims[0];
    return 'scored lower overall (' + rejected.score.overall.toFixed(2) + ' vs ' + selected.score.overall.toFixed(2) +
      '), primarily due to lower ' + top.name + ' (behind by ' + top.d.toFixed(2) + ').';
  }

  function generateAlternativePlans(input, options) {
    options = isPlainObject(options) ? options : {};
    var strategies = [PLAN_STRATEGIES.SEQUENTIAL, PLAN_STRATEGIES.PARALLEL];
    if (GoalManagerLearning && typeof GoalManagerLearning.recommendGoalOrder === 'function') {
      strategies.push(PLAN_STRATEGIES.LEARNING);
    }

    var plans = strategies.map(function (s) {
      return generateExecutionPlan(input, { strategy: s });
    });

    var ranked = plans.slice().sort(function (a, b) {
      if (b.score.overall !== a.score.overall) return b.score.overall - a.score.overall;
      return a.planId < b.planId ? -1 : (a.planId > b.planId ? 1 : 0); // deterministic tie-break
    });
    var selected = ranked[0];
    var rejected = ranked.slice(1).map(function (p) {
      return { planId: p.planId, strategy: p.strategy, reason: buildRejectionReason(p, selected) };
    });

    return { plans: plans, selected: selected, rejected: rejected };
  }

  // ------------------------------------------------------------
  // PART N — Decision Explanation (Requirement 5). Plain string
  // assembly, no model — same posture as buildReasoningSummary()
  // above.
  // ------------------------------------------------------------
  function explainPlan(selected, rejected) {
    var parts = [];
    parts.push('Selected the "' + selected.strategy + '" plan (overall score ' +
      selected.score.overall.toFixed(2) + ', confidence ' + selected.score.confidence.toFixed(2) + ').');
    parts.push('Reliability ' + selected.score.reliability.toFixed(2) +
      ', efficiency ' + selected.score.efficiency.toFixed(2) +
      ', completion probability ' + selected.score.completionProbability.toFixed(2) +
      ', resource usage ' + selected.score.resourceUsage.toFixed(2) + '.');
    (rejected || []).forEach(function (r) {
      parts.push('Rejected "' + r.strategy + '" plan: ' + r.reason);
    });
    var path = selected.steps.map(function (step, i) {
      var names = step.goals.map(function (g) { return g.title; }).join(' + ');
      return 'Step ' + (i + 1) + ' (' + step.mode + '): ' + names;
    }).join(' -> ');
    parts.push('Expected execution path: ' + path + '.');
    parts.push('Estimated completion time: ' + Math.round(selected.factors.estimatedDurationMs) + 'ms.');
    return parts.join(' ');
  }

  // ------------------------------------------------------------
  // PART O — Planning history + metrics. Same bounded-log posture as
  // PART D's decision history above; a second, independent log (a
  // planning cycle and a decision are different kinds of record).
  // ------------------------------------------------------------
  var MAX_PLANNING_HISTORY = 200;
  var planningById = Object.create(null);
  var planningOrder = [];
  var planningMetrics = { startedCount: 0, completedCount: 0, failedCount: 0 };

  function recordPlanning(p) {
    planningById[p.planningId] = p;
    planningOrder.push(p.planningId);
    if (planningOrder.length > MAX_PLANNING_HISTORY) {
      var evicted = planningOrder.shift();
      delete planningById[evicted];
    }
  }

  function getPlanning(planningId) {
    return (isNonEmptyString(planningId) && planningById[planningId]) || null;
  }

  function getPlanningHistory(filter) {
    filter = isPlainObject(filter) ? filter : {};
    var ids = planningOrder.slice();
    var limit = typeof filter.limit === 'number' ? filter.limit : ids.length;
    return ids.slice(-limit).map(function (id) { return planningById[id]; });
  }

  function getPlanningMetrics() {
    return {
      startedCount: planningMetrics.startedCount,
      completedCount: planningMetrics.completedCount,
      failedCount: planningMetrics.failedCount,
      historySize: planningOrder.length
    };
  }

  // ------------------------------------------------------------
  // PART P — plan(): the main planning entry point (Requirement 6:
  // events). Mirrors decide()'s own Runtime Context + event + history
  // discipline exactly, for a planning cycle instead of a decision.
  // Analysis + read-only recommendation ONLY — never dispatches,
  // executes, or admits a goal.
  // ------------------------------------------------------------
  function plan(input, options) {
    options = isPlainObject(options) ? options : {};
    var planningId = makeId('planning');
    var startedAt = now();
    planningMetrics.startedCount += 1;
    emit('planning_started', { planningId: planningId, timestamp: startedAt });

    var contextRecordId = null;
    try {
      contextRecordId = RuntimeContext.createContext({
        metadata: { planningId: planningId, source: 'decision-engine-planning' },
        state: { status: 'planning' }
      }).contextId;
      RuntimeContext.markReady(contextRecordId);
      RuntimeContext.markRunning(contextRecordId);
    } catch (err) {
      log('error', 'runtime context creation failed', { planningId: planningId, message: err && err.message });
      contextRecordId = null;
    }

    try {
      var normalized = normalizePlanInput(input);
      var result;
      if (options.mode === 'single') {
        var strategy = VALID_PLAN_STRATEGIES.indexOf(options.strategy) !== -1 ? options.strategy : PLAN_STRATEGIES.SEQUENTIAL;
        var singlePlan = generateExecutionPlan(input, { strategy: strategy });
        result = { plans: [singlePlan], selected: singlePlan, rejected: [] };
      } else {
        result = generateAlternativePlans(input, options);
      }

      var explanation = explainPlan(result.selected, result.rejected);

      var planningResult = {
        planningId: planningId,
        decisionId: normalized.decisionId,
        timestamp: startedAt,
        plans: result.plans,
        selected: result.selected,
        rejected: result.rejected,
        explanation: explanation,
        contextId: contextRecordId
      };

      if (contextRecordId) {
        try { RuntimeContext.completeContext(contextRecordId, { selectedPlanId: result.selected.planId }); }
        catch (err) { log('error', 'runtime context completion failed', err && err.message); }
      }

      planningMetrics.completedCount += 1;
      recordPlanning(planningResult);
      emit('planning_completed', {
        planningId: planningId,
        decisionId: normalized.decisionId,
        selectedPlanId: result.selected.planId,
        planCount: result.plans.length,
        timestamp: now()
      });
      emit('plan_selected', {
        planningId: planningId,
        planId: result.selected.planId,
        strategy: result.selected.strategy,
        score: result.selected.score,
        timestamp: now()
      });

      return deepFreeze(planningResult);
    } catch (err) {
      planningMetrics.failedCount += 1;
      if (contextRecordId) {
        try { RuntimeContext.failContext(contextRecordId, err && err.message); }
        catch (e2) { /* swallow — best-effort cleanup */ }
      }
      emit('planning_failed', { planningId: planningId, error: err && err.message, timestamp: now() });
      throw err;
    }
  }

  // ------------------------------------------------------------
  // Standalone global only — same posture goal-manager.js /
  // autonomous-decision-engine.js already document for the identical
  // reason: nothing here should be able to collide with another
  // module's own claimed surface (see file header re: the
  // window.AxiomDecisionEngine name already held by Part 3C).
  // ------------------------------------------------------------
  var AxiomCognitiveDecisionEngine = {
    API_VERSION: API_VERSION,
    INTENT_CATEGORIES: INTENT_CATEGORIES,
    VALID_INTENT_CATEGORIES: VALID_INTENT_CATEGORIES,

    detectIntent: detectIntent,
    extractContext: extractContext,
    matchCapabilities: matchCapabilities,
    decide: decide,

    getDecision: getDecision,
    getDecisionHistory: getDecisionHistory,
    getMetrics: getMetrics,

    // --- Block 2 / Step 8 / Part 2: Intelligent Planning ---
    PLAN_STRATEGIES: PLAN_STRATEGIES,
    VALID_PLAN_STRATEGIES: VALID_PLAN_STRATEGIES,

    generateExecutionPlan: generateExecutionPlan,
    generateAlternativePlans: generateAlternativePlans,
    scorePlan: scorePlan,
    explainPlan: explainPlan,
    plan: plan,

    getPlanning: getPlanning,
    getPlanningHistory: getPlanningHistory,
    getPlanningMetrics: getPlanningMetrics
  };

  global.AxiomCognitiveDecisionEngine = AxiomCognitiveDecisionEngine;
})(typeof window !== 'undefined' ? window : this);
