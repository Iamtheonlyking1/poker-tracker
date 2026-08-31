// Sync orchestration. Local-first: the store stays the working copy; this layer
// pushes local changes up (debounced, via the outbox) and pulls remote changes
// down (on start / resume / realtime), merging with last-write-wins.
//
// Dependency-injected (`store`, `backend`, `deviceId`, `now`) so the whole thing
// runs headless in tests with two engines against one in-memory backend.

import * as merge from './merge.js';
import { createQueue } from './queue.js';
import { report } from '../report.js';

const CURSOR_KEY = 'poker.sync.cursor';
const SHADOW_KEY = 'poker.sync.shadow';
const PUSH_DEBOUNCE_MS = 2000;

// localStorage key <-> documents.kind mapping
const SYNCED = [
  { key: 'poker.history', kind: 'session', list: true, settled: true },
  { key: 'poker.active', kind: 'session', list: false, active: true },
  { key: 'poker.roster', kind: 'roster', list: true },
  { key: 'poker.sessionlog', kind: 'logentry', list: true },
  { key: 'poker.structures', kind: 'structure', list: true },
  { key: 'poker.customRanges', kind: 'range', list: true },
  { key: 'poker.prefs', kind: 'prefs', list: false },
  { key: 'poker.quiz', kind: 'quiz', list: false },
];
const byKey = Object.fromEntries(SYNCED.map((s) => [s.key, s]));
const listKinds = SYNCED.filter((s) => s.list).map((s) => s.kind);

