// ============================================================
// AXIOM AI OS — Milestone 6: Coding Agent Toolkit
// ------------------------------------------------------------
// Extends the Coding Agent with project-aware capabilities, all
// composed from tools that already exist:
//
//   projectSearch()      -> AxiomAgents.runTool('workspace_search', …)
//   fileNavigation()      -> the SAME workspace_search, organized into
//                            a tree-ish listing (no new file index)
//   explainCode()         -> the SAME OpenRouter.streamChat() client the
//                            existing "generate" path already uses
//   proposeRefactor()     -> produces a PROPOSAL only (diff-shaped text
//                            + requiresConfirmation: true). It never
//                            writes to any file — applying a refactor
//                            is explicitly out of scope until a human
//                            confirms, per the milestone brief.
//   investigateBug()      -> a small multi-step workflow: search for
//                            likely-relevant files, gather their text,
//                            then ask the model for a hypothesis —
//                            read-only throughout.
//   analyzeProject()      -> aggregate stats over workspace_search
//                            results (counts by kind/extension).
//
// Public surface — window.AxiomCodingToolkit
// ============================================================
window.AxiomCodingToolkit = (function () {
  'use strict';

  // ------------------------------------------------------------
  // Block 2 / Step 1: model access.
  //
  // This used to look for `window.OpenRouterClient` / `window.AxiomOpenRouter`
  // and a `.complete()` method — neither of which the app defines anywhere
  // (the real, loaded client is `window.OpenRouter`, with a callback/streaming
  // `.streamChat()`, not a promise-based `.complete()`). Every op below was
  // therefore silently unreachable: "generate" always fell through to the
  // canned placeholder note, and explainCode/proposeRefactor/investigateBug
  // always threw "No code-generation model client is available", even with
  // a fully working model configured. completeText() is the real client,
  // wired to what actually loads on the page, wrapped so the rest of the
  // toolkit can keep awaiting a single string like before.
  //
  // It also wires up real cancellation: if a `task` is passed in opts and
  // the runtime cooperatively flags it cancelled (Agent.cancelCurrent),
  // this aborts the in-flight fetch/stream instead of leaving it running
  // in the background after the caller has stopped listening.
  //
  // Block 2 / Step 1 (this pass): every other agent that talks to a real
  // backend (Browser, Memory, Planner, File) runs its call through
  // AxiomCapabilityKit.withCapability() for uniform loading/success/
  // failure/retry/timeout handling. The Coding Agent's LLM calls were the
  // one exception — a hung or slow-to-respond stream had no timeout at
  // all, so streamChat() calling neither onDone nor onError left the
  // in-flight promise pending forever. The agent's status eventually got
  // cosmetically reset to idle by the manager's 15s stall heartbeat, but
  // the agent's internal _processing flag never cleared, so it silently
  // stopped draining its queue — new requests would sit forever, and if
  // the original stream ever did resolve, its result would land after
  // the fact as an effective duplicate/stale response. Routing through
  // withCapability() gives every coding op a real timeout that actually
  // rejects the promise (so the runtime's task queue settles and drains
  // correctly) plus bounded retries for transient failures — never for a
  // cancellation, which withCapability always re-throws untouched.
  // ------------------------------------------------------------
  function hasClient() { return !!(window.OpenRouter && typeof window.OpenRouter.streamChat === 'function'); }

  function resolveModel(explicit) {
    if (explicit) return explicit;
    try {
      if (window.ModelSelector && typeof window.ModelSelector.getSelectedModel === 'function') {
        var selected = window.ModelSelector.getSelectedModel();
        if (selected) return selected;
      }
    } catch (e) { /* selector unavailable on this page — fall through */ }
    return 'openai/gpt-4o-mini';
  }

  // Rough, dependency-free token estimate (~4 chars/token, the same
  // ballpark heuristic most providers quote for English text/code).
  // Good enough for surfacing usage in the UI/stats — not billing-grade.
  function estimateTokenCount(chars) {
    return chars > 0 ? Math.max(1, Math.ceil(chars / 4)) : 0;
  }

  function estimateUsage(messages, outputText) {
    var promptChars = (messages || []).reduce(function (sum, m) { return sum + String((m && m.content) || '').length; }, 0);
    var promptTokens = estimateTokenCount(promptChars);
    var completionTokens = estimateTokenCount(String(outputText || '').length);
    return { promptTokens: promptTokens, completionTokens: completionTokens, totalTokens: promptTokens + completionTokens, estimated: true };
  }

  // One live call to the streaming client, wrapped in a promise. Kept as
  // its own function so withCapability() can retry it (a fresh
  // AbortController/watchdog per attempt) without duplicating the
  // cancellation wiring at every call site.
  function streamOnce(model, messages, task) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var watchdog = (task && controller)
      ? setInterval(function () { if (task.cancelled) controller.abort(); }, 150)
      : null;

    function cleanup() { if (watchdog) clearInterval(watchdog); }

    return new Promise(function (resolve, reject) {
      window.OpenRouter.streamChat({
        model: model,
        messages: messages,
        signal: controller ? controller.signal : undefined,
        onDone: function (fullText, aborted) {
          cleanup();
          if (aborted) { var err = new Error('Cancelled'); err.cancelled = true; reject(err); return; }
          // Response parsing: the client contract promises a string, but
          // never trust that blindly — coerce/guard so a malformed or
          // empty payload can't propagate as a silent non-string result.
          resolve(typeof fullText === 'string' ? fullText : String(fullText == null ? '' : fullText));
        },
        onError: function (err) { cleanup(); reject(err || new Error('Unknown streaming error')); }
      });
    });
  }

  /**
   * Runs one completion through the real client, timeout- and
   * retry-wrapped via AxiomCapabilityKit when available (falls back to a
   * single bare attempt if the kit isn't loaded on this page, e.g. in an
   * isolated test harness).
   * @param {Array<{role:string, content:string}>} messages
   * @param {object} [opts]
   * @param {object} [opts.task] - the runtime task, for cancellation
   * @param {object} [opts.ctx] - agent handler ctx ({agent, bus}), for capability lifecycle events
   * @param {string} [opts.model]
   * @param {string} [opts.label] - capability name suffix, e.g. 'generate' / 'explain-code'
   * @param {number} [opts.timeoutMs] - default 45000
   * @param {number} [opts.retries] - total attempts, default 2
   * @returns {Promise<{text:string, usage:object}>}
   */
  function completeText(messages, opts) {
    opts = opts || {};
    if (!hasClient()) return Promise.reject(new Error('No code-generation model client is available on this page.'));
    if (!Array.isArray(messages) || !messages.length) return Promise.reject(new Error('completeText requires at least one message.'));

    var model = resolveModel(opts.model);
    var task = opts.task || null;
    var ctx = opts.ctx || {};
    var label = 'coding:' + (opts.label || 'complete');
    var timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 45000;
    var retries = typeof opts.retries === 'number' ? opts.retries : 2;

    var run = function () { return streamOnce(model, messages, task); };
    var kit = window.AxiomCapabilityKit;
    var promise = kit
      ? kit.withCapability(label, task, ctx, run, { timeoutMs: timeoutMs, retries: retries })
      : run();

    return promise.then(function (text) {
      return { text: text, usage: estimateUsage(messages, text) };
    });
  }

  function mem() { return window.AxiomAgents; }

  async function projectSearch(query, limit) {
    var m = mem();
    if (!m || typeof m.runTool !== 'function') throw new Error('Workspace search is unavailable on this page.');
    return m.runTool('workspace_search', { query: query || '', limit: limit || 20 });
  }

  // "File navigation": the same search results, organized as a shallow
  // path-prefix tree so a caller can browse rather than just list.
  async function fileNavigation(query, limit) {
    var files = await projectSearch(query, limit || 100);
    var tree = {};
    (files || []).forEach(function (f) {
      var parts = String(f.filename || f.path || f.id || 'unknown').split('/');
      var dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '(root)';
      (tree[dir] = tree[dir] || []).push(f);
    });
    return { total: (files || []).length, byDirectory: tree };
  }

  // Optional conversation context: a leading system message and prior
  // turns (opts.task.system / opts.task.history), so multi-turn coding
  // conversations aren't forced back to a single isolated prompt every
  // time. Both are optional and additive — omit them and behavior is
  // exactly the single-message prompt as before.
  function buildMessages(task, userContent) {
    var msgs = [];
    var t = task || {};
    if (t.system) msgs.push({ role: 'system', content: String(t.system) });
    if (Array.isArray(t.history)) {
      t.history.forEach(function (turn) {
        if (turn && turn.role && turn.content != null) msgs.push({ role: String(turn.role), content: String(turn.content) });
      });
    }
    msgs.push({ role: 'user', content: userContent });
    return msgs;
  }

  async function explainCode(prompt, opts) {
    if (!prompt) throw new Error('explainCode requires code or a question.');
    opts = opts || {};
    var messages = buildMessages(opts.task, 'Explain the following code clearly and concisely:\n\n' + prompt);
    var out = await completeText(messages, Object.assign({ label: 'explain-code' }, opts));
    return { explanation: out.text, usage: out.usage };
  }

  // Never applies anything — returns a suggestion the person must review
  // and apply themselves (or explicitly confirm through a real file-write
  // path elsewhere in the OS). requiresConfirmation is always true.
  async function proposeRefactor(prompt, instructions, opts) {
    if (!prompt) throw new Error('proposeRefactor requires the code to refactor.');
    opts = opts || {};
    var ask = 'Propose a refactor for the following code. ' +
      (instructions ? ('Goal: ' + instructions + '. ') : '') +
      'Return the suggested change and a short rationale. Do not claim the change has been applied.\n\n' + prompt;
    if (!hasClient()) {
      return { proposal: null, requiresConfirmation: true, applied: false, note: 'No code-generation model client is available — nothing was proposed or applied.' };
    }
    var messages = buildMessages(opts.task, ask);
    var out = await completeText(messages, Object.assign({ label: 'refactor' }, opts));
    return { proposal: out.text, requiresConfirmation: true, applied: false, usage: out.usage };
  }

  // Read-only bug-investigation workflow: search -> gather -> hypothesize.
  // Each step reuses an existing tool; nothing here mutates project files.
  async function investigateBug(description, opts) {
    if (!description) throw new Error('investigateBug requires a bug description.');
    opts = opts || {};
    var candidates = [];
    try { candidates = await projectSearch(description, 6); } catch (e) { /* search unavailable — proceed with none */ }

    var context = (candidates || []).map(function (f) { return '- ' + (f.filename || f.id); }).join('\n');
    var prompt = 'A user reports this bug:\n"' + description + '"\n\n' +
      (context ? ('Potentially relevant files found by workspace search:\n' + context + '\n\n') : '') +
      'Suggest likely root causes and where to look next. Do not claim to have already fixed anything.';

    if (!hasClient()) {
      return { candidateFiles: candidates, hypothesis: null, note: 'No code-generation model client is available — file candidates only.' };
    }
    var messages = buildMessages(opts.task, prompt);
    var out = await completeText(messages, Object.assign({ label: 'bug-investigation' }, opts));
    return { candidateFiles: candidates, hypothesis: out.text, usage: out.usage };
  }

  // "Project analysis": aggregate stats over the same workspace_search
  // index the other capabilities use — no separate project-scanning system.
  async function analyzeProject(query) {
    var files = await projectSearch(query || '', 500);
    var byExt = {}, byKind = {};
    (files || []).forEach(function (f) {
      var name = f.filename || f.path || '';
      var ext = (name.split('.').pop() || 'unknown').toLowerCase();
      byExt[ext] = (byExt[ext] || 0) + 1;
      var kind = f.kind || 'other';
      byKind[kind] = (byKind[kind] || 0) + 1;
    });
    return { total: (files || []).length, byExtension: byExt, byKind: byKind };
  }

  return {
    completeText: completeText,
    hasClient: hasClient,
    estimateUsage: estimateUsage,
    projectSearch: projectSearch,
    fileNavigation: fileNavigation,
    explainCode: explainCode,
    proposeRefactor: proposeRefactor,
    investigateBug: investigateBug,
    analyzeProject: analyzeProject
  };
})();
