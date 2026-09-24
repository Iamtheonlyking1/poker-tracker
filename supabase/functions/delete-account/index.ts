// Deploy: Supabase Dashboard -> Edge Functions -> New Function -> name it
// exactly "delete-account" -> paste this whole file. Leave "Enforce JWT
// Verification" ON — the gateway rejects an invalid/expired caller before
// this code runs, so the decoded `sub` claim below can be trusted.
//
// Secrets (this function, or the project-wide Secrets page):
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET   — to cancel an active subscription
//     before deleting the account. Best-effort only: deletion proceeds even
//     if this fails or the secrets aren't set.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// What actually deletes the data: every table that references auth.users
// already has `on delete cascade` (documents, profiles, entitlements,
// live_games, live_members) or `on delete set null` (live_events — see
// 0010_live_events_actor_nullable.sql, analytics_events, client_errors,
// billing_events) — checked against every migration. So deleting the
// auth.users row via the Admin API is the whole job; nothing here deletes
// rows one table at a time. billing_events is deliberately left as-is
// (already anonymized via set-null) — kept for India's ~7yr tax retention,
// same as the privacy policy states.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// The gateway already verified this JWT is valid and unexpired; we just need
// the `sub` (user id) claim out of it, no re-verification needed here.
function decodeJwtSub(token) {
  try {
    const seg = token.split('.')[1];
    const pad = (4 - (seg.length % 4)) % 4;
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
    return JSON.parse(atob(b64)).sub || null;
  } catch (_e) {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const userId = token && decodeJwtSub(token);
  if (!userId) return json({ error: 'not signed in' }, 401);

  if (!SERVICE_KEY) return json({ error: 'Account deletion is not configured yet.' }, 503);
  const svc = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  // Best-effort: cancel an active Razorpay subscription first. A Razorpay
  // hiccup here should never block someone from deleting their account.
  if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
    try {
      const entRes = await fetch(
        `${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${userId}&select=provider,provider_subscription_id,status`,
        { headers: svc },
      );
      const [ent] = await entRes.json().catch(() => []);
      if (ent && ent.provider === 'razorpay' && ent.provider_subscription_id && ent.status !== 'canceled') {
        const rzpAuth = 'Basic ' + btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);
        // the account is being deleted, not just downgraded — cancel now,
        // not at the end of the billing period like a normal cancel would
        await fetch(`https://api.razorpay.com/v1/subscriptions/${ent.provider_subscription_id}/cancel`, {
          method: 'POST',
          headers: { Authorization: rzpAuth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ cancel_at_cycle_end: 0 }),
        });
      }
    } catch (_e) { /* best-effort — deletion proceeds regardless */ }
  }

  const delRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: svc,
  });
  if (!delRes.ok) {
    const body = await delRes.json().catch(() => ({}));
    return json({ error: body.msg || body.error_description || body.error || 'Could not delete account.' }, 502);
  }

  return json({ ok: true });
});
