// Session model + localStorage persistence + undo stack. No DOM.

const ACTIVE_KEY = 'poker.active';
const HISTORY_KEY = 'poker.history';
const CURRENCY_KEY = 'poker.currency';
const ROSTER_KEY = 'poker.roster';
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
];

const STRUCTURES_KEY = 'poker.structures';

let undoStack = [];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// last currency the user picked, so the next game defaults to it
export function loadCurrencyPref() {
  try {
    return localStorage.getItem(CURRENCY_KEY) || 'INR';
  } catch (e) {
    return 'INR';
  }
}

export function saveCurrencyPref(code) {
  try {
    localStorage.setItem(CURRENCY_KEY, code);
  } catch (e) {}
}

export function newSession({ name, defaultBuyIn, currency }) {
  return {
    id: uid(),
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
    id: uid(),
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
  return readJSON(STRUCTURES_KEY, []);
}

export function saveStructure(name, levels) {
  const list = loadStructures().filter((x) => x.name !== name);
  list.push({ id: uid(), name, levels });
  writeJSON(STRUCTURES_KEY, list);
  return list;
}

export function deleteStructure(id) {
  const list = loadStructures().filter((x) => x.id !== id);
  writeJSON(STRUCTURES_KEY, list);
  return list;
}

export function addTournamentPlayer(session, name) {
  const clean = (name || '').trim();
  if (!clean) return;
  session.players.push({
    id: uid(),
    name: clean,
    entries: [{ type: 'buyin', amount: session.buyIn, chips: session.startStack, ts: Date.now() }],
    finish: null,
  });
}

export function addPlayer(session, name) {
  session.players.push({ id: uid(), name: name.trim(), buyIns: [], cashOut: null });
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
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(session));
  } catch (e) {
    /* private mode / quota - nothing we can do */
  }
}

export function loadActive() {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function clearActive() {
  try {
    localStorage.removeItem(ACTIVE_KEY);
  } catch (e) {}
  undoStack = [];
}

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveToHistory(session) {
  const hist = loadHistory();
  session.status = 'settled';
  session.settledAt = Date.now();
  if (!hist.some((s) => s.id === session.id)) {
    hist.unshift(session);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
    } catch (e) {}
  }
  return hist;
}

export function deleteFromHistory(id) {
  const hist = loadHistory().filter((s) => s.id !== id);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  } catch (e) {}
  return hist;
}

/** Overwrite a saved game (e.g. after ticking off a payment later). */
export function updateHistorySession(session) {
  const hist = loadHistory();
  const i = hist.findIndex((s) => s.id === session.id);
  if (i < 0) return hist;
  hist[i] = session;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  } catch (e) {}
  return hist;
}

// ---- cash-game session ledger (the "My Sessions" tool) ----

const SESSIONLOG_KEY = 'poker.sessionlog';
const QUIZ_KEY = 'poker.quiz';

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function writeJSON(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {}
}

// one-time migration from the standalone toolkit.html keys
function migrate(oldKey, newKey) {
  try {
    if (localStorage.getItem(newKey) == null && localStorage.getItem(oldKey) != null) {
      localStorage.setItem(newKey, localStorage.getItem(oldKey));
    }
  } catch (e) {}
}

export function loadSessionLog() {
  migrate('ptk_sessions', SESSIONLOG_KEY);
  return readJSON(SESSIONLOG_KEY, []);
}

export function addSessionLog(entry) {
  const list = loadSessionLog();
  list.push({ ...entry, id: Date.now() });
  writeJSON(SESSIONLOG_KEY, list);
  return list;
}

export function deleteSessionLog(id) {
  const list = loadSessionLog().filter((s) => s.id !== id);
  writeJSON(SESSIONLOG_KEY, list);
  return list;
}

export function loadQuizScore() {
  migrate('ptk_quiz', QUIZ_KEY);
  return readJSON(QUIZ_KEY, { correct: 0, total: 0, wrong: 0, streak: 0 });
}

export function saveQuizScore(score) {
  writeJSON(QUIZ_KEY, score);
}

// ---- player roster (saved regulars + private notes) ----

export function loadRoster() {
  return readJSON(ROSTER_KEY, []);
}

export function upsertRosterPlayer({ id, name, note }) {
  const list = loadRoster();
  const clean = (name || '').trim();
  if (!clean) return list;
  const existing = id
    ? list.find((r) => r.id === id)
    : list.find((r) => r.name.toLowerCase() === clean.toLowerCase());
  if (existing) {
    existing.name = clean;
    if (note !== undefined) existing.note = note;
  } else {
    list.push({ id: uid(), name: clean, note: note || '' });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  writeJSON(ROSTER_KEY, list);
  return list;
}

export function deleteRosterPlayer(id) {
  const list = loadRoster().filter((r) => r.id !== id);
  writeJSON(ROSTER_KEY, list);
  return list;
}

/** note for a player name, or '' — used to surface notes during a game. */
export function noteFor(name) {
  const clean = (name || '').trim().toLowerCase();
  const hit = loadRoster().find((r) => r.name.toLowerCase() === clean);
  return hit ? hit.note || '' : '';
}

// ---- raw store access (for backup / import) ----

export function rawGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

export function rawSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (e) {}
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
