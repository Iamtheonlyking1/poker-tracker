// The real backend: maps the sync engine's pull/push onto PostgREST calls.
// Realtime (engine `subscribe`) is a no-op until Phase 3 — the engine's periodic
// pull covers change propagation in the meantime.

import { db, currentUser } from '../supabase.js';

const TABLE = 'documents';

function rowToDoc(row) {
  return {
    kind: row.kind,
    doc_id: row.doc_id,
    data: row.data || {},
    client_updated_at: Number(row.client_updated_at) || 0,
    deleted: !!row.deleted,
    schema_version: row.schema_version || 1,
    updated_at: row.updated_at, // ISO string — the pull cursor
  };
}

function docToRow(doc, userId) {
  return {
    user_id: userId,
    kind: doc.kind,
    doc_id: doc.doc_id,
    data: doc.data || {},
    client_updated_at: doc.client_updated_at || 0,
    deleted: !!doc.deleted,
    schema_version: doc.schema_version || 1,
  };
}

export function createSupabaseBackend() {
  return {
    async pull(cursor) {
      const rows = (await db.selectSince(TABLE, cursor || '')) || [];
      const docs = rows.map(rowToDoc);
      const newCursor = docs.length ? docs[docs.length - 1].updated_at : cursor;
      return { docs, cursor: newCursor };
    },

    async push(docs) {
      const user = currentUser();
      if (!user) throw new Error('sync push: not signed in');
      const rows = docs.map((d) => docToRow(d, user.id));
      const stored = (await db.upsert(TABLE, rows)) || [];
      const byKey = new Map(stored.map((r) => [`${r.kind}/${r.doc_id}`, r]));
      let serverTime = 0;
      const ok = docs.map((d) => {
        const r = byKey.get(`${d.kind}/${d.doc_id}`);
        if (r && r.updated_at) serverTime = Math.max(serverTime, Date.parse(r.updated_at) || 0);
        // reject-stale trigger: if the server row is NEWER than what we sent our
        // write lost — the engine should pull to reconcile.
        const applied = !r || Number(r.client_updated_at) <= (d.client_updated_at || 0);
        return { kind: d.kind, docId: d.doc_id, applied };
      });
      return { ok, serverTime };
    },

    // Phase 3 replaces this with a Realtime subscription.
    subscribe() {
      return () => {};
    },
  };
}
