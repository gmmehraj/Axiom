// ============================================================
// AXIOM AI OS — Agent Definition: Coding Agent
// ------------------------------------------------------------
// Split out of the former monolithic os/runtime/agent-definitions.js
// as part of Phase 8 Part 2 (Code Quality & Maintainability). Behavior
// is unchanged — this is the exact same spec object, just given its
// own file. See os/runtime/agent-definitions/_shared.js for the
// `tick`/`has` helpers and os/runtime/agent-definitions/_assemble.js
// for how every agent file's spec is collected into the same
// window.AxiomAgentDefinitions / window.AxiomAgentDefinitionsById
// globals the rest of the runtime already depends on.
// ============================================================
(function (global) {
  'use strict';
  var tick = global.AxiomAgentDefHelpers.tick;
  var has = global.AxiomAgentDefHelpers.has;

  (global.__axiomAgentDefs = global.__axiomAgentDefs || []).push(
{
  id: 'agent.coding',
  name: 'Coding Agent',
  description: 'Writes, reviews, and reasons about code. Routes generation requests through the active model via the OpenRouter client.',
  icon: '\uD83D\uDCBB',
  canonicalState: 'coding',
  capabilities: ['generate-code', 'review-code', 'explain-code', 'refactor',
    'project-search', 'file-navigation', 'bug-investigation', 'project-analysis'],
  tools: ['code_execution', 'workspace_search'],
  subscriptions: ['task:assign'],
  // Block 2 / Step 1: a large free-text field reaching the model unbounded
  // is the one input the request-validation stage below can't leave to
  // the toolkit — everything else (missing required fields per op) is
  // already validated close to where it's used, inside coding-toolkit.js.
  //
  // Milestone 6: new ops delegate to coding-toolkit.js. Refactor
  // requests always come back as a proposal (requiresConfirmation:
  // true, applied: false) — this handler never writes to project
  // files automatically, matching the milestone brief exactly.
  //
  // Block 2 / Step 1: request validation happens up front (op-appropriate
  // free-text field present and within a sane size) before anything ever
  // reaches the network, every live call is routed through the toolkit's
  // capability-kit-backed completeText() for timeout/retry, and each
  // result carries an estimated token-usage figure that is also folded
  // into this agent's own running stats so it's visible without digging
  // through individual task results.
  handler: async function (task, ctx) {
    var kit = global.AxiomCodingToolkit;
    var MAX_INPUT_CHARS = 20000;
    var op = task.op || (task.prompt || task.text ? 'generate' : null);

    function tooLong(field, value) {
      if (typeof value === 'string' && value.length > MAX_INPUT_CHARS) {
        return { ok: false, op: op || 'generate', error: field + ' exceeds the ' + MAX_INPUT_CHARS + '-character limit (' + value.length + ' chars). Shorten it and try again.' };
      }
      return null;
    }

    function trackUsage(usage) {
      if (!usage || !ctx || !ctx.agent) return;
      var stats = ctx.agent.stats;
      stats.tokens = stats.tokens || { prompt: 0, completion: 0, total: 0 };
      stats.tokens.prompt += usage.promptTokens || 0;
      stats.tokens.completion += usage.completionTokens || 0;
      stats.tokens.total += usage.totalTokens || 0;
      if (ctx.bus) ctx.bus.emit('agent:token-usage', ctx.agent.id, { task: task.id, usage: usage, cumulative: stats.tokens });
    }

    // Passed into every kit call: lets completeText() resolve the right
    // model (task.model, else whatever's active in the page's model
    // picker), abort the live request the moment the runtime flags this
    // task cancelled (Agent.cancelCurrent), and emit uniform capability
    // loading/success/failure/retry/timeout events via ctx (bus/agent).
    var kitOpts = { task: task, model: task.model, ctx: ctx };
    if (typeof task.timeoutMs === 'number') kitOpts.timeoutMs = task.timeoutMs;
    if (typeof task.retries === 'number') kitOpts.retries = task.retries;

    if (op === 'generate' || !op) {
      var prompt = task.prompt || task.text || '';
      if (!prompt) {
        await tick(250);
        return { ok: true, op: 'generate', note: 'Coding task prepared: ' + (task.intent || 'generate'), live: false };
      }
      var lenErr = tooLong('Prompt', prompt);
      if (lenErr) return lenErr;
      // Previously this looked for `global.OpenRouterClient` /
      // `global.AxiomOpenRouter`, which nothing in the app ever defines —
      // so this path always fell through to the canned note below, even
      // with a fully working model configured. It now goes through the
      // toolkit's completeText(), which talks to the actual client
      // (window.OpenRouter) that the rest of the app already uses, wrapped
      // with a real timeout + bounded retries.
      if (kit && typeof kit.completeText === 'function' && kit.hasClient()) {
        try {
          var messages = [];
          if (task.system) messages.push({ role: 'system', content: String(task.system) });
          if (Array.isArray(task.history)) {
            task.history.forEach(function (turn) {
              if (turn && turn.role && turn.content != null) messages.push({ role: String(turn.role), content: String(turn.content) });
            });
          }
          messages.push({ role: 'user', content: prompt });
          var out = await kit.completeText(messages, Object.assign({ label: 'generate' }, kitOpts));
          if (task.cancelled) return { ok: false, op: 'generate', cancelled: true };
          trackUsage(out.usage);
          return { ok: true, op: 'generate', code: out.text, live: true, usage: out.usage };
        } catch (e) {
          if (task.cancelled || (e && e.cancelled)) return { ok: false, op: 'generate', cancelled: true };
          return { ok: false, op: 'generate', error: String(e && e.message || e) };
        }
      }
      await tick(250);
      return { ok: true, op: 'generate', note: 'Coding task prepared: ' + (prompt.slice(0, 80) || task.intent || 'generate'), live: false };
    }

    if (!kit) return { ok: false, op: op, error: 'Coding toolkit unavailable on this page.' };

    var candidateInput = task.code || task.description || task.text;
    var inputErr = tooLong('Input', candidateInput);
    if (inputErr) return inputErr;

    try {
      var result;
      switch (op) {
        case 'project-search':
          return { ok: true, op: op, result: await kit.projectSearch(task.query || task.text, task.limit) };
        case 'file-navigation':
          return { ok: true, op: op, result: await kit.fileNavigation(task.query || task.text, task.limit) };
        case 'explain-code':
          result = await kit.explainCode(task.code || task.text, kitOpts);
          trackUsage(result.usage);
          return { ok: true, op: op, result: result };
        case 'refactor':
          // Always a proposal — never applied without explicit human
          // confirmation through a separate, deliberate action.
          result = await kit.proposeRefactor(task.code || task.text, task.instructions, kitOpts);
          trackUsage(result.usage);
          return { ok: true, op: op, result: result };
        case 'bug-investigation':
          result = await kit.investigateBug(task.description || task.text, kitOpts);
          trackUsage(result.usage);
          return { ok: true, op: op, result: result };
        case 'project-analysis':
          return { ok: true, op: op, result: await kit.analyzeProject(task.query) };
        default:
          return { ok: false, op: op, error: 'Unsupported coding op "' + op + '".' };
      }
    } catch (e) {
      if (task.cancelled || (e && e.cancelled)) return { ok: false, op: op, cancelled: true };
      return { ok: false, op: op, error: String(e && e.message || e) };
    }
  }
}
  );
})(window);
