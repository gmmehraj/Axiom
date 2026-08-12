// ============================================
// AXIOM — Billing / Razorpay checkout flow
// Loaded on billing.html only, after supabase-config.js + razorpay-config.js
// + auth.js. Handles one-time credit-pack purchases (Razorpay Orders) and
// monthly subscription tiers (Razorpay Subscriptions) — both are created
// server-side (see supabase/functions/) so the client never decides price.
// ============================================

async function startPackCheckout(pack, btn) {
  const originalText = btn ? btn.textContent : null;
  if (btn) { btn.textContent = 'Preparing checkout…'; btn.disabled = true; }

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

    const createRes = await fetch(`${SUPABASE_URL}/functions/v1/create-razorpay-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ pack }),
    });
    const order = await createRes.json();
    if (!createRes.ok) {
      showToast(order.error || 'Could not start checkout');
      if (btn) { btn.textContent = originalText; btn.disabled = false; }
      return;
    }

    const rzp = new Razorpay({
      key: RAZORPAY_KEY_ID,
      amount: order.amount,
      currency: order.currency,
      name: 'Axiom Studio',
description: 'Credit top-up',
      order_id: order.order_id,
      prefill: { email: session.user.email },
      theme: { color: '#60A5FA' },
      handler: async function (response) {
        await verifyAndRefresh(response, session, btn, originalText);
      },
      modal: { ondismiss: function () { if (btn) { btn.textContent = originalText; btn.disabled = false; } } },
    });
    rzp.on('payment.failed', function (resp) {
      showToast('Payment failed: ' + (resp.error?.description || 'please try again'));
      if (btn) { btn.textContent = originalText; btn.disabled = false; }
    });
    rzp.open();
  } catch (err) {
    showToast(window.t ? window.t('billing.checkoutError') : 'Something went wrong starting checkout');
    if (btn) { btn.textContent = originalText; btn.disabled = false; }
  }
}

async function startTierCheckout(tier, btn) {
  const originalText = btn ? btn.textContent : null;
  if (btn) { btn.textContent = 'Preparing checkout…'; btn.disabled = true; }

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

    const createRes = await fetch(`${SUPABASE_URL}/functions/v1/create-razorpay-subscription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ tier }),
    });
    const sub = await createRes.json();
    if (!createRes.ok) {
      showToast(sub.error || 'Could not start checkout');
      if (btn) { btn.textContent = originalText; btn.disabled = false; }
      return;
    }

    const rzp = new Razorpay({
      key: RAZORPAY_KEY_ID,
      subscription_id: sub.subscription_id,
      name: 'Axiom Studio',
      description: `${tier[0].toUpperCase()}${tier.slice(1)} — monthly`,
      prefill: { email: session.user.email },
      theme: { color: '#60A5FA' },
      handler: async function (response) {
        await verifyAndRefresh(response, session, btn, originalText);
      },
      modal: { ondismiss: function () { if (btn) { btn.textContent = originalText; btn.disabled = false; } } },
    });
    rzp.on('payment.failed', function (resp) {
      showToast('Payment failed: ' + (resp.error?.description || 'please try again'));
      if (btn) { btn.textContent = originalText; btn.disabled = false; }
    });
    rzp.open();
  } catch (err) {
    showToast(window.t ? window.t('billing.checkoutError') : 'Something went wrong starting checkout');
    if (btn) { btn.textContent = originalText; btn.disabled = false; }
  }
}

async function verifyAndRefresh(razorpayResponse, session, btn, originalText) {
  if (btn) btn.textContent = 'Verifying payment…';
  try {
    const verifyRes = await fetch(`${SUPABASE_URL}/functions/v1/verify-razorpay-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(razorpayResponse),
    });
    const result = await verifyRes.json();

    if (result.success) {
      showToast(window.t ? window.t('billing.paymentSuccessful') : 'Payment successful!');
      setTimeout(() => window.location.reload(), 1200);
    } else {
      showToast(result.error || (window.t ? window.t('billing.verificationFailed') : 'Payment verification failed'));
      if (btn) { btn.textContent = originalText; btn.disabled = false; }
    }
  } catch (err) {
    showToast(window.t ? window.t('billing.verificationError') : 'Could not verify payment — contact support if you were charged');
    if (btn) { btn.textContent = originalText; btn.disabled = false; }
  }
}

document.querySelectorAll('[data-pack-checkout]').forEach(btn => {
  btn.addEventListener('click', () => startPackCheckout(btn.dataset.packCheckout, btn));
});
document.querySelectorAll('[data-tier-checkout]').forEach(btn => {
  btn.addEventListener('click', () => startTierCheckout(btn.dataset.tierCheckout, btn));
});

// ============================================
// Usage history table — reads the caller's own usage_logs rows (RLS-scoped)
// ============================================
async function loadUsageHistory() {
  const body = document.getElementById('usageHistoryBody');
  if (!body) return;

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;

  const { data: rows, error } = await supabaseClient
    .from('usage_logs')
    .select('model, prompt_tokens, completion_tokens, credits_charged, created_at')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !rows || rows.length === 0) {
    body.innerHTML = '<tr><td colspan="4" style="color:var(--text-faint);">No usage yet.</td></tr>';
    return;
  }

  body.innerHTML = rows.map(row => {
    const date = window.AxiomFormat ? window.AxiomFormat.date(row.created_at) : new Date(row.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const tokens = (row.prompt_tokens + row.completion_tokens).toLocaleString();
    return `<tr><td>${escapeHtml(row.model)}</td><td>${date}</td><td>${tokens}</td><td>${row.credits_charged}</td></tr>`;
  }).join('');
}

// Any string read from the database and rendered via innerHTML needs this —
// model names, in particular, are user-influenced input on the way in
// (openrouter-chat's `model` field), so treat them as untrusted on the way
// out too rather than relying only on server-side validation.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
loadUsageHistory();
