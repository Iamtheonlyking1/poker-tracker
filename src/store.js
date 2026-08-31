// The single storage seam. Everything that used to touch localStorage directly
// goes through here: an in-memory mirror (so reads stay synchronous and cheap),
// a write-through to localStorage, a change-event stream, and — from Phase 2 — a
// sync backend. state.js is the only module that calls this; backup.js reaches
// it through state.js's rawGet/rawSet.
//
// Writes persist synchronously. Coalescing high-frequency writes belongs in the
// Phase 2 sync *push* queue, where an un-pushed change is still safe on disk —
// delaying the localStorage write itself just risks loss on an abrupt close
// (iOS Safari fires pagehide/beforeunload unreliably).

import { report } from './report.js';

// Device-local keys: never synced, never in a backup file. A backup that
// restored another device's sync cursor would be a genuine bug, so the rule is
// structural, not a checklist.
const DEVICE_KEY_PREFIXES = ['poker.sync.', 'sb-'];
const DEVICE_KEYS = new Set(['poker.deviceId', 'poker.lastExport']);

export function isDeviceKey(key) {
  return DEVICE_KEYS.has(key) || DEVICE_KEY_PREFIXES.some((p) => key.startsWith(p));
}

let mem = new Map();
let hydrated = false;
let backend = null;
const subs = new Set();
const dirty = new Set(); // keys whose localStorage write failed, to retry

function hydrate() {
  mem = new Map();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      mem.set(k, localStorage.getItem(k));
    }
  } catch (e) {
    /* private mode / no storage — run from the empty mirror */
  }
  hydrated = true;
}

function ensureHydrated() {
  if (!hydrated) hydrate();
}

export function getRaw(key) {
  ensureHydrated();
  return mem.has(key) ? mem.get(key) : null;
}

/** All keys currently in the mirror (optionally filtered by prefix). */
export function keys(prefix) {
  ensureHydrated();
  const all = [...mem.keys()];
  return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
}

// `immediate` is accepted for call-site intent/readability but writes are always
// synchronous now; it's a no-op kept so the Phase 2 sync layer can reintroduce
// deferred writes without touching every call site.
export function setRaw(key, value, _opts) {
  ensureHydrated();
  if (value == null) mem.delete(key);
  else mem.set(key, String(value));
  writeKey(key);
  emit(key, 'local');
}

function writeKey(k) {
  try {
    if (mem.has(k)) localStorage.setItem(k, mem.get(k));
    else localStorage.removeItem(k);
    dirty.delete(k);
  } catch (e) {
    report(e, { kind: 'store.write', key: k });
    dirty.add(k); // retry on the next flush()
  }
}

/** Retry any writes that previously failed (e.g. after the user frees space). */
export function flush() {
  for (const k of [...dirty]) writeKey(k);
}

function emit(key, source) {
  for (const fn of subs) {
    try {
      fn({ key, source });
    } catch (e) {
      report(e, { kind: 'store.subscriber' });
    }
  }
}

/** subscribe(fn) → unsubscribe(). fn receives { key, source: 'local'|'tab'|'remote'|'import' }. */
export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function setBackend(b) {
  backend = b;
}
export function getBackend() {
  return backend;
}

function onStorageEvent(e) {
  ensureHydrated();
  if (e.key == null) {
    hydrate();
    emit(null, 'tab');
    return;
  }
  if (e.newValue == null) mem.delete(e.key);
  else mem.set(e.key, e.newValue);
  emit(e.key, 'tab');
}

/** Wire cross-tab sync + retry-on-resume. No-op outside a browser. */
export function install() {
  ensureHydrated();
  if (typeof window === 'undefined') return;
  window.addEventListener('storage', onStorageEvent);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush();
  });
  window.addEventListener('pageshow', flush);
}

export function _resetForTests() {
  mem = new Map();
  subs.clear();
  dirty.clear();
  backend = null;
  hydrated = false;
}
