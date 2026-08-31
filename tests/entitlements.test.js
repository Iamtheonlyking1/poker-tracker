import { test } from 'node:test';
import assert from 'node:assert/strict';
import { current, isPro, limit, effectiveLimit, FREE_LIMITS, _setForTests } from '../src/entitlements.js';

test('entitlements — default is free with the free limits', () => {
  _setForTests(null);
  assert.equal(current().plan, 'free');
  assert.equal(isPro(), false);
  assert.equal(limit('synced_sessions'), FREE_LIMITS.synced_sessions);
  assert.equal(effectiveLimit('synced_sessions'), 10);
});

test('entitlements — pro (active) lifts every cap to Infinity', () => {
  _setForTests({ plan: 'pro', status: 'active', limits: {} });
  assert.equal(isPro(), true);
  assert.equal(effectiveLimit('synced_sessions'), Infinity);
  assert.equal(effectiveLimit('live_games'), Infinity);
});

test('entitlements — past_due still counts as pro (grace)', () => {
  _setForTests({ plan: 'pro', status: 'past_due', limits: {} });
  assert.equal(isPro(), true);
});

test('entitlements — canceled/expired pro falls back to free', () => {
  _setForTests({ plan: 'pro', status: 'canceled', limits: {} });
  assert.equal(isPro(), false);
  assert.equal(effectiveLimit('synced_sessions'), 10);
});

test('entitlements — a custom limit on the row overrides the default', () => {
  _setForTests({ plan: 'free', status: 'active', limits: { synced_sessions: 25 } });
  assert.equal(limit('synced_sessions'), 25);
  assert.equal(effectiveLimit('synced_sessions'), 25);
});

test('teardown', () => _setForTests(null));
