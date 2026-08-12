// ============================================
// AXIOM / JARVIS — i18n engine
// Load order: this file needs locales/_registry.js loaded first (see the
// <script> tags added to each page). Depends on nothing else.
//
// Responsibilities:
//  - Detect a starting language (saved choice > browser language > English)
//  - Fetch + cache the active locale's JSON (in-memory + sessionStorage,
//    so switching back to a language already seen this session is instant
//    and doesn't re-fetch)
//  - Fall back to English for any key missing from the active locale, and
//    to the raw key string if even English is missing it (should never
//    happen for a real key, but fails safe instead of throwing)
//  - Apply translations to the DOM via data-i18n / data-i18n-placeholder /
//    data-i18n-title attributes, and re-apply automatically on load and on
//    every language change
//  - Set <html lang> and <html dir>, and swap in the right Noto font stack
//    for the active script — only fetching the ONE stylesheet needed, not
//    all 17 font buckets up front
//  - Expose window.t(key, vars) for use from any other script (app.js,
//    auth.js, jarvis.js, etc.) so those files can move their hardcoded
//    strings over incrementally
// ============================================
(function () {
  const STORAGE_KEY = 'axiom_language';
  const CACHE_PREFIX = 'axiom_locale_cache_';
  const FALLBACK = 'en';

  let currentLang = FALLBACK;
  let currentDict = {};
  let fallbackDict = {};
  let loadedFonts = new Set();

  function getRegistry() {
    return window.AxiomLanguages || [];
  }
  function langMeta(code) {
    return getRegistry().find((l) => l.code === code);
  }

  // ---- language detection ----
  function detectInitialLanguage() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && langMeta(saved)) return saved;

    // navigator.languages gives an ordered preference list — walk it and
    // take the first one we actually have a registry entry for, trying
    // both the full tag (e.g. "zh-Hans") and the base subtag (e.g. "pt-BR" -> "pt").
    const browserLangs = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || 'en'];

    for (const raw of browserLangs) {
      if (langMeta(raw)) return raw;
      const base = raw.split('-')[0];
      if (langMeta(base)) return base;
      // Chinese needs the script subtag, not just "zh" — browsers report
      // "zh-CN"/"zh-SG" for simplified and "zh-TW"/"zh-HK" for traditional.
      if (base === 'zh') {
        const traditional = /^zh-(TW|HK|MO)/i.test(raw);
        return traditional ? 'zh-Hant' : 'zh-Hans';
      }
    }
    return FALLBACK;
  }

  // ---- fetching + caching ----
  async function fetchLocale(code) {
    const cacheKey = CACHE_PREFIX + code;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* fall through to refetch */ }
    }
    try {
      const res = await fetch(`locales/${code}.json`, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      try { sessionStorage.setItem(cacheKey, JSON.stringify(json)); } catch { /* storage full — non-fatal */ }
      return json;
    } catch (err) {
      console.warn(`[i18n] Could not load locales/${code}.json, falling back to English.`, err);
      return null;
    }
  }

  // ---- flatten "a.b.c" style lookups against a nested object ----
  function lookup(dict, key) {
    return key.split('.').reduce((obj, part) => (obj && typeof obj === 'object' ? obj[part] : undefined), dict);
  }

  function interpolate(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? vars[name] : m));
  }

  // Public translation function — used both by the DOM auto-apply below and
  // directly from other scripts, e.g. showToast(t('playground.outOfCredits')).
  window.t = function (key, vars) {
    let val = lookup(currentDict, key);
    if (val === undefined) val = lookup(fallbackDict, key);
    if (val === undefined) return key; // fail safe — never throw, never show "undefined"
    return interpolate(val, vars);
  };

  // ---- font loading (lazy — one stylesheet for the active script only) ----
  function loadFontFor(langCode) {
    const meta = langMeta(langCode);
    if (!meta) return;
    const stack = window.AxiomFontStacks && window.AxiomFontStacks[meta.font];
    if (!stack) return;
    if (loadedFonts.has(meta.font)) {
      document.documentElement.style.setProperty('--font-i18n', stack.family);
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = stack.url;
    link.onload = () => {
      loadedFonts.add(meta.font);
      document.documentElement.style.setProperty('--font-i18n', stack.family);
    };
    document.head.appendChild(link);
  }

  // ---- apply translations to the DOM ----
  function applyToDom() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      el.textContent = window.t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', window.t(el.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', window.t(el.getAttribute('data-i18n-title')));
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      el.setAttribute('aria-label', window.t(el.getAttribute('data-i18n-aria-label')));
    });
  }

  function applyDirection(langCode) {
    const meta = langMeta(langCode);
    const dir = meta ? meta.dir : 'ltr';
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', langCode);
    document.body.classList.toggle('rtl', dir === 'rtl');
  }

  // ---- public API ----
  async function setLanguage(code, opts = {}) {
    const meta = langMeta(code);
    if (!meta) {
      console.warn(`[i18n] Unknown language code "${code}", ignoring.`);
      return;
    }
    const dict = await fetchLocale(code);
    currentLang = code;
    currentDict = dict || {};
    if (!fallbackDict || Object.keys(fallbackDict).length === 0) {
      fallbackDict = code === FALLBACK ? currentDict : (await fetchLocale(FALLBACK)) || {};
    }
    applyDirection(code);
    loadFontFor(code);
    applyToDom();
    if (!opts.silent) localStorage.setItem(STORAGE_KEY, code);
    document.dispatchEvent(new CustomEvent('axiom:lang-changed', { detail: { code, meta } }));
  }

  // ---- localized formatting helpers (Intl-backed) ----
  window.AxiomFormat = {
    date(d, options) {
      try { return new Intl.DateTimeFormat(currentLang, options || { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(d)); }
      catch { return new Date(d).toLocaleDateString(); }
    },
    number(n) {
      try { return new Intl.NumberFormat(currentLang).format(n); }
      catch { return String(n); }
    },
    currency(amount, currencyCode) {
      try { return new Intl.NumberFormat(currentLang, { style: 'currency', currency: currencyCode || 'USD' }).format(amount); }
      catch { return `${currencyCode || 'USD'} ${amount}`; }
    },
    relativeTime(d) {
      const diffSec = (new Date(d).getTime() - Date.now()) / 1000;
      const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
      try {
        const rtf = new Intl.RelativeTimeFormat(currentLang, { numeric: 'auto' });
        for (const [unit, secs] of units) {
          if (Math.abs(diffSec) >= secs) return rtf.format(Math.round(diffSec / secs), unit);
        }
        return rtf.format(Math.round(diffSec), 'second');
      } catch { return new Date(d).toLocaleString(); }
    }
  };

  window.AxiomI18n = {
    setLanguage,
    getLanguage: () => currentLang,
    getLanguageMeta: () => langMeta(currentLang),
    registry: () => getRegistry(),
  };

  // ---- boot ----
  document.addEventListener('DOMContentLoaded', () => {
    const hadSavedChoice = !!localStorage.getItem(STORAGE_KEY);
    // Only persist to localStorage if this came from an explicit prior
    // choice or the user picks one via the switcher — an auto-detected
    // default shouldn't get "silently" locked in the first time a page loads.
    setLanguage(detectInitialLanguage(), { silent: !hadSavedChoice });
  });
})();
