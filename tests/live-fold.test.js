import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldEvents, toHistoryEntry } from '../src/live/fold.js';
import { reconciliation, net } from '../src/settle.js';

const GAME = { id: 'g1', name: 'Friday', currency: 'INR', default_buy_in: 500, created_at: '2026-08-31T18:00:00Z', status: 'live' };
let seq = 0;
const ev = (type, payload) => ({ seq: ++seq, type, payload, created_at: '2026-08-31T18:05:00Z' });

test('fold — players, buy-ins, cash-outs build the expected session shape', () => {
  seq = 0;
  const s = foldEvents(GAME, [
    ev('add_player', { playerId: 'a', name: 'Ana' }),
    ev('add_player', { playerId: 'b', name: 'Bo' }),
    ev('add_buyin', { playerId: 'a', amount: 500 }),
    ev('add_buyin', { playerId: 'b', amount: 500 }),
    ev('add_buyin', { playerId: 'a', amount: 500 }),
    ev('set_cashout', { playerId: 'a', amount: 1400 }),
    ev('set_cashout', { playerId: 'b', amount: 100 }),
  ]);
  assert.equal(s.name, 'Friday');
  assert.equal(s.defaultBuyIn, 500);
  assert.equal(s._live, true);
  const ana = s.players.find((p) => p.name === 'Ana');
  assert.equal(ana.buyIns.length, 2);
  assert.equal(ana.cashOut, 1400);
  assert.equal(net(ana), 400);
});

test('fold — set_cashout is last-write-wins by seq', () => {
  seq = 0;
  const s = foldEvents(GAME, [
    ev('add_player', { playerId: 'a', name: 'Ana' }),
    ev('add_buyin', { playerId: 'a', amount: 500 }),
    ev('set_cashout', { playerId: 'a', amount: 999 }),
    ev('set_cashout', { playerId: 'a', amount: 250 }),
  ]);
  assert.equal(s.players[0].cashOut, 250);
});

test('fold — out-of-order events fold identically (sorted by seq)', () => {
  const events = [
    { seq: 3, type: 'add_buyin', payload: { playerId: 'a', amount: 500 }, created_at: '2026-08-31T18:03:00Z' },
    { seq: 1, type: 'add_player', payload: { playerId: 'a', name: 'Ana' }, created_at: '2026-08-31T18:01:00Z' },
    { seq: 2, type: 'add_buyin', payload: { playerId: 'a', amount: 500 }, created_at: '2026-08-31T18:02:00Z' },
  ];
  const a = foldEvents(GAME, events);
  const b = foldEvents(GAME, [...events].reverse());
  assert.deepEqual(a, b);
  assert.equal(a.players[0].buyIns.length, 2);
});

test('fold — replaying the same log twice gives the same result (idempotent)', () => {
  seq = 0;
  const log = [
    ev('add_player', { playerId: 'a', name: 'Ana' }),
    ev('add_buyin', { playerId: 'a', amount: 500 }),
    ev('rename_player', { playerId: 'a', name: 'Ana K.' }),
  ];
  assert.deepEqual(foldEvents(GAME, log), foldEvents(GAME, log));
});

test('fold — remove_player drops the player', () => {
  seq = 0;
  const s = foldEvents(GAME, [
    ev('add_player', { playerId: 'a', name: 'Ana' }),
    ev('add_player', { playerId: 'b', name: 'Bo' }),
    ev('remove_player', { playerId: 'a' }),
  ]);
  assert.equal(s.players.length, 1);
  assert.equal(s.players[0].name, 'Bo');
});

test('fold — add_buyin before add_player still creates the player', () => {
  seq = 0;
  const s = foldEvents(GAME, [ev('add_buyin', { playerId: 'x', name: 'Lee', amount: 500 })]);
  assert.equal(s.players.length, 1);
  assert.equal(s.players[0].name, 'Lee');
});

test('fold — money reconciles the same as a normal session', () => {
  seq = 0;
  const s = foldEvents(GAME, [
    ev('add_player', { playerId: 'a', name: 'Ana' }),
    ev('add_player', { playerId: 'b', name: 'Bo' }),
    ev('add_player', { playerId: 'c', name: 'Cid' }),
    ev('add_buyin', { playerId: 'a', amount: 500 }),
    ev('add_buyin', { playerId: 'b', amount: 500 }),
    ev('add_buyin', { playerId: 'c', amount: 500 }),
    ev('add_buyin', { playerId: 'a', amount: 500 }),
    ev('set_cashout', { playerId: 'a', amount: 900 }),
    ev('set_cashout', { playerId: 'b', amount: 700 }),
    ev('set_cashout', { playerId: 'c', amount: 400 }),
  ]);
  const rec = reconciliation(s.players);
  assert.equal(rec.in, 2000);
  assert.equal(rec.out, 2000);
  assert.equal(rec.balanced, true);
});

test('fold — settle flips status', () => {
  seq = 0;
  const s = foldEvents(GAME, [
    ev('add_player', { playerId: 'a', name: 'Ana' }),
    ev('settle', {}),
  ]);
  assert.equal(s.status, 'settled');
});

test('toHistoryEntry — produces a syncable settled record', () => {
  seq = 0;
  const folded = foldEvents(GAME, [ev('add_player', { playerId: 'a', name: 'Ana' })]);
  const h = toHistoryEntry(folded);
  assert.equal(h.status, 'settled');
  assert.equal(h.deletedAt, null);
  assert.ok(h.updatedAt > 0);
  assert.equal(h._live, undefined);
});
