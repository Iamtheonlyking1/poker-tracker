import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, uninstallLocalStorage } from './helpers/localstorage.js';
import * as store from '../src/store.js';
import { shouldShow, isStandalone, isIOS } from '../src/install.js';

function boot(seed) {
  uninstallLocalStorage();
  installLocalStorage({ seed });
  store._resetForTests();
  // node: no navigator/window → isStandalone() false, isIOS() false
}

test('install — no window/navigator → nothing to show', () => {
  boot();
  assert.equal(isStandalone(), false);
  assert.equal(isIOS(), false);
  assert.equal(shouldShow(), false, 'no deferred prompt, not iOS → hidden');
});

test('install — "installed" marker permanently hides the banner', () => {
  boot({ 'poker.install.dismissed': 'installed' });
  assert.equal(shouldShow(), false);
});

test('install — a recent dismissal hides it; an old one does not gate on its own', () => {
  const now = 1_000_000_000_000;
  boot({ 'poker.install.dismissed': String(now - 3 * 86400000) }); // 3 days ago
  assert.equal(shouldShow(now), false, 'dismissed 3d ago → still hidden');

  boot({ 'poker.install.dismissed': String(now - 20 * 86400000) }); // 20 days ago
  // still false in node (no prompt / not iOS) but the dismissal window has passed
  assert.equal(shouldShow(now), false);
});

test('install — poker.install.* is a device key (never synced/backed up)', () => {
  assert.equal(store.isDeviceKey('poker.install.dismissed'), true);
});

test('teardown', () => uninstallLocalStorage());
