// Dodo Payments checkout, client side. The Edge Functions (create-subscription,
// cancel-subscription, dodo-webhook) do the actual work; this just redirects
// to Dodo's hosted checkout page and calls them. No card data ever touches us.

import { functions, currentUser } from './supabase.js';

/**
 * Is the launch price still on offer? Asked of the server (it owns the clock
 * and the end date) so the prices we display match what checkout will charge.
 * A separate, unauthenticated function from create-subscription — this needs
 * to work before anyone has signed in, since pricing should be visible
 * without an account. Resolves { launchActive, launchEndsAt } — null when over.
 */
export async function getQuote() {
  const q = await functions.invoke('get-quote', {});
  return { launchActive: !!q.launchActive, launchEndsAt: q.launchEndsAt || null };
}

/**
 * Start a Pro subscription checkout for the given term ('1m' | '3m' | '6m' |
 * '12m'). Unlike the old Razorpay in-page modal, Dodo's checkout is a hosted
 * page — this does a full-page redirect there and never returns (the browser
 * navigates away). Dodo redirects back to the app's own URL with
 * ?checkout=done or ?checkout=cancelled once the customer is done; app.js's
 * boot() reads that on the fresh page load that follows and shows the
 * "confirming…" state / polls entitlements, since there's no in-page promise
 * to resolve the way the old modal's onDismiss/handler callbacks gave us.
 */
export async function startCheckout(term) {
  const user = currentUser();
  if (!user) throw new Error('Sign in first.');
  const { checkoutUrl } = await functions.invoke('create-subscription', { term });
  if (!checkoutUrl) throw new Error('Could not start checkout.');
  location.href = checkoutUrl;
}

/** Cancel at the end of the current billing period. Returns { ok, endsAt }. */
export async function cancelSubscription() {
  return functions.invoke('cancel-subscription', {});
}
