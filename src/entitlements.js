// What the signed-in user is entitled to. Read-only from the client (the
// `entitlements` table is service-role-write only); refreshed on sign-in and
// after a plan change. Free is the default whenever we don't know.

import { db, currentUser } from './supabase.js';
import { report } from './report.js';

export const FREE_LIMITS = {
  synced_sessions: 10,
  live_games: 1,
  live_seats: 8,
  hand_log: 25,
};

let ent = null; // { plan, status, limits }
const subs = new Set();

function emit() {
  for (const fn of subs) {
    try {
      fn(current());
    } catch (e) {
      /* ignore */
    }
  }
}

export function onEntitlementChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function current() {
  return ent || { plan: 'free', status: 'active', limits: {} };
}

export function isPro() {
  const e = current();
  return e.plan === 'pro' && (e.status === 'active' || e.status === 'past_due');
}

/** The configured limit for a key (ignores plan). */
export function limit(key) {
  const e = current();
  if (e.limits && e.limits[key] != null) return Number(e.limits[key]);
  return FREE_LIMITS[key];
}

/** The limit that actually applies — Infinity for Pro. */
export function effectiveLimit(key) {
  return isPro() ? Infinity : limit(key);
}

export async function refresh() {
  if (!currentUser()) {
    ent = null;
    emit();
    return current();
  }
  try {
    const rows = await db.select('entitlements', 'select=plan,status,limits');
    ent = (Array.isArray(rows) ? rows[0] : rows) || null;
  } catch (e) {
    report(e, { kind: 'entitlements.refresh' });
  }
  emit();
  return current();
}

/** Injected into the sync engine so it knows how many sessions a free user syncs. */
export const entitlementView = {
  isPro,
  limit: effectiveLimit,
};

export function _setForTests(e) {
  ent = e;
  emit();
}
