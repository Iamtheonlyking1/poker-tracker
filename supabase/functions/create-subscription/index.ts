// Deploy: Supabase Dashboard -> Edge Functions -> New Function -> name it
// exactly "create-subscription" -> paste this whole file. Leave "Enforce JWT
// Verification" ON — the gateway rejects an invalid/expired caller before this
// code runs, so a decoded `sub` claim below can be trusted.
//
// Secrets to set (this function, or the project-wide Secrets page):
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_PLAN_ID
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically —
// don't set those yourself.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET');
const RAZORPAY_PLAN_ID = Deno.env.get('RAZORPAY_PLAN_ID');

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

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || !RAZORPAY_PLAN_ID) {
    return json({ error: 'Billing is not configured yet.' }, 503);
  }

  const svc = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  // don't let someone already-Pro create a second subscription
  const entRes = await fetch(
    `${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${userId}&select=plan,status`,
    { headers: svc },
  );
  const [ent] = await entRes.json().catch(() => []);
  if (ent && ent.plan === 'pro' && (ent.status === 'active' || ent.status === 'past_due')) {
    return json({ error: 'You already have Pro.' }, 409);
  }

  const rzpAuth = 'Basic ' + btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);
  const subRes = await fetch('https://api.razorpay.com/v1/subscriptions', {
    method: 'POST',
    headers: { Authorization: rzpAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan_id: RAZORPAY_PLAN_ID,
      customer_notify: 1,
      total_count: 1200, // ~100 years of monthly cycles — effectively "until cancelled"
      notes: { supabase_user_id: userId },
    }),
  });
  const sub = await subRes.json().catch(() => ({}));
  if (!subRes.ok) {
    return json({ error: (sub.error && sub.error.description) || 'Could not start checkout.' }, 502);
  }

  return json({ subscriptionId: sub.id, keyId: RAZORPAY_KEY_ID });
});
