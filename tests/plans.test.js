import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlans, launchActive, pickPlan, TERMS } from '../supabase/functions/_shared/plans.js';

const PLANS = JSON.stringify({
  '1m': { plan: 'plan_1', launchOffer: 'offer_1' },
  '3m': { plan: 'plan_3', launchOffer: 'offer_3' },
  '6m': { plan: 'plan_6', launchOffer: 'offer_6' },
  '12m': { plan: 'plan_12', launchOffer: 'offer_12' },
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
  assert.equal(parsePlans(PLANS)['3m'].plan, 'plan_3');
});

test('pickPlan — launch window: the same list plan PLUS the launch offer', () => {
  const a = pickPlan({ term: '3m', plansRaw: PLANS, launchEndsAt: ENDS, now: BEFORE });
  assert.deepEqual([a.planId, a.offerId, a.tier, a.months], ['plan_3', 'offer_3', 'launch', 3]);
});

test('pickPlan — after the window: same plan, no offer', () => {
  const b = pickPlan({ term: '3m', plansRaw: PLANS, launchEndsAt: ENDS, now: AFTER });
  assert.deepEqual([b.planId, b.offerId, b.tier], ['plan_3', null, 'list']);
});

test('pickPlan — no LAUNCH_ENDS_AT means list price, no offer (safe default)', () => {
  const p = pickPlan({ term: '1m', plansRaw: PLANS, launchEndsAt: undefined, now: BEFORE });
  assert.deepEqual([p.tier, p.offerId], ['list', null]);
});

test('pickPlan — total_count keeps every term at ~100 years', () => {
  for (const t of Object.keys(TERMS)) {
    const p = pickPlan({ term: t, plansRaw: PLANS, launchEndsAt: ENDS, now: BEFORE });
    assert.equal(p.totalCount * p.months, 1200);
  }
});

test('pickPlan — bad term is 400, missing config is 503', () => {
  assert.throws(() => pickPlan({ term: '2m', plansRaw: PLANS, launchEndsAt: ENDS }), (e) => e.status === 400);
  assert.throws(() => pickPlan({ term: '__proto__', plansRaw: PLANS, launchEndsAt: ENDS }), (e) => e.status === 400);
  assert.throws(() => pickPlan({ term: '1m', plansRaw: '', launchEndsAt: ENDS }), (e) => e.status === 503);
  const noPlan = JSON.stringify({ '1m': { launchOffer: 'offer_1' } });
  assert.throws(() => pickPlan({ term: '1m', plansRaw: noPlan, launchEndsAt: ENDS, now: BEFORE }), (e) => e.status === 503);
});

test('pickPlan — launch on but its offer missing must not silently charge full price', () => {
  const noOffer = JSON.stringify({ '1m': { plan: 'plan_1' } });
  assert.throws(() => pickPlan({ term: '1m', plansRaw: noOffer, launchEndsAt: ENDS, now: BEFORE }), (e) => e.status === 503);
  // …but after the window the missing offer is irrelevant
  assert.equal(pickPlan({ term: '1m', plansRaw: noOffer, launchEndsAt: ENDS, now: AFTER }).planId, 'plan_1');
});
