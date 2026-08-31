import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, uninstallLocalStorage } from './helpers/localstorage.js';
import * as store from '../src/store.js';

function fresh(seed) {
  uninstallLocalStorage();
  installLocalStorage({ seed });
  store._resetForTests();
}

test('store — getRaw reads the in-memory mirror, hydrated from localStorage', () => {
  fresh({ 'poker.currency': 'EUR', 'poker.sound': '1' });
  assert.equal(store.getRaw('poker.currency'), 'EUR');
  assert.equal(store.getRaw('poker.sound'), '1');
  assert.equal(store.getRaw('missing'), null);
});

test('store — setRaw writes through to localStorage synchronously', () => {
  fresh();
  store.setRaw('poker.currency', 'GBP');
  assert.equal(store.getRaw('poker.currency'), 'GBP', 'mirror');
  assert.equal(localStorage.getItem('poker.currency'), 'GBP', 'persisted immediately');
});

test('store — setRaw(null) deletes', () => {
  fresh({ 'poker.active': '{}' });
  store.setRaw('poker.active', null);
  assert.equal(store.getRaw('poker.active'), null);
  assert.equal(localStorage.getItem('poker.active'), null);
});

test('store — subscribers see local changes with a source tag', () => {
  fresh();
  const seen = [];
  const off = store.subscribe((e) => seen.push(e));
  store.setRaw('poker.roster', '[]');
  assert.deepEqual(seen, [{ key: 'poker.roster', source: 'local' }]);
  off();
  store.setRaw('poker.roster', '[1]');
  assert.equal(seen.length, 1, 'unsubscribed');
});

test('store — a write that hits quota keeps the mirror, reports, and retries on flush()', async () => {
  fresh();
  const { getBuffer, _clearForTests } = await import('../src/report.js');
  _clearForTests();
  localStorage._setQuota(20);
  store.setRaw('poker.history', 'x'.repeat(100));
  assert.ok(getBuffer().some((e) => e.name === 'QuotaExceededError'), 'reported');
  assert.equal(store.getRaw('poker.history'), 'x'.repeat(100), 'mirror still holds the value');
  assert.equal(localStorage.getItem('poker.history'), null, 'not persisted while over quota');
  localStorage._setQuota(Infinity);
  store.flush();
  assert.equal(localStorage.getItem('poker.history'), 'x'.repeat(100), 'retried once quota lifts');
});

test('store — isDeviceKey covers sync + device-local keys', () => {
  assert.equal(store.isDeviceKey('poker.deviceId'), true);
  assert.equal(store.isDeviceKey('poker.lastExport'), true);
  assert.equal(store.isDeviceKey('poker.sync.cursor'), true);
  assert.equal(store.isDeviceKey('sb-xyz-auth-token'), true);
  assert.equal(store.isDeviceKey('poker.history'), false);
  assert.equal(store.isDeviceKey('poker.currency'), false);
});

test('store — teardown', () => {
  uninstallLocalStorage();
});
