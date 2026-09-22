import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeEvent, sanitizeError, sanitizeBatch, EVENT_NAMES, PROP_KEYS, MAX_BATCH } from '../supabase/functions/_shared/analytics-rules.js';

test('sanitizeEvent — accepts a known event, drops unknown-name events', () => {
  const ok = sanitizeEvent({ name: 'screen_view', deviceId: 'd1', sessionId: 's1', props: { view: 'home' } });
  assert.equal(ok.name, 'screen_view');
  assert.deepEqual(ok.props, { view: 'home' });
  assert.equal(sanitizeEvent({ name: 'drop_table_users', deviceId: 'd1', sessionId: 's1' }), null);
  assert.equal(sanitizeEvent(null), null);
  assert.equal(sanitizeEvent({}), null);
});

test('sanitizeEvent — requires deviceId and sessionId', () => {
  assert.equal(sanitizeEvent({ name: 'screen_view', sessionId: 's1' }), null);
  assert.equal(sanitizeEvent({ name: 'screen_view', deviceId: 'd1' }), null);
});

test('sanitizeEvent — strips prop keys not on the allowlist (no PII sneaks through)', () => {
  const e = sanitizeEvent({
    name: 'game_settle',
    deviceId: 'd1',
    sessionId: 's1',
    props: { mode: 'cash', players: 4, playerNames: ['Alice', 'Bob'], email: 'a@b.com' },
  });
  assert.deepEqual(e.props, { mode: 'cash', players: 4 });
});

test('sanitizeEvent — drops nested/array prop values, keeps flat primitives', () => {
  const e = sanitizeEvent({ name: 'screen_view', deviceId: 'd1', sessionId: 's1', props: { view: { nested: 1 }, mode: [1, 2] } });
  assert.deepEqual(e.props, {});
});

test('sanitizeEvent — long strings truncated, not rejected', () => {
  const long = 'x'.repeat(500);
  const e = sanitizeEvent({ name: 'signin_method', deviceId: 'd1', sessionId: 's1', props: { reason: long } });
  assert.equal(e.props.reason.length, 200);
});

test('sanitizeEvent — carries userId and a stable at timestamp', () => {
  const at = new Date('2026-01-01T00:00:00Z');
  const e = sanitizeEvent({ name: 'signup', deviceId: 'd1', sessionId: 's1' }, { userId: 'u1', at });
  assert.equal(e.user_id, 'u1');
  assert.equal(e.at, '2026-01-01T00:00:00.000Z');
  const anon = sanitizeEvent({ name: 'signup', deviceId: 'd1', sessionId: 's1' }, { at });
  assert.equal(anon.user_id, null);
});

test('sanitizeError — requires a message and deviceId, caps stack/ctx', () => {
  assert.equal(sanitizeError({ deviceId: 'd1' }), null, 'no message');
  assert.equal(sanitizeError({ message: 'boom' }), null, 'no deviceId');
  const e = sanitizeError({ message: 'boom', deviceId: 'd1', stack: 'x'.repeat(3000), ctx: { view: 'home', secret: 'nope' } });
  assert.equal(e.message, 'boom');
  assert.equal(e.stack.length, 2000);
  assert.deepEqual(e.ctx, { view: 'home' });
});

test('sanitizeBatch — splits events vs errors by kind, drops invalid items silently', () => {
  const { events, errors } = sanitizeBatch([
    { kind: 'event', name: 'screen_view', deviceId: 'd1', sessionId: 's1' },
    { kind: 'error', message: 'boom', deviceId: 'd1' },
    { kind: 'event', name: 'not_a_real_event', deviceId: 'd1', sessionId: 's1' },
    'garbage',
    null,
  ]);
  assert.equal(events.length, 1);
  assert.equal(errors.length, 1);
});

test('sanitizeBatch — caps at MAX_BATCH per kind so one call cannot flood the table', () => {
  const items = Array.from({ length: MAX_BATCH + 20 }, () => ({ kind: 'event', name: 'screen_view', deviceId: 'd1', sessionId: 's1' }));
  const { events } = sanitizeBatch(items);
  assert.equal(events.length, MAX_BATCH);
});

test('sanitizeBatch — non-array input is safely empty', () => {
  assert.deepEqual(sanitizeBatch(null), { events: [], errors: [] });
  assert.deepEqual(sanitizeBatch('nope'), { events: [], errors: [] });
});

test('vocabularies are non-empty and stable shapes', () => {
  assert.ok(EVENT_NAMES.size > 0);
  assert.ok(PROP_KEYS.size > 0);
  assert.ok(EVENT_NAMES instanceof Set);
  assert.ok(PROP_KEYS instanceof Set);
});
