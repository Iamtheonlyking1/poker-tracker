// Export / import every Poker Night localStorage store as a single JSON file.
// The only recovery path for data that otherwise lives in one browser.

import { STORE_KEYS, rawGet, rawSet } from './state.js';
import { migrateBackupData } from './migrate.js';

const FORMAT = 'poker-night-backup';
const VERSION = 2;
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
  if (obj.version != null && (typeof obj.version !== 'number' || obj.version > VERSION)) {
    return { ok: false, error: 'This backup was made by a newer version of Poker Night. Update the app and try again.' };
  }

  // bring an older file's records up to the current schema (uuid ids, updatedAt,
  // tombstone slots, prefs doc)
  const incoming = migrateBackupData(obj.data);
  const dedupeKey = (item) => (item && (item.legacyId ?? item.id)) ?? null;

  for (const key of STORE_KEYS) {
    if (!(key in incoming)) continue;
    const raw = incoming[key];

    if (mode === 'merge' && (key === 'poker.history' || key === 'poker.sessionlog')) {
      const cur = parseArray(rawGet(key)) || [];
      const next = parseArray(raw) || [];
      const byKey = new Map();
      for (const item of [...cur, ...next]) {
        const k = dedupeKey(item);
        if (k == null) continue;
        const prev = byKey.get(k);
        // keep whichever was updated more recently; a tombstone still wins ties
        if (!prev || (item.updatedAt || 0) >= (prev.updatedAt || 0)) byKey.set(k, item);
      }
      const merged = [...byKey.values()];
      merged.sort((a, b) =>
        key === 'poker.history'
          ? (b.startedAt || 0) - (a.startedAt || 0)
          : (a.updatedAt || 0) - (b.updatedAt || 0),
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
  const count = (key) => (parseArray(rawGet(key)) || []).filter((r) => !(r && r.deletedAt)).length;
  return {
    games: count('poker.history'),
    sessions: count('poker.sessionlog'),
    roster: count('poker.roster'),
    hasActive: rawGet('poker.active') != null,
    lastExportAt: lastExportAt(),
  };
}