export function createEngine({ backend, store, deviceId, now = () => Date.now() }) {
  const queue = createQueue(store);
  let status = 'off';
  let statusCb = null;
  let conflictCb = null;
  let running = false;
  let unsubStore = null;
  let unsubRealtime = null;
  let pushTimer = null;
  let pulling = null;

  const setStatus = (s) => {
    if (s === status) return;
    status = s;
    if (statusCb) statusCb(s);
  };

  // ---- shadow: {kind: {docId: clientUpdatedAt}} of what we believe is synced
  const loadShadow = () => {
    try {
      return JSON.parse(store.getRaw(SHADOW_KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  };
  const saveShadow = (sh) => store.setRaw(SHADOW_KEY, JSON.stringify(sh));
  const shadowSet = (sh, kind, docId, ts) => {
    (sh[kind] || (sh[kind] = {}))[docId] = ts;
  };

  const readJSON = (key, fallback) => {
    try {
      const raw = store.getRaw(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  };

  // ---- records for one synced store, in client shape ----
  function localRecords(entry) {
    if (entry.list) {
      const arr = readJSON(entry.key, []);
      return Array.isArray(arr) ? arr.filter((r) => r && r.id != null) : [];
    }
    if (entry.active) {
      const s = readJSON(entry.key, null);
      return s && s.id != null ? [s] : [];
    }
    // singleton (prefs / quiz)
    const v = readJSON(entry.key, null);
    return v ? [{ id: 'default', updatedAt: v.updatedAt || 0, ...v }] : [];
  }

  // ---- diff a store against the shadow, enqueue what changed ----
  function scan(entry, sh) {
    const recs = localRecords(entry);
    const known = sh[entry.kind] || {};
    // for the shared session kind, only touch the docs this store owns
    for (const r of recs) {
      if (entry.settled && r.status === 'live') continue;
      if (entry.active && r.status && r.status !== 'live') continue;
      const id = String(r.id);
      const ts = r.updatedAt || 0;
      if (known[id] !== ts) {
        queue.enqueue(entry.kind, id, ts);
        shadowSet(sh, entry.kind, id, ts);
      }
    }
  }

  function scanAll() {
    const sh = loadShadow();
    for (const entry of SYNCED) scan(entry, sh);
    saveShadow(sh);
  }

  // ---- push ----
  async function flush() {
    if (!running) return;
    setStatus('syncing');
    const sh = loadShadow();
    let sawStale = false;
    const res = await queue.drain(
      async (entries) => {
        const docs = [];
        const ok = [];
        for (const e of entries) {
          const doc = docFor(e.kind, e.docId);
          if (!doc) {
            // record no longer in the store (purged tombstone) — nothing to send
            ok.push({ kind: e.kind, docId: e.docId });
            continue;
          }
          docs.push(doc);
        }
        if (!docs.length) return { ok };
        const r = await backend.push(docs);
        for (const a of r.ok || []) {
          ok.push({ kind: a.kind, docId: a.docId });
          if (a.applied === false) sawStale = true;
          else shadowSet(sh, a.kind, a.docId, docClientTs(a.kind, a.docId));
        }
        return { ok };
      },
      { now: now() },
    );
    saveShadow(sh);
    if (sawStale) schedulePull();
    setStatus(queue.size() ? 'error' : 'synced');
    return res;
  }

  function docFor(kind, docId) {
    // find which store owns this kind+id and build a wire doc
    for (const entry of SYNCED.filter((s) => s.kind === kind)) {
      for (const r of localRecords(entry)) {
        if (String(r.id) === String(docId)) {
          if (entry.active || (entry.settled && r.status === 'live')) {
            return merge.recordToDoc(kind, { ...r, status: r.status || 'live' });
          }
          return entry.list
            ? merge.recordToDoc(kind, r)
            : merge.singletonToDoc(kind, stripId(r));
        }
      }
    }
    return null;
  }
  function docClientTs(kind, docId) {
    const d = docFor(kind, docId);
    return d ? d.client_updated_at : 0;
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      flush().catch((e) => report(e, { kind: 'sync.flush' }));
    }, PUSH_DEBOUNCE_MS);
  }

  // ---- pull + merge ----
  function schedulePull() {
    Promise.resolve().then(() => pullAndMerge().catch((e) => report(e, { kind: 'sync.pull' })));
  }

  async function pullAndMerge() {
    if (!running) return;
    if (pulling) return pulling;
    pulling = (async () => {
      setStatus('syncing');
      let out;
      try {
        out = await backend.pull(Number(store.getRaw(CURSOR_KEY) || 0));
      } catch (e) {
        setStatus('offline');
        throw e;
      }
      const sh = loadShadow();
      const remoteByKind = {};
      for (const doc of out.docs) (remoteByKind[doc.kind] || (remoteByKind[doc.kind] = [])).push(doc);

      // list stores
      for (const entry of SYNCED.filter((s) => s.list)) {
        const remoteDocs = (remoteByKind[entry.kind] || []).filter((d) =>
          entry.settled ? (d.data && d.data.status) !== 'live' : true,
        );
        if (!remoteDocs.length) continue;
        applyListMerge(entry, remoteDocs, sh);
      }

      // active session
      const liveRemote = (remoteByKind.session || [])
        .filter((d) => d.data && d.data.status === 'live')
        .sort((a, b) => (b.client_updated_at || 0) - (a.client_updated_at || 0))[0];
      if (liveRemote) applyActiveMerge(liveRemote, sh);

      // singletons
      for (const entry of SYNCED.filter((s) => !s.list && !s.active)) {
        const d = (remoteByKind[entry.kind] || [])[0];
        if (d) applySingletonMerge(entry, d, sh);
      }

      store.setRaw(CURSOR_KEY, String(out.cursor || 0));
      saveShadow(sh);
      setStatus(queue.size() ? 'syncing' : 'synced');
    })();
    try {
      await pulling;
    } finally {
      pulling = null;
    }
  }

  function applyListMerge(entry, remoteDocs, sh) {
    const local = readJSON(entry.key, []);
    const remoteRecs = remoteDocs.map(merge.docToRecord);
    const { merged, changedIds } = merge.mergeList(local, remoteRecs, {
      localDeviceId: deviceId,
      remoteDeviceId: '',
    });
    if (!changedIds.length && merged.length === local.length) {
      for (const r of remoteRecs) shadowSet(sh, entry.kind, String(r.id), r.updatedAt || 0);
      return;
    }
    store.setRaw(entry.key, JSON.stringify(merged), { source: 'remote' });
    for (const r of merged) shadowSet(sh, entry.kind, String(r.id), r.updatedAt || 0);
  }

  function applyActiveMerge(doc, sh) {
    const remote = merge.docToRecord(doc);
    const localActive = readJSON('poker.active', null);
    if (!localActive) {
      store.setRaw('poker.active', JSON.stringify(remote), { source: 'remote' });
      shadowSet(sh, 'session', String(remote.id), remote.updatedAt || 0);
      return;
    }
    if (String(localActive.id) !== String(remote.id)) {
      if (conflictCb) conflictCb({ local: localActive, remote });
      return; // keep local; the UI resolves it
    }
    const { winner } = merge.pickWinner(
      { ...localActive, updatedAt: localActive.updatedAt || 0 },
      remote,
      { localDeviceId: deviceId },
    );
    store.setRaw('poker.active', JSON.stringify(winner), { source: 'remote' });
    shadowSet(sh, 'session', String(remote.id), winner.updatedAt || 0);
  }

  function applySingletonMerge(entry, doc, sh) {
    const local = readJSON(entry.key, null);
    const remote = doc.data || {};
    const { value, source } = merge.mergeSingleton(local, remote, { localDeviceId: deviceId });
    if (source === 'remote') store.setRaw(entry.key, JSON.stringify(value), { source: 'remote' });
    shadowSet(sh, entry.kind, 'default', (value && value.updatedAt) || 0);
  }

  // ---- store change listener ----
  function onStoreChange({ key, source }) {
    if (!running) return;
    if (source === 'remote' || source === 'import') return; // our own write / bulk restore
    if (!byKey[key]) return;
    const sh = loadShadow();
    scan(byKey[key], sh);
    saveShadow(sh);
    if (queue.size()) schedulePush();
  }

  // ---- realtime ----
  function onRealtime() {
    if (running) schedulePull();
  }

  return {
    async start() {
      if (running) return;
      running = true;
      setStatus('syncing');
      unsubStore = store.subscribe(onStoreChange);
      if (backend.subscribe) unsubRealtime = backend.subscribe(onRealtime);
      try {
        await pullAndMerge();
      } catch (e) {
        report(e, { kind: 'sync.start.pull' });
      }
      scanAll(); // enqueue anything local that isn't synced yet
      await flush();
    },
    stop() {
      running = false;
      clearTimeout(pushTimer);
      if (unsubStore) unsubStore();
      if (unsubRealtime) unsubRealtime();
      unsubStore = unsubRealtime = null;
      setStatus('off');
    },
    async resume() {
      if (!running) return;
      await pullAndMerge().catch((e) => report(e, { kind: 'sync.resume' }));
      await flush();
    },
    flush,
    pullNow: pullAndMerge,
    status: () => status,
    onStatus: (fn) => (statusCb = fn),
    onConflict: (fn) => (conflictCb = fn),
    _queue: queue,
  };
}

const stripId = (r) => {
  const { id, ...rest } = r;
  return rest;
};
