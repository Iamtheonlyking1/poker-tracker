import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeSession, encodeSession } from '../src/share.js';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/share-v1.json', import.meta.url)), 'utf8'),
);

test('share — a pre-Phase-1 #s= payload still decodes (back-compat lock)', () => {
  const s = decodeSession(fixture.payload);
  const e = fixture.expect;
  assert.ok(s, 'decodes to a session');
  assert.equal(s.name, e.name);
  assert.equal(s.defaultBuyIn, e.defaultBuyIn);
  assert.equal(s.startedAt, e.startedAt);
  assert.equal(s.currency, e.currency);
  assert.equal(s.status, e.status);

  assert.equal(s.players.length, e.players.length);
  for (const want of e.players) {
    const p = s.players.find((x) => x.name === want.name);
    assert.ok(p, `player ${want.name} present`);
    assert.deepEqual(p.buyIns.map((b) => b.amount), want.buyInAmounts);
    assert.equal(p.cashOut, want.cashOut);
  }

  const paidBy = s.players.find((p) => p.id === s.kitty.paidBy);
  assert.equal(paidBy.name, e.kitty.paidByName, 'kitty paidBy resolves to the right player');
  assert.equal(s.kitty.label, e.kitty.label);
  const entriesByName = {};
  for (const [pid, amt] of Object.entries(s.kitty.entries)) {
    entriesByName[s.players.find((p) => p.id === pid).name] = amt;
  }
  assert.deepEqual(entriesByName, e.kitty.entriesByName);
});

test('share — round-trips a session through encode/decode', () => {
  const original = {
    id: 'whatever',
    name: 'Round Trip',
    startedAt: 1700000000000,
    defaultBuyIn: 1000,
    currency: 'USD',
    status: 'settled',
    players: [
      { id: 'a', name: 'Ann', buyIns: [{ amount: 1000, ts: 1 }], cashOut: 2500 },
      { id: 'b', name: 'Bob', buyIns: [{ amount: 1000, ts: 2 }, { amount: 500, ts: 3 }], cashOut: 0 },
    ],
  };
  const back = decodeSession(encodeSession(original));
  assert.equal(back.name, 'Round Trip');
  assert.equal(back.currency, 'USD');
  assert.equal(back.players.length, 2);
  assert.equal(back.players.find((p) => p.name === 'Bob').buyIns.length, 2);
});

test('share — decodeSession returns null on garbage', () => {
  assert.equal(decodeSession('not-base64!!!'), null);
  assert.equal(decodeSession(''), null);
});
