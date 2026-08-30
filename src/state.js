// Session model + localStorage persistence + undo stack. No DOM.

const ACTIVE_KEY = 'poker.active';
const HISTORY_KEY = 'poker.history';
const CURRENCY_KEY = 'poker.currency';
const UNDO_LIMIT = 20;

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
