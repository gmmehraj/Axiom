// ============================================================
// AXIOM — Supabase Edge Function: openrouter-chat
// ------------------------------------------------------------
// The secure OpenRouter transport boundary for chat completions.
// Browser -> this function -> OpenRouter. OPENROUTER_API_KEY never
// leaves this function.
//
// Contract (matches js/core/openrouter-client.js streamChat()):
//   POST body:  { model: string, messages: [...], temperature?: number,
//                 stream?: boolean, tools?: [...], tool_choice?: ...,
//                 top_p?: number, max_tokens?: number }
//   Headers:    Authorization: Bearer <supabase access_token>
//               apikey: <supabase anon key>
//   Success (stream: true):  text/event-stream, forwarded verbatim from
//                             OpenRouter (SSE "data: {...}\n\n" chunks,
//                             terminated by "data: [DONE]\n\n").
//   Success (stream: false): application/json — the OpenRouter response
//                             body verbatim (choices[].message incl.
//                             tool_calls, usage, finish_reason, etc).
//   Error:      { error: string, code?: string } with an appropriate
//               HTTP status (400/401/402/429/502).
//
// Per Part 2C-2A instructions (Phase 9): this function is a transport
// boundary only. It forwards `tools`/`tool_choice` and preserves
// `tool_calls` in the response — it does NOT execute tools. Tool
// execution stays entirely client-side in the AXIOM tool pipeline
// (os/api/openrouter/tool-calling/*), which this function does not
// touch.
// ============================================================

import { handleOptions, corsHeaders, jsonError } from '../_shared/cors.ts';
import { readEnv, ENV_NAMES } from '../_shared/env.ts';
import { authenticateRequest, AuthError } from '../_shared/auth.ts';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Matches deduct_credits()'s per-model rate table in db/schema.sql —
// used only for the pre-flight "do you have any credits at all" check.
// The authoritative charge happens server-side in deduct_credits() itself
// after real token counts are known, so drift here only affects the
// pre-check, never the actual bill.
const MAX_CONCURRENT_GENERATIONS = 3;
const RATE_LIMIT_MAX_PER_WINDOW = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

interface ChatRequestBody {
  model?: string;
  messages?: unknown[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: unknown[];
  tool_choice?: unknown;
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed.', 'METHOD_NOT_ALLOWED');
  }

  // ---- Config guard: fail safe, not crash, if secrets aren't set yet ----
  const env = readEnv([
    ENV_NAMES.SUPABASE_URL,
    ENV_NAMES.SUPABASE_SERVICE_ROLE_KEY,
    ENV_NAMES.OPENROUTER_API_KEY,
  ]);
  if (env.ok === false) {
    return jsonError(
      500,
      'Server is not configured yet. Missing required secret(s): ' + env.missing.join(', ') + '.',
      'NOT_CONFIGURED',
    );
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY } = env.values;

