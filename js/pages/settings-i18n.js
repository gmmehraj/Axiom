// ============================================
// AXIOM — Settings: Language & Voice tab
// Populates the language grid (from the shared registry) and the full
// Voice Settings panel (Phase 3), wiring both to AxiomI18n / AxiomVoice /
// JarvisVoiceController. Loaded only on settings.html.
// ============================================
function renderLangGrid() {
  const grid = document.getElementById('langGrid');
  if (!grid) return;
  const current = window.AxiomI18n.getLanguage();

  grid.innerHTML = window.AxiomLanguages.map(l => `
    <div class="lang-option ${l.code === current ? 'selected' : ''}" data-lang="${l.code}" role="radio" aria-checked="${l.code === current}" tabindex="0">
      <span class="lang-native">${l.native}</span>
      <span class="lang-en">${l.name}</span>
      ${!l.translated ? '<span class="lang-fallback-note">Interface shown in English for now</span>' : ''}
    </div>
  `).join('');

  grid.querySelectorAll('.lang-option').forEach(el => {
    const pick = () => window.AxiomI18n.setLanguage(el.dataset.lang);
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });
}

function renderVoiceSelectors() {
  const inputSel = document.getElementById('voiceInputLang');
  const outputSel = document.getElementById('voiceOutputVoice');
  if (!inputSel || !outputSel) return;

  const controller = window.JarvisVoiceController;
  const saved = controller ? controller.getSettings() : null;
  const current = (saved && saved.voiceLang) || window.AxiomI18n.getLanguage();
  inputSel.innerHTML = window.AxiomLanguages.map(l =>
    `<option value="${l.code}" ${l.code === current ? 'selected' : ''}>${l.native}</option>`
  ).join('');

  function refreshOutputVoices() {
    if (!window.AxiomVoice.isSynthesisSupported()) {
      outputSel.innerHTML = `<option>${window.t('errors.notFound')}</option>`;
      outputSel.disabled = true;
      return;
    }
    const speechLang = window.AxiomVoice.toSpeechLang(inputSel.value);
    const voices = window.AxiomVoice.voicesFor(speechLang);
    if (voices.length === 0) {
      outputSel.innerHTML = `<option value="">System default</option>`;
      return;
    }
    outputSel.innerHTML = `<option value="">System default</option>` +
      voices.map(v => `<option value="${v.name}">${v.name}${v.localService ? '' : ' (network)'}</option>`).join('');
    const preferred = (saved && saved.voiceName) || localStorage.getItem('axiom_voice_' + speechLang);
    if (preferred && voices.some(v => v.name === preferred)) outputSel.value = preferred;
  }

  inputSel.addEventListener('change', refreshOutputVoices);
  outputSel.addEventListener('change', () => {
    // Keep the legacy per-language key in sync too, since voice.js's
    // speak() falls back to it when no explicit voiceName is passed.
    const speechLang = window.AxiomVoice.toSpeechLang(inputSel.value);
    localStorage.setItem('axiom_voice_' + speechLang, outputSel.value);
  });

  // Voice lists load async in some browsers — refresh once the browser
  // fires onvoiceschanged. (Not via a DOMContentLoaded listener here:
  // this function only ever runs from inside the page's own
  // DOMContentLoaded handler below, so that event has already fired
  // by this point and a listener for it here would never trigger.)
  if (window.speechSynthesis) {
    const prevHandler = window.speechSynthesis.onvoiceschanged;
    window.speechSynthesis.onvoiceschanged = (e) => { if (prevHandler) prevHandler(e); refreshOutputVoices(); };
  }
  refreshOutputVoices();
}

