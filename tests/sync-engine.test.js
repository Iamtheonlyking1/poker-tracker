import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/sync/engine.js';
import { createMemoryBackend } from '../src/sync/backend-memory.js';

// a per-device store stub: getRaw / setRaw / subscribe, its own Map
function makeStore() {
  const m = new Map();
  const subs = new Set();
  return {
    getRaw: (k) => (m.has(k) ? m.get(k) : null),
    setRaw(k, v, opts = {}) {
      if (v == null) m.delete(k);
      else m.set(k, String(v));
      for (const fn of subs) fn({ key: k, source: opts.source || 'local' });
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    isDeviceKey: () => false,
  };
}

const settledGame = (id, name, ts) =>
  JSON.stringify([{ id, name, startedAt: 1, updatedAt: ts, deletedAt: null, status: 'settled', players: [] }]);

async function pair(nowA = () => 1000, nowB = () => 1000) {
  const backend = createMemoryBackend();
  const A = makeStore();
  const B = makeStore();
  const eA = createEngine({ backend, store: A, deviceId: 'devA', now: nowA });
  const eB = createEngine({ backend, store: B, deviceId: 'devB', now: nowB });
  await eA.start();
  await eB.start();
  return { backend, A, B, eA, eB };
}

test('two devices — a game created on A shows up on B', async () => {
  const { A, B, eA, eB } = await pair();
  A.setRaw('poker.history', settledGame('g1', 'Friday', 500));
  await eA.flush();
  await eB.pullNow();
  const hist = JSON.parse(B.getRaw('poker.history'));
  assert.equal(hist.length, 1);
  assert.equal(hist[0].name, 'Friday');
});

test('two devices — offline edits to one game converge, newest wins, nothing lost', async () => {
  const { A, B, eA, eB } = await pair();
  A.setRaw('poker.history', settledGame('g1', 'base', 100));
  await eA.flush();
  await eB.pullNow();
  assert.equal(JSON.parse(B.getRaw('poker.history'))[0].name, 'base');

  // both offline, both edit the same game
  A.setRaw('poker.history', settledGame('g1', 'edited-by-A', 300));
  B.setRaw('poker.history', settledGame('g1', 'edited-by-B', 250));

  // reconnect
  await eA.flush();
  await eB.flush(); // B's older write is rejected as stale → triggers a pull
  await eA.pullNow();
  await eB.pullNow();

  const a = JSON.parse(A.getRaw('poker.history'))[0].name;
  const b = JSON.parse(B.getRaw('poker.history'))[0].name;
  assert.equal(a, 'edited-by-A', 'the t=300 edit wins');
  assert.equal(a, b, 'both devices converged on the same value');
});

test('two devices — two different games edited offline: both survive', async () => {
  const { A, B, eA, eB } = await pair();
  A.setRaw('poker.history', settledGame('g1', 'game one', 100));
  await eA.flush();
  await eB.pullNow();

  // A settles a second game while B edits the first — both offline
  A.setRaw(
    'poker.history',
    JSON.stringify([
      { id: 'g1', name: 'game one', updatedAt: 100, deletedAt: null, status: 'settled', players: [] },
      { id: 'g2', name: 'game two', updatedAt: 400, deletedAt: null, status: 'settled', players: [] },
    ]),
  );
  B.setRaw('poker.history', settledGame('g1', 'game one (B tweaked)', 300));

  await eA.flush();
  await eB.flush();
  await eA.pullNow();
  await eB.pullNow();

  for (const store of [A, B]) {
    const byId = Object.fromEntries(JSON.parse(store.getRaw('poker.history')).map((g) => [g.id, g.name]));
    assert.equal(byId.g1, 'game one (B tweaked)', 'B’s newer edit to g1 wins');
    assert.equal(byId.g2, 'game two', 'A’s new g2 is not lost');
  }
});

test('two devices — a delete on A removes the game from B', async () => {
  const { A, B, eA, eB } = await pair();
  A.setRaw('poker.history', settledGame('g1', 'doomed', 100));
  await eA.flush();
  await eB.pullNow();
  assert.equal(JSON.parse(B.getRaw('poker.history')).length, 1);

  // A tombstones it
  A.setRaw(
    'poker.history',
    JSON.stringify([{ id: 'g1', name: 'doomed', updatedAt: 500, deletedAt: 500, status: 'settled', players: [] }]),
  );
  await eA.flush();
  await eB.pullNow();

  const g = JSON.parse(B.getRaw('poker.history'))[0];
  assert.equal(g.deletedAt, 500, 'B now has the tombstone (loadHistory filters it out of the UI)');
});

test('two devices — a live-session id clash is surfaced, not silently resolved', async () => {
  const { A, B, eA, eB } = await pair(() => 1, () => 1);
  A.setRaw(
    'poker.active',
    JSON.stringify({ id: 'gameA', status: 'live', updatedAt: 200, players: [{ id: 'p', name: 'x' }] }),
  );
  await eA.flush();

  let conflict = null;
  eB.onConflict((c) => (conflict = c));
  B.setRaw('poker.active', JSON.stringify({ id: 'gameB', status: 'live', updatedAt: 100, players: [] }));
  await eB.pullNow();

  assert.ok(conflict, 'onConflict fired');
  assert.equal(conflict.local.id, 'gameB');
  assert.equal(conflict.remote.id, 'gameA');
  assert.equal(JSON.parse(B.getRaw('poker.active')).id, 'gameB', 'local active is kept until the user chooses');
});

test('two devices — B adopts A’s live game when B has none', async () => {
  const { A, B, eA, eB } = await pair(() => 1, () => 1);
  A.setRaw(
    'poker.active',
    JSON.stringify({ id: 'gameX', status: 'live', updatedAt: 50, players: [{ id: 'p', name: 'y' }] }),
  );
  await eA.flush();
  await eB.pullNow();
  assert.equal(JSON.parse(B.getRaw('poker.active')).id, 'gameX', 'start on phone, continue on laptop');
});

test('engine — a fresh sign-in uploads existing local data', async () => {
  const backend = createMemoryBackend();
  const A = makeStore();
  A.setRaw('poker.history', settledGame('local1', 'pre-existing', 10));
  const eA = createEngine({ backend, store: A, deviceId: 'devA', now: () => 1 });
  await eA.start(); // pull (empty) → scanAll → flush
  assert.ok(backend.snapshot().some((d) => d.doc_id === 'local1'), 'local game pushed on start');
});

test('engine — push failure leaves the change queued and status error', async () => {
  const backend = createMemoryBackend();
  const A = makeStore();
  const eA = createEngine({ backend, store: A, deviceId: 'devA', now: () => 1 });
  await eA.start();
  backend.failNextPush(1);
  A.setRaw('poker.history', settledGame('g9', 'unlucky', 1));
  await eA.flush();
  assert.equal(eA._queue.size(), 1, 'still queued');
  assert.equal(eA.status(), 'error');
  await eA.flush(); // retry (queue entry backed off — may not be due)
});
