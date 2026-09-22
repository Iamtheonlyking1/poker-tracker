// Deploy: Supabase Dashboard -> Edge Functions -> New Function -> name it
// exactly "create-subscription" -> paste this whole file. Leave "Enforce JWT
// Verification" ON — the gateway rejects an invalid/expired caller before this
// code runs, so a decoded `sub` claim below can be trusted.
//
// Secrets to set (this function, or the project-wide Secrets page):
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
//   RAZORPAY_PLANS   JSON, TWO Razorpay plans per term — launch price and list
//     price — since this Razorpay account has no Subscription Offers feature
//     to attach a temporary discount to a single plan:
//     {"1m":{"launch":"plan_..","list":"plan_.."},"3m":{...},"6m":{...},"12m":{...}}
//   LAUNCH_ENDS_AT  ISO date/time, e.g. 2026-12-01T00:00:00Z. Signups before it
//     get the launch plan, after it the list plan. Unset = list price.
// The client only says which TERM it wants — launch vs list is decided here by
// this server's clock, never by the browser. Pricing itself (whether launch is
// still on) is served by the separate "get-quote" function instead of a body
// flag here, since this function requires a signed-in JWT and pricing needs
// to be visible before anyone signs in.
// razorpay-webhook is what moves a launch subscriber to the list plan once
// their launch-priced payments run out (LAUNCH_PAYMENTS in _shared/plans.js).
// (Pure logic mirrored in supabase/functions/_shared/plans.js, which is tested.)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically —
// don't set those yourself.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET');
const RAZORPAY_PLANS = Deno.env.get('RAZORPAY_PLANS');
const LAUNCH_ENDS_AT = Deno.env.get('LAUNCH_ENDS_AT');

const TERMS = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 };

function launchActive(now = Date.now()) {
  if (!LAUNCH_ENDS_AT) return false;
  const t = Date.parse(LAUNCH_ENDS_AT);
  return Number.isFinite(t) && now < t;
}

function pickPlan(term) {
  if (!Object.prototype.hasOwnProperty.call(TERMS, term)) return { error: 'Pick a plan length.', status: 400 };
  let plans = null;
  try { plans = RAZORPAY_PLANS ? JSON.parse(RAZORPAY_PLANS) : null; } catch (_e) { plans = null; }
  const tier = launchActive() ? 'launch' : 'list';
  const planId = plans && plans[term] && plans[term][tier];
  if (!planId || typeof planId !== 'string') return { error: 'Billing is not configured yet.', status: 503 };
  const months = TERMS[term];
  // ~25 years of cycles, i.e. "until cancelled", whatever the cycle length.
  // Razorpay caps a subscription's computed end date at ~2121 for cards, and
  // separately caps UPI Autopay mandates at 30 years from now no matter what
  // — since the same total_count has to work for whichever method the
  // customer picks at checkout, 25 years stays safely under both.
  return { planId, tier, term, totalCount: Math.floor(300 / months) };
}

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

  let body: { term?: string } = {};
  try { body = await req.json(); } catch (_e) { body = {}; }

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return json({ error: 'Billing is not configured yet.' }, 503);
  }
  const pick = pickPlan(String(body.term || ''));
  if ('error' in pick) return json({ error: pick.error }, pick.status);

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
      plan_id: pick.planId,
      customer_notify: 1,
      total_count: pick.totalCount,
      // term + tier ride along on every renewal event so the webhook can
      // record them (a launch-price customer stays identifiable)
      notes: { supabase_user_id: userId, term: pick.term, tier: pick.tier },
    }),
  });
  const sub = await subRes.json().catch(() => ({}));
  if (!subRes.ok) {
    return json({ error: (sub.error && sub.error.description) || 'Could not start checkout.' }, 502);
  }

  return json({ subscriptionId: sub.id, keyId: RAZORPAY_KEY_ID });
});
