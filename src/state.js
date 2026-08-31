// Session model + persistence + undo stack. No DOM.
// All storage goes through src/store.js (in-memory mirror + write-through +
// change events). This module keeps the same synchronous API it always had.

import { uuid } from './id.js';
import { getRaw, setRaw } from './store.js';

const ACTIVE_KEY = 'poker.active';
const HISTORY_KEY = 'poker.history';
const CURRENCY_KEY = 'poker.currency';
const ROSTER_KEY = 'poker.roster';
const PREFS_KEY = 'poker.prefs';
const UNDO_LIMIT = 20;

// Every persisted key, for backup/export. Keep this in sync when adding stores.
export const STORE_KEYS = [
  'poker.active',
  'poker.history',
  'poker.currency',
  'poker.roster',
  'poker.sessionlog',
  'poker.quiz',
  'poker.structures',
  'poker.customRanges',
  'poker.sound',
  'poker.prefs',
  'poker.schemaVersion',
];

const STRUCTURES_KEY = 'poker.structures';
const CUSTOMRANGES_KEY = 'poker.customRanges';

let undoStack = [];

// currency + sound live in one `poker.prefs` doc (so Phase 2 syncs them as a
// single record); the bare `poker.currency` / `poker.sound` keys are kept
// written too for one release, so an old backup still imports and a rollback
// doesn't lose the setting.
function loadPrefs() {
  const raw = getRaw(PREFS_KEY);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}
function patchPrefs(patch) {
  setRaw(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch, updatedAt: Date.now() }));
}

// last currency the user picked, so the next game defaults to it
export function loadCurrencyPref() {
  const p = loadPrefs();
  if (typeof p.currency === 'string' && p.currency) return p.currency;
  return getRaw(CURRENCY_KEY) || 'INR';
}

export function saveCurrencyPref(code) {
  setRaw(CURRENCY_KEY, code);
  patchPrefs({ currency: code });
}

export function newSession({ name, defaultBuyIn, currency }) {
  return {
    id: uuid(),
    name: name || 'Poker night',
    startedAt: Date.now(),
    defaultBuyIn: Math.max(1, Math.round(defaultBuyIn || 500)),
    currency: currency || loadCurrencyPref(),
    players: [],
    status: 'live', // 'live' | 'settled'
  };
}

export function newTournament({ name, currency, buyIn, startStack, structure, payouts, rebuy, addon }) {
  return {
    id: uuid(),
    name: name || 'Tournament',
    startedAt: Date.now(),
    currency: currency || loadCurrencyPref(),
    type: 'tournament',
    buyIn: Math.max(1, Math.round(buyIn || 500)),
    startStack: Math.max(1, Math.round(startStack || 10000)),
    structure: structure || [],
    payouts: payouts || [{ place: 1, pct: 100 }],
    rebuy: rebuy || null,
    addon: addon || null,
    players: [],
    clock: null,
    status: 'live',
  };
}

// ---- saved blind structures ----

export function loadStructures() {
  return readJSON(STRUCTURES_KEY, []).filter(notDeleted);
}

export function saveStructure(name, levels) {
  const list = readJSON(STRUCTURES_KEY, []).filter((x) => x.name !== name);
  list.push({ id: uuid(), name, levels, updatedAt: Date.now(), deletedAt: null });
  writeJSON(STRUCTURES_KEY, list);
  return list.filter(notDeleted);
}

export function deleteStructure(id) {
  return tombstone(STRUCTURES_KEY, id);
}

// ---- saved custom ranges (list of hand keys) ----

export function loadCustomRanges() {
  return readJSON(CUSTOMRANGES_KEY, []).filter(notDeleted);
}

export function saveCustomRange(name, hands) {
  const list = readJSON(CUSTOMRANGES_KEY, []).filter((x) => x.name !== name);
  list.push({ id: uuid(), name, hands: [...hands], updatedAt: Date.now(), deletedAt: null });
  list.sort((a, b) => a.name.localeCompare(b.name));
  writeJSON(CUSTOMRANGES_KEY, list);
  return list.filter(notDeleted);
}

export function deleteCustomRange(id) {
  return tombstone(CUSTOMRANGES_KEY, id);
}

export function addTournamentPlayer(session, name) {
  const clean = (name || '').trim();
  if (!clean) return;
  session.players.push({
    id: uuid(),
    name: clean,
    entries: [{ type: 'buyin', amount: session.buyIn, chips: session.startStack, ts: Date.now() }],
    finish: null,
  });
}

export function addPlayer(session, name) {
  session.players.push({ id: uuid(), name: name.trim(), buyIns: [], cashOut: null });
}

export function removePlayer(session, playerId) {
  session.players = session.players.filter((p) => p.id !== playerId);
}

export function renamePlayer(session, playerId, name) {
  const p = session.players.find((x) => x.id === playerId);
  if (p && name.trim()) p.name = name.trim();
}

// One rebuy at the default amount for every player at once.
export function rebuyAll(session) {
  const ts = Date.now();
  session.players.forEach((p) => p.buyIns.push({ amount: session.defaultBuyIn, ts }));
}

export function addBuyIn(session, playerId, amount) {
  const p = session.players.find((x) => x.id === playerId);
  if (!p) return;
  p.buyIns.push({ amount: Math.max(1, Math.round(amount)), ts: Date.now() });
}

export function undoLastBuyIn(session, playerId) {
  const p = session.players.find((x) => x.id === playerId);
  if (p && p.buyIns.length) p.buyIns.pop();
}

export function setCashOut(session, playerId, amount) {
  const p = session.players.find((x) => x.id === playerId);
  if (!p) return;
  p.cashOut = amount === null || amount === '' ? null : Math.max(0, Math.round(amount));
}

// ---- persistence ----

