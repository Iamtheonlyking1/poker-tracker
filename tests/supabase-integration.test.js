// Wires the real client (src/supabase.js) + PostgREST adapter
// (src/sync/backend-supabase.js) + engine against a mocked fetch that behaves
// like Supabase Auth + PostgREST. Verifies the request shapes and a full
// push/pull round trip without a live project.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, uninstallLocalStorage } from './helpers/localstorage.js';
import * as store from '../src/store.js';
import { setConfig } from '../src/config.js';
import { auth } from '../src/supabase.js';
import { createSupabaseBackend } from '../src/sync/backend-supabase.js';
import { createEngine } from '../src/sync/engine.js';

// a fake Supabase server
function fakeSupabase() {
  const rows = new Map(); // "kind/doc_id" -> row
  let clock = 0;
  const calls = [];

  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers, body: opts.body });
    const u = new URL(url);
    const path = u.pathname;
    const body = opts.body ? JSON.parse(opts.body) : null;

    if (path === '/auth/v1/verify') {
      return json({
        access_token: 'jwt-' + body.email,
        refresh_token: 'refresh-1',
        expires_in: 3600,
        user: { id: 'user-' + body.email, email: body.email },
      });
    }
    if (path === '/auth/v1/user') return json({ id: 'user-x', email: 'x@test.dev' });
    if (path === '/auth/v1/logout') return new Response(null, { status: 204 });

    if (path === '/rest/v1/documents' && (opts.method || 'GET') === 'GET') {
      const gte = u.searchParams.get('updated_at'); // "gte.<n>"
      const cursor = gte ? Number(gte.split('.')[1]) : 0;
      const out = [...rows.values()]
        .filter((r) => r.updated_at >= cursor)
        .sort((a, b) => a.updated_at - b.updated_at);
      return json(out);
    }
    if (path === '/rest/v1/documents' && opts.method === 'POST') {
      const stored = [];
      for (const d of body) {
        const k = `${d.kind}/${d.doc_id}`;
        const cur = rows.get(k);
        if (!cur || d.client_updated_at >= cur.client_updated_at) {
          const row = { ...d, updated_at: ++clock };
          rows.set(k, row);
          stored.push(row);
        } else {
          stored.push(cur); // reject-stale: unchanged row
        }
      }
      return json(stored);
    }
    return new Response('not found', { status: 404 });
  };

  return { rows, calls };
}
const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });

function boot() {
  uninstallLocalStorage();
  installLocalStorage();
  store._resetForTests();
  setConfig('https://fake.supabase.co', 'anon-key-123');
}

test('supabase — verifyOtp stores a session and stamps the apikey header', async () => {
  boot();
  const srv = fakeSupabase();
  const s = await auth.verifyOtp('a@test.dev', '123456');
  assert.equal(s.user.email, 'a@test.dev');
  assert.ok(auth === auth); // sanity
  const verifyCall = srv.calls.find((c) => c.url.includes('/auth/v1/verify'));
  assert.equal(verifyCall.headers.apikey, 'anon-key-123');
});

test('supabase — engine push then pull round-trips a game through PostgREST', async () => {
  boot();
  const srv = fakeSupabase();
  await auth.verifyOtp('h@test.dev', '000000');

  const A = engineStore();
  const eA = createEngine({ backend: createSupabaseBackend(), store: A, deviceId: 'devA', now: () => 1 });
  await eA.start();

  A.setRaw(
    'poker.history',
    JSON.stringify([{ id: 'g1', name: 'Poker Fri', updatedAt: 900, deletedAt: null, status: 'settled', players: [] }]),
  );
  await eA.flush();

  // it reached the "server"
  assert.ok([...srv.rows.keys()].includes('session/g1'));
  const postCall = srv.calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/documents'));
  const sent = JSON.parse(postCall.body)[0];
  assert.equal(sent.user_id, 'user-h@test.dev', 'RLS user_id attached');
  assert.equal(sent.kind, 'session');
  assert.equal(sent.client_updated_at, 900);
  assert.equal(sent.data.name, 'Poker Fri');

  // a second device pulls it
  const B = engineStore();
  const eB = createEngine({ backend: createSupabaseBackend(), store: B, deviceId: 'devB', now: () => 1 });
  await eB.start();
  const histB = JSON.parse(B.getRaw('poker.history'));
  assert.equal(histB[0].name, 'Poker Fri');
  assert.equal(histB[0].updatedAt, 900);
});

test('supabase — a stale write is reported not-applied and triggers a re-pull', async () => {
  boot();
  fakeSupabase();
  await auth.verifyOtp('s@test.dev', '000000');
  const backend = createSupabaseBackend();

  await backend.push([{ kind: 'roster', doc_id: 'r1', data: { name: 'new' }, client_updated_at: 500, deleted: false }]);
  const res = await backend.push([
    { kind: 'roster', doc_id: 'r1', data: { name: 'stale' }, client_updated_at: 200, deleted: false },
  ]);
  assert.equal(res.ok[0].applied, false, 'server kept the newer row');
});

test('teardown', () => {
  uninstallLocalStorage();
  delete globalThis.fetch;
});

function engineStore() {
  const m = new Map();
  const subs = new Set();
  return {
    getRaw: (k) => (m.has(k) ? m.get(k) : null),
    setRaw(k, v, opts = {}) {
      if (v == null) m.delete(k);
      else m.set(k, String(v));
      for (const fn of subs) fn({ key: k, source: opts.source || 'local' });
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
