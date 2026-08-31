// Ties auth + the sync engine + the Supabase backend together and manages the
// engine's lifecycle across sign-in / sign-out / resume. Loaded (dynamically by
// app.js) only when syncConfigured() is true.

import { createEngine } from './sync/engine.js';
import { createSupabaseBackend } from './sync/backend-supabase.js';
import { classifyFirstSync } from './sync/onboard.js';
import * as store from './store.js';
import { deviceId } from './id.js';
import { auth, onAuthChange, isSignedIn } from './supabase.js';
import { wipeLocalData } from './auth.js';
import { entitlementView, refresh as refreshEntitlement, onEntitlementChange } from './entitlements.js';
import { report } from './report.js';

let engine = null;
let hooks = { onStatus: () => {}, onConflict: () => {}, onChoice: () => {} };

const CURSOR_KEY = 'poker.sync.cursor';
const firstEver = () => !store.getRaw(CURSOR_KEY);

export function initSync(h = {}) {
  hooks = {
    onStatus: h.onStatus || (() => {}),
    onConflict: h.onConflict || (() => {}),
    onChoice: h.onChoice || (() => {}),
  };

  auth.init(); // picks up an OAuth/magic-link return in the URL hash

  onAuthChange((session) => {
    if (session && session.access_token) onSignedIn();
    else stopEngine();
  });

  if (isSignedIn()) onSignedIn();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && engine) engine.resume().catch(noop);
  });
  window.addEventListener('online', () => engine && engine.resume().catch(noop));
}

function makeEngine() {
  const e = createEngine({
    backend: createSupabaseBackend(),
    store,
    deviceId: deviceId(),
    pollMs: 60_000,
    entitlement: entitlementView,
  });
  e.onStatus(hooks.onStatus);
  e.onConflict(hooks.onConflict);
  return e;
}

// a plan change re-scans (a fresh Pro user's older games start syncing)
onEntitlementChange(() => {
  if (engine) engine.resume().catch(noop);
});

async function onSignedIn() {
  refreshEntitlement().catch(noop);
  if (engine) return;
  // On the very first sync, if there is data on both sides, let the user choose
  // before we merge (merge is non-destructive, but "use cloud" wipes local).
  if (firstEver()) {
    try {
      const verdict = await classifyFirstSync(createSupabaseBackend(), store);
      if (verdict === 'choose') {
        hooks.onChoice(); // Account view shows Merge / Use-cloud
        return;
      }
    } catch (e) {
      report(e, { kind: 'sync.classify' });
    }
  }
  startEngine();
}

function startEngine() {
  if (engine) return;
  engine = makeEngine();
  engine.start().catch((err) => report(err, { kind: 'sync.start' }));
}

function stopEngine() {
  if (engine) engine.stop();
  engine = null;
  hooks.onStatus('off');
}

export function getEngine() {
  return engine;
}
export function syncStatus() {
  return engine ? engine.status() : 'off';
}

/** choice: 'merge' (default, safe) | 'cloud' (wipe local, take the cloud). */
export async function resolveFirstSync(choice) {
  if (choice === 'cloud') wipeLocalData();
  startEngine();
}

function noop() {}