export function save(session) {
  if (session) session.updatedAt = Date.now();
  setRaw(ACTIVE_KEY, JSON.stringify(session));
}

export function loadActive() {
  const raw = getRaw(ACTIVE_KEY);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function clearActive() {
  setRaw(ACTIVE_KEY, null, { immediate: true });
  undoStack = [];
}

// full list including tombstones — for mutations that must not resurrect a
// deleted game or add a duplicate
function allHistory() {
  const raw = getRaw(HISTORY_KEY);
  try {
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function loadHistory() {
  return allHistory().filter(notDeleted);
}

export function saveToHistory(session) {
  const hist = allHistory();
  session.status = 'settled';
  session.settledAt = Date.now();
  session.updatedAt = Date.now();
  if (!hist.some((s) => s.id === session.id)) {
    hist.unshift(session);
    setRaw(HISTORY_KEY, JSON.stringify(hist));
  }
  return hist.filter(notDeleted);
}

export function deleteFromHistory(id) {
  return tombstone(HISTORY_KEY, id);
}

/** Overwrite a saved game (e.g. after ticking off a payment later). */
export function updateHistorySession(session) {
  const hist = allHistory();
  const i = hist.findIndex((s) => s.id === session.id);
  if (i < 0) return hist.filter(notDeleted);
  session.updatedAt = Date.now();
  hist[i] = session;
  setRaw(HISTORY_KEY, JSON.stringify(hist));
  return hist.filter(notDeleted);
}

// ---- cash-game session ledger (the "My Sessions" tool) ----

const SESSIONLOG_KEY = 'poker.sessionlog';
const QUIZ_KEY = 'poker.quiz';

function readJSON(key, fallback) {
  const raw = getRaw(key);
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function writeJSON(key, val) {
  setRaw(key, JSON.stringify(val));
}

// ---- soft deletes ----
// Deleting a record marks it rather than dropping it, so a device that pulls
// after a delete elsewhere doesn't resurrect it. Loaders filter tombstones;
// migrate.js purges ones older than 90 days on boot.
const notDeleted = (r) => !(r && r.deletedAt);

function tombstone(key, id) {
  const list = readJSON(key, []);
  const now = Date.now();
  let hit = false;
  for (const r of list) {
    if (r && r.id === id && !r.deletedAt) {
      r.deletedAt = now;
      r.updatedAt = now;
      hit = true;
    }
  }
  if (hit) writeJSON(key, list);
  return list.filter(notDeleted);
}

// one-time migration from the standalone toolkit.html keys
function migrate(oldKey, newKey) {
  if (getRaw(newKey) == null && getRaw(oldKey) != null) {
    setRaw(newKey, getRaw(oldKey));
  }
}

export function loadSessionLog() {
  migrate('ptk_sessions', SESSIONLOG_KEY);
  return readJSON(SESSIONLOG_KEY, []).filter(notDeleted);
}

export function addSessionLog(entry) {
  const list = readJSON(SESSIONLOG_KEY, []);
  const now = Date.now();
  list.push({ ...entry, id: uuid(), updatedAt: now, deletedAt: null });
  writeJSON(SESSIONLOG_KEY, list);
  return list.filter(notDeleted);
}

export function deleteSessionLog(id) {
  return tombstone(SESSIONLOG_KEY, id);
}

export function loadQuizScore() {
  migrate('ptk_quiz', QUIZ_KEY);
  return readJSON(QUIZ_KEY, { correct: 0, total: 0, wrong: 0, streak: 0 });
}

export function saveQuizScore(score) {
  writeJSON(QUIZ_KEY, { ...score, updatedAt: Date.now() });
}

// ---- player roster (saved regulars + private notes) ----

export function loadRoster() {
  return readJSON(ROSTER_KEY, []).filter(notDeleted);
}

export function upsertRosterPlayer({ id, name, note }) {
  const list = readJSON(ROSTER_KEY, []);
  const clean = (name || '').trim();
  if (!clean) return list.filter(notDeleted);
  const existing = id
    ? list.find((r) => r.id === id)
    : list.find((r) => r.name.toLowerCase() === clean.toLowerCase());
  if (existing) {
    existing.name = clean;
    if (note !== undefined) existing.note = note;
    existing.deletedAt = null; // re-adding a name resurrects its note
    existing.updatedAt = Date.now();
  } else {
    list.push({ id: uuid(), name: clean, note: note || '', updatedAt: Date.now(), deletedAt: null });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  writeJSON(ROSTER_KEY, list);
  return list.filter(notDeleted);
}

export function deleteRosterPlayer(id) {
  return tombstone(ROSTER_KEY, id);
}

/** note for a player name, or '' — used to surface notes during a game. */
export function noteFor(name) {
  const clean = (name || '').trim().toLowerCase();
  const hit = loadRoster().find((r) => r.name.toLowerCase() === clean);
  return hit ? hit.note || '' : '';
}

// ---- sound preference (off by default) ----

const SOUND_KEY = 'poker.sound';

export function loadSoundOn() {
  const p = loadPrefs();
  if (typeof p.sound === 'boolean') return p.sound;
  return getRaw(SOUND_KEY) === '1';
}

export function saveSoundOn(on) {
  setRaw(SOUND_KEY, on ? '1' : '0');
  patchPrefs({ sound: !!on });
}

// ---- raw store access (for backup / import) ----

export function rawGet(key) {
  return getRaw(key);
}

export function rawSet(key, value) {
  setRaw(key, value, { immediate: true });
}

// ---- undo ----

export function pushUndo(session) {
  undoStack.push(JSON.stringify(session));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

export function canUndo() {
  return undoStack.length > 0;
}

export function popUndo() {
  if (!undoStack.length) return null;
  return JSON.parse(undoStack.pop());
}
