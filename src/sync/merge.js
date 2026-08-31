// Pure last-write-wins merge. No I/O, no clock of its own — every input is
// passed in so the whole thing is deterministic and trivially testable.
//
// A "record" is the client shape: { id, updatedAt (ms), deletedAt (ms|null), ...fields }.
// A "doc" is the wire shape:      { kind, doc_id, data, client_updated_at, deleted, schema_version }.

/**
 * Given the local and remote version of one record, decide which to keep.
 * Rules:
 *   - newer `updatedAt` wins;
 *   - on an exact tie, a tombstone beats an edit;
 *   - on an exact tie with the same deleted-state, the lower deviceId wins
 *     (arbitrary but identical on every device, so the outcome converges).
 * A tombstone never loses to an *older* edit — that falls out of rule 1.
 */
export function pickWinner(local, remote, { localDeviceId = '', remoteDeviceId = '' } = {}) {
  if (!local) return { winner: remote, source: 'remote' };
  if (!remote) return { winner: local, source: 'local' };

  const lt = local.updatedAt || 0;
  const rt = remote.updatedAt || 0;
  if (rt > lt) return { winner: remote, source: 'remote' };
  if (lt > rt) return { winner: local, source: 'local' };

  const lDel = local.deletedAt != null;
  const rDel = remote.deletedAt != null;
  if (lDel !== rDel) {
    return lDel ? { winner: local, source: 'local' } : { winner: remote, source: 'remote' };
  }

  if (localDeviceId && remoteDeviceId && String(remoteDeviceId) < String(localDeviceId)) {
    return { winner: remote, source: 'remote' };
  }
  return { winner: local, source: 'local' };
}

/**
 * Merge a local array store with a set of remote records of the same kind.
 * Returns the merged array (tombstones included) and the ids where the remote
 * version won (so the caller knows what changed).
 */
export function mergeList(localArr, remoteArr, opts = {}) {
  const slots = new Map();
  for (const r of localArr || []) {
    if (r && r.id != null) slots.set(String(r.id), { local: r });
  }
  for (const r of remoteArr || []) {
    if (r && r.id != null) {
      const s = slots.get(String(r.id)) || {};
      s.remote = r;
      slots.set(String(r.id), s);
    }
  }

  const merged = [];
  const changedIds = [];
  for (const [id, { local, remote }] of slots) {
    const { winner, source } = pickWinner(local, remote, opts);
    merged.push(winner);
    if (source === 'remote' && winner !== local) changedIds.push(id);
  }
  return { merged, changedIds };
}

// ---- wire <-> client shape ----

export function recordToDoc(kind, rec) {
  const { id, updatedAt, ...data } = rec;
  return {
    kind,
    doc_id: String(id),
    data,
    client_updated_at: updatedAt || 0,
    deleted: data.deletedAt != null,
    schema_version: 1,
  };
}

export function docToRecord(doc) {
  return { id: doc.doc_id, updatedAt: doc.client_updated_at || 0, ...(doc.data || {}) };
}

/** A whole-value singleton store (prefs, quiz) as a doc. */
export function singletonToDoc(kind, value) {
  return {
    kind,
    doc_id: 'default',
    data: value || {},
    client_updated_at: (value && value.updatedAt) || 0,
    deleted: false,
    schema_version: 1,
  };
}

/** Merge two singleton values by their `updatedAt`. */
export function mergeSingleton(local, remote, opts = {}) {
  const l = local ? { id: 'default', updatedAt: local.updatedAt || 0, ...local } : null;
  const r = remote ? { id: 'default', updatedAt: remote.updatedAt || 0, ...remote } : null;
  const { winner, source } = pickWinner(l, r, opts);
  if (!winner) return { value: local || remote || null, source: 'local' };
  const { id, ...value } = winner;
  return { value, source };
}
