// AXIOM — Production auth UX helpers
(function () {
  'use strict';

  function errorBox() { return document.getElementById('authError'); }
  function showError(message) {
    var box = errorBox();
    if (!box) return;
    box.textContent = message;
    box.style.display = 'block';
  }
  function clearError() {
    var box = errorBox();
    if (box) { box.textContent = ''; box.style.display = 'none'; }
  }
  function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }

  window.AxiomAuthUX = {
    normalizeEmail: normalizeEmail,
    showError: showError,
    clearError: clearError,
    friendlyError: function (error) {
      var msg = String((error && error.message) || '').toLowerCase();
      if (msg.includes('rate limit') || msg.includes('too many')) return 'Too many email requests right now. Please wait a few minutes and try again.';
      if (msg.includes('invalid login credentials')) return 'Email or password is incorrect. If you just created your account, confirm your email first.';
      if (msg.includes('email not confirmed')) return 'Please confirm your email address, then sign in again.';
      if (msg.includes('already registered') || msg.includes('already been registered')) return 'An account with this email already exists. Try signing in instead.';
      if (msg.includes('invalid email')) return 'Please enter a valid email address.';
      if (msg.includes('password')) return error.message;
      return (error && error.message) || 'Something went wrong. Please try again.';
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    var email = document.getElementById('loginEmail') || document.getElementById('regEmail');
    if (email) email.addEventListener('blur', function () { email.value = normalizeEmail(email.value); });
    document.querySelectorAll('[data-auth-clear-error]').forEach(function (el) {
      el.addEventListener('input', clearError);
    });
  });
})();
