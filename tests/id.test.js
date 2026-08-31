import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uuid, shortCode, deviceId } from '../src/id.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('uuid — RFC 4122 v4 shape', () => {
  for (let i = 0; i < 200; i++) assert.match(uuid(), UUID_RE);
});

test('uuid — effectively unique', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) seen.add(uuid());
  assert.equal(seen.size, 5000);
});

test('uuid — falls back to getRandomValues when randomUUID is missing', () => {
  const real = crypto.randomUUID;
  try {
    // eslint-disable-next-line no-global-assign
    crypto.randomUUID = undefined;
    assert.match(uuid(), UUID_RE);
  } finally {
    crypto.randomUUID = real;
  }
});

test('shortCode — Crockford base32 alphabet, no ambiguous letters', () => {
  const alphabet = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/;
  for (let i = 0; i < 500; i++) {
    const c = shortCode();
    assert.equal(c.length, 6);
    assert.match(c, alphabet);
    assert.ok(!/[ILOU]/.test(c));
  }
  assert.equal(shortCode(10).length, 10);
});

test('deviceId — returns a uuid-shaped string', () => {
  assert.match(deviceId(), UUID_RE);
});
