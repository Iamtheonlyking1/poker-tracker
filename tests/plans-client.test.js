import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, pricingRows, subscriptionPrice, planByTerm, fmtInr } from '../src/plans.js';

test('pricingRows — launch prices end in 99 and cross out the list price', () => {
  const rows = pricingRows(true);
  assert.deepEqual(rows.map((r) => r.price), [299, 799, 1399, 2499]);
  assert.deepEqual(rows.map((r) => r.strike), [499, 1349, 2399, 4199]);
  for (const r of rows) assert.equal(r.price % 100, 99);
});

test('pricingRows — after launch it is list prices, nothing crossed out', () => {
  const rows = pricingRows(false);
  assert.deepEqual(rows.map((r) => r.price), [499, 1349, 2399, 4199]);
  assert.ok(rows.every((r) => r.strike === null));
});

test('pricingRows — savings vs monthly and per-month figures', () => {
  const l = pricingRows(true);
  assert.deepEqual(l.map((r) => r.savePct), [0, 11, 22, 30]);
  assert.deepEqual(l.map((r) => r.perMonth), [299, 266, 233, 208]);
  assert.deepEqual(pricingRows(false).map((r) => r.savePct), [0, 10, 20, 30]);
});

test('longer plans are always cheaper per month (both tiers)', () => {
  for (const t of ['launch', 'list']) {
    const per = PLANS.map((p) => p[t] / p.months);
    for (let i = 1; i < per.length; i++) assert.ok(per[i] < per[i - 1], `${t} plan ${i}`);
  }
});

test('launch is ~40% off list on every term', () => {
  for (const p of PLANS) {
    const off = 1 - p.launch / p.list;
    assert.ok(off > 0.39 && off < 0.43, `${p.term}: ${off}`);
  }
});

test('subscriptionPrice — what a stored launch customer keeps paying', () => {
  const s = subscriptionPrice('12m', 'launch');
  assert.deepEqual([s.price, s.months, s.label], [2499, 12, '12 months']);
  assert.equal(subscriptionPrice('12m', 'nope'), null);
  assert.equal(subscriptionPrice('7m', 'launch'), null);
  assert.equal(subscriptionPrice(null, null), null);
  assert.equal(planByTerm('zz'), null);
});

test('fmtInr — Indian digit grouping', () => {
  assert.equal(fmtInr(4199), '₹4,199');
  assert.equal(fmtInr(299), '₹299');
});
