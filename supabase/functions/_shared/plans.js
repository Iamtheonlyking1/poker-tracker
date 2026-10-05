// Pure plan-selection logic for create-subscription/dodo-webhook: which Dodo
// product a signup gets, and whether the launch price is still on offer.
//
// How launch pricing works, with Dodo: ONE product per term (Dodo bills at
// whatever price/interval that product is configured with in the dashboard —
// the list price). A signup during the launch window also gets a discount
// CODE applied at checkout, with Dodo's own `subscription_cycles` limit set
// to LAUNCH_PAYMENTS — Dodo reverts the subscription to the product's full
// price automatically after that many renewals, no webhook-driven plan
// switching needed (unlike the old Razorpay setup, whose account had no
// equivalent — see git history for that two-plan workaround).
//
// create-subscription/index.ts keeps its OWN inline copy (Dashboard-pasted
// Edge Functions can't share files) — keep the two in sync. This file is what
// tests/plans.test.js exercises.
//
// Config the function reads from secrets:
//   DODO_PRODUCTS       JSON: {"1m":"pdt_..","3m":"pdt_..","6m":"pdt_..","12m":"pdt_.."}
//   DODO_DISCOUNT_CODES JSON: {"1m":"LAUNCH1M","3m":"LAUNCH3M","6m":"LAUNCH6M","12m":"LAUNCH12M"}
//     — only applied while the launch window is open; omit/leave unconfigured
//     to run with list price only.
//   LAUNCH_ENDS_AT      ISO date/time. Signups strictly before it get the
//                       launch discount code attached; unset/invalid = off.

export const TERMS = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 };
// must match the discount codes' "Subscription Cycle Limit" in the Dodo
// dashboard — also mirrored in src/plans.js (LAUNCH_PAYMENTS) for the
// client's own display copy
export const LAUNCH_PAYMENTS = 2;

/** Parse a JSON secret (DODO_PRODUCTS / DODO_DISCOUNT_CODES); null if missing/invalid. */
export function parseJsonMap(raw) {
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
 * Decide the product (and launch discount code, if any) for a signup. The
 * client only ever says which TERM it wants; whether the launch price
 * applies is decided here, by the server clock.
 * Returns { productId, term, months, tier, discountCode }. `discountCode` is
 * null when the launch offer is off or not configured for this term —
 * callers should simply omit it from the checkout request in that case.
 * Throws an Error with .status (400 bad term, 503 not configured).
 */
export function pickPlan({ term, productsRaw, discountsRaw, launchEndsAt, now = Date.now() }) {
  if (!Object.prototype.hasOwnProperty.call(TERMS, term)) throw fail('Pick a plan length.', 400);
  const products = parseJsonMap(productsRaw);
  const productId = products && products[term];
  if (!productId || typeof productId !== 'string') throw fail('Billing is not configured yet.', 503);
  const wantsLaunch = launchActive(launchEndsAt, now);
  const discounts = parseJsonMap(discountsRaw);
  const discountCode = wantsLaunch && discounts && typeof discounts[term] === 'string' ? discounts[term] : null;
  return { productId, term, months: TERMS[term], tier: discountCode ? 'launch' : 'list', discountCode };
}
