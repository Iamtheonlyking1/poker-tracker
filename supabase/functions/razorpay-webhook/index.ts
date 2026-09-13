// Deploy: paste as function "razorpay-webhook". IMPORTANT — turn "Enforce JWT
// Verification" OFF for this one function only. Razorpay's servers call this
// directly and send no Supabase session token; authenticity is checked below
// via the X-Razorpay-Signature HMAC instead, which is the correct mechanism
// for a server-to-server webhook (create-subscription/cancel-subscription are
// the opposite: JWT verification ON, no signature check, since those ARE
// called by a signed-in user's browser).
//
// After deploying, the Dashboard shows this function's URL — looks like
// https://<project-ref>.functions.supabase.co/razorpay-webhook (or
// https://<project-ref>.supabase.co/functions/v1/razorpay-webhook, depending
// on dashboard version — copy whatever it actually shows you). Paste that into
// Razorpay -> Settings -> Webhooks -> Add New Webhook, and check these events:
//   subscription.activated, subscription.charged, subscription.pending,
//   subscription.halted, subscription.cancelled, subscription.completed
// Razorpay shows a Webhook Secret when you save it — put that in this
// function's secrets as RAZORPAY_WEBHOOK_SECRET.
//
// The mapping/signature logic here is mirrored in
// supabase/functions/_shared/razorpay-map.js, which is what's unit-tested
// (tests/razorpay-map.test.js) — keep the two in sync if you change either.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const WEBHOOK_SECRET = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signHmac(body, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return hex(sig);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(body, signature, secret) {
  if (!signature || !secret) return false;
  return safeEqual(await signHmac(body, secret), signature);
}

function mapEventToEntitlement(event) {
  const type = event.event;
  const sub = event.payload && event.payload.subscription && event.payload.subscription.entity;
  if (!sub) return null;
  const userId = sub.notes && sub.notes.supabase_user_id;
  if (!userId) return null;

  const patch = (extra) => ({
    userId,
    patch: { provider: 'razorpay', provider_subscription_id: sub.id, ...extra },
  });

  switch (type) {
    case 'subscription.activated':
    case 'subscription.charged':
      return patch({
        plan: 'pro',
        status: 'active',
        provider_customer_id: sub.customer_id || null,
        current_period_end: sub.current_end ? new Date(sub.current_end * 1000).toISOString() : null,
      });
    case 'subscription.pending':
      return patch({ status: 'past_due' });
    case 'subscription.halted':
    case 'subscription.cancelled':
    case 'subscription.completed':
    case 'subscription.expired':
      return patch({ plan: 'free', status: 'canceled' });
    default:
      return null;
  }
}

function eventDedupeKey(event) {
  const sub = event.payload && event.payload.subscription && event.payload.subscription.entity;
  const payment = event.payload && event.payload.payment && event.payload.payment.entity;
  return `${event.event}:${(payment && payment.id) || (sub && sub.id) || 'x'}:${event.created_at || ''}`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature') || '';
  const ok = await verifySignature(rawBody, signature, WEBHOOK_SECRET || '');
  if (!ok) return new Response('invalid signature', { status: 401 });

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (_e) {
    return new Response('bad json', { status: 400 });
  }

  const dedupeKey = eventDedupeKey(event);
  const svc = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

  // dedupe first — Razorpay retries undelivered webhooks with the identical
  // payload, and this must be a no-op the second time
  const existing = await fetch(
    `${SUPABASE_URL}/rest/v1/billing_events?event_id=eq.${encodeURIComponent(dedupeKey)}&select=id`,
    { headers: svc },
  );
  const existingRows = await existing.json().catch(() => []);
  if (Array.isArray(existingRows) && existingRows.length) {
    return new Response('already processed', { status: 200 });
  }

  const mapped = mapEventToEntitlement(event);
  if (mapped) {
    await fetch(`${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${mapped.userId}`, {
      method: 'PATCH',
      headers: { ...svc, Prefer: 'return=minimal' },
      body: JSON.stringify(mapped.patch),
    });
  }

  await fetch(`${SUPABASE_URL}/rest/v1/billing_events`, {
    method: 'POST',
    headers: { ...svc, Prefer: 'return=minimal' },
    body: JSON.stringify([{
      provider: 'razorpay',
      event_id: dedupeKey,
      event_type: event.event,
      user_id: mapped ? mapped.userId : null,
      payload: event,
    }]),
  });

  return new Response('ok', { status: 200 });
});
