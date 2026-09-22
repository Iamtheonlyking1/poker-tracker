import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlans, launchActive, pickPlan, listPlanFor, shouldSwitchToList, TERMS } from '../supabase/functions/_shared/plans.js';

const PLANS = JSON.stringify({
  '1m': { launch: 'plan_1L', list: 'plan_1P' },
  '3m': { launch: 'plan_3L', list: 'plan_3P' },
  '6m': { launch: 'plan_6L', list: 'plan_6P' },
  '12m': { launch: 'plan_12L', list: 'plan_12P' },
});
const ENDS = '2026-12-01T00:00:00Z';
const BEFORE = Date.parse('2026-11-30T23:59:59Z');
const AFTER = Date.parse('2026-12-01T00:00:00Z');

test('launchActive — strictly before the end instant only', () => {
  assert.equal(launchActive(ENDS, BEFORE), true);
  assert.equal(launchActive(ENDS, AFTER), false, 'at the boundary the offer is over');
  assert.equal(launchActive('', BEFORE), false, 'unset = off');
  assert.equal(launchActive('not a date', BEFORE), false, 'garbage = off');
  assert.equal(launchActive(undefined, BEFORE), false);
});

test('parsePlans — null for missing/garbage, object for valid JSON', () => {
  assert.equal(parsePlans(''), null);
  assert.equal(parsePlans('{nope'), null);
  assert.equal(parsePlans('7'), null);
  assert.equal(parsePlans(PLANS)['3m'].launch, 'plan_3L');
});

test('pickPlan — launch window picks launch plans, after picks list plans', () => {
  const a = pickPlan({ term: '3m', plansRaw: PLANS, launchEndsAt: ENDS, now: BEFORE });
  assert.deepEqual([a.planId, a.tier, a.months], ['plan_3L', 'launch', 3]);
  const b = pickPlan({ term: '3m', plansRaw: PLANS, launchEndsAt: ENDS, now: AFTER });
  assert.deepEqual([b.planId, b.tier], ['plan_3P', 'list']);
});

test('pickPlan — no LAUNCH_ENDS_AT means list price (safe default)', () => {
  const p = pickPlan({ term: '1m', plansRaw: PLANS, launchEndsAt: undefined, now: BEFORE });
  assert.equal(p.tier, 'list');
});

test('pickPlan — total_count keeps every term at ~40 years (safely under Razorpay\'s end-date cap)', () => {
  for (const t of Object.keys(TERMS)) {
    const p = pickPlan({ term: t, plansRaw: PLANS, launchEndsAt: ENDS, now: BEFORE });
    assert.equal(p.totalCount * p.months, 480);
  }
});

test('pickPlan — bad term is 400, missing config is 503', () => {
  assert.throws(() => pickPlan({ term: '2m', plansRaw: PLANS, launchEndsAt: ENDS }), (e) => e.status === 400);
  assert.throws(() => pickPlan({ term: '__proto__', plansRaw: PLANS, launchEndsAt: ENDS }), (e) => e.status === 400);
  assert.throws(() => pickPlan({ term: '1m', plansRaw: '', launchEndsAt: ENDS }), (e) => e.status === 503);
  const partial = JSON.stringify({ '1m': { list: 'plan_1P' } });
  assert.throws(() => pickPlan({ term: '1m', plansRaw: partial, launchEndsAt: ENDS, now: BEFORE }), (e) => e.status === 503,
    'launch active but launch plan id missing must not silently charge list price');
});

test('listPlanFor — the list-price plan id for a term, or null if missing', () => {
  assert.equal(listPlanFor('3m', PLANS), 'plan_3P');
  assert.equal(listPlanFor('3m', ''), null);
  assert.equal(listPlanFor('3m', '{nope'), null);
  assert.equal(listPlanFor('7m', PLANS), null, 'unknown term');
  const noList = JSON.stringify({ '1m': { launch: 'plan_1L' } });
  assert.equal(listPlanFor('1m', noList), null);
});

test('shouldSwitchToList — fires from paidCount >= LAUNCH_PAYMENTS while notes still say launch', () => {
  assert.equal(shouldSwitchToList('launch', 1, 2), false, 'first payment — not yet');
  assert.equal(shouldSwitchToList('launch', 2, 2), true, 'second payment — switch now');
  assert.equal(shouldSwitchToList('launch', 3, 2), true,
    'still true on a later charge — this is how a failed switch attempt on the 2nd payment retries on the 3rd, ' +
    'rather than leaving the customer on the launch plan forever; it stops once the switch actually succeeds ' +
    'and flips the subscription notes to tier: list, not by counting exactly');
  assert.equal(shouldSwitchToList('list', 2, 2), false, 'a list-tier subscriber never switches — already switched');
  assert.equal(shouldSwitchToList('launch', 2), true, 'defaults to the exported LAUNCH_PAYMENTS');
  assert.equal(shouldSwitchToList('launch', undefined, 2), false, 'no paid_count on the event — nothing to compare, stay put');
  assert.equal(shouldSwitchToList('launch', null, 2), false);
});
