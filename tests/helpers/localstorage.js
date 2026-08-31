// A Storage-shaped shim for node tests. Node's own --experimental-webstorage
// can't inject a QuotaExceededError, and the failure paths are exactly what
// needs coverage, so we roll our own.

export function installLocalStorage({ quota = Infinity, seed = {} } = {}) {
  const map = new Map(Object.entries(seed).map(([k, v]) => [String(k), String(v)]));

  const store = {
    _quota: quota,
    _map: map,

    get length() {
      return map.size;
    },
    key(i) {
      return [...map.keys()][i] ?? null;
    },
    getItem(k) {
      k = String(k);
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      k = String(k);
      v = String(v);
      let total = k.length + v.length;
      for (const [ek, ev] of map) if (ek !== k) total += ek.length + ev.length;
      if (total > store._quota) {
        const err = new Error(`localStorage quota exceeded (${total} > ${store._quota})`);
        err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(k, v);
    },
    removeItem(k) {
      map.delete(String(k));
    },
    clear() {
      map.clear();
    },
    /** test helper: shrink/grow the quota mid-test */
    _setQuota(n) {
      store._quota = n;
    },
  };

  globalThis.localStorage = store;
  return store;
}

export function uninstallLocalStorage() {
  delete globalThis.localStorage;
}
