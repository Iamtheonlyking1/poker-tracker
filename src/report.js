// Lightweight error capture. Today it just buffers + warns; Phase 2 adds a
// sampled POST to an Edge Function. No bundler, so no Sentry.

const MAX_BUFFER = 50;
const buffer = [];
let toast = null; // set by app.js so we don't import the UI layer here

/** app.js calls this with nav.toast so quota errors surface to the user. */
export function setToast(fn) {
  toast = typeof fn === 'function' ? fn : null;
}

/** Record an error with optional context. Safe to call anywhere. */
export function report(err, ctx = {}) {
  const entry = {
    at: Date.now(),
    message: err && err.message ? String(err.message) : String(err),
    name: (err && err.name) || 'Error',
    stack: err && err.stack ? String(err.stack).slice(0, 2000) : undefined,
    ctx,
  };
  buffer.push(entry);
  while (buffer.length > MAX_BUFFER) buffer.shift();

  try {
    // eslint-disable-next-line no-console
    console.warn('[poker]', entry.name + ':', entry.message, ctx);
  } catch (e) {
    /* no console */
  }

  if (entry.name === 'QuotaExceededError' && toast) {
    toast('Storage is full on this device — export a backup and clear old games.');
  }
  return entry;
}

export function getBuffer() {
  return buffer.slice();
}

export function _clearForTests() {
  buffer.length = 0;
}

/** Rough byte size of everything under localStorage. */
export function storageBytes() {
  try {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      n += k.length + (localStorage.getItem(k) || '').length;
    }
    return n * 2; // UTF-16 code units
  } catch (e) {
    return 0;
  }
}

// Most browsers cap localStorage near 5 MB.
const STORAGE_BUDGET = 5 * 1024 * 1024;

/** Warn once per session if we're near the localStorage ceiling. */
let pressureWarned = false;
export function checkStoragePressure() {
  const bytes = storageBytes();
  const ratio = bytes / STORAGE_BUDGET;
  if (ratio >= 0.8 && !pressureWarned) {
    pressureWarned = true;
    report(new Error(`localStorage at ${(ratio * 100) | 0}% of budget`), { kind: 'storage-pressure', bytes });
    if (toast) toast('This device is almost out of space for Poker Night — back up and trim old games.');
  }
  return { bytes, ratio };
}

/** Attach global handlers. No-op outside a browser. */
export function install() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => {
    report(e.error || new Error(e.message), { kind: 'window.onerror', src: e.filename, line: e.lineno });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    report(r instanceof Error ? r : new Error(String(r)), { kind: 'unhandledrejection' });
  });
}
