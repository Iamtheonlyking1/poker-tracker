import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickWinner,
  mergeList,
  recordToDoc,
  docToRecord,
  mergeSingleton,
} from '../src/sync/merge.js';

const rec = (id, updatedAt, extra = {}) => ({ id, updatedAt, deletedAt: null, ...extra });
const tomb = (id, updatedAt) => ({ id, updatedAt, deletedAt: updatedAt });

test('pickWinner — newer updatedAt wins, either direction', () => {
  assert.equal(pickWinner(rec('a', 100), rec('a', 200)).source, 'remote');
  assert.equal(pickWinner(rec('a', 300), rec('a', 200)).source, 'local');
});

test('pickWinner — missing side', () => {
  assert.equal(pickWinner(null, rec('a', 1)).source, 'remote');
  assert.equal(pickWinner(rec('a', 1), null).source, 'local');
});

test('pickWinner — a tombstone beats an edit at the exact same timestamp', () => {
  assert.equal(pickWinner(tomb('a', 500), rec('a', 500)).source, 'local');
  assert.equal(pickWinner(rec('a', 500), tomb('a', 500)).source, 'remote');
});

test('pickWinner — a newer edit still beats an older tombstone (rule 1)', () => {
  assert.equal(pickWinner(tomb('a', 100), rec('a', 200)).source, 'remote');
  assert.equal(pickWinner(rec('a', 200), tomb('a', 100)).source, 'local');
});

test('pickWinner — exact tie, same delete-state → lower deviceId wins, deterministically', () => {
  const a = pickWinner(rec('x', 9), rec('x', 9), { localDeviceId: 'dev-B', remoteDeviceId: 'dev-A' });
  assert.equal(a.source, 'remote');
  // reverse the roles: the other device computes the mirror-image and must agree
  const b = pickWinner(rec('x', 9), rec('x', 9), { localDeviceId: 'dev-A', remoteDeviceId: 'dev-B' });
  assert.equal(b.source, 'local');
});

test('mergeList — union by id, remote wins where newer, changedIds reported', () => {
  const local = [rec('1', 100, { name: 'L1' }), rec('2', 100, { name: 'L2' }), rec('3', 100, { name: 'L3' })];
  const remote = [
    { ...rec('1', 50), name: 'R1' }, // older → local keeps
    { ...rec('2', 200), name: 'R2' }, // newer → remote wins
    { ...rec('4', 10), name: 'R4' }, // new record
  ];
  const { merged, changedIds } = mergeList(local, remote);
  const byId = Object.fromEntries(merged.map((r) => [r.id, r.name]));
  assert.deepEqual(byId, { 1: 'L1', 2: 'R2', 3: 'L3', 4: 'R4' });
  assert.deepEqual(changedIds.sort(), ['2', '4']);
});

test('mergeList — a remote tombstone removes a local record from view', () => {
  const local = [rec('1', 100, { name: 'keep' })];
  const remote = [tomb('1', 200)];
  const { merged, changedIds } = mergeList(local, remote);
  assert.equal(merged[0].deletedAt, 200);
  assert.deepEqual(changedIds, ['1']);
});

test('mergeList — offline edits on both sides converge the same way on both devices', () => {
  // device A edited record 1 at t=300; device B edited it at t=250; both were offline
  const aLocal = [rec('1', 300, { v: 'A' })];
  const bWire = [{ ...rec('1', 250), v: 'B' }];
  const onA = mergeList(aLocal, bWire, { localDeviceId: 'A', remoteDeviceId: 'B' });
  assert.equal(onA.merged[0].v, 'A', 'A keeps its newer edit');

  // now from B's point of view (its local is the t=250 edit, remote is A's t=300)
  const bLocal = [rec('1', 250, { v: 'B' })];
  const aWire = [{ ...rec('1', 300), v: 'A' }];
  const onB = mergeList(bLocal, aWire, { localDeviceId: 'B', remoteDeviceId: 'A' });
  assert.equal(onB.merged[0].v, 'A', 'B also ends up with A’s edit — converged, nothing lost');
});

test('recordToDoc / docToRecord — round trip', () => {
  const r = rec('g1', 1234, { name: 'Friday', deletedAt: null, players: [{ id: 'p', name: 'Ann' }] });
  const doc = recordToDoc('session', r);
  assert.equal(doc.kind, 'session');
  assert.equal(doc.doc_id, 'g1');
  assert.equal(doc.client_updated_at, 1234);
  assert.equal(doc.deleted, false);
  assert.deepEqual(docToRecord(doc), r);
});

test('recordToDoc — tombstone sets deleted:true', () => {
  const doc = recordToDoc('roster', tomb('r1', 900));
  assert.equal(doc.deleted, true);
  assert.equal(docToRecord(doc).deletedAt, 900);
});

test('mergeSingleton — newest updatedAt wins, value has no synthetic id', () => {
  const { value, source } = mergeSingleton(
    { currency: 'INR', updatedAt: 10 },
    { currency: 'USD', updatedAt: 20 },
  );
  assert.equal(source, 'remote');
  assert.equal(value.currency, 'USD');
  assert.ok(!('id' in value));
});
