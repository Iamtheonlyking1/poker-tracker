import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlans, launchActive, pickPlan, TERMS } from '../supabase/functions/_shared/plans.js';

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
  const partial = JSON.stringify({ '1m': { list: 'plan_1P' } });
  assert.throws(() => pickPlan({ term: '1m', plansRaw: partial, launchEndsAt: ENDS, now: BEFORE }), (e) => e.status === 503,
    'launch active but launch plan id missing must not silently charge list price');
});
