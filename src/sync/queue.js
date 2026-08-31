// The outbox: which (kind, docId) records have local changes not yet pushed.
// Markers only — the payload is read from the store at push time, so a burst of
// edits to one record collapses to a single push of the final value.
// Persisted to a device-local key so a reload doesn't drop pending changes.
//
// A factory so tests can run several independent outboxes (one per simulated
// device); production passes the real src/store.js module.

import { report } from '../report.js';

const KEY = 'poker.sync.outbox';
const MAX_ATTEMPTS = 8;
const BASE_DELAY = 1000;

const keyOf = (e) => `${e.kind}/${e.docId}`;

function backoff(attempts, rand) {
  const exp = Math.min(attempts, 6);
  return Math.round(BASE_DELAY * 2 ** exp * (0.5 + rand()));
}

export function createQueue(store) {
  const load = () => {
    try {
      const v = JSON.parse(store.getRaw(KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  };
  const save = (list) => store.setRaw(KEY, JSON.stringify(list));

  return {
    /** Mark (kind, docId) dirty. Coalesces to one entry and clears any backoff. */
    enqueue(kind, docId, clientUpdatedAt = 0) {
      const list = load();
      const e = list.find((x) => x.kind === kind && x.docId === String(docId));
      if (e) {
        e.clientUpdatedAt = Math.max(e.clientUpdatedAt || 0, clientUpdatedAt);
        e.attempts = 0;
        e.nextAt = 0;
      } else {
        list.push({ kind, docId: String(docId), clientUpdatedAt, attempts: 0, nextAt: 0 });
      }
      save(list);
    },

    size() {
      return load().length;
    },
    peek() {
      return load();
    },
    clear() {
      save([]);
    },

    /**
     * Flush due entries. `pushEntries(entries)` returns `{ ok: [{kind,docId}] }`
     * for entries it durably handled (applied or superseded), or throws on total
     * failure.
     */
    async drain(pushEntries, { now = Date.now(), rand = Math.random } = {}) {
      const list = load();
      const due = list.filter(
        (e) => (e.nextAt || 0) <= now && (e.attempts || 0) < MAX_ATTEMPTS,
      );
      if (!due.length) return { pushed: 0, remaining: list.length };

      let ok;
      try {
        const res = await pushEntries(due);
        ok = new Set((res && res.ok ? res.ok : []).map((x) => `${x.kind}/${x.docId}`));
      } catch (e) {
        report(e, { kind: 'sync.drain' });
        ok = new Set();
      }

      const dueKeys = new Set(due.map(keyOf));
      const next = [];
      for (const e of load()) {
        const k = keyOf(e);
        if (!dueKeys.has(k)) {
          next.push(e);
          continue;
        }
        if (ok.has(k)) continue; // pushed — drop
        e.attempts = (e.attempts || 0) + 1;
        e.nextAt = now + backoff(e.attempts, rand);
        if (e.attempts >= MAX_ATTEMPTS) {
          report(new Error(`sync: ${k} stuck after ${MAX_ATTEMPTS} attempts`), { kind: 'sync.stuck' });
        }
        next.push(e);
      }
      save(next);
      return { pushed: ok.size, remaining: next.length };
    },
  };
}
