// ============================================
// AXIOM / JARVIS — Language registry
// Single source of truth for every language the i18n system knows about:
// its BCP-47 code, native display name, text direction, and which Noto font
// family covers its script (used for lazy font loading — see i18n.js).
//
// NOTE ON TRANSLATION COVERAGE: this registry lists all 32 languages from
// the spec so language *detection, switching, RTL, fonts, voice, and
// date/number formatting* work for all of them immediately. Actual UI
// string translations (/locales/<code>.json) only exist so far for the
// languages marked translated:true below — everything else automatically
// falls back to English strings (per the required fallback behavior) until
// its locale file is authored. See /locales/README.md for how to add one.
// ============================================
window.AxiomLanguages = [
  { code: 'en',    name: 'English',    native: 'English',        dir: 'ltr', font: 'noto-sans',    translated: true  },

  { code: 'hi',    name: 'Hindi',      native: 'हिन्दी',          dir: 'ltr', font: 'noto-devanagari', translated: true  },
  { code: 'ta',    name: 'Tamil',      native: 'தமிழ்',          dir: 'ltr', font: 'noto-tamil',   translated: true  },
  { code: 'te',    name: 'Telugu',     native: 'తెలుగు',         dir: 'ltr', font: 'noto-telugu',  translated: false },
  { code: 'kn',    name: 'Kannada',    native: 'ಕನ್ನಡ',          dir: 'ltr', font: 'noto-kannada', translated: false },
  { code: 'ml',    name: 'Malayalam',  native: 'മലയാളം',        dir: 'ltr', font: 'noto-malayalam', translated: false },
  { code: 'mr',    name: 'Marathi',    native: 'मराठी',          dir: 'ltr', font: 'noto-devanagari', translated: false },
  { code: 'gu',    name: 'Gujarati',   native: 'ગુજરાતી',        dir: 'ltr', font: 'noto-gujarati', translated: false },
  { code: 'pa',    name: 'Punjabi',    native: 'ਪੰਜਾਬੀ',         dir: 'ltr', font: 'noto-gurmukhi', translated: false },
  { code: 'bn',    name: 'Bengali',    native: 'বাংলা',          dir: 'ltr', font: 'noto-bengali', translated: false },
  { code: 'or',    name: 'Odia',       native: 'ଓଡ଼ିଆ',          dir: 'ltr', font: 'noto-oriya',   translated: false },
  { code: 'ur',    name: 'Urdu',       native: 'اردو',           dir: 'rtl', font: 'noto-arabic',  translated: true  },

  { code: 'es',    name: 'Spanish',    native: 'Español',        dir: 'ltr', font: 'noto-sans',    translated: true  },
  { code: 'fr',    name: 'French',     native: 'Français',       dir: 'ltr', font: 'noto-sans',    translated: true  },
  { code: 'de',    name: 'German',     native: 'Deutsch',        dir: 'ltr', font: 'noto-sans',    translated: true  },
  { code: 'it',    name: 'Italian',    native: 'Italiano',       dir: 'ltr', font: 'noto-sans',    translated: false },
  { code: 'pt',    name: 'Portuguese', native: 'Português',      dir: 'ltr', font: 'noto-sans',    translated: false },
  { code: 'nl',    name: 'Dutch',      native: 'Nederlands',     dir: 'ltr', font: 'noto-sans',    translated: false },
  { code: 'ru',    name: 'Russian',    native: 'Русский',        dir: 'ltr', font: 'noto-sans',    translated: false },
  { code: 'uk',    name: 'Ukrainian',  native: 'Українська',     dir: 'ltr', font: 'noto-sans',    translated: false },
  { code: 'tr',    name: 'Turkish',    native: 'Türkçe',         dir: 'ltr', font: 'noto-sans',    translated: false },

  { code: 'ar',    name: 'Arabic',     native: 'العربية',        dir: 'rtl', font: 'noto-arabic',  translated: true  },
  { code: 'he',    name: 'Hebrew',     native: 'עברית',          dir: 'rtl', font: 'noto-hebrew',  translated: false },
  { code: 'fa',    name: 'Persian',    native: 'فارسی',          dir: 'rtl', font: 'noto-arabic',  translated: false },

  { code: 'zh-Hans', name: 'Chinese (Simplified)',  native: '简体中文', dir: 'ltr', font: 'noto-sc', translated: true  },
  { code: 'zh-Hant', name: 'Chinese (Traditional)', native: '繁體中文', dir: 'ltr', font: 'noto-tc', translated: false },
  { code: 'ja',    name: 'Japanese',   native: '日本語',          dir: 'ltr', font: 'noto-jp',      translated: true  },
  { code: 'ko',    name: 'Korean',     native: '한국어',          dir: 'ltr', font: 'noto-kr',      translated: false },
  { code: 'th',    name: 'Thai',       native: 'ไทย',            dir: 'ltr', font: 'noto-thai',    translated: false },
  { code: 'vi',    name: 'Vietnamese', native: 'Tiếng Việt',     dir: 'ltr', font: 'noto-sans',    translated: false },
  { code: 'id',    name: 'Indonesian', native: 'Bahasa Indonesia', dir: 'ltr', font: 'noto-sans',  translated: false },
  { code: 'ms',    name: 'Malay',      native: 'Bahasa Melayu',  dir: 'ltr', font: 'noto-sans',    translated: false },
];

// Google Fonts stylesheet URL per font bucket — loaded lazily, one <link>
// at a time, only for the script actually needed (see loadFontFor() in
// i18n.js). Keeping these as separate per-script requests instead of one
// giant "all Noto variants" stylesheet is what keeps this from bloating
// every page's initial load just because 32 languages are supported.
window.AxiomFontStacks = {
  'noto-sans':        { family: 'Noto Sans',            url: 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600;700&display=swap' },
  'noto-devanagari':  { family: "'Noto Sans Devanagari'", url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap' },
  'noto-tamil':       { family: "'Noto Sans Tamil'",     url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Tamil:wght@400;500;600;700&display=swap' },
  'noto-telugu':      { family: "'Noto Sans Telugu'",    url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Telugu:wght@400;500;600;700&display=swap' },
  'noto-kannada':     { family: "'Noto Sans Kannada'",   url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Kannada:wght@400;500;600;700&display=swap' },
  'noto-malayalam':   { family: "'Noto Sans Malayalam'", url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Malayalam:wght@400;500;600;700&display=swap' },
  'noto-gujarati':    { family: "'Noto Sans Gujarati'",  url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati:wght@400;500;600;700&display=swap' },
  'noto-gurmukhi':    { family: "'Noto Sans Gurmukhi'",  url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Gurmukhi:wght@400;500;600;700&display=swap' },
  'noto-bengali':     { family: "'Noto Sans Bengali'",   url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap' },
  'noto-oriya':       { family: "'Noto Sans Oriya'",     url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Oriya:wght@400;500;600;700&display=swap' },
  'noto-arabic':      { family: "'Noto Sans Arabic'",    url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap' },
  'noto-hebrew':      { family: "'Noto Sans Hebrew'",    url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@400;500;600;700&display=swap' },
  'noto-sc':          { family: "'Noto Sans SC'",        url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap' },
  'noto-tc':          { family: "'Noto Sans TC'",        url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&display=swap' },
  'noto-jp':          { family: "'Noto Sans JP'",        url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&display=swap' },
  'noto-kr':          { family: "'Noto Sans KR'",        url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap' },
  'noto-thai':        { family: "'Noto Sans Thai'",      url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&display=swap' },
};
