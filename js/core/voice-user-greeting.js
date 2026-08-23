// AXIOM — Personalized voice greeting
(function (w) {
  'use strict';
  const GREETING_KEY = 'axiom_voice_greeted_session';
  let spoken = false;

  function firstName(user) {
    const meta = user && user.user_metadata || {};
    const raw = meta.full_name || meta.name || meta.display_name || meta.preferred_username || user?.email?.split('@')[0] || '';
    return String(raw).trim().split(/[\s._]+/)[0] || 'there';
  }

  async function getUser() {
    try {
      if (w.AxiomSupabaseAuth && typeof w.AxiomSupabaseAuth.getUser === 'function') {
        const u = await w.AxiomSupabaseAuth.getUser();
        if (u) return u.user || u;
      }
    } catch (_) {}
    try {
      if (typeof supabaseClient !== 'undefined' && supabaseClient && supabaseClient.auth) {
        const { data } = await supabaseClient.auth.getUser();
        if (data && data.user) return data.user;
      }
    } catch (_) {}
    try {
      if (w.supabase?.auth?.getUser) {
        const r = await w.supabase.auth.getUser();
        if (!r.error && r.data?.user) return r.data.user;
      }
    } catch (_) {}
    return null;
  }

  async function speakGreeting(user) {
    if (spoken) return false;
    const userId = (user && user.id) || 'guest-commander';
    const sessionMarker = userId + ':' + new Date().toISOString().slice(0, 10);
    try { if (sessionStorage.getItem(GREETING_KEY) === sessionMarker) return false; } catch (_) {}
    const name = user ? firstName(user) : 'Commander';
    const hour = new Date().getHours();
    let period = 'Good evening';
    if (hour >= 5 && hour < 12) period = 'Good morning';
    else if (hour >= 12 && hour < 17) period = 'Good afternoon';
    else if (hour >= 17 && hour < 22) period = 'Good evening';
    else period = 'Good night';

    const text = `${period}, ${name}. Axiom is online and listening. How can I help?`;
    spoken = true;
    try { sessionStorage.setItem(GREETING_KEY, sessionMarker); } catch (_) {}
    document.dispatchEvent(new CustomEvent('axiom:user-greeting', { detail: { user, name, text } }));
    try {
      if (w.JarvisVoiceController && typeof w.JarvisVoiceController.speak === 'function') {
        await w.JarvisVoiceController.speak(text);
        return true;
      }
      if (w.AxiomElevenLabsVoice && typeof w.AxiomElevenLabsVoice.speak === 'function') {
        await w.AxiomElevenLabsVoice.speak(text);
        return true;
      }
      if (w.speechSynthesis) {
        w.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.96;
        utterance.pitch = 1.02;
        w.speechSynthesis.speak(utterance);
        return true;
      }
    } catch (_) {}
    return false;
  }

  function reset() {
    spoken = false;
    try { sessionStorage.removeItem(GREETING_KEY); } catch (_) {}
  }

  // Listen for auth changes
  document.addEventListener('axiom:auth-changed', e => {
    if (!e.detail?.user) {
      reset();
      w.JarvisVoiceController?.stopSpeaking();
    } else {
      speakGreeting(e.detail.user);
    }
  });

  async function init() {
    for (let i = 0; i < 5; i++) {
      const user = await getUser();
      if (user) { await new Promise(r => setTimeout(r, 600)); return speakGreeting(user); }
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }

  w.AxiomVoiceGreeting = { init, speakGreeting, getUser, firstName, reset };
})(window);
