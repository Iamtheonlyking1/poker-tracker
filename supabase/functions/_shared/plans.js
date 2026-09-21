// Pure plan-selection logic for create-subscription: which Razorpay plan id a
// signup gets, and whether the launch price is still on offer. No I/O.
//
// create-subscription/index.ts keeps its OWN inline copy (Dashboard-pasted
// Edge Functions can't share files) — keep the two in sync. This file is what
// tests/plans.test.js exercises.
//
// Config the function reads from secrets:
//   RAZORPAY_PLANS    JSON: {"1m":{"launch":"plan_..","list":"plan_.."}, "3m":{..}, "6m":{..}, "12m":{..}}
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
 * Returns { planId, tier, term, months, totalCount }.
 * Throws an Error with .status (400 bad term, 503 not configured).
 */
export function pickPlan({ term, plansRaw, launchEndsAt, now = Date.now() }) {
  if (!Object.prototype.hasOwnProperty.call(TERMS, term)) throw fail('Pick a plan length.', 400);
  const plans = parsePlans(plansRaw);
  if (!plans) throw fail('Billing is not configured yet.', 503);
  const tier = launchActive(launchEndsAt, now) ? 'launch' : 'list';
  const planId = plans[term] && plans[term][tier];
  if (!planId || typeof planId !== 'string') throw fail('Billing is not configured yet.', 503);
  const months = TERMS[term];
  // ~100 years of cycles, i.e. "until cancelled", whatever the cycle length
  return { planId, tier, term, months, totalCount: Math.floor(1200 / months) };
}
