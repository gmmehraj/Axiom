// ============================================================
// AXIOM — Supabase Edge Function: analyze-file
// ------------------------------------------------------------
// Contract (matches js/pages/workspace.js callAnalyzeFile()):
//   POST body: { type: 'image'|'audio'|'video', op: 'ocr'|'caption'|'transcribe',
//                imageBase64?: string, audioBase64?: string, mimeType: string }
//   Headers:   Authorization: Bearer <supabase access_token>
//              apikey: <supabase anon key>
//   Success:   { text: string }
//   Error:     { error: string, code?: string }
//
// 'video' is handled by the frontend extracting an audio track first
// (see wireVideoTools() in workspace.js) and sending it here exactly
// like an 'audio' + 'transcribe' request — this function does not
// receive raw video.
//
// Vision (ocr/caption) and audio (transcribe) both go through
// OpenRouter chat completions with a multimodal-capable model, so this
// function shares the same "OPENROUTER_API_KEY never leaves the
// server" boundary as openrouter-chat, and bills the same credits
// ledger (deduct_credits) so balances never drift between the two.
// ============================================================

import { handleOptions, jsonError, jsonOk } from '../_shared/cors.ts';
import { readEnv, ENV_NAMES } from '../_shared/env.ts';
import { authenticateRequest, AuthError } from '../_shared/auth.ts';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Models chosen for multimodal support on OpenRouter. Overridable via
// env so these can be swapped without a redeploy of the function logic.
const DEFAULT_VISION_MODEL = 'openai/gpt-4o-mini';
const DEFAULT_AUDIO_MODEL = 'openai/gpt-4o-audio-preview';

// Rough cap to stop pathologically large payloads from tying up the
// function (Deno Edge Functions also have their own hard body-size
// limit, this is a friendlier, earlier rejection). ~15MB of base64.
const MAX_BASE64_CHARS = 20_000_000;

const RATE_LIMIT_MAX_PER_WINDOW = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60;

type FileType = 'image' | 'audio' | 'video';
type Op = 'ocr' | 'caption' | 'transcribe';

interface AnalyzeRequestBody {
  type?: FileType;
  op?: Op;
  imageBase64?: string;
  audioBase64?: string;
  mimeType?: string;
}

