// Tournament model: blind structures, the level clock, entries / bust-outs,
// and prize-pool math. Pure — no DOM. Session shape:
//
//   { id, name, startedAt, currency, type:'tournament',
//     buyIn, startStack,
//     structure: [{ sb, bb, ante, minutes } | { break:true, minutes }],
//     rebuy:  { throughLevel, amount, stack } | null,
//     addon:  { throughLevel, amount, stack } | null,
//     payouts: [{ place, pct }],
//     players: [{ id, name, entries:[{ type, amount, chips, ts }], finish:null }],
//     clock: { levelIdx, levelStartedAt, pausedElapsed, pausedAt },
//     status: 'live' | 'settled' }

import { uuid } from './id.js';

// ---------- presets ----------

const BLINDS = [
  [25, 50, 0], [50, 100, 0], [75, 150, 0], [100, 200, 25],
  [150, 300, 25], [200, 400, 50], [300, 600, 75], [400, 800, 100],
  [500, 1000, 100], [700, 1400, 200], [1000, 2000, 300], [1500, 3000, 400],
  [2000, 4000, 500], [3000, 6000, 1000], [5000, 10000, 1000],
];

function buildLevels(minutes, count, breakAfter) {
  const lv = [];
  for (let i = 0; i < count; i++) {
    const [sb, bb, ante] = BLINDS[Math.min(i, BLINDS.length - 1)];
    lv.push({ sb, bb, ante, minutes });
    if (breakAfter.includes(i + 1)) lv.push({ break: true, minutes: Math.max(5, Math.round(minutes / 2)) });
  }
  return lv;
}

export const STRUCTURE_PRESETS = {
  turbo: { name: 'Turbo · 10 min', levels: buildLevels(10, 12, [4, 8]) },
  standard: { name: 'Standard · 15 min', levels: buildLevels(15, 14, [5, 10]) },
  deep: { name: 'Deep · 20 min', levels: buildLevels(20, 15, [6, 12]) },
};

export const PAYOUT_PRESETS = {
  wta: { name: 'Winner takes all', rows: [{ place: 1, pct: 100 }] },
  top2: { name: 'Top 2 — 65 / 35', rows: [{ place: 1, pct: 65 }, { place: 2, pct: 35 }] },
  top3: { name: 'Top 3 — 50 / 30 / 20', rows: [{ place: 1, pct: 50 }, { place: 2, pct: 30 }, { place: 3, pct: 20 }] },
  top4: { name: 'Top 4 — 40 / 30 / 20 / 10', rows: [{ place: 1, pct: 40 }, { place: 2, pct: 30 }, { place: 3, pct: 20 }, { place: 4, pct: 10 }] },
};

// ---------- readouts ----------

export function prizePool(s) {
  return (s.players || []).reduce(
    (sum, p) => sum + (p.entries || []).reduce((a, e) => a + (e.amount || 0), 0),
    0,
  );
}

export function totalChips(s) {
  return (s.players || []).reduce(
    (sum, p) => sum + (p.entries || []).reduce((a, e) => a + (e.chips || 0), 0),
    0,
  );
}

export function totalEntries(s) {
  return (s.players || []).reduce((sum, p) => sum + (p.entries || []).length, 0);
}

export function invested(player) {
  return (player.entries || []).reduce((a, e) => a + (e.amount || 0), 0);
}

export function playersLeft(s) {
  return (s.players || []).filter((p) => p.finish == null).length;
}

export function avgStack(s) {
  const left = playersLeft(s);
  return left ? Math.round(totalChips(s) / left) : 0;
}

export function currentLevel(s) {
  return (s.structure || [])[s.clock ? s.clock.levelIdx : 0] || null;
}

export function nextLevel(s) {
  return (s.structure || [])[(s.clock ? s.clock.levelIdx : 0) + 1] || null;
}

/** blind-level number (breaks don't count), or 0 on a break. */
export function levelNumber(s) {
  const idx = s.clock ? s.clock.levelIdx : 0;
  let n = 0;
  for (let i = 0; i <= idx; i++) {
    if (!(s.structure[i] && s.structure[i].break)) n += 1;
  }
  return s.structure[idx] && s.structure[idx].break ? 0 : n;
}

export function levelElapsedMs(s) {
  const c = s.clock;
  if (!c) return 0;
  if (c.pausedAt) return c.pausedElapsed || 0;
  return (c.pausedElapsed || 0) + (Date.now() - c.levelStartedAt);
}

export function levelRemainingMs(s) {
  const lv = currentLevel(s);
  if (!lv) return 0;
  return Math.max(0, lv.minutes * 60000 - levelElapsedMs(s));
}

export function isPaused(s) {
  return !!(s.clock && s.clock.pausedAt);
}

export function canRebuy(s) {
  return !!(s.rebuy && s.clock && s.clock.levelIdx <= s.rebuy.throughLevel);
}
export function canAddon(s) {
  return !!(s.addon && s.clock && s.clock.levelIdx <= s.addon.throughLevel);
}
export function hasAddon(player) {
  return (player.entries || []).some((e) => e.type === 'addon');
}

// ---------- clock mutations ----------

