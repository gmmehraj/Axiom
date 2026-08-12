// ============================================================
// AXIOM AI OS X — Theme Engine
// 12 dynamic themes. One engine. Instant switching.
// ============================================================
window.AxiomThemeEngine = (function() {
  'use strict';

  const THEMES = {
    midnight: {
      name: 'Midnight',
      icon: 'moon',
      tokens: {
        '--ax-bg': '#030303',
        '--ax-bg-2': '#080808',
        '--ax-surface': '#0C0C0C',
        '--ax-surface-2': '#111111',
        '--ax-surface-3': '#181818',
        '--ax-border': 'rgba(255,255,255,.08)',
        '--ax-border-strong': 'rgba(255,255,255,.14)',
        '--ax-text': '#FFFFFF',
        '--ax-text-2': 'rgba(255,255,255,.62)',
        '--ax-text-3': 'rgba(255,255,255,.35)',
        '--ax-accent': '#E8E8E8',
        '--ax-accent-2': '#F0F0F0',
        '--ax-glow': 'rgba(255,255,255,.06)',
        '--ax-glass': 'rgba(255,255,255,.04)',
        '--ax-glass-hover': 'rgba(255,255,255,.07)',
        '--ax-shadow': '0 20px 60px rgba(0,0,0,.5)',
        '--ax-blur': '40px',
      }
    },
    graphite: {
      name: 'Graphite',
      icon: 'grid',
      tokens: {
        '--ax-bg': '#0C0C0E',
        '--ax-bg-2': '#141416',
        '--ax-surface': '#1C1C1E',
        '--ax-surface-2': '#242426',
        '--ax-surface-3': '#2C2C2E',
        '--ax-border': 'rgba(255,255,255,.07)',
        '--ax-border-strong': 'rgba(255,255,255,.13)',
        '--ax-text': '#F5F5F7',
        '--ax-text-2': 'rgba(245,245,247,.65)',
        '--ax-text-3': 'rgba(245,245,247,.35)',
        '--ax-accent': '#86868B',
        '--ax-accent-2': '#AEAEB2',
        '--ax-glow': 'rgba(255,255,255,.08)',
        '--ax-glass': 'rgba(255,255,255,.04)',
        '--ax-glass-hover': 'rgba(255,255,255,.07)',
        '--ax-shadow': '0 20px 60px rgba(0,0,0,.55)',
        '--ax-blur': '40px',
      }
    },
    carbon: {
      name: 'Carbon',
      icon: 'layers',
      tokens: {
        '--ax-bg': '#121212',
        '--ax-bg-2': '#1A1A1A',
        '--ax-surface': '#222222',
        '--ax-surface-2': '#2A2A2A',
        '--ax-surface-3': '#323232',
        '--ax-border': 'rgba(255,255,255,.08)',
        '--ax-border-strong': 'rgba(255,255,255,.14)',
        '--ax-text': '#E8E8E8',
        '--ax-text-2': 'rgba(232,232,232,.65)',
        '--ax-text-3': 'rgba(232,232,232,.35)',
        '--ax-accent': '#6B6B6B',
        '--ax-accent-2': '#8A8A8A',
        '--ax-glow': 'rgba(255,255,255,.06)',
        '--ax-glass': 'rgba(255,255,255,.04)',
        '--ax-glass-hover': 'rgba(255,255,255,.07)',
        '--ax-shadow': '0 20px 60px rgba(0,0,0,.5)',
        '--ax-blur': '35px',
      }
    },
    titanium: {
      name: 'Titanium',
      icon: 'sparkle',
      tokens: {
        '--ax-bg': '#0A0A0C',
        '--ax-bg-2': '#121214',
        '--ax-surface': '#1A1A1E',
        '--ax-surface-2': '#222226',
        '--ax-surface-3': '#2A2A2E',
        '--ax-border': 'rgba(255,255,255,.08)',
        '--ax-border-strong': 'rgba(255,255,255,.14)',
        '--ax-text': '#F0F0F5',
        '--ax-text-2': 'rgba(240,240,245,.65)',
        '--ax-text-3': 'rgba(240,240,245,.35)',
        '--ax-accent': '#6E8EF0',
        '--ax-accent-2': '#8EB0FF',
        '--ax-glow': 'rgba(110,142,240,.12)',
        '--ax-glass': 'rgba(255,255,255,.035)',
        '--ax-glass-hover': 'rgba(255,255,255,.06)',
        '--ax-shadow': '0 20px 60px rgba(0,0,0,.5)',
        '--ax-blur': '40px',
      }
    },
    obsidian: {
      name: 'Obsidian',
      icon: 'eye',
      tokens: {
        '--ax-bg': '#0B0B0D',
        '--ax-bg-2': '#131315',
        '--ax-surface': '#1B1B1E',
        '--ax-surface-2': '#232326',
        '--ax-surface-3': '#2B2B2E',
        '--ax-border': 'rgba(255,255,255,.06)',
        '--ax-border-strong': 'rgba(255,255,255,.12)',
        '--ax-text': '#E5E5EA',
        '--ax-text-2': 'rgba(229,229,234,.65)',
        '--ax-text-3': 'rgba(229,229,234,.3)',
        '--ax-accent': '#E8E8E8',
        '--ax-accent-2': '#60A5FA',
        '--ax-glow': 'rgba(96,165,250,.12)',
        '--ax-glass': 'rgba(255,255,255,.035)',
        '--ax-glass-hover': 'rgba(255,255,255,.06)',
        '--ax-shadow': '0 20px 60px rgba(0,0,0,.5)',
        '--ax-blur': '40px',
      }
    },
    slate: {
      name: 'Slate',
      icon: 'layers',
      tokens: {
        '--ax-bg': '#0E1117',
        '--ax-bg-2': '#161920',
        '--ax-surface': '#1E2128',
        '--ax-surface-2': '#262930',
        '--ax-surface-3': '#2E3138',
        '--ax-border': 'rgba(255,255,255,.07)',
        '--ax-border-strong': 'rgba(255,255,255,.13)',
        '--ax-text': '#E1E4E8',
        '--ax-text-2': 'rgba(225,228,232,.6)',
        '--ax-text-3': 'rgba(225,228,232,.3)',
        '--ax-accent': '#58A6FF',
        '--ax-accent-2': '#79C0FF',
        '--ax-glow': 'rgba(88,166,255,.12)',
        '--ax-glass': 'rgba(255,255,255,.035)',
        '--ax-glass-hover': 'rgba(255,255,255,.06)',
        '--ax-shadow': '0 20px 60px rgba(0,0,0,.5)',
        '--ax-blur': '40px',
      }
    },
    glass: {
      name: 'Glass',
      icon: 'collection',
      tokens: {
        '--ax-bg': '#050505',
        '--ax-bg-2': '#0A0A0A',
        '--ax-surface': 'rgba(255,255,255,.04)',
        '--ax-surface-2': 'rgba(255,255,255,.06)',
        '--ax-surface-3': 'rgba(255,255,255,.08)',
        '--ax-border': 'rgba(255,255,255,.08)',
        '--ax-border-strong': 'rgba(255,255,255,.14)',
        '--ax-text': '#FFFFFF',
        '--ax-text-2': 'rgba(255,255,255,.7)',
        '--ax-text-3': 'rgba(255,255,255,.35)',
        '--ax-accent': '#FFFFFF',
        '--ax-accent-2': 'rgba(255,255,255,.8)',
        '--ax-glow': 'rgba(255,255,255,.1)',
        '--ax-glass': 'rgba(255,255,255,.04)',
        '--ax-glass-hover': 'rgba(255,255,255,.07)',
        '--ax-shadow': '0 20px 60px rgba(0,0,0,.5)',
        '--ax-blur': '40px',
      }
    },
    vision: {
      name: 'Vision',
      icon: 'eye',
      tokens: {
        '--ax-bg': '#000000',
        '--ax-bg-2': '#050505',
        '--ax-surface': '#0A0A0A',
        '--ax-surface-2': '#101010',
        '--ax-surface-3': '#1A1A1A',
        '--ax-border': 'rgba(255,255,255,.06)',
        '--ax-border-strong': 'rgba(255,255,255,.12)',
        '--ax-text': '#F5F5F7',
        '--ax-text-2': 'rgba(245,245,247,.6)',
        '--ax-text-3': 'rgba(245,245,247,.25)',
        '--ax-accent': '#E8E8E8',
        '--ax-accent-2': '#FFFFFF',
        '--ax-glow': 'rgba(255,255,255,.08)',
        '--ax-glass': 'rgba(255,255,255,.035)',
        '--ax-glass-hover': 'rgba(255,255,255,.065)',
        '--ax-shadow': '0 20px 60px rgba(0,0,0,.5)',
        '--ax-blur': '40px',
      }
    },
    arctic: {
      name: 'Arctic',
      icon: 'weather',
      tokens: {
        '--ax-bg': '#0F1419',
        '--ax-bg-2': '#17212B',
        '--ax-surface': '#1F2937',
        '--ax-surface-2': '#273341',
        '--ax-surface-3': '#2F3D4B',
        '--ax-border': 'rgba(255,255,255,.07)',
        '--ax-border-strong': 'rgba(255,255,255,.13)',
        '--ax-text': '#E2E8F0',
        '--ax-text-2': 'rgba(226,232,240,.6)',
        '--ax-text-3': 'rgba(226,232,240,.3)',
        '--ax-accent': '#60A5FA',
        '--ax-accent-2': '#93C5FD',
        '--ax-glow': 'rgba(96,165,250,.12)',
        '--ax-glass': 'rgba(255,255,255,.035)',
        '--ax-glass-hover': 'rgba(255,255,255,.065)',
        '--ax-shadow': '0 20px 60px rgba(0,0,0,.45)',
        '--ax-blur': '40px',
      }
    },
    aurora: {
      name: 'Aurora',
      icon: 'gradient',
      tokens: {
        '--ax-bg': '#0A0B12',
        '--ax-bg-2': '#12141E',
        '--ax-surface': '#1A1C2A',
        '--ax-surface-2': '#222436',
        '--ax-surface-3': '#2A2C40',
        '--ax-border': 'rgba(255,255,255,.07)',
        '--ax-border-strong': 'rgba(255,255,255,.13)',
        '--ax-text': '#E4E6F0',
        '--ax-text-2': 'rgba(228,230,240,.6)',
        '--ax-text-3': 'rgba(228,230,240,.3)',
        '--ax-accent': '#6EE7B7',
        '--ax-accent-2': '#A7F3D0',
        '--ax-glow': 'rgba(110,231,183,.12)',
        '--ax-glass': 'rgba(255,255,255,.035)',
        '--ax-glass-hover': 'rgba(255,255,255,.065)',
        '--ax-shadow': '0 20px 60px rgba(0,0,0,.45)',
        '--ax-blur': '40px',
      }
    },
    monochrome: {
      name: 'Monochrome',
      icon: 'grid',
      tokens: {
        '--ax-bg': '#000000',
        '--ax-bg-2': '#0A0A0A',
        '--ax-surface': '#141414',
        '--ax-surface-2': '#1E1E1E',
        '--ax-surface-3': '#282828',
        '--ax-border': 'rgba(255,255,255,.08)',
        '--ax-border-strong': 'rgba(255,255,255,.15)',
        '--ax-text': '#FFFFFF',
        '--ax-text-2': 'rgba(255,255,255,.6)',
        '--ax-text-3': 'rgba(255,255,255,.3)',
        '--ax-accent': '#FFFFFF',
        '--ax-accent-2': 'rgba(255,255,255,.7)',
        '--ax-glow': 'rgba(255,255,255,.1)',
        '--ax-glass': 'rgba(255,255,255,.04)',
        '--ax-glass-hover': 'rgba(255,255,255,.07)',
        '--ax-shadow': '0 20px 60px rgba(0,0,0,.6)',
        '--ax-blur': '40px',
      }
    },
    professional: {
      name: 'Professional',
      icon: 'layers',
      tokens: {
        '--ax-bg': '#0D1117',
        '--ax-bg-2': '#161B22',
        '--ax-surface': '#1C2128',
        '--ax-surface-2': '#252A32',
        '--ax-surface-3': '#2D323A',
        '--ax-border': 'rgba(255,255,255,.06)',
        '--ax-border-strong': 'rgba(255,255,255,.12)',
        '--ax-text': '#E6EDF3',
        '--ax-text-2': 'rgba(230,237,243,.6)',
        '--ax-text-3': 'rgba(230,237,243,.3)',
        '--ax-accent': '#58A6FF',
        '--ax-accent-2': '#79C0FF',
        '--ax-glow': 'rgba(88,166,255,.1)',
        '--ax-glass': 'rgba(255,255,255,.035)',
        '--ax-glass-hover': 'rgba(255,255,255,.065)',
        '--ax-shadow': '0 20px 60px rgba(0,0,0,.45)',
        '--ax-blur': '35px',
      }
    }
  };

  let currentTheme = localStorage.getItem('ax-os-theme') || 'midnight';
  let listeners = [];

  function applyTheme(themeId) {
    const theme = THEMES[themeId] || THEMES.midnight;
    const root = document.documentElement;
    
    Object.entries(theme.tokens).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    root.setAttribute('data-theme', themeId);
    currentTheme = themeId;
    localStorage.setItem('ax-os-theme', themeId);
    
    listeners.forEach(fn => fn(themeId, theme));
    
    document.dispatchEvent(new CustomEvent('ax-theme-changed', { 
      detail: { theme: themeId, tokens: theme.tokens } 
    }));
  }

  function getTheme() { return currentTheme; }
  function getThemeInfo(id) { return THEMES[id] || THEMES.midnight; }
  function getAllThemes() { return Object.entries(THEMES).map(([id, t]) => ({ id, ...t })); }
  function onChange(fn) { listeners.push(fn); return () => { listeners = listeners.filter(l => l !== fn); }; }

  // Apply saved theme on load
  applyTheme(currentTheme);

  return {
    applyTheme,
    getTheme,
    getThemeInfo,
    getAllThemes,
    onChange,
    THEMES
  };
})();
