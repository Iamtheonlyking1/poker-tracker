import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHandKey,
  rfiStatus,
  shoveStatus,
  rangeStatus,
  openerTier,
  comboKey,
  decideAction,
  potOddsPct,
  equityFromOuts,
  evOfCall,
  sprInterp,
  bestHand,
  cmpH,
  runMC,
  cardIndex,
  CANONICAL,
} from '../src/poker.js';

test('normalizeHandKey', () => {
  assert.equal(normalizeHandKey('A', '♠', 'K', '♦').key, 'AKo');
  assert.equal(normalizeHandKey('K', '♦', 'A', '♠').key, 'AKo');
  assert.equal(normalizeHandKey('A', '♠', 'K', '♠').key, 'AKs');
  assert.equal(normalizeHandKey('A', '♠', 'A', '♥').key, 'AA');
  assert.equal(normalizeHandKey('A', '♠', 'A', '♠').ok, false);
  assert.equal(normalizeHandKey('A', '♠', '', '').ok, false);
});

test('CANONICAL has 169 hands', () => {
  assert.equal(CANONICAL.length, 169);
});

test('rfiStatus', () => {
  assert.equal(rfiStatus('BTN', 'AA', 100), 'open');
  assert.equal(rfiStatus('UTG', 'AA', 100), 'open');
  assert.equal(rfiStatus('UTG', '72o', 100), 'fold');
  assert.equal(rfiStatus('BTN', '72o', 100), 'fold');
  assert.equal(rfiStatus('UTG', '44', 100), 'mix'); // UTG_m
  // short stack trims some borderline hands
  assert.equal(rfiStatus('BTN', '53s', 15), 'fold');
  assert.equal(rfiStatus('BTN', 'AA', 15), 'open');
  assert.equal(shoveStatus('BTN', 'AA'), 'shove');
  assert.equal(shoveStatus('UTG', '72o'), 'fold');
});

test('decideAction — RFI', () => {
  assert.equal(decideAction(8, 'BTN', 100, 'RFI', 'AA', true).cls, 'raise');
  assert.equal(decideAction(8, 'UTG', 100, 'RFI', '72o', true).cls, 'fold');
  assert.equal(decideAction(8, 'BB', 100, 'RFI', 'AA', true).cls, 'error');
  // short stack: AA shoves, trash folds
  assert.equal(decideAction(8, 'CO', 10, 'RFI', 'AA', true).cls, 'raise');
  assert.match(decideAction(8, 'CO', 10, 'RFI', 'AA', true).text, /Shove/);
  assert.equal(decideAction(8, 'UTG', 10, 'RFI', '72o', true).cls, 'fold');
});

test('decideAction — vs open / vs 3bet', () => {
  assert.equal(decideAction(8, 'BTN', 100, 'VS_OPEN', 'AA', false).cls, 'raise');
  assert.equal(decideAction(8, 'BTN', 100, 'VS_OPEN', '72o', false).cls, 'fold');
  assert.equal(decideAction(8, 'CO', 100, 'VS_3BET', 'AA', false).cls, 'raise');
  assert.equal(decideAction(8, 'CO', 100, 'VS_3BET', '72o', false).cls, 'fold');
});

test('pot odds / equity / EV', () => {
  // pot 10, bet 5 -> call 5 into total 20 -> 25%
  assert.equal(Math.round(potOddsPct(10, 5)), 25);
  assert.equal(equityFromOuts(9, 'flop'), 36);
  assert.equal(equityFromOuts(9, 'turn'), 18);
  assert.equal(equityFromOuts(30, 'flop'), 100); // capped
  assert.equal(equityFromOuts(0, 'flop'), 0);
  // break-even: equity == pot odds -> EV ~ 0
  assert.ok(Math.abs(evOfCall(10, 5, potOddsPct(10, 5))) < 1e-9);
  assert.ok(evOfCall(10, 5, 50) > 0);
});

test('sprInterp', () => {
  assert.match(sprInterp(0.5).label, /Extremely low/);
  assert.match(sprInterp(6).label, /Medium/);
  assert.equal(sprInterp(6).guide.length, 4);
});