// ---- Full Voice Settings panel (Phase 3) ----
function renderVoiceSettingsPanel() {
  const controller = window.JarvisVoiceController;
  const els = {
    rate: document.getElementById('voiceRate'), rateVal: document.getElementById('voiceRateVal'),
    pitch: document.getElementById('voicePitch'), pitchVal: document.getElementById('voicePitchVal'),
    volume: document.getElementById('voiceVolume'), volumeVal: document.getElementById('voiceVolumeVal'),
    autoSpeak: document.getElementById('voiceAutoSpeak'),
    continuous: document.getElementById('voiceContinuous'),
    noiseSuppression: document.getElementById('voiceNoiseSuppression'),
    micDevice: document.getElementById('voiceMicDevice'),
    speakerDevice: document.getElementById('voiceSpeakerDevice'),
    speakerNote: document.getElementById('voiceSpeakerNote'),
    micNote: document.getElementById('voiceMicPermissionNote'),
    preview: document.getElementById('voicePreviewBtn'),
    save: document.getElementById('voiceSettingsSave'),
    inputSel: document.getElementById('voiceInputLang'),
    outputSel: document.getElementById('voiceOutputVoice'),
  };
  if (!controller || !els.save) return;

  const s = controller.getSettings();
  els.rate.value = s.rate; els.rateVal.textContent = `${Number(s.rate).toFixed(2)}×`;
  els.pitch.value = s.pitch; els.pitchVal.textContent = Number(s.pitch).toFixed(2);
  els.volume.value = s.volume; els.volumeVal.textContent = `${Math.round(s.volume * 100)}%`;
  els.autoSpeak.checked = !!s.autoSpeak;
  els.continuous.checked = !!s.continuous;
  els.noiseSuppression.checked = s.noiseSuppression !== false;

  els.rate.addEventListener('input', () => { els.rateVal.textContent = `${Number(els.rate.value).toFixed(2)}×`; });
  els.pitch.addEventListener('input', () => { els.pitchVal.textContent = Number(els.pitch.value).toFixed(2); });
  els.volume.addEventListener('input', () => { els.volumeVal.textContent = `${Math.round(els.volume.value * 100)}%`; });

  // Devices: labels stay generic ("Microphone 1") until permission has
  // been granted at least once — that's a browser privacy rule. The
  // permission note explains that instead of leaving it a silent gap.
  if (!controller.isSupported().recognition && !controller.isSupported().synthesis) {
    els.micNote.textContent = "Your browser doesn't support voice input or output. Try the latest Chrome, Edge, or Safari.";
  }

  async function refreshDevices() {
    try {
      const { inputs, outputs, outputSelectable } = await controller.listDevices();
      els.micDevice.innerHTML = `<option value="">System default</option>` +
        inputs.map((d, i) => `<option value="${d.deviceId}">${d.label || 'Microphone ' + (i + 1)}</option>`).join('');
      if (s.micDeviceId) els.micDevice.value = s.micDeviceId;

      if (outputSelectable) {
        els.speakerDevice.innerHTML = `<option value="">System default</option>` +
          outputs.map((d, i) => `<option value="${d.deviceId}">${d.label || 'Speaker ' + (i + 1)}</option>`).join('');
        if (s.speakerDeviceId) els.speakerDevice.value = s.speakerDeviceId;
      } else {
        els.speakerDevice.disabled = true;
        els.speakerNote.style.display = 'block';
      }
    } catch {
      /* enumerateDevices unsupported — selects stay at "System default" */
    }
  }
  refreshDevices();

  // Requesting the mic once (on first interaction with a device control)
  // both unlocks real device labels and confirms permission — lazily, not
  // on page load, per the performance requirement.
  let permissionRequested = false;
  async function ensureMicPermission() {
    if (permissionRequested) return;
    permissionRequested = true;
    try {
      await controller.requestMicPermission();
      els.micNote.textContent = 'Microphone access granted.';
      refreshDevices();
    } catch (err) {
      const normalized = controller.normalizeError(err.code || 'unknown');
      els.micNote.textContent = normalized.message || "Couldn't access the microphone.";
    }
  }
  [els.micDevice, els.speakerDevice].forEach(el => el && el.addEventListener('focus', ensureMicPermission, { once: true }));

  els.preview.addEventListener('click', () => {
    const previewText = (window.t && window.t('jarvis.greeting')) || "Hey, I'm JARVIS. This is a preview of the selected voice.";
    controller.speak(previewText, { voiceName: els.outputSel.value || undefined, lang: els.inputSel.value });
  });

  els.save.addEventListener('click', () => {
    controller.saveSettings({
      rate: parseFloat(els.rate.value),
      pitch: parseFloat(els.pitch.value),
      volume: parseFloat(els.volume.value),
      autoSpeak: els.autoSpeak.checked,
      continuous: els.continuous.checked,
      noiseSuppression: els.noiseSuppression.checked,
      echoCancellation: els.noiseSuppression.checked,
      micDeviceId: els.micDevice.value,
      speakerDeviceId: els.speakerDevice.value,
      voiceLang: els.inputSel.value,
      voiceName: els.outputSel.value,
    });
    if (typeof showToast === 'function') showToast('Voice settings saved');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderLangGrid();
  renderVoiceSelectors();
  renderVoiceSettingsPanel();
  document.addEventListener('axiom:lang-changed', renderLangGrid);
});
