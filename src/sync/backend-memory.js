// In-memory stand-in for the Supabase backend. Many engine instances can share
// one of these to simulate several devices against one server table. Used only
// by tests; the real adapter is backend-supabase.js.

export function createMemoryBackend({ latency = 0 } = {}) {
  const rows = new Map(); // "kind/doc_id" -> wire doc + server updated_at
  const subs = new Set();
  let serverClock = 0;
  let failPushes = 0;
  let failPulls = 0;

  const wait = () => (latency ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve());
  const stamp = () => ++serverClock;

  return {
    // ---- test knobs ----
    _rows: rows,
    failNextPush(n = 1) {
      failPushes += n;
    },
    failNextPull(n = 1) {
      failPulls += n;
    },
    snapshot() {
      return [...rows.values()].map((r) => ({ ...r }));
    },

    // ---- backend interface ----
    async pull(cursor = 0) {
      await wait();
      if (failPulls > 0) {
        failPulls--;
        throw new Error('memory backend: injected pull failure');
      }
      const docs = [...rows.values()]
        .filter((r) => r.updated_at >= cursor)
        .sort((a, b) => a.updated_at - b.updated_at)
        .map((r) => ({ ...r }));
      const newCursor = docs.length ? docs[docs.length - 1].updated_at : cursor;
      return { docs, cursor: newCursor };
    },

    async push(docs) {
      await wait();
      if (failPushes > 0) {
        failPushes--;
        throw new Error('memory backend: injected push failure');
      }
      const ok = [];
      for (const d of docs) {
        const k = `${d.kind}/${d.doc_id}`;
        const cur = rows.get(k);
        // realistic: the server keeps whichever write has the higher
        // client_updated_at (an "if-newer" upsert). A stale write is accepted
        // as done from the client's view but does not overwrite.
        const applied = !cur || (d.client_updated_at || 0) >= (cur.client_updated_at || 0);
        if (applied) {
          const row = { ...d, updated_at: stamp() };
          rows.set(k, row);
          for (const fn of subs) fn({ ...row });
        }
        ok.push({ kind: d.kind, docId: d.doc_id, applied });
      }
      return { ok, serverTime: serverClock };
    },

    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
