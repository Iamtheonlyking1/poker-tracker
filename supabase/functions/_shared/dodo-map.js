// Pure webhook logic for dodo-webhook: signature verification + event ->
// entitlements-patch mapping. No I/O — this is what tests/dodo-map.test.js
// exercises. dodo-webhook/index.ts keeps an inline copy (Dashboard-pasted
// Edge Functions can't share files across functions) — keep both in sync.
//
// Dodo signs webhooks per the Standard Webhooks spec: headers
// webhook-id / webhook-timestamp / webhook-signature, HMAC-SHA256 of
// "{id}.{timestamp}.{raw body}" using the secret (strip the "whsec_" prefix,
// base64-decode the rest), base64-encoded, compared against one or more
// "v1,<base64>" entries in webhook-signature (space-separated — more than one
// only during a secret rotation).

const TOLERANCE_SECONDS = 5 * 60; // Standard Webhooks' own recommended window

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

/**
 * Verify a Dodo webhook request. `rawBody` must be the exact, unparsed
 * request text (signing covers the literal bytes — re-serializing parsed
 * JSON can produce a different string and always fail). Resolves true/false;
 * never throws (a malformed header/secret just fails verification).
 */
export async function verifyWebhookSignature({ id, timestamp, rawBody, signatureHeader, secret, now = Date.now() }) {
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

// Events that mean "paid and active" — .active fires once on first payment,
// .renewed on every cycle after.
const ACTIVE_LIKE = new Set(['subscription.active', 'subscription.renewed']);

/**
 * Map one parsed Dodo webhook event ({ type, data }) to an entitlements PATCH,
 * or null if this event type doesn't touch entitlements (e.g. .failed — a
 * mandate that never activated, nothing to flip) or has no attributable user
 * (metadata.supabase_user_id missing — not one of ours, or malformed).
 * The patch deliberately excludes paid_count — see nextPaidCount(), which
 * needs the CURRENT row (a read dodo-webhook does, not available here).
 */
export function mapEventToEntitlement(event) {
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

/**
 * What paid_count should become after this event, given the entitlements
 * row's CURRENT paid_count (null/undefined for a brand new row). `.active`
 * is always the first payment (resets to 1, even on a resubscribe); `.renewed`
 * increments; anything else leaves it untouched.
 */
export function nextPaidCount(type, prevPaidCount) {
  if (type === 'subscription.active') return 1;
  if (type === 'subscription.renewed') {
    const prev = Number.isInteger(prevPaidCount) && prevPaidCount > 0 ? prevPaidCount : 1;
    return prev + 1;
  }
  return prevPaidCount ?? null;
}
