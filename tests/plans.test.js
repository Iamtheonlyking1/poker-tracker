import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonMap, launchActive, pickPlan, TERMS } from '../supabase/functions/_shared/plans.js';

const PRODUCTS = JSON.stringify({ '1m': 'pdt_1m', '3m': 'pdt_3m', '6m': 'pdt_6m', '12m': 'pdt_12m' });
const DISCOUNTS = JSON.stringify({ '1m': 'LAUNCH1M', '3m': 'LAUNCH3M', '6m': 'LAUNCH6M', '12m': 'LAUNCH12M' });
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

test('parseJsonMap — null for missing/garbage, object for valid JSON', () => {
  assert.equal(parseJsonMap(''), null);
  assert.equal(parseJsonMap('{nope'), null);
  assert.equal(parseJsonMap('7'), null);
  assert.equal(parseJsonMap(PRODUCTS)['3m'], 'pdt_3m');
});

test('pickPlan — launch window attaches the discount code, after it does not', () => {
  const a = pickPlan({ term: '3m', productsRaw: PRODUCTS, discountsRaw: DISCOUNTS, launchEndsAt: ENDS, now: BEFORE });
  assert.deepEqual([a.productId, a.tier, a.discountCode, a.months], ['pdt_3m', 'launch', 'LAUNCH3M', 3]);
  const b = pickPlan({ term: '3m', productsRaw: PRODUCTS, discountsRaw: DISCOUNTS, launchEndsAt: ENDS, now: AFTER });
  assert.deepEqual([b.productId, b.tier, b.discountCode], ['pdt_3m', 'list', null]);
});

test('pickPlan — no LAUNCH_ENDS_AT means list price (safe default), no discount code', () => {
  const p = pickPlan({ term: '1m', productsRaw: PRODUCTS, discountsRaw: DISCOUNTS, launchEndsAt: undefined, now: BEFORE });
  assert.equal(p.tier, 'list');
  assert.equal(p.discountCode, null);
});

test('pickPlan — launch active but no discount codes configured still checks out at list price', () => {
  const p = pickPlan({ term: '1m', productsRaw: PRODUCTS, discountsRaw: '', launchEndsAt: ENDS, now: BEFORE });
  assert.equal(p.tier, 'list');
  assert.equal(p.discountCode, null);
  assert.equal(p.productId, 'pdt_1m', 'still checks out — a missing discount config should never block a sale');
});

test('pickPlan — bad term is 400, missing product config is 503', () => {
  assert.throws(() => pickPlan({ term: '2m', productsRaw: PRODUCTS, launchEndsAt: ENDS }), (e) => e.status === 400);
  assert.throws(() => pickPlan({ term: '__proto__', productsRaw: PRODUCTS, launchEndsAt: ENDS }), (e) => e.status === 400);
  assert.throws(() => pickPlan({ term: '1m', productsRaw: '', launchEndsAt: ENDS }), (e) => e.status === 503);
  const partial = JSON.stringify({ '1m': {} });
  assert.throws(() => pickPlan({ term: '1m', productsRaw: partial, launchEndsAt: ENDS }), (e) => e.status === 503);
});

test('every term is covered', () => {
  assert.deepEqual(Object.keys(TERMS).sort(), ['12m', '1m', '3m', '6m']);
});
