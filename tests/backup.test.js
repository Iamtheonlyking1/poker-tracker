import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, uninstallLocalStorage } from './helpers/localstorage.js';
import * as store from '../src/store.js';
import { exportAll, importAll, summarize } from '../src/backup.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function boot(seed) {
  uninstallLocalStorage();
  installLocalStorage({ seed });
  store._resetForTests();
}

test('backup — exportAll tags format + version 2', () => {
  boot({ 'poker.currency': 'INR', 'poker.history': '[]' });
  const b = exportAll();
  assert.equal(b.format, 'poker-night-backup');
  assert.equal(b.version, 2);
  assert.equal(b.data['poker.currency'], 'INR');
});

test('backup — rejects a non-backup object', () => {
  boot({});
  assert.equal(importAll({ foo: 1 }).ok, false);
  assert.equal(importAll(null).ok, false);
});

test('backup — rejects a file from a newer app version', () => {
  boot({});
  const res = importAll({ format: 'poker-night-backup', version: 99, data: {} });
  assert.equal(res.ok, false);
  assert.match(res.error, /newer version/);
});

test('backup — replace restores stores and migrates an old-shape file', () => {
  boot({});
  const oldFile = {
    format: 'poker-night-backup',
    version: 1,
    data: {
      'poker.history': JSON.stringify([{ id: 'g1', name: 'Old Game', startedAt: 5, players: [] }]),
      'poker.currency': 'JPY',
    },
  };
  const res = importAll(oldFile, { mode: 'replace' });
  assert.equal(res.ok, true);
  const hist = JSON.parse(store.getRaw('poker.history'));
  assert.match(hist[0].id, UUID_RE, 'id migrated to uuid');
  assert.equal(hist[0].legacyId, 'g1');
  assert.equal(store.getRaw('poker.currency'), 'JPY');
  assert.equal(store.getRaw('poker.schemaVersion'), '1');
});

test('backup — merge de-dupes an old-shape file by legacyId (no duplicate)', () => {
  boot({
    'poker.history': JSON.stringify([
      { id: 'uuid-local', legacyId: 'g1', name: 'Local copy', startedAt: 5, updatedAt: 100, deletedAt: null, players: [] },
      { id: 'uuid-only-local', legacyId: 'g2', name: 'Only local', startedAt: 6, updatedAt: 50, deletedAt: null, players: [] },
    ]),
  });
  const file = {
    format: 'poker-night-backup',
    version: 1,
    data: { 'poker.history': JSON.stringify([{ id: 'g1', name: 'Old backup of g1', startedAt: 5, players: [] }]) },
  };
  assert.equal(importAll(file, { mode: 'merge' }).ok, true);
  const hist = JSON.parse(store.getRaw('poker.history'));
  assert.equal(hist.length, 2, 'g1 matched by legacyId, not duplicated');
  assert.ok(hist.some((h) => h.name === 'Only local'), 'local-only record kept');
});

test('backup — merge keeps the more recently updated copy on a collision', () => {
  boot({
    'poker.history': JSON.stringify([
      { id: 'g1', name: 'Local (stale)', startedAt: 5, updatedAt: 100, deletedAt: null, players: [] },
    ]),
  });
  const file = {
    format: 'poker-night-backup',
    version: 2,
    data: { 'poker.history': JSON.stringify([{ id: 'g1', name: 'Backup (fresh)', startedAt: 5, updatedAt: 999, deletedAt: null, players: [] }]) },
  };
  assert.equal(importAll(file, { mode: 'merge' }).ok, true);
  const hist = JSON.parse(store.getRaw('poker.history'));
  assert.equal(hist.length, 1);
  assert.equal(hist[0].name, 'Backup (fresh)');
});

test('backup — summarize ignores tombstones', () => {
  boot({
    'poker.history': JSON.stringify([
      { id: 'a', deletedAt: null, players: [] },
      { id: 'b', deletedAt: Date.now(), players: [] },
    ]),
    'poker.sessionlog': '[]',
    'poker.roster': '[]',
  });
  assert.equal(summarize().games, 1);
});

test('teardown', () => uninstallLocalStorage());
