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

function sameEnt(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.plan === b.plan &&
    a.status === b.status &&
    a.provider === b.provider &&
    a.provider_subscription_id === b.provider_subscription_id &&
    a.current_period_end === b.current_period_end &&
    a.plan_term === b.plan_term &&
    a.price_tier === b.price_tier &&
    a.paid_count === b.paid_count &&
    JSON.stringify(a.limits || {}) === JSON.stringify(b.limits || {})
  );
}

// Only notify subscribers when the entitlement actually changed. Without
// this, refresh() → emit() → onEntitlementChange → engine.resume() →
// sync-status flip → a reactive re-render on the Account screen → that
// re-render calls refresh() again → forever, even though nothing changed.
export async function refresh() {
  if (!currentUser()) {
    const changed = ent !== null;
    ent = null;
    if (changed) emit();
    return current();
  }
  try {
    const base = 'plan,status,limits,provider,provider_subscription_id,current_period_end';
    let rows;
    try {
      rows = await db.select('entitlements', `select=${base},plan_term,price_tier,paid_count`);
    } catch (e) {
      // plan_term/price_tier/paid_count come from migration 0007 — until it has been run
      // the select is rejected; never let that read as "free" for a Pro user
      rows = await db.select('entitlements', `select=${base}`);
    }
    const next = (Array.isArray(rows) ? rows[0] : rows) || null;
    const changed = !sameEnt(ent, next);
    ent = next;
    if (changed) emit();
  } catch (e) {
    report(e, { kind: 'entitlements.refresh' });
  }
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
