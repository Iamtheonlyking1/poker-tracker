// Pure Razorpay webhook logic — signature check, event→entitlement mapping,
// dedupe key. No Deno/Node-specific APIs beyond Web Crypto (crypto.subtle),
// which both runtimes provide, so this file is unit-tested directly with
// `node --test` (tests/razorpay-map.test.js).
//
// supabase/functions/razorpay-webhook/index.ts keeps its OWN copy of this
// logic inline — Edge Functions deployed via the Supabase Dashboard can't
// share files across functions without the CLI. Keep the two in sync if you
// change either.

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA256(body, secret) as lowercase hex — Razorpay's webhook signature. */
export async function signHmac(body, secret) {
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

/** Verify a Razorpay webhook. `signature` = the X-Razorpay-Signature header;
 *  `body` must be the raw request text, not a re-serialized/parsed object —
 *  Razorpay signs the exact bytes it sent. */
export async function verifySignature(body, signature, secret) {
  if (!signature || !secret) return false;
  return safeEqual(await signHmac(body, secret), signature);
}

/**
 * Map a verified webhook event to an entitlements patch, or null if this
 * event type doesn't carry an entitlement change (e.g. we don't recognise it,
 * or it has no subscription/notes to attribute to a user — still gets logged
 * in billing_events for audit either way).
 */
export function mapEventToEntitlement(event) {
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
      return patch({
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
    }
    case 'subscription.pending':
      // a renewal payment failed but Razorpay is retrying — entitlements.isPro()
      // treats past_due as still-pro, so access continues through the grace window
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

/**
 * A stable dedupe key for this event. Razorpay doesn't include a unique event
 * id in the payload, so this combines the event type + the payment/subscription
 * id + created_at — identical on every redelivery of the exact same event,
 * distinct for any other event.
 */
export function eventDedupeKey(event) {
  const sub = event.payload && event.payload.subscription && event.payload.subscription.entity;
  const payment = event.payload && event.payload.payment && event.payload.payment.entity;
  return `${event.event}:${(payment && payment.id) || (sub && sub.id) || 'x'}:${event.created_at || ''}`;
}