const PROMPTS: Record<Op, string> = {
  ocr: 'Extract all readable text from this image, verbatim, in reading order. Return only the extracted text with no commentary.',
  caption: 'Describe this image in one or two clear, factual sentences for someone who cannot see it.',
  transcribe: 'Transcribe this audio verbatim. Return only the transcript text with no commentary.',
};

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed.', 'METHOD_NOT_ALLOWED');
  }

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

  let user, supabaseAdmin;
  try {
    ({ user, supabaseAdmin } = await authenticateRequest(req, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY));
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.status, e.message, 'UNAUTHENTICATED');
    return jsonError(401, 'Authentication failed.', 'UNAUTHENTICATED');
  }

  let body: AnalyzeRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Request body must be valid JSON.', 'BAD_REQUEST');
  }

  const { type, op, imageBase64, audioBase64, mimeType } = body;

  if (type !== 'image' && type !== 'audio' && type !== 'video') {
    return jsonError(400, 'Field "type" must be "image", "audio", or "video".', 'BAD_REQUEST');
  }
  if (op !== 'ocr' && op !== 'caption' && op !== 'transcribe') {
    return jsonError(400, 'Field "op" must be "ocr", "caption", or "transcribe".', 'BAD_REQUEST');
  }
  if ((type === 'image' && op === 'transcribe') || (type !== 'image' && op !== 'transcribe')) {
    return jsonError(400, `Op "${op}" is not valid for type "${type}".`, 'BAD_REQUEST');
  }
  if (!mimeType || typeof mimeType !== 'string') {
    return jsonError(400, 'Field "mimeType" is required.', 'BAD_REQUEST');
  }

  const isImageOp = type === 'image';
  const base64Data = isImageOp ? imageBase64 : audioBase64;
  const base64Field = isImageOp ? 'imageBase64' : 'audioBase64';

  if (!base64Data || typeof base64Data !== 'string') {
    return jsonError(400, `Field "${base64Field}" is required.`, 'BAD_REQUEST');
  }
  if (base64Data.length > MAX_BASE64_CHARS) {
    return jsonError(413, 'File is too large to analyze.', 'FILE_TOO_LARGE');
  }

  // ---- Rate limit ----
  try {
    const { data: underLimit, error: rateErr } = await supabaseAdmin.rpc('check_rate_limit', {
      p_user_id: user.id,
      p_action: 'analyze-file',
      p_max_per_window: RATE_LIMIT_MAX_PER_WINDOW,
      p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    });
    if (rateErr) {
      console.error('[analyze-file] check_rate_limit RPC error:', rateErr.message);
    } else if (underLimit === false) {
      return jsonError(429, 'Too many requests. Slow down and try again shortly.', 'RATE_LIMITED');
    }
  } catch (e) {
    console.error('[analyze-file] rate limit check threw:', e instanceof Error ? e.message : e);
  }

  // ---- Credits pre-check (flat, no concurrency slot — these are short single calls) ----
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('credits')
    .eq('id', user.id)
    .single();
  if (profileErr || !profile) {
    console.error('[analyze-file] profile lookup error:', profileErr?.message);
    return jsonError(500, 'Could not verify account balance. Try again.', 'INTERNAL');
  }
  if (profile.credits <= 0) {
    return jsonError(402, 'Out of credits. Add credits to keep using this feature.', 'NO_CREDITS');
  }

  const model = isImageOp
    ? Deno.env.get('OPENROUTER_VISION_MODEL')?.trim() || DEFAULT_VISION_MODEL
    : Deno.env.get('OPENROUTER_AUDIO_MODEL')?.trim() || DEFAULT_AUDIO_MODEL;

  const upstreamPayload = isImageOp
    ? {
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPTS[op] },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
            ],
          },
        ],
      }
    : {
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPTS[op] },
              {
                type: 'input_audio',
                input_audio: { data: base64Data, format: mimeType.includes('wav') ? 'wav' : 'mp3' },
              },
            ],
          },
        ],
      };

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': req.headers.get('origin') || 'https://axiom.app',
        'X-Title': 'Axiom Workspace',
      },
      body: JSON.stringify(upstreamPayload),
    });
  } catch (networkErr) {
    console.error('[analyze-file] network error contacting OpenRouter:', networkErr);
    return jsonError(502, 'Could not reach the analysis provider. Try again shortly.', 'UPSTREAM_UNREACHABLE');
  }

  if (!upstream.ok) {
    let detail = `Analysis request failed (HTTP ${upstream.status}).`;
    try {
      const errJson = await upstream.json();
      detail = errJson?.error?.message || errJson?.error || detail;
    } catch {
      // ignore non-JSON error body
    }
    return jsonError(upstream.status, detail, 'UPSTREAM_ERROR');
  }

  let json: any;
  try {
    json = await upstream.json();
  } catch {
    return jsonError(502, 'Analysis provider returned an unreadable response.', 'UPSTREAM_ERROR');
  }

  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    return jsonError(502, 'Analysis provider returned no usable text.', 'UPSTREAM_ERROR');
  }

  // ---- Deduct credits (flat floor of 1 via deduct_credits' greatest(1, ...)) ----
  try {
    const usage = json?.usage || {};
    const { error: deductErr } = await supabaseAdmin.rpc('deduct_credits', {
      p_user_id: user.id,
      p_model: `analyze-file:${op}`,
      p_prompt_tokens: usage.prompt_tokens ?? 0,
      p_completion_tokens: usage.completion_tokens ?? 0,
    });
    if (deductErr) console.error('[analyze-file] deduct_credits RPC error:', deductErr.message);
  } catch (e) {
    console.error('[analyze-file] deduct_credits threw:', e instanceof Error ? e.message : e);
  }

  return jsonOk({ text });
});
