import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, uninstallLocalStorage } from './helpers/localstorage.js';
import * as store from '../src/store.js';
import { runMigrations, migrateBackupData, migrateDataV0toV1, purgeOldTombstones, SCHEMA_VERSION } from '../src/migrate.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// a realistic pre-Phase-1 (v0) localStorage
function v0Seed() {
  return {
    'poker.currency': 'EUR',
    'poker.sound': '1',
    'poker.active': JSON.stringify({
      id: 'act1234',
      name: 'Tonight',
      startedAt: 1700000000000,
      defaultBuyIn: 500,
      currency: 'EUR',
      status: 'live',
      players: [
        { id: 'pA', name: 'Ana', buyIns: [{ amount: 500, ts: 1 }], cashOut: null },
        { id: 'pB', name: 'Bo', buyIns: [{ amount: 500, ts: 2 }], cashOut: null },
      ],
      kitty: { label: 'Snacks', total: '400', paidBy: 'pA', entries: { pA: 200, pB: 200 } },
    }),
    'poker.history': JSON.stringify([
      {
        id: 'hist1',
        name: 'Last week',
        startedAt: 1699000000000,
        settledAt: 1699003600000,
        status: 'settled',
        defaultBuyIn: 500,
        players: [{ id: 'x1', name: 'Ana', buyIns: [{ amount: 500, ts: 1 }], cashOut: 900 }],
      },
    ]),
    'poker.roster': JSON.stringify([{ id: 'r1', name: 'Ana', note: 'tight' }]),
    'poker.sessionlog': JSON.stringify([{ id: 1699000000000, date: '2024-11-03', game: 'Home', buyin: 500, cashout: 900, hours: 3, notes: '' }]),
    'poker.structures': JSON.stringify([{ id: 's1', name: 'Turbo', levels: [] }]),
    'poker.customRanges': JSON.stringify([{ id: 'cr1', name: 'BTN', hands: ['AA', 'KK'] }]),
    'poker.quiz': JSON.stringify({ correct: 5, total: 10, wrong: 5, streak: 0 }),
  };
}

function boot(seed) {
  uninstallLocalStorage();
  installLocalStorage({ seed });
  store._resetForTests();
}

const read = (k) => JSON.parse(store.getRaw(k));

test('migrate — v0 → v1 stamps ids, updatedAt, tombstone slots', () => {
  boot(v0Seed());
  const res = runMigrations();
  assert.equal(res.migrated, true);
  assert.equal(store.getRaw('poker.schemaVersion'), String(SCHEMA_VERSION));

  const hist = read('poker.history')[0];
  assert.match(hist.id, UUID_RE);
  assert.equal(hist.legacyId, 'hist1');
  assert.equal(hist.updatedAt, 1699003600000, 'updatedAt from settledAt');
  assert.equal(hist.deletedAt, null);
  assert.match(hist.players[0].id, UUID_RE);
  assert.equal(hist.players[0].legacyId, 'x1');

  const roster = read('poker.roster')[0];
  assert.match(roster.id, UUID_RE);
  assert.equal(roster.legacyId, 'r1');
  assert.equal(roster.deletedAt, null);

  const log = read('poker.sessionlog')[0];
  assert.match(log.id, UUID_RE);
  assert.equal(log.legacyId, 1699000000000);
  assert.equal(log.updatedAt, 1699000000000, 'sessionlog updatedAt from its old Date.now() id');
});

test('migrate — kitty paidBy + entries follow the re-minted player ids', () => {
  boot(v0Seed());
  runMigrations();
  const active = read('poker.active');
  const ana = active.players.find((p) => p.legacyId === 'pA');
  const bo = active.players.find((p) => p.legacyId === 'pB');
  assert.equal(active.kitty.paidBy, ana.id);
  assert.deepEqual(active.kitty.entries, { [ana.id]: 200, [bo.id]: 200 });
});

test('migrate — folds currency + sound into poker.prefs, keeps bare keys', () => {
  boot(v0Seed());
  runMigrations();
  const prefs = read('poker.prefs');
  assert.equal(prefs.currency, 'EUR');
  assert.equal(prefs.sound, true);
  assert.equal(store.getRaw('poker.currency'), 'EUR', 'bare key still present');
  assert.equal(store.getRaw('poker.sound'), '1');
});

test('migrate — writes a v0 rollback snapshot', () => {
  boot(v0Seed());
  runMigrations();
  const snap = JSON.parse(store.getRaw('poker.migration.backup.v0'));
  assert.ok(snap.data['poker.history'], 'snapshot has the pre-migration history');
  assert.match(JSON.parse(snap.data['poker.history'])[0].id, /^hist1$/, 'snapshot is the ORIGINAL shape');
});

test('migrate — idempotent: a second run is a no-op', () => {
  boot(v0Seed());
  runMigrations();
  const after1 = store.getRaw('poker.history');
  const res2 = runMigrations();
  assert.equal(res2.migrated, false);
  assert.equal(store.getRaw('poker.history'), after1, 'history untouched by the second run');
});

test('migrate — an already-v1 store is left alone', () => {
  boot(v0Seed());
  runMigrations();
  const v1History = store.getRaw('poker.history');
  // simulate a fresh boot on the same (now-v1) data
  store._resetForTests();
  const res = runMigrations();
  assert.equal(res.migrated, false);
  assert.equal(store.getRaw('poker.history'), v1History);
});

test('migrateBackupData — brings an old raw-string backup up to v1', () => {
  const raw = {
    'poker.history': JSON.stringify([{ id: 'old1', name: 'G', startedAt: 100, players: [] }]),
    'poker.currency': 'GBP',
  };
  const out = migrateBackupData(raw);
  const h = JSON.parse(out['poker.history'])[0];
  assert.match(h.id, UUID_RE);
  assert.equal(h.legacyId, 'old1');
  assert.equal(out['poker.schemaVersion'], String(SCHEMA_VERSION));
  assert.ok(out['poker.prefs']);
});

test('purgeOldTombstones — drops tombstones older than 90 days, keeps fresh ones', () => {
  const now = Date.now();
  boot({
    'poker.history': JSON.stringify([
      { id: 'a', deletedAt: now - 100 * 86400000, updatedAt: now - 100 * 86400000, players: [] },
      { id: 'b', deletedAt: now - 10 * 86400000, updatedAt: now - 10 * 86400000, players: [] },
      { id: 'c', deletedAt: null, players: [] },
    ]),
  });
  purgeOldTombstones(now);
  const ids = read('poker.history').map((r) => r.id);
  assert.deepEqual(ids, ['b', 'c']);
});

test('teardown', () => uninstallLocalStorage());
