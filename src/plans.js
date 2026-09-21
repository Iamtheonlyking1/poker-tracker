// Pro plan catalogue + price maths. Pure (no DOM) so it's unit-tested.
//
// The amounts here are DISPLAY ONLY. What a customer is actually charged is
// the Razorpay plan's amount (= list) minus the launch offer, if create-
// subscription attached one — keep them in step when prices change. Which tier
// applies is decided by the server clock; the client just asks (billing.js).
//
// Launch price = the first LAUNCH_PAYMENTS payments (the signup payment plus
// ONE renewal), then the plan's full list price. LAUNCH_PAYMENTS must match the
// "cycles" set on the Razorpay launch offers.

export const LAUNCH_PAYMENTS = 2;

export const PLANS = [
  { term: '1m', months: 1, label: '1 month', launch: 299, list: 499 },
  { term: '3m', months: 3, label: '3 months', launch: 799, list: 1349 },
  { term: '6m', months: 6, label: '6 months', launch: 1399, list: 2399 },
  { term: '12m', months: 12, label: '12 months', launch: 2499, list: 4199 },
];

export const DEFAULT_TERM = '12m';
export const BEST_VALUE_TERM = '12m';

export const planByTerm = (term) => PLANS.find((p) => p.term === term) || null;

export const fmtInr = (n) => '₹' + Number(n).toLocaleString('en-IN');

/**
 * One row per plan, priced for the tier currently on offer.
 * `strike` is the list price to cross out while the launch offer is on.
 * `savePct` is the saving vs paying month by month at the same tier.
 */
export function pricingRows(launchActive) {
  const tier = launchActive ? 'launch' : 'list';
  const monthly = PLANS[0][tier];
  return PLANS.map((p) => {
    const price = p[tier];
    return {
      ...p,
      tier,
      price,
      perMonth: Math.round(price / p.months),
      strike: launchActive ? p.list : null,
      savePct: p.months > 1 ? Math.round((1 - price / (monthly * p.months)) * 100) : 0,
    };
  });
}

/**
 * What a stored subscription (entitlements.plan_term / price_tier / paid_count)
 * is paying, and what its NEXT payment will be. A launch subscription's next
 * payment is still launch-priced only while fewer than LAUNCH_PAYMENTS
 * payments have gone through.
 */
export function subscriptionPrice(term, tier, paidCount) {
  const p = planByTerm(term);
  if (!p || !['launch', 'list'].includes(tier)) return null;
  const paid = Number.isInteger(paidCount) && paidCount > 0 ? paidCount : 1;
  const launchLeft = tier === 'launch' ? Math.max(0, LAUNCH_PAYMENTS - paid) : 0;
  return {
    term,
    tier,
    months: p.months,
    label: p.label,
    launchPrice: p.launch,
    listPrice: p.list,
    launchLeft,
    nextPrice: launchLeft > 0 ? p.launch : p.list,
  };
}
