// ============================================
// AXIOM — OpenRouter API client
// Exposes window.OpenRouter. Requires window.OpenRouterConfig,
// so openrouter-config.js MUST be loaded first.
//
// All requests go through Supabase Edge Functions (see supabase/functions/)
// which hold the real OpenRouter key server-side and bill the request
// against the caller's credit balance. The browser only ever sends the
// user's Supabase session token — never an OpenRouter key.
// ============================================
(function (global) {
  'use strict';

  function ensureConfig() {
    if (!global.OpenRouterConfig) {
      throw new Error(
        '[OpenRouter] window.OpenRouterConfig is missing. ' +
        'Load openrouter-config.js before openrouter-client.js.'
      );
    }
    return global.OpenRouterConfig;
  }

  // NOTE: supabaseClient/SUPABASE_ANON_KEY are top-level `const`s in
  // supabase-config.js, not window properties — read as bare identifiers
  // since both scripts share the page's global lexical scope.
  async function authHeaders() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      const err = new Error('You need to be signed in to do that.');
      err.code = 'NOT_SIGNED_IN';
      throw err;
    }
    return {
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY
    };
  }

  function isDevMode() {
    return typeof global.AXIOM_DEV_MODE !== 'undefined' && global.AXIOM_DEV_MODE;
  }

  // Local preview only (see dev-config.js): simulates a streamed reply so
  // the JARVIS/chat UI is fully demoable with no Supabase session and no
  // Edge Functions running. Never used when AXIOM_DEV_MODE is off.
  function simulateStreamChat({ messages, onToken, onDone, signal }) {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const reply =
      `(Dev preview — this is a simulated reply, not a real model call.) ` +
      `You said: "${(lastUser && lastUser.content || '').slice(0, 160)}". ` +
      `Sign in with a real Supabase session to talk to an actual model.`;
    const words = reply.split(' ');
    let i = 0;
    let full = '';
    const timer = setInterval(() => {
      if (signal && signal.aborted) { clearInterval(timer); if (onDone) onDone(full, true); return; }
      full += (i === 0 ? '' : ' ') + words[i];
      if (onToken) onToken(words[i] + ' ', full);
      i++;
      if (i >= words.length) {
        clearInterval(timer);
        if (onDone) onDone(full, false);
      }
    }, 45);
  }

  const OpenRouter = {
    // -------------------- Model catalog --------------------
    async fetchModels() {
      const cfg = ensureConfig();
      if (isDevMode()) return cfg.FALLBACK_MODELS;
      const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
      const res = await fetch(cfg.MODELS_ENDPOINT, { headers });
      if (!res.ok) {
        throw new Error(`Failed to fetch OpenRouter models (HTTP ${res.status})`);
      }
      const json = await res.json();
      const list = Array.isArray(json.data) ? json.data : [];
      return list.map((m) => {
        const vendor = (m.id.split('/')[0] || 'Other');
        return {
          id: m.id,
          label: m.name || m.id,
          group: vendor.charAt(0).toUpperCase() + vendor.slice(1)
        };
      });
    },

    // -------------------- Chat completions (streaming) --------------------
    /**
     * @param {Object} options
     * @param {string} options.model - OpenRouter model id, e.g. "openai/gpt-4o-mini"
     * @param {Array<{role: string, content: string}>} options.messages
     * @param {number} [options.temperature] - 0-2, optional (e.g. supplied by the active Agent). Omitted from the request entirely when not a finite number, so the model/provider default applies.
     * @param {Array<Object>} [options.tools] - OpenRouter/OpenAI-format tool definitions (`{type:'function', function:{...}}`). Omitted from the request entirely when not a non-empty array.
     * @param {string|Object} [options.toolChoice] - forwarded as `tool_choice` when provided.
     * @param {(delta: string, fullText: string) => void} [options.onToken]
     * @param {(fullText: string, aborted: boolean, extra?: {toolCalls: Array|null, finishReason: string|null}) => void} [options.onDone] - `extra.toolCalls` is a non-empty array (parsed via AxiomOpenRouterToolCallParser, when loaded) exactly when the model asked to call tools this turn, otherwise null.
     * @param {(err: Error) => void} [options.onError]
     * @param {AbortSignal} [options.signal]
     */
    async streamChat(options) {
      const cfg = ensureConfig();
      const { model, messages, temperature, tools, toolChoice, onToken, onDone, onError, signal } = options || {};

      const fail = (err) => {
        if (typeof onError === 'function') onError(err);
        else throw err;
      };

      if (!model) {
        return fail(new Error('No model selected.'));
      }
      if (!Array.isArray(messages) || messages.length === 0) {
        return fail(new Error('No messages to send.'));
      }

      if (isDevMode()) {
        return simulateStreamChat({ messages, onToken, onDone, signal });
      }

      let headers;
      try {
        headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
      } catch (authErr) {
        return fail(authErr);
      }

      const hasTemperature = typeof temperature === 'number' && isFinite(temperature);
      const hasTools = Array.isArray(tools) && tools.length > 0;

      const payload = { model, messages, stream: true };
      if (hasTemperature) payload.temperature = temperature;
      if (hasTools) payload.tools = tools;
      if (toolChoice !== undefined) payload.tool_choice = toolChoice;

      let response;
      try {
        response = await fetch(cfg.CHAT_ENDPOINT, {
          method: 'POST',
          signal,
          headers,
          body: JSON.stringify(payload)
        });
      } catch (networkErr) {
        if (networkErr.name === 'AbortError') {
          if (typeof onDone === 'function') onDone('', true);
          return;
        }
        const err = new Error('Network error while contacting the server. Check your connection.');
        err.cause = networkErr;
        return fail(err);
      }

      if (!response.ok || !response.body) {
        let detail = '';
        let code = '';
        try {
          const errJson = await response.json();
          detail = (errJson && errJson.error) || '';
          code = (errJson && errJson.code) || '';
        } catch (_) {
          // response body wasn't JSON — ignore and fall back to a generic message
        }
        let message = detail || `Request failed (HTTP ${response.status}).`;
        if (response.status === 402) code = code || 'NO_CREDITS';
        if (response.status === 429) message = detail || 'Rate limited. Try again shortly.';
        const err = new Error(message);
        err.status = response.status;
        err.code = code;
        return fail(err);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let fullText = '';
      let finishReason = null;

      // Canonical streaming tool-call accumulator. AxiomOpenRouterToolCallParser
      // (os/api/openrouter/tool-calling/tool-call-parser.js) is the ONE
      // accumulator this client uses for tool_calls deltas — stream-manager.js's
      // internal mergeToolCalls() belongs to a separate, unwired OpenRouter
      // client (window.AxiomOpenRouter, BYOK-key/direct-fetch) and is
      // intentionally not reused here. Feature-detected: with the file not
      // loaded, tool_calls deltas are simply not accumulated (finishToolCalls
      // stays null), same graceful-degrade posture as every other optional
      // AXIOM global referenced in this codebase.
      const toolAccumulator = (global.AxiomOpenRouterToolCallParser
        && typeof global.AxiomOpenRouterToolCallParser.createAccumulator === 'function')
        ? global.AxiomOpenRouterToolCallParser.createAccumulator()
        : null;
      let sawToolCallDeltas = false;

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;

            let parsed;
            try {
              parsed = JSON.parse(data);
            } catch (_) {
              continue; // skip malformed SSE chunk
            }

            const choice = parsed && parsed.choices && parsed.choices[0];
            const delta = choice && choice.delta;

            if (choice && choice.finish_reason) finishReason = choice.finish_reason;

            if (delta && delta.content) {
              fullText += delta.content;
              if (typeof onToken === 'function') onToken(delta.content, fullText);
            }

            if (delta && Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
              sawToolCallDeltas = true;
              if (toolAccumulator) toolAccumulator.addDeltas(delta.tool_calls);
            }
          }
        }
      } catch (streamErr) {
        if (streamErr.name === 'AbortError') {
          if (typeof onDone === 'function') onDone(fullText, true, { toolCalls: null, finishReason });
          return;
        }
        const err = new Error('Connection interrupted while streaming the response.');
        err.cause = streamErr;
        return fail(err);
      }

      let toolCalls = null;
      if (toolAccumulator && sawToolCallDeltas) {
        const finalized = toolAccumulator.finalize();
        if (Array.isArray(finalized) && finalized.length > 0) toolCalls = finalized;
      }

      if (typeof onDone === 'function') onDone(fullText, false, { toolCalls, finishReason });
    }
  };

  global.OpenRouter = OpenRouter;
})(window);
