// Pure plan-selection logic for create-subscription/razorpay-webhook: which
// Razorpay plan id a signup gets, whether the launch price is still on offer,
// and which plan a launch subscriber moves to once their launch payments run
// out. No I/O.
//
// How launch pricing works: every term has TWO Razorpay plans — launch price
// and list price. A signup during the launch window subscribes to the launch
// plan; the webhook watches paid_count and, the moment it hits LAUNCH_PAYMENTS,
// schedules the subscription onto the matching list plan for the NEXT cycle
// (Razorpay's subscription-update API, schedule_change_at: 'cycle_end'). This
// account's Razorpay plan doesn't have Subscription Offers available, which
// would have done this automatically — two plans + one webhook-driven switch
// gets the same result.
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
// must match the "cycles" a launch plan is meant to be paid at — also mirrored
// in src/plans.js (LAUNCH_PAYMENTS) for the client's own display copy
export const LAUNCH_PAYMENTS = 2;

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
  // ~25 years of cycles, i.e. "until cancelled", whatever the cycle length.
  // Razorpay caps a subscription's computed end date at ~2121 for cards, and
  // separately caps UPI Autopay mandates at 30 years from now no matter what
  // — since the same total_count has to work for whichever method the
  // customer picks at checkout, 25 years stays safely under both.
  return { planId, tier, term, months, totalCount: Math.floor(300 / months) };
}

/** The list-price plan id for `term`, or null if not configured. Used by the
 *  webhook to know what to move a launch subscriber onto. */
export function listPlanFor(term, plansRaw) {
  const plans = parsePlans(plansRaw);
  const id = plans && plans[term] && plans[term].list;
  return typeof id === 'string' ? id : null;
}

/**
 * Should this charge trigger scheduling the switch to the list plan?
 * `tier` here is read from the subscription's OWN notes at the time of this
 * event — once the webhook successfully switches a subscription, it also
 * rewrites those notes to tier:'list', so a later event naturally reports
 * tier:'list' and this returns false without needing to count exactly.
 * Uses >= rather than === on purpose: if the switch attempt fails on the
 * charge that first crosses LAUNCH_PAYMENTS (a network blip, Razorpay 5xx),
 * the notes still say 'launch', so the NEXT charge retries it — no customer
 * gets stuck on the launch plan forever because of one failed API call.
 */
export function shouldSwitchToList(tier, paidCount, launchPayments = LAUNCH_PAYMENTS) {
  return tier === 'launch' && Number.isInteger(paidCount) && paidCount >= launchPayments;
}
