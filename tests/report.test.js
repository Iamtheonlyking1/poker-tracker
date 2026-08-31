import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, uninstallLocalStorage } from './helpers/localstorage.js';
import { report, getBuffer, _clearForTests, setToast, storageBytes, checkStoragePressure } from '../src/report.js';

test('report — buffers entries and caps at 50', () => {
  _clearForTests();
  for (let i = 0; i < 70; i++) report(new Error('e' + i));
  const buf = getBuffer();
  assert.equal(buf.length, 50);
  assert.equal(buf[buf.length - 1].message, 'e69');
});

test('report — QuotaExceededError fires the toast hook', () => {
  _clearForTests();
  const msgs = [];
  setToast((m) => msgs.push(m));
  const err = new Error('full');
  err.name = 'QuotaExceededError';
  report(err);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /Storage is full/);
  setToast(null);
});

test('storageBytes / checkStoragePressure — reads the shim', () => {
  installLocalStorage();
  try {
    _clearForTests();
    localStorage.setItem('poker.history', 'x'.repeat(1000));
    assert.ok(storageBytes() >= 2000);
    const { ratio } = checkStoragePressure();
    assert.ok(ratio > 0 && ratio < 0.8);
    assert.equal(getBuffer().length, 0, 'no pressure warning below 80%');
  } finally {
    uninstallLocalStorage();
  }
});