test('hand evaluator ordering', () => {
  const ci = cardIndex;
  const royal = [ci('A', 's'), ci('K', 's'), ci('Q', 's'), ci('J', 's'), ci('T', 's')];
  const pair = [ci('A', 'h'), ci('A', 'd'), ci('K', 'c'), ci('Q', 'h'), ci('J', 'd')];
  const straight = [ci('9', 'h'), ci('8', 'd'), ci('7', 'c'), ci('6', 'h'), ci('5', 's')];
  assert.equal(bestHand(royal)[0], 8); // straight flush
  assert.equal(bestHand(pair)[0], 1);
  assert.equal(bestHand(straight)[0], 4);
  assert.ok(cmpH(bestHand(royal), bestHand(pair)) > 0);
  assert.ok(cmpH(bestHand(straight), bestHand(pair)) > 0);
  // wheel straight
  const wheel = [ci('A', 'h'), ci('2', 'd'), ci('3', 'c'), ci('4', 'h'), ci('5', 's')];
  assert.equal(bestHand(wheel)[0], 4);
});

test('runMC — AA vs random preflop is a big favourite', () => {
  const aa = [cardIndex('A', 's'), cardIndex('A', 'h')];
  const r = runMC(aa, [], 'random', 3000);
  assert.ok(r);
  const hero = parseFloat(r.hero);
  assert.ok(hero > 80 && hero < 90, `AA equity ${hero}`);
});

test('runMC — dominated hand loses', () => {
  const r = runMC([cardIndex('7', 's'), cardIndex('2', 'h')], [], 'premium', 2000);
  assert.ok(r);
  assert.ok(parseFloat(r.hero) < 40);
});

test('comboKey', () => {
  assert.equal(comboKey(cardIndex('A', 's'), cardIndex('K', 's')), 'AKs');
  assert.equal(comboKey(cardIndex('K', 's'), cardIndex('A', 'h')), 'AKo');
  assert.equal(comboKey(cardIndex('A', 's'), cardIndex('A', 'h')), 'AA');
});

test('rangeStatus — rfi / vs open / defend', () => {
  assert.equal(openerTier('UTG'), 'early');
  assert.equal(openerTier('BTN'), 'late');
  // rfi maps open->raise
  assert.equal(rangeStatus('rfi', 'BTN', null, 'AA'), 'raise');
  assert.equal(rangeStatus('rfi', 'UTG', null, '72o'), 'fold');
  // vs open, IP: AA raises, 72o folds, JTs calls vs a late open
  assert.equal(rangeStatus('vsopen', 'BTN', 'CO', 'AA'), 'raise');
  assert.equal(rangeStatus('vsopen', 'BTN', 'CO', '72o'), 'fold');
  assert.equal(rangeStatus('vsopen', 'BTN', 'CO', 'JTs'), 'call');
  // BB defends much wider vs a BTN open than vs UTG
  const wideVsBtn = CANONICAL.filter((k) => rangeStatus('defend', 'BB', 'BTN', k) !== 'fold').length;
  const wideVsUtg = CANONICAL.filter((k) => rangeStatus('defend', 'BB', 'UTG', k) !== 'fold').length;
  assert.ok(wideVsBtn > wideVsUtg);
});

test('runMC — hand vs hand and range vs hand', () => {
  const AA = [cardIndex('A', 's'), cardIndex('A', 'h')];
  const KK = [cardIndex('K', 's'), cardIndex('K', 'h')];
  const r = runMC(AA, [], { villainHand: KK }, 4000);
  assert.ok(r);
  assert.ok(parseFloat(r.hero) > 78 && parseFloat(r.hero) < 86, `AA vs KK ${r.hero}`);
  // hero as a range: 'premium' vs a random hand should be a big favourite
  const r2 = runMC(null, [], { hero: 'premium', villain: 'random' }, 3000);
  assert.ok(parseFloat(r2.hero) > 60);
  // custom Set as villain range
  const set = new Set(['AA', 'KK', 'QQ']);
  const r3 = runMC([cardIndex('A', 'c'), cardIndex('K', 'c')], [], { villain: set }, 3000);
  assert.ok(r3 && parseFloat(r3.hero) < 45); // AKs vs QQ+ is behind
});
