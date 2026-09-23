import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, uninstallLocalStorage } from './helpers/localstorage.js';
import * as store from '../src/store.js';
import { loadSessionLog, addSessionLog, updateSessionLog, deleteSessionLog } from '../src/state.js';

function fresh() {
  installLocalStorage();
  store._resetForTests();
}

test('addSessionLog/updateSessionLog/deleteSessionLog — CRUD on the My Sessions log', () => {
  fresh();
  try {
    assert.deepEqual(loadSessionLog(), []);
    let list = addSessionLog({ date: '2026-09-23', game: 'NL50', buyin: 100, cashout: 145, hours: 2, notes: '' });
    assert.equal(list.length, 1);
    const id = list[0].id;
    assert.equal(list[0].buyin, 100);

    // a currency change re-derives the stored (main-currency) amounts
    list = updateSessionLog(id, { buyin: 8300, cashout: 12035, currency: 'INR', origCurrency: 'USD', origBuyin: 100, origCashout: 145, fxRate: 83 });
    assert.equal(list[0].buyin, 8300);
    assert.equal(list[0].origCurrency, 'USD');

    // updating a nonexistent id is a safe no-op
    const before = loadSessionLog();
    updateSessionLog('nope', { buyin: 1 });
    assert.deepEqual(loadSessionLog(), before);

    list = deleteSessionLog(id);
    assert.equal(list.length, 0, 'tombstoned entries are filtered out of the loaded list');
  } finally {
    uninstallLocalStorage();
  }
});