  // ---- Auth ----
  let user, supabaseAdmin;
  try {
    ({ user, supabaseAdmin } = await authenticateRequest(req, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY));
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.status, e.message, 'UNAUTHENTICATED');
    return jsonError(401, 'Authentication failed.', 'UNAUTHENTICATED');
  }

  // ---- Parse + validate body ----
  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Request body must be valid JSON.', 'BAD_REQUEST');
  }

  const { model, messages, temperature, top_p, max_tokens, tools, tool_choice } = body;
  const stream = body.stream !== false; // default true, matching the client's default usage

  if (typeof model !== 'string' || !model.trim()) {
    return jsonError(400, 'Field "model" is required.', 'BAD_REQUEST');
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError(400, 'Field "messages" must be a non-empty array.', 'BAD_REQUEST');
  }

  // ---- Rate limit (shared fixed-window counter, see check_rate_limit() in db/schema.sql) ----
  try {
    const { data: underLimit, error: rateErr } = await supabaseAdmin.rpc('check_rate_limit', {
      p_user_id: user.id,
      p_action: 'openrouter-chat',
      p_max_per_window: RATE_LIMIT_MAX_PER_WINDOW,
      p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    });
    if (rateErr) {
      // If the RPC itself isn't deployed yet (fresh DB not migrated),
      // fail open on rate limiting rather than breaking chat entirely —
      // but do NOT fail open on credits below, that one is load-bearing.
      console.error('[openrouter-chat] check_rate_limit RPC error:', rateErr.message);
    } else if (underLimit === false) {
      return jsonError(429, 'Too many requests. Slow down and try again shortly.', 'RATE_LIMITED');
    }
  } catch (e) {
    console.error('[openrouter-chat] rate limit check threw:', e instanceof Error ? e.message : e);
  }

  // ---- Credits pre-check + concurrency slot (see begin_generation() in db/schema.sql) ----
  let slotClaimed = false;
  try {
    const { data: canGenerate, error: slotErr } = await supabaseAdmin.rpc('begin_generation', {
      p_user_id: user.id,
      p_max_concurrent: MAX_CONCURRENT_GENERATIONS,
    });
    if (slotErr) {
      console.error('[openrouter-chat] begin_generation RPC error:', slotErr.message);
      return jsonError(500, 'Could not verify account balance. Try again.', 'INTERNAL');
    }
    if (canGenerate === false) {
      return jsonError(
        402,
        'Out of credits, or too many chats already in progress. Wait for one to finish or add credits.',
        'NO_CREDITS',
      );
    }
    slotClaimed = true;
  } catch (e) {
    console.error('[openrouter-chat] begin_generation threw:', e instanceof Error ? e.message : e);
    return jsonError(500, 'Could not verify account balance. Try again.', 'INTERNAL');
  }

  const releaseSlot = async () => {
    if (!slotClaimed) return;
    slotClaimed = false;
    try {
      await supabaseAdmin.rpc('end_generation', { p_user_id: user.id });
    } catch (e) {
      console.error('[openrouter-chat] end_generation threw:', e instanceof Error ? e.message : e);
    }
  };

  // ---- Build the OpenRouter payload — forward only known-safe fields ----
  const upstreamPayload: Record<string, unknown> = { model, messages, stream };
  if (typeof temperature === 'number' && isFinite(temperature)) upstreamPayload.temperature = temperature;
  if (typeof top_p === 'number' && isFinite(top_p)) upstreamPayload.top_p = top_p;
  if (typeof max_tokens === 'number' && isFinite(max_tokens)) upstreamPayload.max_tokens = max_tokens;
  if (Array.isArray(tools) && tools.length > 0) upstreamPayload.tools = tools;
  if (tool_choice !== undefined) upstreamPayload.tool_choice = tool_choice;

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        // OpenRouter attribution headers — no secrets, safe to send.
        'HTTP-Referer': req.headers.get('origin') || 'https://axiom.app',
        'X-Title': 'Axiom Playground',
      },
      body: JSON.stringify(upstreamPayload),
    });
  } catch (networkErr) {
    await releaseSlot();
    console.error('[openrouter-chat] network error contacting OpenRouter:', networkErr);
    return jsonError(502, 'Could not reach the model provider. Try again shortly.', 'UPSTREAM_UNREACHABLE');
  }

  if (!upstream.ok) {
    await releaseSlot();
    let detail = `OpenRouter request failed (HTTP ${upstream.status}).`;
    try {
      const errJson = await upstream.json();
      detail = errJson?.error?.message || errJson?.error || detail;
    } catch {
      // upstream error body wasn't JSON — keep the generic message
    }
    // Never leak upstream headers/body verbatim (could theoretically echo
    // request internals); just the message.
    return jsonError(upstream.status, detail, 'UPSTREAM_ERROR');
  }

  // ---- Non-streaming path: forward JSON, then deduct credits from usage ----
  if (!stream) {
    let json: any;
    try {
      json = await upstream.json();
    } catch {
      await releaseSlot();
      return jsonError(502, 'Model provider returned an unreadable response.', 'UPSTREAM_ERROR');
    }
    const usage = json?.usage || {};
    await deductAndRelease(supabaseAdmin, user.id, model, usage.prompt_tokens, usage.completion_tokens, releaseSlot);
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ---- Streaming path: pipe SSE through verbatim, deduct credits at the end ----
  if (!upstream.body) {
    await releaseSlot();
    return jsonError(502, 'Model provider returned no stream.', 'UPSTREAM_ERROR');
  }

  let promptTokens = 0;
  let completionTokens = 0;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let sseBuffer = '';

  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Pass the raw bytes straight through to the client immediately —
      // no buffering delay — while separately peeking at `usage` if
      // OpenRouter includes it in the final chunk (stream_options may
      // not always be set, so this is best-effort; deduct_credits()
      // falls back to a minimum 1-credit charge if we never see one).
      controller.enqueue(chunk);
      sseBuffer += decoder.decode(chunk, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed?.usage) {
            promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
            completionTokens = parsed.usage.completion_tokens ?? completionTokens;
          }
        } catch {
          // not every chunk is JSON-parseable mid-stream; ignore
        }
      }
    },
    async flush() {
      // Best-effort: even if we never saw a usage chunk, still charge the
      // account-minimum via deduct_credits (it floors cost at 1 credit)
      // so the concurrency slot always gets released.
      await deductAndRelease(supabaseAdmin, user.id, model, promptTokens, completionTokens, releaseSlot);
    },
  });

  const pipedBody = upstream.body.pipeThrough(transformStream);

  return new Response(pipedBody, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

async function deductAndRelease(
  supabaseAdmin: any,
  userId: string,
  model: string,
  promptTokens: number | undefined,
  completionTokens: number | undefined,
  releaseSlot: () => Promise<void>,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('deduct_credits', {
      p_user_id: userId,
      p_model: model,
      p_prompt_tokens: promptTokens ?? 0,
      p_completion_tokens: completionTokens ?? 0,
    });
    if (error) {
      console.error('[openrouter-chat] deduct_credits RPC error:', error.message);
    }
  } catch (e) {
    console.error('[openrouter-chat] deduct_credits threw:', e instanceof Error ? e.message : e);
  } finally {
    await releaseSlot();
  }
}
