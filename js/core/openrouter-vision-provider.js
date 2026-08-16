// ============================================================
// AXIOM — OpenRouter Vision Provider
// ------------------------------------------------------------
// Uses the existing authenticated OpenRouter Edge Function. The
// browser never needs an OpenRouter secret.
// ============================================================
(function (global) {
  'use strict';

  const FUNCTION_NAME = 'openrouter-chat';
  const DEFAULT_MODEL = 'google/gemini-2.0-flash-exp:free';

  function getSupabaseUrl() {
    try {
      if (global.AxiomSupabaseEnv && typeof global.AxiomSupabaseEnv.validate === 'function') {
        const env = global.AxiomSupabaseEnv.validate();
        if (env && env.url) return env.url;
      }
    } catch (_) {}
    return '';
  }

  async function authHeaders() {
    let session = null;
    try {
      if (global.AxiomSupabaseAuth && typeof global.AxiomSupabaseAuth.getSession === 'function') session = await global.AxiomSupabaseAuth.getSession();
    } catch (_) {}
    if (!session || !session.access_token) throw new Error('Please sign in to use Vision.');
    return {
      Authorization: 'Bearer ' + session.access_token,
      apikey: (typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : ''),
      'Content-Type': 'application/json'
    };
  }

  async function analyze({ image, prompt, model, signal }) {
    const url = getSupabaseUrl();
    if (!url) throw new Error('Axiom AI service is not configured.');
    const body = {
      model: model || DEFAULT_MODEL,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt || 'Describe this image accurately. Identify important objects, visible text, layout, and anything relevant to the user request.' },
        { type: 'image_url', image_url: { url: image } }
      ] }],
      stream: false,
      temperature: 0.2
    };
    const response = await fetch(url.replace(/\/$/, '') + '/functions/v1/' + FUNCTION_NAME, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body), signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || ('Vision request failed (' + response.status + ').'));
    const content = data?.choices?.[0]?.message?.content ?? data?.content ?? data?.text ?? data;
    return { text: typeof content === 'string' ? content : JSON.stringify(content), raw: data, model: body.model };
  }

  function register() {
    if (!global.AxiomVision || typeof global.AxiomVision.registerVisionProvider !== 'function') return false;
    global.AxiomVision.registerVisionProvider('openrouter', { analyze });
    return true;
  }

  register();
  const retry = setInterval(() => { if (register()) clearInterval(retry); }, 100);
})(window);
