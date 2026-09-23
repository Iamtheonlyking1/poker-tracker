import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert } from '../src/fxrates.js';

test('convert — same currency both sides is a no-op, no network call', async () => {
  const r = await convert(150, 'INR', 'INR');
  assert.deepEqual(r, { amount: 150, rate: 1 });
});
