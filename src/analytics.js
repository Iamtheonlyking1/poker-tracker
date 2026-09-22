// Owner-only product analytics: a small, no-op-when-unconfigured event queue
// that flushes to the `ingest` Edge Function. Nothing here changes what a
// user sees — this module never blocks, never throws to its caller, and does
// nothing at all when Supabase isn't configured (syncConfigured() false).
//
// Bump APP_VERSION alongside sw.js's CACHE on each deploy — informational
// only (shows up in the owner's Admin screen), a stale value costs nothing.
export const APP_VERSION = 'poker-v41';

import { deviceId, uuid } from './id.js';
import { syncConfigured } from './config.js';

const FLUSH_MS = 5000;
const FLUSH_AT_COUNT = 20;

const sessionId = uuid();
let queue = [];
let flushTimer = null;
let optedOut = false;

/** Respected if ever set — no UI toggle yet, but the switch exists. */
export function setOptOut(v) {
  optedOut = !!v;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_MS);
}

function enqueue(item) {
  if (optedOut || !syncConfigured()) return;
  queue.push(item);
  if (queue.length >= FLUSH_AT_COUNT) flush();
  else scheduleFlush();
}

/** Fire-and-forget a product event. `name` must be on the server's allowlist
 *  (supabase/functions/_shared/analytics-rules.js) or it's silently dropped
 *  server-side — safe to call speculatively. */
export function track(name, props) {
  enqueue({ kind: 'event', name, props, deviceId: deviceId(), sessionId, appVersion: APP_VERSION });
}

/** Same idea for an error — report.js calls this, not app code directly. */
export function trackError(message, stack, ctx) {
  enqueue({
    kind: 'error', message, stack, ctx,
    deviceId: deviceId(),
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    appVersion: APP_VERSION,
  });
}

/** Send whatever's queued. Safe to call anytime; no-ops on an empty queue. */
export function flush(opts = {}) {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (!queue.length || optedOut || !syncConfigured()) return;
  const items = queue;
  queue = [];
  import('./supabase.js')
    .then(({ functions }) => functions.invoke('ingest', { items }))
    .catch(() => {}); // best-effort — never surface an analytics failure to the user
  if (opts.keepalive) sendKeepalive(items);
}

// pagehide/visibilitychange: fetch(..., {keepalive}) so the browser can finish
// the send after the page has already started unloading (mirrors the sync
// engine's own pagehide flush).
function sendKeepalive(items) {
  try {
    Promise.all([import('./supabase.js'), import('./config.js')]).then(([sb, cfg]) => {
      fetch(`${cfg.getSupabaseUrl()}/functions/v1/ingest`, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', apikey: cfg.getSupabaseAnonKey() },
        body: JSON.stringify({ items }),
      }).catch(() => {});
    });
  } catch (e) {
    /* best-effort */
  }
}

/** app.js calls this once at boot. */
export function install() {
  if (typeof window === 'undefined') return;
  const onHide = () => {
    if (queue.length) flush({ keepalive: true });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide();
  });
  window.addEventListener('pagehide', onHide);
}

export function _resetForTests() {
  queue = [];
  clearTimeout(flushTimer);
  flushTimer = null;
  optedOut = false;
}
