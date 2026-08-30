// Export / import every Poker Night localStorage store as a single JSON file.
// The only recovery path for data that otherwise lives in one browser.

import { STORE_KEYS, rawGet, rawSet } from './state.js';

const FORMAT = 'poker-night-backup';
const VERSION = 1;
const LAST_EXPORT_KEY = 'poker.lastExport';

/** Snapshot of all stores. Values are kept as their raw JSON strings. */
export function exportAll() {
  const data = {};
  for (const key of STORE_KEYS) {
    const raw = rawGet(key);
    if (raw != null) data[key] = raw;
  }
  return { format: FORMAT, version: VERSION, exportedAt: Date.now(), data };
}

export function exportBlob() {
  return new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' });
}

export function markExported() {
  rawSet(LAST_EXPORT_KEY, String(Date.now()));
}

export function lastExportAt() {
  const raw = rawGet(LAST_EXPORT_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseArray(raw) {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : null;
  } catch (e) {
    return null;
  }
}

/**
 * Restore a backup object.
 *   mode 'replace' — overwrite every store present in the backup
 *   mode 'merge'   — union history + sessionlog by id, otherwise prefer backup
 * Returns { ok, error?, summary }.
 */
export function importAll(obj, { mode = 'replace' } = {}) {
  if (!obj || obj.format !== FORMAT || typeof obj.data !== 'object') {
    return { ok: false, error: 'Not a Poker Night backup file.' };
  }
  const incoming = obj.data;

  for (const key of STORE_KEYS) {
    if (!(key in incoming)) continue;
    const raw = incoming[key];

    if (mode === 'merge' && (key === 'poker.history' || key === 'poker.sessionlog')) {
      const cur = parseArray(rawGet(key)) || [];
      const next = parseArray(raw) || [];
      const byId = new Map();
      for (const item of [...cur, ...next]) {
        if (item && item.id != null) byId.set(item.id, item);
      }
      const merged = [...byId.values()];
      // history is newest-first by startedAt; sessionlog is oldest-first
      merged.sort((a, b) =>
        key === 'poker.history'
          ? (b.startedAt || 0) - (a.startedAt || 0)
          : (a.id || 0) - (b.id || 0),
      );
      rawSet(key, JSON.stringify(merged));
    } else {
      rawSet(key, raw);
    }
  }

  return { ok: true, summary: summarize() };
}

/** Human counts for the Data screen. */
export function summarize() {
  const count = (key) => (parseArray(rawGet(key)) || []).length;
  return {
    games: count('poker.history'),
    sessions: count('poker.sessionlog'),
    roster: count('poker.roster'),
    hasActive: rawGet('poker.active') != null,
    lastExportAt: lastExportAt(),
  };
}
