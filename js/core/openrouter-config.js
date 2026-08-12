// ============================================
// AXIOM — OpenRouter configuration
// Single source of truth for endpoints, storage keys, and the
// model catalog. MUST be loaded before openrouter-client.js and
// model-selector.js — both read window.OpenRouterConfig at call time.
// ============================================
(function (global) {
  'use strict';

  // Chat/model requests are proxied through Supabase Edge Functions so the
  // real OpenRouter key stays server-side (see supabase/functions/).
  // NOTE: SUPABASE_URL is a top-level `const` in supabase-config.js, not a
  // window property, so it's read here as a bare identifier (both scripts
  // share the page's global lexical scope) rather than via `global.`.
  const OpenRouterConfig = {
    CHAT_ENDPOINT: `${SUPABASE_URL}/functions/v1/openrouter-chat`,
    MODELS_ENDPOINT: `${SUPABASE_URL}/functions/v1/openrouter-models`,
    // AI Workspace: image OCR/caption/Q&A and audio+video transcription
    // (see supabase/functions/analyze-file and ai/workspace.js).
    ANALYZE_FILE_ENDPOINT: `${SUPABASE_URL}/functions/v1/analyze-file`,

    STORAGE_KEYS: {
      SELECTED_MODEL: 'axiom_openrouter_selected_model'
    },

    DEFAULT_MODEL: 'openai/gpt-4o-mini',

    // Used to seed the selector instantly and as a safety net if the
    // live /models fetch fails (offline, CORS, outage, etc).
    FALLBACK_MODELS: [
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', group: 'OpenAI' },
      { id: 'openai/gpt-4o', label: 'GPT-4o', group: 'OpenAI' },
      { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', group: 'Anthropic' },
      { id: 'anthropic/claude-3-haiku', label: 'Claude 3 Haiku', group: 'Anthropic' },
      { id: 'google/gemini-flash-1.5', label: 'Gemini 1.5 Flash', group: 'Google' },
      { id: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B', group: 'Meta' },
      { id: 'mistralai/mistral-7b-instruct', label: 'Mistral 7B', group: 'Mistral' }
    ],

    // OpenRouter asks for these attribution headers on chat requests.
    SITE_URL: (global.location && global.location.origin) || '',
    SITE_TITLE: 'Axiom Playground',

    REQUEST_TIMEOUT_MS: 60000
  };

  global.OpenRouterConfig = OpenRouterConfig;
})(window);
