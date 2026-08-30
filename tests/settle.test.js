import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle, net, totalIn, reconciliation, kittyExtras, kittyTotal } from '../src/settle.js';

let pid = 0;
function p(name, buyIns, cashOut = null) {
  return { id: 'p' + pid++, name, buyIns: buyIns.map((amount) => ({ amount, ts: 0 })), cashOut };
}

// Every transfer list must move each player from their net to zero.
function verify(players, transfers) {
  const bal = {};
  for (const pl of players) bal[pl.name] = net(pl) || 0;
  for (const t of transfers) {
    assert.ok(t.amount > 0, 'transfer amount positive');
    bal[t.from] += t.amount;
    bal[t.to] -= t.amount;
  }
  for (const name of Object.keys(bal)) {
    assert.equal(bal[name], 0, `${name} settled to zero`);
  }
}

test('balanced 4-player session: nets correct, <= n-1 transfers, reconciles', () => {
  const players = [
    p('Rahul', [500, 500], 300), // in 1000, net -700
    p('Ankit', [500], 1700), // in 500, net +1200
    p('Meera', [500, 500], 900), // in 1000, net -100
    p('Sana', [500], 100), // in 500, net -400
  ];
  assert.equal(net(players[0]), -700);
  assert.equal(net(players[1]), 1200);
  assert.equal(totalIn(players[2]), 1000);

  const r = reconciliation(players);
  assert.ok(r.balanced, 'pot balances');

  const t = settle(players);
  assert.ok(t.length <= players.length - 1, 'at most n-1 transfers');
  verify(players, t);
});

test('exact-match pair short-circuits', () => {
  const players = [
    p('A', [1000], 2000), // +1000
    p('B', [1000], 0), // -1000
    p('C', [500], 800), // +300
    p('D', [500], 200), // -300
  ];
  const t = settle(players);
  // Exactly two transfers, each a clean pair.
  assert.equal(t.length, 2);
  assert.deepEqual(
    t.map((x) => x.amount).sort((a, b) => a - b),
    [300, 1000],
  );
  verify(players, t);
});

test('unbalanced pot is flagged, settle does not crash', () => {
  const players = [
    p('A', [1000], 1500), // +500
    p('B', [1000], 700), // -300  -> out 2200 vs in 2000, delta +200 (phantom chips)
  ];
  const r = reconciliation(players);
  assert.equal(r.balanced, false);
  assert.equal(r.delta, 200);
  const t = settle(players);
  assert.ok(Array.isArray(t));
});

test('one big winner vs many losers', () => {
  const players = [
    p('Winner', [1000], 5000), // +4000
    p('L1', [1000], 0),
    p('L2', [1000], 0),
    p('L3', [1000], 0),
    p('L4', [1000], 0),
  ];
  const t = settle(players);
  assert.ok(t.length <= 4);
  verify(players, t);
  assert.ok(t.every((x) => x.to === 'Winner'));
});

test('one big loser vs many winners', () => {
  const players = [
    p('Loser', [5000], 1000), // -4000
    p('W1', [0], 1000),
    p('W2', [0], 1000),
    p('W3', [0], 1000),
    p('W4', [0], 1000),
  ];
  const t = settle(players);
  assert.ok(t.length <= 4);
  verify(players, t);
  assert.ok(t.every((x) => x.from === 'Loser'));
});

test('multiple rebuys and a mid-session joiner', () => {
  const players = [
    p('A', [500, 500, 500], 300), // in 1500, -1200
    p('B', [500], 400), // -100
    p('Late', [1000], 2300), // joined later, in 1000, +1300
  ];
  const r = reconciliation(players);
  assert.ok(r.balanced);
  const t = settle(players);
  assert.ok(t.length <= 2);
  verify(players, t);
});

test('nobody owes anybody when everyone breaks even', () => {
  const players = [p('A', [500], 500), p('B', [500], 500)];
  assert.deepEqual(settle(players), []);
});

// verify with extras folded in
function verifyWithExtras(players, extras, transfers) {
  const bal = {};
  for (const pl of players) bal[pl.name] = net(pl) || 0;
  for (const e of extras) { bal[e.from] -= e.amount; bal[e.to] += e.amount; }
  for (const t of transfers) { bal[t.from] += t.amount; bal[t.to] -= t.amount; }
  for (const name of Object.keys(bal)) assert.equal(bal[name], 0, `${name} settled to zero`);
}

test('settle folds a kitty into one combined minimal list', () => {
  const players = [
    p('Rahul', [500, 500], 300), // -700
    p('Ankit', [500], 1700), //  +1200
    p('Meera', [500, 500], 900), // -100
    p('Sana', [500], 100), // -400
  ];
  // Ankit fronted an ₹800 food bill; split 300/300/200 among Rahul/Sana/Meera
  const kitty = {
    label: 'Pizza',
    paidBy: players[1].id,
    entries: { [players[0].id]: 300, [players[3].id]: 300, [players[2].id]: 200 },
  };
  const extras = kittyExtras({ players, kitty });
  assert.equal(extras.length, 3);
  assert.ok(extras.every((e) => e.to === 'Ankit'));
  assert.equal(kittyTotal({ kitty }), 800);

  const t = settle(players, extras);
  verifyWithExtras(players, extras, t);
  // still minimal — everyone owes Ankit, so <= n-1
  assert.ok(t.length <= 3);
});

test('kitty entry for the payer nets out', () => {
  const players = [p('A', [500], 900), p('B', [500], 100)]; // A +400, B -400
  const kitty = { paidBy: players[0].id, entries: { [players[0].id]: 200, [players[1].id]: 200 } };
  const extras = kittyExtras({ players, kitty });
  assert.equal(extras.length, 1); // only B owes A
  assert.deepEqual(extras[0], { from: 'B', to: 'A', amount: 200 });
  const t = settle(players, extras);
  verifyWithExtras(players, extras, t);
  assert.equal(t.length, 1);
  assert.equal(t[0].amount, 600); // 400 game + 200 kitty, one payment
});

test('kittyExtras returns [] for no/blank kitty', () => {
  const players = [p('A', [500], 500)];
  assert.deepEqual(kittyExtras({ players }), []);
  assert.deepEqual(kittyExtras({ players, kitty: { paidBy: null, entries: {} } }), []);
});
