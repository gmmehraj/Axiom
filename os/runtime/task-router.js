// ============================================================
// AXIOM AI OS — Milestone 4: Task Router
// ------------------------------------------------------------
// Decides WHICH agent(s) should handle a request. It is pure and
// stateless: text (or a structured request) in, a routing decision
// out. It never dispatches anything itself — the Agent Manager owns
// dispatch — which keeps routing testable in isolation and prevents
// two systems from both "sending" tasks.
//
//   "Search the web"    -> Browser Agent
//   "Summarize PDF"     -> File Agent
//   "Generate code"     -> Coding Agent
//   "Remember this"     -> Memory Agent
//   "Create a plan"     -> Planner Agent
//
// Multi-agent collaboration is first-class: a request can match
// several rules ("research X then write code to do it" -> Research
// Agent + Coding Agent), and the decision preserves order so the
// manager dispatches a coordinated sequence.
//
// Plugin architecture: rules live in an ordered, mutable list.
// addRule()/removeRule() let new agents register their own routing
// triggers at runtime without editing this file — the same
// extensibility principle the agent definitions follow.
//
// Public surface — window.AxiomTaskRouter:
//   .route(request)            -> decision { text, intent, agents:[{agentId, task, matchedBy}] }
//   .addRule(rule)             -> register a routing rule (returns an id)
//   .removeRule(id)            -> remove a rule
//   .rules()                   -> current rules (read-only copy)
//   .explain(request)          -> human-readable trace of what matched
// ============================================================
window.AxiomTaskRouter = (function () {
  'use strict';

  // A rule maps a matcher to a target agent + a base task template.
  // `keywords` is the common case (any keyword present => match);
  // `test(text)` is the escape hatch for anything richer.
  // `priority` orders multi-agent output (lower runs first).
  var _rules = [];
  var _seq = 0;

  function normalize(request) {
    if (typeof request === 'string') return { text: request, structured: null };
    if (request && typeof request === 'object') {
      // A structured request may already name an intent or a target agent.
      return { text: String(request.text || request.intent || request.query || ''), structured: request };
    }
    return { text: '', structured: null };
  }

  function keywordMatch(text, keywords) {
    var t = ' ' + text.toLowerCase() + ' ';
    for (var i = 0; i < keywords.length; i++) {
      var k = keywords[i].toLowerCase();
      // word-ish boundary match so "code" doesn't fire inside "encode"
      if (t.indexOf(' ' + k) !== -1 || t.indexOf(k + ' ') !== -1 || t.indexOf(' ' + k + ' ') !== -1) return keywords[i];
    }
    return null;
  }

  /**
   * Register a routing rule. Rules are re-sorted by priority (ascending —
   * lower runs first) after every add.
   * @param {object} rule - { agentId (required), intent, keywords, test,
   *   task, workflow, priority }
   * @returns {string} generated rule id, usable with removeRule()
   * @throws {Error} if rule.agentId is missing
   */
  function addRule(rule) {
    if (!rule || !rule.agentId) throw new Error('[AxiomTaskRouter] a rule needs an agentId.');
    var id = 'rule-' + (++_seq);
    _rules.push({
      id: id,
      intent: rule.intent || rule.agentId,
      agentId: rule.agentId,
      keywords: rule.keywords || [],
      test: typeof rule.test === 'function' ? rule.test : null,
      task: (typeof rule.task === 'function' || rule.task) ? rule.task : {},
      workflow: rule.workflow || null,
      priority: typeof rule.priority === 'number' ? rule.priority : 100
    });
    _rules.sort(function (a, b) { return a.priority - b.priority; });
    return id;
  }

  /** @param {string} id @returns {boolean} true if a rule with that id existed and was removed */
  function removeRule(id) {
    var before = _rules.length;
    _rules = _rules.filter(function (r) { return r.id !== id; });
    return _rules.length !== before;
  }

  /** @returns {object[]} a read-only-shaped copy of every registered rule */
  function rules() {
    return _rules.map(function (r) {
      return { id: r.id, intent: r.intent, agentId: r.agentId, keywords: r.keywords.slice(), priority: r.priority };
    });
  }

  /**
   * Core routing. Collects EVERY matching rule (deduped per agent, first
   * match wins for that agent) so multi-agent collaborations surface,
   * ordered by rule priority. Falls back to the Assistant Agent when
   * nothing matches, so no request is ever silently dropped.
   * @param {string|object} request - free text, or a structured request
   *   with an explicit agentId
   * @returns {{text: string, intent: string, agents: object[]}}
   */
  function route(request) {
    var norm = normalize(request);
    var text = norm.text;

    // A structured request can force a target agent, bypassing keywords.
    if (norm.structured && norm.structured.agentId) {
      return {
        text: text,
        intent: norm.structured.intent || norm.structured.agentId,
        agents: [{ agentId: norm.structured.agentId, task: Object.assign({}, norm.structured), matchedBy: 'explicit' }]
      };
    }

    var seen = Object.create(null);
    var agents = [];
    _rules.forEach(function (r) {
      if (seen[r.agentId]) return;
      var matched = null;
      if (r.test) { try { matched = r.test(text) ? 'test' : null; } catch (e) { matched = null; } }
      if (!matched && r.keywords.length) { var kw = keywordMatch(text, r.keywords); if (kw) matched = 'keyword:' + kw; }
      if (matched) {
        seen[r.agentId] = true;
        var resolvedTask = typeof r.task === 'function' ? (r.task(text) || {}) : (r.task || {});
        agents.push({
          agentId: r.agentId,
          matchedBy: matched,
          workflow: r.workflow,
          task: Object.assign({ intent: r.intent, text: text }, resolvedTask,
            (norm.structured ? { params: norm.structured } : {}))
        });
      }
    });

    // Nothing matched: fall back to the Assistant Agent, the conversational
    // front door, so no request is ever silently dropped.
    if (!agents.length) {
      agents.push({ agentId: 'agent.assistant', matchedBy: 'fallback', task: { intent: 'converse', text: text } });
    }

    return { text: text, intent: agents[0].task.intent, agents: agents };
  }

  /**
   * Human-readable trace of route()'s decision — one line per matched
   * agent, showing what matched it. Useful for debugging routing rules.
   * @param {string|object} request
   * @returns {string}
   */
  function explain(request) {
    var d = route(request);
    return d.agents.map(function (a) { return a.agentId + '  <=  ' + a.matchedBy; }).join('\n');
  }

  // -------------------- Default rules for the ten core agents ------------
  // Ordered by priority so that, e.g., an explicit "remember" beats a generic
  // "note". Planner sits early because it often precedes other agents.
  [
    // A standalone "research <topic>" request runs the full collaboration
    // (Browser collects -> Memory stores -> Planner drafts next steps ->
    // Assistant presents) rather than just handing the topic to one agent.
    // Priority 5 so it wins the agent.browser slot ahead of the generic
    // browse rule below; compound requests ("research X then write code")
    // still fall through to normal multi-agent dispatch since the keyword
    // rules further down also match and cover the other agents involved.
    { agentId: 'agent.browser', intent: 'research-workflow', priority: 5, workflow: 'researchAndRemember',
      test: function (t) { return /^\s*research\b/i.test(t) && !/\bthen\b/i.test(t); } },
    { agentId: 'agent.planner',    intent: 'plan',        priority: 10, keywords: ['plan', 'break down', 'steps', 'roadmap', 'organize', 'strategy', 'outline'] },

    // Milestone 6 — "Documents" workflow (File -> Vision if needed -> Memory
    // -> Assistant). Priority 33, between the generic browse rule (30) and
    // the plain File Agent rule (35), so a clear "process/analyze this
    // document/file" request runs the full workflow instead of a bare
    // File Agent dispatch, while a plain "summarize this PDF" still goes
    // straight to the File Agent as it always has.
    { agentId: 'agent.file', intent: 'documents-workflow', priority: 33, workflow: 'documentWorkflow',
      test: function (t) { return /\b(process|analy[sz]e|handle)\b.*\b(document|file|pdf|docx|upload)\b/i.test(t); } },

    // Milestone 6 — "Development" workflow (Coding -> Browser -> Planner ->
    // Assistant). Priority 19, just ahead of the plain Coding Agent rule
    // (20), so "investigate this bug" / "analyze the project and fix it"
    // runs the full workflow instead of a single generation request.
    { agentId: 'agent.coding', intent: 'development-workflow', priority: 19, workflow: 'developmentWorkflow',
      test: function (t) { return /\b(investigate|diagnose|track down)\b.*\bbug\b/i.test(t) || /\banalyze (the )?project\b/i.test(t); } },

    // "Open YouTube" / "Open github.com" / "Open https://…" -> Browser
    // Agent navigate. Deliberately skips known workspace names ("open
    // settings", "open browser") since those are handled by the OS
    // shell's own dock/command-palette actions, not free-text routing —
    // matching them here would misroute a workspace-open click's text.
    { agentId: 'agent.browser', intent: 'browse', priority: 12,
      test: function (t) {
        var m = /^\s*open\s+(.+)$/i.exec(t);
        if (!m) return false;
        var target = m[1].trim().toLowerCase().replace(/^(the|a)\s+/, '');
        var workspaceNames = ['browser', 'settings', 'memory', 'billing', 'analytics', 'automation',
          'coding', 'voice', 'image', 'chat', 'dashboard', 'studios', 'playground', 'brain', 'admin', 'workspace'];
        return workspaceNames.indexOf(target) === -1;
      },
      task: function (t) {
        var m = /^\s*open\s+(.+)$/i.exec(t);
        var raw = (m ? m[1] : t).trim().replace(/^(the|a)\s+/i, '');
        var key = raw.toLowerCase();
        var knownSites = {
          youtube: 'https://youtube.com', github: 'https://github.com', google: 'https://google.com',
          gmail: 'https://mail.google.com', reddit: 'https://reddit.com', twitter: 'https://twitter.com',
          x: 'https://x.com', wikipedia: 'https://wikipedia.org', amazon: 'https://amazon.com',
          netflix: 'https://netflix.com', linkedin: 'https://linkedin.com'
        };
        if (knownSites[key]) return { op: 'navigate', url: knownSites[key] };
        if (/^https?:\/\//i.test(raw)) return { op: 'navigate', url: raw };
        if (/\.[a-z]{2,}$/i.test(raw)) return { op: 'navigate', url: 'https://' + raw };
        // Not a recognizable domain — treat as a search rather than
        // guessing a made-up ".com" that likely doesn't exist.
        return { op: 'search', query: raw };
      }
    },

    // Memory phrasing carries real intent ("remember: X" vs "show my
    // memories"), so this rule derives op + note/query from the actual
    // words instead of a single fixed task template.
    { agentId: 'agent.memory', intent: 'memory', priority: 15,
      keywords: ['remember', 'memorize', 'note this', 'save this', 'recall',
        'forget', "don't forget", 'my memories', 'what do you remember', 'what do i remember'],
      task: function (t) {
        var m = /^\s*(?:remember|memorize|note this|save this)\s*[:\-]?\s*(.+)$/i.exec(t);
        if (m && m[1] && m[1].trim()) return { op: 'remember', note: m[1].trim() };
        if (/\bforget\b/i.test(t) && !/don'?t forget/i.test(t)) return { op: 'forget-all' };
        return { op: 'recall' }; // "show my memories", "recall", "what do you remember", bare "remember"
      }
    },
    { agentId: 'agent.coding',     intent: 'code',        priority: 20, keywords: ['code', 'function', 'bug', 'refactor', 'program', 'script', 'implement', 'compile', 'debug', 'api'] },
    { agentId: 'agent.research',   intent: 'research',    priority: 25, keywords: ['research', 'find out', 'investigate', 'compare', 'sources', 'gather', 'analyze topic'] },
    { agentId: 'agent.browser',    intent: 'browse',      priority: 30, keywords: ['search the web', 'browse', 'website', 'url', 'open page', 'google', 'look up', 'navigate'] },
    { agentId: 'agent.file',       intent: 'file',        priority: 35, keywords: ['pdf', 'document', 'file', 'summarize', 'docx', 'spreadsheet', 'transcript', 'extract text'] },
    { agentId: 'agent.vision',     intent: 'vision',      priority: 40, keywords: ['image', 'picture', 'photo', 'ocr', 'screenshot', 'describe image', 'read text from'] },
    { agentId: 'agent.voice',      intent: 'voice',       priority: 45, keywords: ['speak', 'say', 'listen', 'voice', 'transcribe', 'read aloud', 'talk'] },
    { agentId: 'agent.automation', intent: 'automate',    priority: 50, keywords: ['automate', 'workflow', 'schedule', 'every day', 'trigger', 'routine', 'recipe'] }
    // Assistant Agent is intentionally NOT a keyword rule — it is the
    // universal fallback in route() so it never competes with a specialist.
  ].forEach(addRule);

  return {
    route: route,
    addRule: addRule,
    removeRule: removeRule,
    rules: rules,
    explain: explain
  };
})();
