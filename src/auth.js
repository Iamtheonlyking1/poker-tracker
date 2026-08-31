// App-facing auth: the sign-in flows live in src/supabase.js; this adds the
// sign-out-and-wipe behaviour (the owner's choice — a signed-out device keeps
// nothing) and the account-deletion call.

import { auth, currentUser, isSignedIn, onAuthChange } from './supabase.js';
import { getRaw, setRaw, keys } from './store.js';
import { report } from './report.js';

export { auth, currentUser, isSignedIn, onAuthChange };

// keys that survive a sign-out (they describe the device, not the account)
const KEEP_ON_WIPE = new Set(['poker.deviceId', 'poker.schemaVersion', 'poker.install.dismissed']);

/** Everything in localStorage the signed-out device should forget. */
export function wipeLocalData() {
  for (const k of keys('poker.')) {
    if (!KEEP_ON_WIPE.has(k)) setRaw(k, null);
  }
}

/**
 * Sign out. Attempts a final sync flush first; if changes are still pending the
 * caller's `confirmUnsynced()` decides whether to proceed and lose them.
 * `flushFn` is the sync engine's flush (optional).
 */
export async function signOutAndWipe({ flushFn, confirmUnsynced } = {}) {
  if (typeof flushFn === 'function') {
    try {
      await flushFn();
    } catch (e) {
      report(e, { kind: 'auth.signOut.flush' });
    }
  }
  const pending = outboxSize();
  if (pending > 0 && typeof confirmUnsynced === 'function') {
    const go = await confirmUnsynced(pending);
    if (!go) return { ok: false, reason: 'cancelled' };
  }
  await auth.signOut();
  wipeLocalData();
  return { ok: true };
}

function outboxSize() {
  try {
    const v = JSON.parse(getRaw('poker.sync.outbox') || '[]');
    return Array.isArray(v) ? v.length : 0;
  } catch (e) {
    return 0;
  }
}

/**
 * Permanently delete the account. Server-side work (removing rows, cancelling a
 * subscription) runs in an Edge Function; it does not exist yet, so this throws
 * until Phase 5/8 add it. The UI should offer a data export first regardless.
 */
export async function deleteAccount() {
  throw new Error('Account deletion is not available yet — email support to close your account.');
}
