// Deploy: Supabase Dashboard -> Edge Functions -> New Function -> name it
// exactly "create-subscription" -> paste this whole file. Leave "Enforce JWT
// Verification" ON — the gateway rejects an invalid/expired caller before this
// code runs, so a decoded `sub` claim below can be trusted.
//
// Secrets to set (this function, or the project-wide Secrets page):
//   DODO_API_KEY     Bearer token for Dodo's API.
//   DODO_API_BASE    "https://test.dodopayments.com" in test mode,
//                    "https://live.dodopayments.com" once live. Same code
//                    either way — just swap this one secret to go live.
//   DODO_PRODUCTS    JSON, one Dodo product id per term:
//                    {"1m":"pdt_..","3m":"pdt_..","6m":"pdt_..","12m":"pdt_.."}
//   DODO_DISCOUNT_CODES   JSON, optional: {"1m":"LAUNCH1M",...} — a discount
//                    code per term, applied only while LAUNCH_ENDS_AT hasn't
//                    passed. Give each code a "Subscription Cycle Limit" of
//                    LAUNCH_PAYMENTS (2) in the Dodo dashboard — Dodo reverts
//                    the subscription to the product's full price on its own
//                    after that many renewals; no webhook-side plan-switching
//                    needed (unlike the previous Razorpay setup).
//   LAUNCH_ENDS_AT   ISO date/time, e.g. 2026-12-01T00:00:00Z. Signups before
//                    it get the launch discount code attached; unset = list
//                    price only.
//   APP_URL          e.g. https://poker-study.com/ — where Dodo redirects the
//                    browser back to after checkout. Defaults to that value
//                    if unset, so only needed if the domain ever changes.
// The client only says which TERM it wants — launch vs list is decided here by
// this server's clock, never by the browser. Pricing itself (whether launch is
// still on) is served by the separate "get-quote" function, since this
// function requires a signed-in JWT and pricing needs to be visible before
// anyone signs in.
// Returns { checkoutUrl } — the client does a full-page redirect there; Dodo
// hosts the whole payment UI (including UPI for Indian customers, shown
// automatically) and redirects back to APP_URL (?checkout=done/cancelled) on
// completion — app.js's boot() reads that and shows a "confirming…" state.
// dodo-webhook is what actually flips entitlements once payment clears.
// (Pure plan-pick logic mirrored in supabase/functions/_shared/plans.js, which
// is tested.)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically —
// don't set those yourself.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const DODO_API_KEY = Deno.env.get('DODO_API_KEY');
const DODO_API_BASE = Deno.env.get('DODO_API_BASE');
const DODO_PRODUCTS = Deno.env.get('DODO_PRODUCTS');
const DODO_DISCOUNT_CODES = Deno.env.get('DODO_DISCOUNT_CODES');
const LAUNCH_ENDS_AT = Deno.env.get('LAUNCH_ENDS_AT');
// Where Dodo sends the browser back after checkout. The app reads a `checkout`
// query param off this at boot() to show a "confirming…" state and poll
// entitlements, same idea as the old Razorpay modal's close-handler did —
// just via a real page load instead, since Dodo's checkout is hosted, not an
// in-page modal.
const APP_URL = Deno.env.get('APP_URL') || 'https://poker-study.com/';

const TERMS = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 };

function launchActive(now = Date.now()) {
  if (!LAUNCH_ENDS_AT) return false;
  const t = Date.parse(LAUNCH_ENDS_AT);
  return Number.isFinite(t) && now < t;
}

function parseJsonMap(raw) {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? p : null;
  } catch (_e) {
    return null;
  }
}

function pickPlan(term) {
  if (!Object.prototype.hasOwnProperty.call(TERMS, term)) return { error: 'Pick a plan length.', status: 400 };
  const products = parseJsonMap(DODO_PRODUCTS);
  const productId = products && products[term];
  if (!productId || typeof productId !== 'string') return { error: 'Billing is not configured yet.', status: 503 };
  const wantsLaunch = launchActive();
  const discounts = parseJsonMap(DODO_DISCOUNT_CODES);
  const discountCode = wantsLaunch && discounts && typeof discounts[term] === 'string' ? discounts[term] : null;
  return { productId, term, tier: discountCode ? 'launch' : 'list', discountCode };
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

  if (!DODO_API_KEY || !DODO_API_BASE) {
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

  // need the signed-in user's email for Dodo's checkout customer object
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: svc });
  const userRow = await userRes.json().catch(() => ({}));
  const email = userRow && userRow.email;
  if (!email) return json({ error: 'Could not look up your account email.' }, 502);

  const checkoutRes = await fetch(`${DODO_API_BASE}/checkouts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DODO_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product_cart: [{ product_id: pick.productId, quantity: 1 }],
      customer: { email, name: email.split('@')[0] },
      // query string (not hash) so it survives as real search params on a
      // fresh page load — app.js's boot() reads location.search for this
      return_url: `${APP_URL}?checkout=done#account`,
      cancel_url: `${APP_URL}?checkout=cancelled#account`,
      // term + tier ride along so the webhook knows which plan/tier this is
      // for, the same way Razorpay's subscription notes used to carry it
      metadata: { supabase_user_id: userId, term: pick.term, tier: pick.tier },
      discount_codes: pick.discountCode ? [pick.discountCode] : undefined,
    }),
  });
  const checkout = await checkoutRes.json().catch(() => ({}));
  if (!checkoutRes.ok || !checkout.checkout_url) {
    return json({ error: checkout.message || checkout.error || 'Could not start checkout.' }, 502);
  }

  return json({ checkoutUrl: checkout.checkout_url });
});
