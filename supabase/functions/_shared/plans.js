// Pure plan-selection logic for create-subscription: which Razorpay plan (and
// launch offer) a signup gets, and whether the launch price is still on offer.
// No I/O.
//
// How launch pricing works: every term has ONE Razorpay plan at the regular
// (list) price. The launch price is a Razorpay *offer* on that plan — a flat
// discount, type "Limited cycles", cycles = 2 — attached at signup. So a launch
// customer pays the launch price for their first payment and ONE renewal, and
// Razorpay itself reverts them to the full plan price from the third payment.
// (Changing a card subscription's plan later isn't allowed by Razorpay, which
// is why this is an offer and not a second "launch plan".)
//
// create-subscription/index.ts keeps its OWN inline copy (Dashboard-pasted
// Edge Functions can't share files) — keep the two in sync. This file is what
// tests/plans.test.js exercises.
//
// Config the function reads from secrets:
//   RAZORPAY_PLANS    JSON: {"1m":{"plan":"plan_..","launchOffer":"offer_.."}, "3m":{..}, "6m":{..}, "12m":{..}}
//   LAUNCH_ENDS_AT    ISO date/time. Signups strictly before it get the launch
//                     price; unset/invalid = launch offer is OFF (list price).

export const TERMS = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 };
export const TIERS = ['launch', 'list'];

/** Parse the RAZORPAY_PLANS secret; null if missing or not valid JSON. */
export function parsePlans(raw) {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? p : null;
  } catch (_e) {
    return null;
  }
}

/** Is the launch price still on offer at `now` (ms epoch)? */
export function launchActive(launchEndsAt, now = Date.now()) {
  if (!launchEndsAt) return false;
  const t = Date.parse(launchEndsAt);
  return Number.isFinite(t) && now < t;
}

function fail(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * Decide the plan for a signup. The client only ever says which TERM it wants;
 * the tier (launch vs list) is decided here, by the server clock.
 * Returns { planId, offerId, tier, term, months, totalCount } — offerId is
 * null for the list tier.
 * Throws an Error with .status (400 bad term, 503 not configured).
 */
export function pickPlan({ term, plansRaw, launchEndsAt, now = Date.now() }) {
  if (!Object.prototype.hasOwnProperty.call(TERMS, term)) throw fail('Pick a plan length.', 400);
  const plans = parsePlans(plansRaw);
  if (!plans) throw fail('Billing is not configured yet.', 503);
  const tier = launchActive(launchEndsAt, now) ? 'launch' : 'list';
  const entry = plans[term];
  const planId = entry && entry.plan;
  if (!planId || typeof planId !== 'string') throw fail('Billing is not configured yet.', 503);
  let offerId = null;
  if (tier === 'launch') {
    offerId = entry.launchOffer;
    // launch is on but its offer isn't configured: refuse rather than
    // silently charging the full price the screen said was discounted
    if (!offerId || typeof offerId !== 'string') throw fail('Billing is not configured yet.', 503);
  }
  const months = TERMS[term];
  // ~100 years of cycles, i.e. "until cancelled", whatever the cycle length
  return { planId, offerId, tier, term, months, totalCount: Math.floor(1200 / months) };
}
