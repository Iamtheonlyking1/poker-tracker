// Storage schema migrations. Runs once at boot, before anything reads state.
// v0 (pre-accounts) → v1: every syncable record gets a uuid `id` (+ `legacyId`),
// an `updatedAt`, and a `deletedAt` tombstone slot; currency/sound fold into a
// `poker.prefs` doc (the bare keys stay written too, for one release).

import { getRaw, setRaw, keys as storeKeys } from './store.js';
import { uuid } from './id.js';
import { report } from './report.js';

export const SCHEMA_VERSION = 1;
const VERSION_KEY = 'poker.schemaVersion';
const V0_BACKUP_KEY = 'poker.migration.backup.v0';

const readJSON = (key, fallback) => {
  const raw = getRaw(key);
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
};
const writeJSON = (key, val) => setRaw(key, JSON.stringify(val));
const readArr = (key) => {
  const v = readJSON(key, []);
  return Array.isArray(v) ? v : [];
};

/** Stamp a plain record (roster / structure / range). */
function bumpRecord(r) {
  if (!r || typeof r !== 'object') return r;
  if (r.id && isUuid(r.id) && 'updatedAt' in r) return r; // already v1
  return {
    ...r,
    id: uuid(),
    legacyId: r.legacyId ?? r.id,
    updatedAt: r.updatedAt || Date.now(),
    deletedAt: r.deletedAt ?? null,
  };
}

/** Stamp a session (cash or tournament), re-minting player ids and remapping
 *  the few places that reference a player id by value. */
