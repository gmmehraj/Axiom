// ============================================
// AXIOM — Local developer preview mode
//
// PURPOSE: lets you view dashboard/playground/billing/settings and JARVIS
// without a live Supabase session, so you can preview the UI on your own
// machine. It does NOT touch production auth — see the safety gate below.
//
// TO DISABLE ENTIRELY: delete this file's <script> tag from the HTML pages,
// or flip AXIOM_DEV_MODE_REQUESTED to false. Do not deploy this file to a
// real hosting domain if you don't want the option to exist at all.
//
// SAFETY GATE: even with the flag on, this only activates when the page is
// served from localhost/127.0.0.1 or opened via file://. On any other
// hostname (your real deployed domain) it is always OFF, regardless of the
// flag below, so it cannot accidentally bypass auth in production.
// ============================================
const AXIOM_DEV_MODE_REQUESTED = true;

const AXIOM_DEV_MODE = AXIOM_DEV_MODE_REQUESTED && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname === '' || // file://
  window.location.protocol === 'file:'
);

// Mock profile used everywhere the app would normally read the signed-in
// user's Supabase profile row (name, plan, credits, admin role).
const AXIOM_DEV_PROFILE = {
  full_name: 'Dev Preview',
  avatar_url: null,
  plan: 'pro',
  credits: 2480,
  role: 'admin',
  email: 'dev-preview@local'
};

if (AXIOM_DEV_MODE) {
  console.warn(
    '%c[Axiom] DEV MODE — auth is bypassed and AI replies are simulated.',
    'color:#22D3EE; font-weight:bold;'
  );
}
