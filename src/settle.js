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
 * Output: [{ from, to, amount }] sorted by amount desc, amounts are positive ints.
 *
 * Strategy: exact-opposite pairs first (keeps the list readable), then greedy
 * largest-debtor / largest-creditor matching. Produces <= n-1 transfers.
 */
export function settle(players) {
  const balances = players
    .map((p) => ({ name: p.name, amount: net(p) || 0 }))
    .filter((b) => b.amount !== 0);

  let creditors = balances.filter((b) => b.amount > 0).map((b) => ({ ...b }));
  let debtors = balances
    .filter((b) => b.amount < 0)
    .map((b) => ({ name: b.name, amount: -b.amount }));

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
