import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyWebhookSignature, mapEventToEntitlement, nextPaidCount } from '../supabase/functions/_shared/dodo-map.js';

// A valid Standard Webhooks secret is "whsec_" + base64. Any base64 string
// works for these tests — it just needs to decode cleanly.
const SECRET = 'whsec_' + Buffer.from('test-signing-key-bytes').toString('base64');

async function sign(id, timestamp, body, secret = SECRET) {
  const crypto = globalThis.crypto;
  const keyBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return 'v1,' + Buffer.from(mac).toString('base64');
}

test('verifyWebhookSignature — round trip and tamper detection', async () => {
  const id = 'msg_test1';
  const now = Date.now();
  const timestamp = String(Math.floor(now / 1000));
  const body = JSON.stringify({ type: 'subscription.active', data: { subscription_id: 'sub_1' } });
  const signatureHeader = await sign(id, timestamp, body);

  assert.equal(await verifyWebhookSignature({ id, timestamp, rawBody: body, signatureHeader, secret: SECRET, now }), true);
  assert.equal(await verifyWebhookSignature({ id, timestamp, rawBody: body + 'x', signatureHeader, secret: SECRET, now }), false, 'tampered body fails');
  assert.equal(await verifyWebhookSignature({ id, timestamp, rawBody: body, signatureHeader, secret: SECRET + 'nope', now }), false, 'wrong secret fails');
  assert.equal(await verifyWebhookSignature({ id: 'different-id', timestamp, rawBody: body, signatureHeader, secret: SECRET, now }), false, 'tampered id fails');
});

test('verifyWebhookSignature — missing pieces or a stale timestamp are always false', async () => {
  const body = 'x';
  assert.equal(await verifyWebhookSignature({ id: '', timestamp: '1', rawBody: body, signatureHeader: 'v1,abc', secret: SECRET }), false);
  assert.equal(await verifyWebhookSignature({ id: 'a', timestamp: '1', rawBody: body, signatureHeader: '', secret: SECRET }), false);
  assert.equal(await verifyWebhookSignature({ id: 'a', timestamp: '1', rawBody: body, signatureHeader: 'v1,abc', secret: '' }), false);
  const id = 'a';
  const now = Date.now();
  const staleTimestamp = String(Math.floor(now / 1000) - 10 * 60); // 10 minutes old, outside the 5-minute window
  const sig = await sign(id, staleTimestamp, body);
  assert.equal(await verifyWebhookSignature({ id, timestamp: staleTimestamp, rawBody: body, signatureHeader: sig, secret: SECRET, now }), false, 'stale timestamp rejected');
});

const event = (type, dataOverrides = {}) => ({
  business_id: 'biz_1',
  type,
  timestamp: new Date().toISOString(),
  data: {
    subscription_id: 'sub_test1',
    customer: { customer_id: 'cust_test1' },
    next_billing_date: '2026-12-01T00:00:00Z',
    metadata: { supabase_user_id: 'user-uuid-1' },
    ...dataOverrides,
  },
});

test('mapEventToEntitlement — active/renewed grant pro + set period end', () => {
  for (const type of ['subscription.active', 'subscription.renewed']) {
    const m = mapEventToEntitlement(event(type));
    assert.equal(m.userId, 'user-uuid-1');
    assert.equal(m.patch.plan, 'pro');
    assert.equal(m.patch.status, 'active');
    assert.equal(m.patch.provider, 'dodo');
    assert.equal(m.patch.provider_subscription_id, 'sub_test1');
    assert.equal(m.patch.provider_customer_id, 'cust_test1');
    assert.equal(m.patch.current_period_end, '2026-12-01T00:00:00Z');
  }
});

test('mapEventToEntitlement — on_hold is past_due, not canceled (grace period)', () => {
  const m = mapEventToEntitlement(event('subscription.on_hold'));
  assert.equal(m.patch.status, 'past_due');
  assert.equal('plan' in m.patch, false, 'does not touch plan');
});

test('mapEventToEntitlement — cancelled falls back to free', () => {
  const m = mapEventToEntitlement(event('subscription.cancelled'));
  assert.equal(m.patch.plan, 'free');
  assert.equal(m.patch.status, 'canceled');
});

test('mapEventToEntitlement — failed/plan_changed/unknown types are ignored', () => {
  assert.equal(mapEventToEntitlement(event('subscription.failed')), null);
  assert.equal(mapEventToEntitlement(event('subscription.plan_changed')), null);
  assert.equal(mapEventToEntitlement(event('subscription.updated')), null);
});

test('mapEventToEntitlement — no metadata.supabase_user_id can\'t be attributed → null', () => {
  assert.equal(mapEventToEntitlement(event('subscription.active', { metadata: {} })), null);
  assert.equal(mapEventToEntitlement({ type: 'subscription.active', data: {} }), null);
});

test('mapEventToEntitlement — carries plan term + price tier from metadata', () => {
  const m = mapEventToEntitlement(event('subscription.active', {
    metadata: { supabase_user_id: 'user-uuid-1', term: '6m', tier: 'launch' },
  }));
  assert.equal(m.patch.plan_term, '6m');
  assert.equal(m.patch.price_tier, 'launch');
});

test('nextPaidCount — active resets to 1, renewed increments, others pass through unchanged', () => {
  assert.equal(nextPaidCount('subscription.active', undefined), 1);
  assert.equal(nextPaidCount('subscription.active', 5), 1, 'a resubscribe starts fresh');
  assert.equal(nextPaidCount('subscription.renewed', undefined), 2, 'missing prior count treated as 1');
  assert.equal(nextPaidCount('subscription.renewed', 1), 2);
  assert.equal(nextPaidCount('subscription.renewed', 4), 5);
  assert.equal(nextPaidCount('subscription.on_hold', 3), 3, 'untouched by non-payment events');
  assert.equal(nextPaidCount('subscription.cancelled', 3), 3);
});
