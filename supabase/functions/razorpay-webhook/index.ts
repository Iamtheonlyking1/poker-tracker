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
// This function ALSO does the launch->list price switch: this Razorpay
// account has no Subscription Offers feature, so instead of one plan with a
// temporary discount, there are two plans per term (launch price, list
// price). The moment a launch subscriber's paid_count reaches LAUNCH_PAYMENTS
// (2, see _shared/plans.js), this schedules the subscription onto the list
// plan for its NEXT cycle via Razorpay's subscription-update API. Needs the
// same RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET as create-subscription, plus
// RAZORPAY_PLANS (to look up the list plan id for the term).
//
// The mapping/signature logic here is mirrored in
// supabase/functions/_shared/razorpay-map.js and _shared/plans.js, which are
// what's unit-tested (tests/razorpay-map.test.js, tests/plans.test.js) —
// keep the inline copies here in sync if you change either.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const WEBHOOK_SECRET = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET');
const RAZORPAY_PLANS = Deno.env.get('RAZORPAY_PLANS');
const LAUNCH_PAYMENTS = 2; // must match _shared/plans.js

function listPlanFor(term) {
  let plans = null;
  try { plans = RAZORPAY_PLANS ? JSON.parse(RAZORPAY_PLANS) : null; } catch (_e) { plans = null; }
  const id = plans && plans[term] && plans[term].list;
  return typeof id === 'string' ? id : null;
}

function shouldSwitchToList(tier, paidCount) {
  return tier === 'launch' && Number.isInteger(paidCount) && paidCount >= LAUNCH_PAYMENTS;
}

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
    case 'subscription.charged': {
      // which plan length / price tier this subscription was sold at — set by
      // create-subscription in the subscription's notes, and carried on every
      // renewal, so a launch-price customer stays identifiable as one
      const term = ['1m', '3m', '6m', '12m'].includes(sub.notes.term) ? sub.notes.term : null;
      const tier = ['launch', 'list'].includes(sub.notes.tier) ? sub.notes.tier : null;
      const result = patch({
        plan: 'pro',
        status: 'active',
        provider_customer_id: sub.customer_id || null,
        current_period_end: sub.current_end ? new Date(sub.current_end * 1000).toISOString() : null,
        ...(term ? { plan_term: term } : {}),
        ...(tier ? { price_tier: tier } : {}),
        // payments made so far — how the app knows whether the launch price
        // still applies to the next renewal
        ...(Number.isInteger(sub.paid_count) ? { paid_count: sub.paid_count } : {}),
      });
      result.subscriptionId = sub.id;
      result.term = term;
      result.tier = tier;
      result.paidCount = Number.isInteger(sub.paid_count) ? sub.paid_count : null;
      return result;
    }
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
    const patchUrl = `${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${mapped.userId}`;
    let res = await fetch(patchUrl, {
      method: 'PATCH',
      headers: { ...svc, Prefer: 'return=minimal' },
      body: JSON.stringify(mapped.patch),
    });
    // plan_term / price_tier / paid_count come from migration 0007. If it
    // hasn't been run yet the PATCH is rejected as a whole — never let that
    // block the plan flip itself, retry without the informational columns.
    if (!res.ok && ('plan_term' in mapped.patch || 'price_tier' in mapped.patch || 'paid_count' in mapped.patch)) {
      const { plan_term: _t, price_tier: _p, paid_count: _c, ...core } = mapped.patch;
      res = await fetch(patchUrl, {
        method: 'PATCH',
        headers: { ...svc, Prefer: 'return=minimal' },
        body: JSON.stringify(core),
      });
    }
    if (!res.ok) return new Response('entitlement update failed', { status: 500 });

    // launch price used up — schedule the switch to the list plan for the
    // NEXT cycle. Best-effort: a failure here doesn't fail the webhook (the
    // entitlement update above already succeeded and is what matters most),
    // and shouldSwitchToList's >= check means the NEXT charge retries this
    // automatically if it doesn't go through now.
    if (shouldSwitchToList(mapped.tier, mapped.paidCount) && RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
      const listPlanId = mapped.term ? listPlanFor(mapped.term) : null;
      if (listPlanId) {
        try {
          const rzpAuth = 'Basic ' + btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);
          const switchRes = await fetch(`https://api.razorpay.com/v1/subscriptions/${mapped.subscriptionId}`, {
            method: 'PATCH',
            headers: { Authorization: rzpAuth, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              plan_id: listPlanId,
              schedule_change_at: 'cycle_end',
              // rewrite notes so the NEXT webhook event already reports
              // tier: 'list' — this is what stops shouldSwitchToList from
              // re-triggering once the switch has actually gone through
              notes: { supabase_user_id: mapped.userId, term: mapped.term, tier: 'list' },
            }),
          });
          if (switchRes.ok) {
            // don't wait for a future event to reflect this — we know now
            await fetch(patchUrl, {
              method: 'PATCH',
              headers: { ...svc, Prefer: 'return=minimal' },
              body: JSON.stringify({ price_tier: 'list' }),
            }).catch(() => {});
          }
        } catch (_e) {
          /* best-effort — next charge retries */
        }
      }
    }
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
