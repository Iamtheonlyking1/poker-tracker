// Deploy: paste as function "dodo-webhook". IMPORTANT — turn "Enforce JWT
// Verification" OFF for this one function only. Dodo's servers call this
// directly and send no Supabase session token; authenticity is checked below
// via the Standard Webhooks HMAC signature instead (webhook-id/
// webhook-timestamp/webhook-signature headers) — the correct mechanism for a
// server-to-server webhook (create-subscription/cancel-subscription are the
// opposite: JWT verification ON, no signature check, since those ARE called
// by a signed-in user's browser).
//
// After deploying, the Dashboard shows this function's URL — paste that into
// Dodo Payments -> Webhooks -> Add Endpoint, and subscribe to:
//   subscription.active, subscription.renewed, subscription.on_hold,
//   subscription.cancelled, subscription.failed
// Dodo shows a signing secret (starts "whsec_") when you create the
// endpoint — put that in this function's secrets as DODO_WEBHOOK_SECRET.
//
// No plan-switching step here, unlike the old Razorpay webhook — Dodo's own
// discount-code "Subscription Cycle Limit" reverts a launch subscriber to the
// product's full price automatically after LAUNCH_PAYMENTS renewals (see
// create-subscription's header comment). This function only needs to keep
// entitlements/paid_count in sync with what Dodo reports.
//
// The mapping/signature logic here is mirrored in
// supabase/functions/_shared/dodo-map.js, which is what's unit-tested
// (tests/dodo-map.test.js) — keep the inline copy here in sync if you change
// either.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const WEBHOOK_SECRET = Deno.env.get('DODO_WEBHOOK_SECRET');

const TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyWebhookSignature({ id, timestamp, rawBody, signatureHeader, secret, now = Date.now() }) {
  try {
    if (!id || !timestamp || !signatureHeader || !secret) return false;
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_SECONDS) return false;

    const keyBytes = base64ToBytes(secret.replace(/^whsec_/, ''));
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signedContent = `${id}.${timestamp}.${rawBody}`;
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
    const expected = bytesToBase64(new Uint8Array(mac));

    return signatureHeader
      .split(' ')
      .some((entry) => {
        const [v, sig] = entry.split(',');
        return v === 'v1' && sig && timingSafeEqual(sig, expected);
      });
  } catch (_e) {
    return false;
  }
}

const ACTIVE_LIKE = new Set(['subscription.active', 'subscription.renewed']);

function mapEventToEntitlement(event) {
  const type = event && event.type;
  const d = (event && event.data) || {};
  const meta = d.metadata || {};
  const userId = meta.supabase_user_id;
  if (!userId) return null;

  if (ACTIVE_LIKE.has(type)) {
    return {
      userId,
      type,
      patch: {
        plan: 'pro',
        status: 'active',
        provider: 'dodo',
        provider_subscription_id: d.subscription_id || null,
        provider_customer_id: (d.customer && d.customer.customer_id) || null,
        current_period_end: d.next_billing_date || null,
        plan_term: meta.term || null,
        price_tier: meta.tier || null,
      },
    };
  }
  if (type === 'subscription.on_hold') {
    return { userId, type, patch: { status: 'past_due' } };
  }
  if (type === 'subscription.cancelled') {
    return { userId, type, patch: { plan: 'free', status: 'canceled' } };
  }
  return null;
}

function nextPaidCount(type, prevPaidCount) {
  if (type === 'subscription.active') return 1;
  if (type === 'subscription.renewed') {
    const prev = Number.isInteger(prevPaidCount) && prevPaidCount > 0 ? prevPaidCount : 1;
    return prev + 1;
  }
  return prevPaidCount ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const rawBody = await req.text();
  const id = req.headers.get('webhook-id') || '';
  const timestamp = req.headers.get('webhook-timestamp') || '';
  const signatureHeader = req.headers.get('webhook-signature') || '';
  const ok = await verifyWebhookSignature({ id, timestamp, rawBody, signatureHeader, secret: WEBHOOK_SECRET || '' });
  if (!ok) return new Response('invalid signature', { status: 401 });

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (_e) {
    return new Response('bad json', { status: 400 });
  }

  const svc = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

  // dedupe first — Dodo (like any webhook sender) retries undelivered
  // webhooks with the identical delivery id, and this must be a no-op the
  // second time. webhook-id is already globally unique per delivery, unlike
  // Razorpay which gave us nothing to key on and needed a synthesized key.
  const existing = await fetch(
    `${SUPABASE_URL}/rest/v1/billing_events?provider=eq.dodo&event_id=eq.${encodeURIComponent(id)}&select=id`,
    { headers: svc },
  );
  const existingRows = await existing.json().catch(() => []);
  if (Array.isArray(existingRows) && existingRows.length) {
    return new Response('already processed', { status: 200 });
  }

  const mapped = mapEventToEntitlement(event);
  if (mapped) {
    const patchUrl = `${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${mapped.userId}`;
    const patch = { ...mapped.patch };
    if (ACTIVE_LIKE.has(mapped.type)) {
      const curRes = await fetch(`${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${mapped.userId}&select=paid_count`, { headers: svc });
      const [curRow] = await curRes.json().catch(() => []);
      patch.paid_count = nextPaidCount(mapped.type, curRow && curRow.paid_count);
    }

    let res = await fetch(patchUrl, {
      method: 'PATCH',
      headers: { ...svc, Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    // plan_term / price_tier / paid_count come from migration 0007. If it
    // hasn't been run yet the PATCH is rejected as a whole — never let that
    // block the plan flip itself, retry without the informational columns.
    if (!res.ok && ('plan_term' in patch || 'price_tier' in patch || 'paid_count' in patch)) {
      const { plan_term: _t, price_tier: _p, paid_count: _c, ...core } = patch;
      res = await fetch(patchUrl, {
        method: 'PATCH',
        headers: { ...svc, Prefer: 'return=minimal' },
        body: JSON.stringify(core),
      });
    }
    if (!res.ok) return new Response('entitlement update failed', { status: 500 });
  }

  await fetch(`${SUPABASE_URL}/rest/v1/billing_events`, {
    method: 'POST',
    headers: { ...svc, Prefer: 'return=minimal' },
    body: JSON.stringify([{
      provider: 'dodo',
      event_id: id,
      event_type: (event && event.type) || 'unknown',
      user_id: mapped ? mapped.userId : null,
      payload: event,
    }]),
  });

  return new Response('ok', { status: 200 });
});
