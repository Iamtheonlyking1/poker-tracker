import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STRUCTURE_PRESETS,
  PAYOUT_PRESETS,
  prizePool,
  totalChips,
  playersLeft,
  avgStack,
  bustOut,
  reenter,
  addEntry,
  canRebuy,
  startClock,
  gotoLevel,
  levelRemainingMs,
  advanceIfDue,
  pauseClock,
  resumeClock,
  isPaused,
  payouts,
  tournamentNets,
  icmEquities,
  chopByICM,
} from '../src/tournament.js';
import { settle } from '../src/settle.js';
import { tournamentSettleInput } from '../src/tournament.js';

let pid = 0;
function mkT(nPlayers, opts = {}) {
  const s = {
    id: 't1',
    name: 'Sunday',
    startedAt: 0,
    type: 'tournament',
    buyIn: opts.buyIn ?? 1000,
    startStack: opts.startStack ?? 10000,
    structure: STRUCTURE_PRESETS.standard.levels,
    rebuy: opts.rebuy ?? { throughLevel: 4, amount: 1000, stack: 10000 },
    addon: opts.addon ?? null,
    payouts: (opts.payout ?? PAYOUT_PRESETS.top3).rows,
    players: [],
    status: 'live',
  };
  for (let i = 0; i < nPlayers; i++) {
    s.players.push({
      id: 'p' + pid++,
      name: 'P' + i,
      entries: [{ type: 'buyin', amount: s.buyIn, chips: s.startStack, ts: 0 }],
      finish: null,
    });
  }
  return s;
}

test('presets are well formed', () => {
  for (const k of Object.keys(STRUCTURE_PRESETS)) {
    const lv = STRUCTURE_PRESETS[k].levels;
    assert.ok(lv.length > 8);
    for (const l of lv) {
      if (l.break) assert.ok(l.minutes > 0);
      else assert.ok(l.bb > l.sb && l.minutes > 0);
    }
  }
  assert.equal(PAYOUT_PRESETS.top3.rows.reduce((a, r) => a + r.pct, 0), 100);
});

test('pool / chips / avg', () => {
  const s = mkT(6, { buyIn: 1000, startStack: 10000 });
  assert.equal(prizePool(s), 6000);
  assert.equal(totalChips(s), 60000);
  assert.equal(playersLeft(s), 6);
  assert.equal(avgStack(s), 10000);
  addEntry(s, s.players[0].id, 'rebuy');
  assert.equal(prizePool(s), 7000);
  assert.equal(totalChips(s), 70000);
});

test('bust-out records finish in reverse order; last one wins', () => {
  const s = mkT(4);
  bustOut(s, s.players[0].id);
  assert.equal(s.players[0].finish, 4);
  bustOut(s, s.players[1].id);
  assert.equal(s.players[1].finish, 3);
  assert.equal(playersLeft(s), 2);
  bustOut(s, s.players[2].id);
  assert.equal(s.players[2].finish, 2);
  assert.equal(s.players[3].finish, 1); // auto-win
  assert.equal(playersLeft(s), 0);
});

test('re-entry during rebuy period clears finish and adds an entry', () => {
  const s = mkT(4);
  startClock(s);
  assert.ok(canRebuy(s));
  bustOut(s, s.players[0].id);
  assert.equal(s.players[0].finish, 4);
  reenter(s, s.players[0].id);
  assert.equal(s.players[0].finish, null);
  assert.equal(s.players[0].entries.length, 2);
  assert.equal(prizePool(s), 5000);
  gotoLevel(s, 6);
  assert.ok(!canRebuy(s));
});

test('clock: countdown, pause holds, advance rolls over', () => {
  const s = mkT(2);
  startClock(s);
  const lv0 = s.structure[0].minutes * 60000;
  assert.ok(Math.abs(levelRemainingMs(s) - lv0) < 50);
  pauseClock(s);
  assert.ok(isPaused(s));
  const held = levelRemainingMs(s);
  const t0 = Date.now();
  while (Date.now() - t0 < 30) {} // spin ~30ms
  assert.equal(levelRemainingMs(s), held); // frozen while paused
  resumeClock(s);
  assert.ok(!isPaused(s));
  // force it due
  s.clock.levelStartedAt = Date.now() - (lv0 + 1000);
  assert.equal(advanceIfDue(s), true);
  assert.equal(s.clock.levelIdx, 1);
  assert.equal(advanceIfDue(s), false);
});

test('payouts split the pool, remainder to 1st, names attach', () => {
  const s = mkT(3, { buyIn: 1000, payout: PAYOUT_PRESETS.top3 }); // pool 3000
  bustOut(s, s.players[2].id); // 3rd
  bustOut(s, s.players[1].id); // 2nd -> p0 wins
  const pay = payouts(s);
  assert.equal(pay.reduce((a, r) => a + r.amount, 0), 3000);
  assert.equal(pay.find((r) => r.place === 1).amount, 1500);
  assert.equal(pay.find((r) => r.place === 1).name, 'P0');
  assert.equal(pay.find((r) => r.place === 3).name, 'P2');
});

test('tournament settlement reconciles to zero', () => {
  const s = mkT(5, { buyIn: 1000, payout: PAYOUT_PRESETS.top2 }); // pool 5000
  // two rebuys
  addEntry(s, s.players[0].id, 'rebuy');
  addEntry(s, s.players[1].id, 'rebuy');
  // bust order: p4,p3,p2,p1 -> p0 wins
  [4, 3, 2, 1].forEach((i) => bustOut(s, s.players[i].id));
  const nets = tournamentNets(s);
  assert.equal(nets.reduce((a, n) => a + n.net, 0), 0); // zero-sum
  const t = settle(tournamentSettleInput(s));
  const bal = {};
  nets.forEach((n) => (bal[n.name] = n.net));
  t.forEach((x) => { bal[x.from] += x.amount; bal[x.to] -= x.amount; });
  Object.values(bal).forEach((v) => assert.equal(v, 0));
});

test('ICM: sums to prize pool, bigger stack >= smaller', () => {
  const prizes = [500, 300, 200];
  const eq = icmEquities([5000, 3000, 2000], prizes);
  assert.ok(Math.abs(eq.reduce((a, b) => a + b, 0) - 1000) < 0.01);
  assert.ok(eq[0] > eq[1] && eq[1] > eq[2]);
  // equal stacks -> equal equity
  const eq2 = icmEquities([1000, 1000, 1000], prizes);
  assert.ok(Math.abs(eq2[0] - eq2[1]) < 1e-6 && Math.abs(eq2[1] - eq2[2]) < 1e-6);
  // 2-player: proportional-ish, both above 3rd-place floor
  const eq3 = icmEquities([8000, 2000], [700, 300]);
  assert.ok(Math.abs(eq3[0] + eq3[1] - 1000) < 0.01);
  assert.ok(eq3[0] > eq3[1]);
  const chop = chopByICM(['A', 'B'], [8000, 2000], [700, 300]);
  assert.equal(chop[0].amount + chop[1].amount <= 1000 + 1, true);
});
