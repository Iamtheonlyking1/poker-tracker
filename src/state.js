// Session model + localStorage persistence + undo stack. No DOM.

const ACTIVE_KEY = 'poker.active';
const HISTORY_KEY = 'poker.history';
const UNDO_LIMIT = 20;

let undoStack = [];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export function newSession({ name, defaultBuyIn }) {
  return {
    id: uid(),
    name: name || 'Poker night',
    startedAt: Date.now(),
    defaultBuyIn: Math.max(1, Math.round(defaultBuyIn || 500)),
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
