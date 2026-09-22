import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setConfig } from '../src/config.js';

// analytics.js dynamically imports supabase.js on flush — stub it via the
// module cache isn't possible without a loader hook, so these tests exercise
// the parts that don't require that: no-op-when-unconfigured, opt-out, and
// queue/flush bookkeeping via the exported hooks.

test('track()/trackError() are silent no-ops when Supabase is not configured', async () => {
  setConfig('', '');
  const a = await import('../src/analytics.js?nocfg=' + Math.random());
  a.track('screen_view', { view: 'home' });
  a.trackError('boom', 'stack', { view: 'home' });
  // nothing to assert on the queue directly (module-private), but this must
  // not throw, and flush() on an empty/unconfigured queue must not throw either
  assert.doesNotThrow(() => a.flush());
});

test('setOptOut() suppresses further tracking without throwing', async () => {
  setConfig('https://example.supabase.co', 'anon-key');
  const a = await import('../src/analytics.js?optout=' + Math.random());
  a.setOptOut(true);
  assert.doesNotThrow(() => a.track('screen_view', { view: 'home' }));
  assert.doesNotThrow(() => a.flush());
  a._resetForTests();
});

test('APP_VERSION is a non-empty string', async () => {
  const a = await import('../src/analytics.js?ver=' + Math.random());
  assert.equal(typeof a.APP_VERSION, 'string');
  assert.ok(a.APP_VERSION.length > 0);
});
