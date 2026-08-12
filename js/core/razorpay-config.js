// ============================================
// AXIOM — Razorpay client config
// The Key ID is public by design (same idea as the Supabase anon key) —
// it identifies your account but can't authorize a charge on its own.
// The Key SECRET must never appear here or anywhere in browser code (it
// lives only in the Edge Functions' RAZORPAY_KEY_SECRET env secret — see
// supabase/functions/README.md).
//
// This is a static site with no build step, so there's no env-var
// injection at deploy time: swap rzp_test_... for rzp_live_... by hand in
// this file only when actually cutting a production deploy, and swap back
// (or keep a separate branch/checkout) for staging.
// ============================================
const RAZORPAY_KEY_ID = "rzp_test_T6b4DpT0jJbxgv";

// Safeguard: warn loudly (don't silently swap it — that would need the real
// live key, which only you have) if this test key is still wired up on
// what looks like a real deployed domain rather than local dev.
if (
  RAZORPAY_KEY_ID.startsWith('rzp_test_') &&
  window.location.hostname !== 'localhost' &&
  window.location.hostname !== '127.0.0.1' &&
  window.location.protocol !== 'file:'
) {
  console.warn(
    '%c[Axiom] Razorpay is using a TEST key (rzp_test_...) on what looks like a live domain. ' +
    'Replace RAZORPAY_KEY_ID in razorpay-config.js with your rzp_live_... key before accepting real payments.',
    'color:#F2657A; font-weight:bold;'
  );
}