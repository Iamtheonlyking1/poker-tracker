// Deploy: paste as function "cancel-subscription". Leave "Enforce JWT
// Verification" ON. Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET (same values
// as create-subscription).
//
// Cancels at the end of the current billing period — the user keeps Pro until
// then, matching the stated refund/cancellation policy. Doesn't touch
// entitlements directly; the webhook flips plan/status when Razorpay actually
// ends the subscription.

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

  const svc = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  const entRes = await fetch(
    `${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${userId}&select=provider,provider_subscription_id`,
    { headers: svc },
  );
  const [ent] = await entRes.json().catch(() => []);
  if (!ent || ent.provider !== 'razorpay' || !ent.provider_subscription_id) {
    return json({ error: 'No active subscription to cancel.' }, 404);
  }

  const rzpAuth = 'Basic ' + btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);
  const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${ent.provider_subscription_id}/cancel`, {
    method: 'POST',
    headers: { Authorization: rzpAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cancel_at_cycle_end: 1 }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: (out.error && out.error.description) || 'Could not cancel.' }, 502);

  return json({ ok: true, endsAt: out.current_end ? new Date(out.current_end * 1000).toISOString() : null });
});
