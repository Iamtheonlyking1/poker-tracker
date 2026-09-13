import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signHmac, verifySignature, mapEventToEntitlement, eventDedupeKey } from '../supabase/functions/_shared/razorpay-map.js';

test('signHmac / verifySignature — round trip and tamper detection', async () => {
  const body = JSON.stringify({ event: 'subscription.charged', foo: 'bar' });
  const secret = 'whsec_test_123';
  const sig = await signHmac(body, secret);
  assert.match(sig, /^[0-9a-f]{64}$/, 'lowercase hex sha256');
  assert.equal(await verifySignature(body, sig, secret), true);
  assert.equal(await verifySignature(body, sig, 'wrong-secret'), false);
  assert.equal(await verifySignature(body + 'x', sig, secret), false, 'tampered body fails');
  assert.equal(await verifySignature(body, sig.slice(0, -1) + '0', secret), false, 'tampered signature fails');
});

test('verifySignature — missing signature or secret is always false', async () => {
  assert.equal(await verifySignature('x', '', 'secret'), false);
  assert.equal(await verifySignature('x', 'abcd', ''), false);
});

const subEvent = (type, subOverrides = {}) => ({
  event: type,
  created_at: 1735689600,
  payload: {
    subscription: {
      entity: {
        id: 'sub_test1',
        customer_id: 'cust_test1',
        current_end: 1738368000,
        notes: { supabase_user_id: 'user-uuid-1' },
        ...subOverrides,
      },
    },
  },
});

test('mapEventToEntitlement — activated/charged grants pro + sets period end', () => {
  for (const type of ['subscription.activated', 'subscription.charged']) {
    const m = mapEventToEntitlement(subEvent(type));
    assert.equal(m.userId, 'user-uuid-1');
    assert.equal(m.patch.plan, 'pro');
    assert.equal(m.patch.status, 'active');
    assert.equal(m.patch.provider, 'razorpay');
    assert.equal(m.patch.provider_subscription_id, 'sub_test1');
    assert.equal(m.patch.provider_customer_id, 'cust_test1');
    assert.equal(m.patch.current_period_end, new Date(1738368000 * 1000).toISOString());
  }
});

test('mapEventToEntitlement — pending is past_due, not canceled (grace period)', () => {
  const m = mapEventToEntitlement(subEvent('subscription.pending'));
  assert.equal(m.patch.status, 'past_due');
  assert.equal('plan' in m.patch, false, 'does not touch plan');
});

test('mapEventToEntitlement — halted/cancelled/completed/expired fall back to free', () => {
  for (const type of ['subscription.halted', 'subscription.cancelled', 'subscription.completed', 'subscription.expired']) {
    const m = mapEventToEntitlement(subEvent(type));
    assert.equal(m.patch.plan, 'free');
    assert.equal(m.patch.status, 'canceled');
  }
});

test('mapEventToEntitlement — unknown event type is ignored', () => {
  assert.equal(mapEventToEntitlement(subEvent('subscription.updated')), null);
});

test('mapEventToEntitlement — no subscription entity at all → null (still logged by the caller)', () => {
  assert.equal(mapEventToEntitlement({ event: 'payment.captured', payload: {} }), null);
});

test('mapEventToEntitlement — a subscription with no supabase_user_id note can’t be attributed → null', () => {
  const e = subEvent('subscription.charged', { notes: {} });
  assert.equal(mapEventToEntitlement(e), null);
});

test('eventDedupeKey — stable across identical redeliveries, distinct across real events', () => {
  const a = subEvent('subscription.charged');
  const aAgain = subEvent('subscription.charged'); // same fields = a Razorpay retry of the same event
  const b = subEvent('subscription.charged', { id: 'sub_test1' });
  b.created_at = 1735689601; // a later, genuinely different charge
  assert.equal(eventDedupeKey(a), eventDedupeKey(aAgain));
  assert.notEqual(eventDedupeKey(a), eventDedupeKey(b));
});

test('eventDedupeKey — prefers the payment id when a payment entity is present', () => {
  const e = subEvent('subscription.charged');
  e.payload.payment = { entity: { id: 'pay_test1' } };
  assert.match(eventDedupeKey(e), /^subscription\.charged:pay_test1:/);
});
