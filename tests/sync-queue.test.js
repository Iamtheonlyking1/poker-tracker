import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../src/sync/queue.js';
import * as store from '../src/store.js';

// a tiny store stub (getRaw/setRaw) — no localStorage needed
function stubStore() {
  const m = new Map();
  return {
    getRaw: (k) => (m.has(k) ? m.get(k) : null),
    setRaw: (k, v) => (v == null ? m.delete(k) : m.set(k, String(v))),
  };
}

test('queue — enqueue coalesces by (kind, docId) and keeps the highest ts', () => {
  const q = createQueue(stubStore());
  q.enqueue('session', 'g1', 100);
  q.enqueue('session', 'g1', 250);
  q.enqueue('roster', 'r1', 5);
  assert.equal(q.size(), 2);
  assert.equal(q.peek().find((e) => e.docId === 'g1').clientUpdatedAt, 250);
});

test('queue — a successful drain empties the outbox', async () => {
  const q = createQueue(stubStore());
  q.enqueue('session', 'g1', 1);
  q.enqueue('session', 'g2', 1);
  const res = await q.drain(async (entries) => ({
    ok: entries.map((e) => ({ kind: e.kind, docId: e.docId })),
  }));
  assert.equal(res.pushed, 2);
  assert.equal(q.size(), 0);
});

test('queue — a failed push backs the entry off and it is not due immediately', async () => {
  const q = createQueue(stubStore());
  q.enqueue('session', 'g1', 1);
  const now = 1_000_000;
  await q.drain(async () => {
    throw new Error('network down');
  }, { now, rand: () => 0.5 });
  assert.equal(q.size(), 1);
  const e = q.peek()[0];
  assert.equal(e.attempts, 1);
  assert.ok(e.nextAt > now);

  const r2 = await q.drain(async () => ({ ok: [{ kind: 'session', docId: 'g1' }] }), { now });
  assert.equal(r2.pushed, 0, 'not due yet');

  const r3 = await q.drain(
    async (entries) => ({ ok: entries.map((x) => ({ kind: x.kind, docId: x.docId })) }),
    { now: e.nextAt + 1 },
  );
  assert.equal(r3.pushed, 1);
  assert.equal(q.size(), 0);
});

test('queue — a fresh enqueue clears a pending backoff', async () => {
  const q = createQueue(stubStore());
  q.enqueue('session', 'g1', 1);
  await q.drain(async () => { throw new Error('down'); }, { now: 1000, rand: () => 0.5 });
  assert.ok(q.peek()[0].nextAt > 1000);
  q.enqueue('session', 'g1', 2);
  assert.equal(q.peek()[0].nextAt, 0);
  assert.equal(q.peek()[0].attempts, 0);
});

test('queue — partial success drops the accepted entries only', async () => {
  const q = createQueue(stubStore());
  q.enqueue('session', 'g1', 1);
  q.enqueue('session', 'g2', 1);
  const res = await q.drain(async () => ({ ok: [{ kind: 'session', docId: 'g1' }] }), { now: 1 });
  assert.equal(res.pushed, 1);
  assert.deepEqual(q.peek().map((e) => e.docId), ['g2']);
});

test('queue — outbox key is device-local', () => {
  assert.equal(store.isDeviceKey('poker.sync.outbox'), true);
});
