// ============================================
// AXIOM — Model selector
// Exposes window.ModelSelector. Populates a <select> with the
// OpenRouter model catalog, persists the choice, and refreshes
// with the live catalog when possible.
// Requires window.OpenRouterConfig (openrouter-config.js).
// Uses window.OpenRouter (openrouter-client.js) if present, but
// degrades gracefully to the static fallback list if not.
// ============================================
(function (global) {
  'use strict';

  // Block 2 · Step 2 · Part 2: the only place the Brain's "active model"
  // field is allowed to change (js/core/ai-state-manager.js just relays
  // this). Fired on every REAL selection change — manual dropdown or
  // programmatic setSelectedModel() — never on a timer or a guess.
  function notifyModelChanged(modelId) {
    try {
      document.dispatchEvent(new CustomEvent('axiom:model-changed', { detail: { modelId: modelId || null } }));
    } catch (err) { /* isolated — a missing CustomEvent support shouldn't break selection */ }
  }

  function ensureConfig() {
    if (!global.OpenRouterConfig) {
      console.error(
        '[ModelSelector] window.OpenRouterConfig is missing. ' +
        'Load openrouter-config.js before model-selector.js.'
      );
      return null;
    }
    return global.OpenRouterConfig;
  }

  const ModelSelector = {
    _models: [],
    _selectEl: null,
    _initialized: false,

    /**
     * Wires a <select> element to the model catalog.
     * Safe to call once per element; calling it twice on the same
     * element is a no-op (prevents duplicate change listeners).
     */
    init(selectEl) {
      const cfg = ensureConfig();
      if (!cfg) return;
      if (!selectEl) {
        console.warn('[ModelSelector] init() called without a <select> element.');
        return;
      }
      if (this._initialized && this._selectEl === selectEl) {
        return; // already wired — avoid duplicate listeners
      }

      this._selectEl = selectEl;
      this._models = cfg.FALLBACK_MODELS.slice();
      this._render();

      const saved = this._readSavedModel();
      if (saved) this._selectEl.value = saved;

      this._selectEl.addEventListener('change', () => {
        try {
          localStorage.setItem(cfg.STORAGE_KEYS.SELECTED_MODEL, this._selectEl.value);
        } catch (err) {
          console.error('[ModelSelector] Unable to persist selected model:', err);
        }
        notifyModelChanged(this._selectEl.value);
      });

      this._initialized = true;
      // Seed the rest of the app (e.g. the Brain) with whatever model is
      // actually selected right now — the saved value if one was found and
      // matched an option, otherwise whatever the freshly-rendered <select>
      // defaulted to.
      notifyModelChanged(this._selectEl.value);
      this._loadLiveModels();
    },

    _render() {
      if (!this._selectEl) return;
      const previousValue = this._selectEl.value;
      this._selectEl.innerHTML = '';

      const groups = {};
      this._models.forEach((m) => {
        const g = m.group || 'Other';
        groups[g] = groups[g] || [];
        groups[g].push(m);
      });

      Object.keys(groups).forEach((groupName) => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = groupName;
        groups[groupName].forEach((m) => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.label;
          optgroup.appendChild(opt);
        });
        this._selectEl.appendChild(optgroup);
      });

      if (previousValue && this._models.some((m) => m.id === previousValue)) {
        this._selectEl.value = previousValue;
      }
    },

    async _loadLiveModels() {
      if (!global.OpenRouter || typeof global.OpenRouter.fetchModels !== 'function') {
        return; // openrouter-client.js not loaded — stay on the fallback list
      }
      try {
        const live = await global.OpenRouter.fetchModels();
        if (Array.isArray(live) && live.length) {
          this._models = live;
          const saved = this._readSavedModel();
          this._render();
          if (saved && live.some((m) => m.id === saved)) {
            this._selectEl.value = saved;
          }
        }
      } catch (err) {
        console.warn('[ModelSelector] Falling back to the static model list:', err.message);
      }
    },

    _readSavedModel() {
      const cfg = ensureConfig();
      if (!cfg) return null;
      try {
        return localStorage.getItem(cfg.STORAGE_KEYS.SELECTED_MODEL);
      } catch (err) {
        return null;
      }
    },

    getSelectedModel() {
      const cfg = ensureConfig();
      if (!cfg) return null;
      if (this._selectEl && this._selectEl.value) return this._selectEl.value;
      return this._readSavedModel() || cfg.DEFAULT_MODEL;
    },

    /**
     * Programmatically selects a model id (e.g. a Phase 6 Agent's
     * preferred model when the user switches agents), reusing the same
     * persistence path as a manual change so it survives a reload.
     * No-ops if the id isn't in the currently loaded catalog — the
     * dropdown stays on whatever was already selected rather than
     * showing a blank/invalid option.
     * @returns {boolean} whether the model was actually applied
     */
    setSelectedModel(modelId) {
      const cfg = ensureConfig();
      if (!cfg || !this._selectEl || !modelId) return false;
      if (!this._models.some((m) => m.id === modelId)) return false;
      this._selectEl.value = modelId;
      try {
        localStorage.setItem(cfg.STORAGE_KEYS.SELECTED_MODEL, modelId);
      } catch (err) {
        console.error('[ModelSelector] Unable to persist selected model:', err);
      }
      notifyModelChanged(modelId);
      return true;
    }
  };

  global.ModelSelector = ModelSelector;
})(window);
