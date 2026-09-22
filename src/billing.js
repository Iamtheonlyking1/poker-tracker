// Razorpay checkout, client side. The Edge Functions (create-subscription,
// cancel-subscription, razorpay-webhook) do the actual work; this just opens
// Razorpay's hosted checkout and calls them. No card data ever touches us.

import { functions, currentUser } from './supabase.js';

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';
let scriptLoading = null;

function loadCheckoutScript() {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve();
  if (scriptLoading) return scriptLoading;
  scriptLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CHECKOUT_SCRIPT;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment form — check your connection.'));
    document.head.appendChild(s);
  });
  return scriptLoading;
}

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
 * Open Razorpay checkout for a Pro subscription of the given term
 * ('1m' | '3m' | '6m' | '12m'). Resolves `{ completed }`
 * once the checkout modal closes. `completed: true` means Razorpay collected
 * payment — it does NOT mean the account is Pro yet; the webhook flips the
 * entitlement, usually within a couple of seconds. The caller should poll
 * entitlements.refresh() a few times after this resolves.
 */
export async function startCheckout(term) {
  const user = currentUser();
  if (!user) throw new Error('Sign in first.');
  await loadCheckoutScript();
  const { subscriptionId, keyId } = await functions.invoke('create-subscription', { term });

  return new Promise((resolve, reject) => {
    let settled = false;
    const rzp = new window.Razorpay({
      key: keyId,
      subscription_id: subscriptionId,
      name: 'Poker Night',
      description: 'Pro — full sync history, unlimited shared tables',
      prefill: { email: user.email || '' },
      theme: { color: '#e7bd5c' },
      handler: () => {
        settled = true;
        resolve({ completed: true });
      },
      modal: {
        ondismiss: () => {
          if (!settled) resolve({ completed: false });
        },
      },
    });
    rzp.on('payment.failed', (resp) => {
      settled = true;
      reject(new Error((resp && resp.error && resp.error.description) || 'Payment failed.'));
    });
    rzp.open();
  });
}

/** Cancel at the end of the current billing period. Returns { ok, endsAt }. */
export async function cancelSubscription() {
  return functions.invoke('cancel-subscription', {});
}
