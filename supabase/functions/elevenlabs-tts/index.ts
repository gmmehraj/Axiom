// ============================================================
// AXIOM — Supabase Edge Function: elevenlabs-tts
// ------------------------------------------------------------
// Secure ElevenLabs transport boundary.
// Browser -> Supabase Edge Function -> ElevenLabs.
// The ElevenLabs API key never reaches client-side JavaScript.
//
// POST { action: "speak", text, voice_id?, model_id?, language_code?,
//        voice_settings?, output_format? }
// POST { action: "voices" }
// ============================================================

import { handleOptions, corsHeaders, jsonError, jsonOk } from '../_shared/cors.ts';
import { readEnv, ENV_NAMES } from '../_shared/env.ts';
import { authenticateRequest, AuthError } from '../_shared/auth.ts';

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';
const MAX_TEXT_LENGTH = 5000;

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return jsonError(405, 'Method not allowed.', 'METHOD_NOT_ALLOWED');

  const env = readEnv([
    ENV_NAMES.SUPABASE_URL,
    ENV_NAMES.SUPABASE_SERVICE_ROLE_KEY,
    ENV_NAMES.ELEVENLABS_API_KEY,
  ]);
  if (!env.ok) {
    return jsonError(500, 'Voice service is not configured yet.', 'NOT_CONFIGURED');
  }

  let user;
  try {
    ({ user } = await authenticateRequest(
      req,
      env.values.SUPABASE_URL,
      env.values.SUPABASE_SERVICE_ROLE_KEY,
    ));
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.status, e.message, 'UNAUTHENTICATED');
    return jsonError(401, 'Authentication failed.', 'UNAUTHENTICATED');
  }

  void user; // Auth is intentionally required even though this transport has no DB writes.

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Request body must be valid JSON.', 'BAD_REQUEST');
  }

  const action = typeof body.action === 'string' ? body.action : 'speak';
  const apiKey = env.values.ELEVENLABS_API_KEY;

  if (action === 'voices') {
    const upstream = await fetch(`${ELEVENLABS_API}/voices`, {
      headers: { 'xi-api-key': apiKey },
    });
    if (!upstream.ok) return mapUpstreamError(upstream);
    const data = await upstream.json();
    return jsonOk(data);
  }

  if (action !== 'speak') return jsonError(400, 'Unsupported voice action.', 'BAD_REQUEST');

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return jsonError(400, 'Field "text" is required.', 'BAD_REQUEST');
  if (text.length > MAX_TEXT_LENGTH) {
    return jsonError(400, `Text exceeds the ${MAX_TEXT_LENGTH}-character limit.`, 'TEXT_TOO_LONG');
  }

  const voiceId = typeof body.voice_id === 'string' && body.voice_id.trim()
    ? body.voice_id.trim()
    : DEFAULT_VOICE_ID;
  const modelId = typeof body.model_id === 'string' && body.model_id.trim()
    ? body.model_id.trim()
    : DEFAULT_MODEL_ID;
  const languageCode = typeof body.language_code === 'string' && body.language_code.trim()
    ? body.language_code.trim()
    : undefined;
  const outputFormat = typeof body.output_format === 'string' && body.output_format.trim()
    ? body.output_format.trim()
    : 'mp3_44100_128';

  const upstreamBody: Record<string, unknown> = {
    text,
    model_id: modelId,
  };
  if (languageCode) upstreamBody.language_code = languageCode;
  if (body.voice_settings && typeof body.voice_settings === 'object') {
    upstreamBody.voice_settings = body.voice_settings;
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ELEVENLABS_API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify(upstreamBody),
      },
    );
  } catch {
    return jsonError(502, 'Could not reach the voice provider.', 'UPSTREAM_UNREACHABLE');
  }

  if (!upstream.ok) return mapUpstreamError(upstream);
  if (!upstream.body) return jsonError(502, 'Voice provider returned no audio.', 'UPSTREAM_ERROR');

  const headers = new Headers(corsHeaders);
  headers.set('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
  headers.set('Cache-Control', 'no-store');
  const requestId = upstream.headers.get('request-id');
  if (requestId) headers.set('X-Axiom-Voice-Request-Id', requestId);

  return new Response(upstream.body, { status: 200, headers });
});

async function mapUpstreamError(upstream: Response): Promise<Response> {
  let message = `Voice provider request failed (HTTP ${upstream.status}).`;
  try {
    const data = await upstream.json();
    message = data?.detail?.message || data?.detail || data?.message || message;
  } catch {
    // Keep generic message; never forward arbitrary upstream bodies.
  }
  const status = upstream.status === 401 || upstream.status === 403 ? 502
    : upstream.status === 429 ? 429
    : upstream.status >= 400 && upstream.status < 500 ? 400
    : 502;
  return jsonError(status, message, 'UPSTREAM_ERROR');
}