export function startClock(s) {
  s.clock = { levelIdx: 0, levelStartedAt: Date.now(), pausedElapsed: 0, pausedAt: null };
}
export function pauseClock(s) {
  const c = s.clock;
  if (!c || c.pausedAt) return;
  c.pausedElapsed = levelElapsedMs(s);
  c.pausedAt = Date.now();
}
export function resumeClock(s) {
  const c = s.clock;
  if (!c || !c.pausedAt) return;
  c.levelStartedAt = Date.now();
  c.pausedAt = null;
}
export function gotoLevel(s, idx) {
  const c = s.clock;
  if (!c) return;
  c.levelIdx = Math.max(0, Math.min(idx, (s.structure || []).length - 1));
  c.levelStartedAt = Date.now();
  c.pausedElapsed = 0;
}
/** returns true if the level rolled over (caller should re-render + buzz). */
export function advanceIfDue(s) {
  const c = s.clock;
  if (!c || c.pausedAt) return false;
  if (levelRemainingMs(s) > 0) return false;
  if (c.levelIdx >= (s.structure || []).length - 1) return false;
  gotoLevel(s, c.levelIdx + 1);
  return true;
}

// ---------- entries / bust-outs ----------

function entryAmountChips(s, type) {
  if (type === 'addon' && s.addon) return [s.addon.amount, s.addon.stack];
  if (type === 'rebuy' && s.rebuy) return [s.rebuy.amount, s.rebuy.stack];
  return [s.buyIn, s.startStack];
}

export function addEntry(s, playerId, type) {
  const p = s.players.find((x) => x.id === playerId);
  if (!p) return;
  const [amount, chips] = entryAmountChips(s, type);
  p.entries.push({ type, amount, chips, ts: Date.now() });
}

export function bustOut(s, playerId) {
  const p = s.players.find((x) => x.id === playerId);
  if (!p || p.finish != null) return;
  p.finish = playersLeft(s);
  const left = s.players.filter((x) => x.finish == null);
  if (left.length === 1) left[0].finish = 1;
}

export function reenter(s, playerId) {
  const p = s.players.find((x) => x.id === playerId);
  if (!p || p.finish == null) return;
  p.finish = null;
  addEntry(s, playerId, 'rebuy');
}

export function addLatePlayer(s, name) {
  const id = uuid();
  s.players.push({ id, name: name.trim(), entries: [{ type: 'buyin', amount: s.buyIn, chips: s.startStack, ts: Date.now() }], finish: null });
  return id;
}

/** tap a still-in player to place them (for an early chop / declared finish). */
export function setFinish(s, playerId, place) {
  const p = s.players.find((x) => x.id === playerId);
  if (p) p.finish = place;
}

// ---------- prizes ----------

/** [{ place, pct, amount, name }] — remainder rounding goes to 1st. */
export function payouts(s) {
  const pool = prizePool(s);
  const rows = (s.payouts || []).slice().sort((a, b) => a.place - b.place);
  let allocated = 0;
  const out = rows.map((r) => {
    const amount = Math.floor((pool * r.pct) / 100);
    allocated += amount;
    return { place: r.place, pct: r.pct, amount };
  });
  if (out.length) out[0].amount += pool - allocated;
  for (const row of out) {
    const p = s.players.find((x) => x.finish === row.place);
    row.name = p ? p.name : null;
  }
  return out;
}

/** per-player result for settlement: net = prize won − total invested. */
export function tournamentNets(s) {
  const pay = payouts(s);
  return s.players.map((p) => {
    const inv = invested(p);
    const won = (pay.find((r) => r.name === p.name) || {}).amount || 0;
    return { name: p.name, invested: inv, won, finish: p.finish, net: won - inv };
  });
}

/** net per player for a session of EITHER type — safe on cash + tournament. */
export function sessionNets(s) {
  if (s.type === 'tournament') return tournamentNets(s).map((r) => ({ name: r.name, net: r.net }));
  return (s.players || []).map((p) => {
    const inv = (p.buyIns || []).reduce((a, b) => a + (b.amount || 0), 0);
    return { name: p.name, net: p.cashOut == null ? 0 : p.cashOut - inv };
  });
}

/** synthetic players so settle.js can produce the who-pays-whom list. */
export function tournamentSettleInput(s) {
  return tournamentNets(s).map((r) => ({
    name: r.name,
    buyIns: [{ amount: r.invested, ts: 0 }],
    cashOut: r.won,
  }));
}

// ---------- ICM / chop (used by phase 4 too) ----------

/**
 * Malmuth–Harville ICM. stacks: number[]; prizes: number[] (desc, len ≤ stacks).
 * Returns number[] — each stack's expected prize $.
 */
export function icmEquities(stacks, prizes) {
  const n = stacks.length;
  if (!n) return [];
  const P = prizes.slice(0, n);
  while (P.length < n) P.push(0);

  // probability each player finishes in each place, via recursive Harville
  const eq = new Array(n).fill(0);
  const total = stacks.reduce((a, b) => a + b, 0);
  if (total <= 0) return eq;

  // recurse over "who has already been placed"
  function recurse(placedMask, placeIdx, prob) {
    if (placeIdx >= n || prob < 1e-12) return;
    let remaining = 0;
    for (let i = 0; i < n; i++) if (!(placedMask & (1 << i))) remaining += stacks[i];
    if (remaining <= 0) return;
    for (let i = 0; i < n; i++) {
      if (placedMask & (1 << i)) continue;
      const pFinishHere = (stacks[i] / remaining) * prob;
      eq[i] += pFinishHere * P[placeIdx];
      recurse(placedMask | (1 << i), placeIdx + 1, pFinishHere);
    }
  }
  recurse(0, 0, 1);
  return eq;
}

/** chop suggestion: ICM by stacks, but never below the min guaranteed prize. */
export function chopByICM(names, stacks, prizes) {
  const eq = icmEquities(stacks, prizes);
  return names.map((name, i) => ({ name, amount: Math.round(eq[i] || 0) }));
}