function bumpSession(s) {
  if (!s || typeof s !== 'object') return s;
  if (s.id && isUuid(s.id) && 'updatedAt' in s) return s;

  const idMap = new Map();
  const players = (s.players || []).map((p) => {
    const nid = uuid();
    idMap.set(p.id, nid);
    return { ...p, id: nid, legacyId: p.legacyId ?? p.id };
  });
  const remap = (pid) => idMap.get(pid) || pid;

  let kitty = s.kitty;
  if (kitty && typeof kitty === 'object') {
    kitty = {
      ...kitty,
      paidBy: remap(kitty.paidBy),
      entries: Object.fromEntries(
        Object.entries(kitty.entries || {}).map(([pid, amt]) => [remap(pid), amt]),
      ),
    };
  }
  let chopStacks = s._chopStacks;
  if (chopStacks && typeof chopStacks === 'object') {
    chopStacks = Object.fromEntries(
      Object.entries(chopStacks).map(([pid, v]) => [remap(pid), v]),
    );
  }

  return {
    ...s,
    id: uuid(),
    legacyId: s.legacyId ?? s.id,
    updatedAt: s.updatedAt || s.settledAt || s.startedAt || Date.now(),
    deletedAt: s.deletedAt ?? null,
    players,
    ...(kitty ? { kitty } : {}),
    ...(chopStacks ? { _chopStacks: chopStacks } : {}),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function isUuid(x) {
  return typeof x === 'string' && UUID_RE.test(x);
}

/** Transform every store's parsed value from v0 shape to v1 shape. Pure over its
 *  input map `{ 'poker.history': <parsed>, ... }`; used by both the boot
 *  migration and backup import. */
export function migrateDataV0toV1(data) {
  const out = { ...data };

  if (out['poker.active']) out['poker.active'] = bumpSession(out['poker.active']);
  if (Array.isArray(out['poker.history'])) out['poker.history'] = out['poker.history'].map(bumpSession);
  if (Array.isArray(out['poker.roster'])) out['poker.roster'] = out['poker.roster'].map(bumpRecord);
  if (Array.isArray(out['poker.structures'])) out['poker.structures'] = out['poker.structures'].map(bumpRecord);
  if (Array.isArray(out['poker.customRanges'])) out['poker.customRanges'] = out['poker.customRanges'].map(bumpRecord);

  if (Array.isArray(out['poker.sessionlog'])) {
    out['poker.sessionlog'] = out['poker.sessionlog'].map((e) => {
      if (e && isUuid(e.id) && 'updatedAt' in e) return e;
      return {
        ...e,
        id: uuid(),
        legacyId: e.legacyId ?? e.id,
        updatedAt: typeof e.id === 'number' ? e.id : e.updatedAt || Date.now(),
        deletedAt: e.deletedAt ?? null,
      };
    });
  }

  if (out['poker.quiz'] && typeof out['poker.quiz'] === 'object') {
    out['poker.quiz'] = { ...out['poker.quiz'], updatedAt: out['poker.quiz'].updatedAt || Date.now() };
  }

  // fold currency + sound into a prefs doc (bare keys are kept in sync elsewhere)
  const currency = typeof out['poker.currency'] === 'string' ? out['poker.currency'] : getRaw('poker.currency');
  const sound = typeof out['poker.sound'] === 'string' ? out['poker.sound'] : getRaw('poker.sound');
  out['poker.prefs'] = {
    currency: currency || 'INR',
    sound: sound === '1',
    updatedAt: Date.now(),
  };

  return out;
}

/** Backup-import hook: bring a restored file's raw-string map up to the current
 *  schema. Input/output values are raw JSON strings (backup.js's `data` shape). */
export function migrateBackupData(rawData) {
  const parsed = {};
  for (const [k, raw] of Object.entries(rawData || {})) {
    if (k === 'poker.currency' || k === 'poker.sound' || k === 'poker.schemaVersion') {
      parsed[k] = raw; // bare strings pass through
      continue;
    }
    try {
      parsed[k] = JSON.parse(raw);
    } catch (e) {
      parsed[k] = raw;
    }
  }
  const migrated = migrateDataV0toV1(parsed);
  const outRaw = {};
  for (const [k, v] of Object.entries(migrated)) {
    outRaw[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  outRaw['poker.schemaVersion'] = String(SCHEMA_VERSION);
  return outRaw;
}

/** Run at the very top of boot(). Idempotent. */
export function runMigrations() {
  let current = Number(getRaw(VERSION_KEY) || '0');
  if (!Number.isFinite(current)) current = 0;
  if (current >= SCHEMA_VERSION) return { migrated: false, version: current };

  try {
    if (current < 1) {
      // the only rollback — a raw snapshot of every pre-migration poker.* key
      const snap = { capturedAt: Date.now(), reason: 'pre-v1 migration', data: {} };
      for (const k of storeKeys('poker.')) {
        if (k === V0_BACKUP_KEY || k === VERSION_KEY) continue;
        snap.data[k] = getRaw(k);
      }
      setRaw(V0_BACKUP_KEY, JSON.stringify(snap));

      const data = {
        'poker.active': readJSON('poker.active', null),
        'poker.history': readArr('poker.history'),
        'poker.roster': readArr('poker.roster'),
        'poker.sessionlog': readArr('poker.sessionlog'),
        'poker.structures': readArr('poker.structures'),
        'poker.customRanges': readArr('poker.customRanges'),
        'poker.quiz': readJSON('poker.quiz', null),
        'poker.currency': getRaw('poker.currency') || undefined,
        'poker.sound': getRaw('poker.sound') || undefined,
      };
      const next = migrateDataV0toV1(data);

      if (next['poker.active']) writeJSON('poker.active', next['poker.active']);
      writeJSON('poker.history', next['poker.history']);
      writeJSON('poker.roster', next['poker.roster']);
      writeJSON('poker.sessionlog', next['poker.sessionlog']);
      writeJSON('poker.structures', next['poker.structures']);
      writeJSON('poker.customRanges', next['poker.customRanges']);
      if (next['poker.quiz']) writeJSON('poker.quiz', next['poker.quiz']);
      writeJSON('poker.prefs', next['poker.prefs']);
    }

    setRaw(VERSION_KEY, String(SCHEMA_VERSION));
    return { migrated: true, from: current, to: SCHEMA_VERSION };
  } catch (e) {
    report(e, { kind: 'migration', from: current });
    return { migrated: false, error: String(e), version: current };
  }
}

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

/** Drop tombstones the user hasn't seen in 90 days. Cheap; call on boot. */
export function purgeOldTombstones(now = Date.now()) {
  for (const key of ['poker.history', 'poker.roster', 'poker.sessionlog', 'poker.structures', 'poker.customRanges']) {
    const list = readArr(key);
    const kept = list.filter((r) => !(r && r.deletedAt && now - r.deletedAt > NINETY_DAYS));
    if (kept.length !== list.length) writeJSON(key, kept);
  }
}
