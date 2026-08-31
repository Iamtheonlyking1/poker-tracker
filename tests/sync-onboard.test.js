import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFirstSync } from '../src/sync/onboard.js';

function storeWith(obj) {
  const m = new Map(Object.entries(obj));
  return { getRaw: (k) => (m.has(k) ? m.get(k) : null) };
}
const backend = (docs) => ({ pull: async () => ({ docs, cursor: '' }) });

test('classifyFirstSync — nothing either side → clean', async () => {
  assert.equal(await classifyFirstSync(backend([]), storeWith({})), 'clean');
});

test('classifyFirstSync — local data, empty cloud → upload', async () => {
  const store = storeWith({
    'poker.history': JSON.stringify([{ id: 'g1', deletedAt: null }]),
  });
  assert.equal(await classifyFirstSync(backend([]), store), 'upload');
});

test('classifyFirstSync — empty local, cloud has data → download', async () => {
  const store = storeWith({ 'poker.history': '[]' });
  const docs = [{ kind: 'session', deleted: false }];
  assert.equal(await classifyFirstSync(backend(docs), store), 'download');
});

test('classifyFirstSync — data on both sides → choose', async () => {
  const store = storeWith({
    'poker.roster': JSON.stringify([{ id: 'r1', deletedAt: null }]),
  });
  const docs = [{ kind: 'roster', deleted: false }];
  assert.equal(await classifyFirstSync(backend(docs), store), 'choose');
});

test('classifyFirstSync — a tombstone-only local store does not count as data', async () => {
  const store = storeWith({
    'poker.history': JSON.stringify([{ id: 'g1', deletedAt: 123 }]),
  });
  assert.equal(await classifyFirstSync(backend([]), store), 'clean');
});

test('classifyFirstSync — prefs/quiz docs alone in the cloud are not "data"', async () => {
  const store = storeWith({});
  const docs = [{ kind: 'prefs', deleted: false }, { kind: 'quiz', deleted: false }];
  assert.equal(await classifyFirstSync(backend(docs), store), 'clean');
});

test('classifyFirstSync — an active game with players counts as local data', async () => {
  const store = storeWith({
    'poker.active': JSON.stringify({ id: 'a', players: [{ id: 'p', name: 'x' }] }),
  });
  assert.equal(await classifyFirstSync(backend([]), store), 'upload');
});

test('classifyFirstSync — backend offline is treated as empty cloud', async () => {
  const store = storeWith({ 'poker.history': JSON.stringify([{ id: 'g1', deletedAt: null }]) });
  const dead = { pull: async () => { throw new Error('offline'); } };
  assert.equal(await classifyFirstSync(dead, store), 'upload');
});
