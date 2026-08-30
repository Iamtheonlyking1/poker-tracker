// Pure settlement logic. No DOM, no storage. Tested in tests/settle.test.js.
// All money is integer units of the session currency.

/** Sum of a player's buy-ins. */
export function totalIn(player) {
  return player.buyIns.reduce((s, b) => s + b.amount, 0);
}

/**
 * Net result for a player: cashOut - totalIn.
 * Returns null if the player has not cashed out yet.
 */
export function net(player) {
  if (player.cashOut === null || player.cashOut === undefined) return null;
  return player.cashOut - totalIn(player);
}

/** Total units put on the table across all players. */
export function potIn(players) {
  return players.reduce((s, p) => s + totalIn(p), 0);
}

/** Total units claimed as ending stacks (players without a cashOut count as 0). */
export function potOut(players) {
  return players.reduce((s, p) => s + (p.cashOut || 0), 0);
}

/**
 * Turn `session.kitty` into `settle()` extras. Each contributor owes their share
 * to whoever fronted the money (`paidBy`); the payer's own share nets out.
 * kitty shape: { label, total, paidBy: playerId, entries: { [playerId]: amount } }
 */
export function kittyExtras(session) {
  const k = session && session.kitty;
  if (!k || !k.paidBy || !k.entries) return [];
  const nameOf = (id) => (session.players.find((p) => p.id === id) || {}).name;
  const payee = nameOf(k.paidBy);
  if (!payee) return [];
  const out = [];
  for (const [pid, amt] of Object.entries(k.entries)) {
    const amount = Math.round(Number(amt) || 0);
    if (amount <= 0 || pid === k.paidBy) continue;
    const from = nameOf(pid);
    if (from) out.push({ from, to: payee, amount });
  }
  return out;
}

export function kittyTotal(session) {
  const k = session && session.kitty;
  if (!k || !k.entries) return 0;
  return Object.values(k.entries).reduce((s, a) => s + (Math.round(Number(a) || 0)), 0);
}

/**
 * Pot reconciliation. delta > 0 means players claimed MORE than was bought in
 * (phantom chips); delta < 0 means chips went missing.
 */
export function reconciliation(players) {
  const inTotal = potIn(players);
  const outTotal = potOut(players);
  const delta = outTotal - inTotal;
  return { in: inTotal, out: outTotal, delta, balanced: delta === 0 };
}

/**
 * Compute who pays whom.
 * Input: players with numeric cashOut set.
 * `extras` — extra debts to fold in before matching, e.g. a shared kitty:
 *   [{ from, to, amount }]  (from owes `amount` to `to`).
 * Output: [{ from, to, amount }] sorted by amount desc, amounts are positive ints.
 *
 * Strategy: net every player (game result ± extras) into a name→balance map,
 * then exact-opposite pairs first (keeps the list readable), then greedy
 * largest-debtor / largest-creditor matching. Produces one minimal combined list.
 */
export function settle(players, extras = []) {
  const bal = {};
  for (const p of players) bal[p.name] = (bal[p.name] || 0) + (net(p) || 0);
  for (const e of extras || []) {
    if (!e || !(e.amount > 0) || e.from === e.to) continue;
    bal[e.from] = (bal[e.from] || 0) - e.amount;
    bal[e.to] = (bal[e.to] || 0) + e.amount;
  }

  let creditors = [];
  let debtors = [];
  for (const [name, amount] of Object.entries(bal)) {
    if (amount > 0) creditors.push({ name, amount });
    else if (amount < 0) debtors.push({ name, amount: -amount });
  }

  const transfers = [];

  // Pass 1: exact matches.
  for (const d of debtors) {
    if (d.amount === 0) continue;
    const c = creditors.find((c) => c.amount === d.amount);
    if (c) {
      transfers.push({ from: d.name, to: c.name, amount: d.amount });
      d.amount = 0;
      c.amount = 0;
    }
  }
  creditors = creditors.filter((c) => c.amount > 0);
  debtors = debtors.filter((d) => d.amount > 0);

  // Pass 2: greedy.
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    if (pay > 0) {
      transfers.push({ from: debtors[i].name, to: creditors[j].name, amount: pay });
      debtors[i].amount -= pay;
      creditors[j].amount -= pay;
    }
    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }

  return transfers.sort((a, b) => b.amount - a.amount);
}
