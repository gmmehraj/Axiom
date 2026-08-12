// ============================================
// AXIOM — Admin dashboard data
// Loaded on admin.html only, after auth.js has already gated the page to
// admin users (see data-require-admin in auth.js). Every query here relies
// on the "Admins can view all ..." RLS policies in db/schema.sql — a
// non-admin session would get empty results even if this file ran.
//
// HONEST SCOPE NOTE: this wires up what's actually derivable from data this
// app owns (users, generations, usage/credits). MRR and infra "system
// uptime" would need a real billing/metrics integration this project
// doesn't have yet, so those cards are left as explicit placeholders
// instead of inventing numbers.
// ============================================

async function loadAdminDashboard() {
  if (!document.body.hasAttribute('data-require-admin')) return;

  const totalUsersEl = document.querySelector('[data-admin-total-users]');
  const totalGenerations24hEl = document.querySelector('[data-admin-generations-24h]');
  const activeSubsEl = document.querySelector('[data-admin-active-subs]');
  const usersTableBody = document.querySelector('[data-admin-users-body]');

  // Wait for the auth gate in auth.js to finish (it dispatches this event
  // after confirming admin role and populating the shell).
  document.addEventListener('axiom:profile-ready', async () => {
    try {
      const [{ count: totalUsers }, { count: gen24h }, { count: activeSubs }, recentUsers] = await Promise.all([
        supabaseClient.from('profiles').select('id', { count: 'exact', head: true }),
        supabaseClient.from('generations').select('id', { count: 'exact', head: true })
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        supabaseClient.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabaseClient.from('profiles')
          .select('id, full_name, plan, credits, created_at')
          .order('created_at', { ascending: false })
          .limit(8),
      ]);

      if (totalUsersEl) totalUsersEl.textContent = (totalUsers ?? 0).toLocaleString();
      if (totalGenerations24hEl) totalGenerations24hEl.textContent = (gen24h ?? 0).toLocaleString();
      if (activeSubsEl) activeSubsEl.textContent = (activeSubs ?? 0).toLocaleString();

      if (usersTableBody) {
        const rows = recentUsers.data || [];
        if (rows.length === 0) {
          usersTableBody.innerHTML = '<tr><td colspan="4" style="color:var(--text-faint);">No users yet.</td></tr>';
        } else {
          usersTableBody.innerHTML = rows.map(u => {
            const joined = window.AxiomFormat ? window.AxiomFormat.date(u.created_at) : new Date(u.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
            const name = u.full_name || '(no name set)';
            return `<tr>
              <td><strong>${escapeHtml(name)}</strong></td>
              <td>${escapeHtml(u.plan)}</td>
              <td>${(u.credits ?? 0).toLocaleString()}</td>
              <td>${joined}</td>
            </tr>`;
          }).join('');
        }
      }
    } catch (err) {
      console.error('[admin] failed to load dashboard data', err);
      if (usersTableBody) {
        usersTableBody.innerHTML = '<tr><td colspan="4" style="color:var(--a-coral, #F2657A);">Could not load user data.</td></tr>';
      }
    }
  }, { once: true });
}

// Minimal HTML-escaping for anything read from the database and rendered
// via innerHTML — full_name is user-supplied at signup, so this is a real
// XSS guard, not decoration.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

loadAdminDashboard();
