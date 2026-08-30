// Pure poker logic + data. No DOM. Transcribed from the original toolkit.
// Covers: preflop opening ranges, a rules-based action advisor, pot-odds / SPR
// math, and a Monte-Carlo equity engine with a 7-card hand evaluator.

export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
export const SUITS = ['♠', '♥', '♦', '♣'];
export const rankIndex = Object.fromEntries(RANKS.map((r, i) => [r, i]));
export const BASE_POSITIONS = ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB'];

// all 169 canonical hands (pairs, suited, offsuit)
export const CANONICAL = (() => {
  const out = [];
  for (let i = 0; i < 13; i++)
    for (let j = 0; j < 13; j++) {
      if (i < j) out.push(RANKS[i] + RANKS[j] + 's');
      else if (i > j) out.push(RANKS[j] + RANKS[i] + 'o');
      else out.push(RANKS[i] + RANKS[i]);
    }
  return [...new Set(out)];
})();

// upper-right = suited, lower-left = offsuit, diagonal = pairs
export function handKey(i, j) {
  const r1 = RANKS[i];
  const r2 = RANKS[j];
  if (i === j) return r1 + r2;
  return (i < j ? r1 : r2) + (i < j ? r2 : r1) + (i < j ? 's' : 'o');
}

// ---------- 8-max RFI opening ranges (by position bucket) ----------

const S = (...x) => new Set(x);

export const ranges8_RFI = {
  UTG: S('AA','KK','QQ','JJ','TT','99','88','77','66','55','AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','KQs','KJs','KTs','QJs','QTs','JTs','T9s','AKo','AQo','KQo'),
  UTG_m: S('44','A4s','A3s','A2s','AJo','KJo','98s','87s'),
  UTG1: S('AA','KK','QQ','JJ','TT','99','88','77','66','55','AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s','KQs','KJs','KTs','K9s','QJs','QTs','JTs','T9s','98s','AKo','AQo','AJo','ATo','KQo','KJo'),
  UTG1_m: S('44','33','87s','KTo','QTo','QJo','JTo'),
  LJ: S('AA','KK','QQ','JJ','TT','99','88','77','66','55','44','AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s','KQs','KJs','KTs','K9s','K8s','QJs','QTs','Q9s','JTs','J9s','T9s','98s','87s','76s','AKo','AQo','AJo','ATo','A9o','KQo','KJo','QJo','JTo','KTo'),
  LJ_m: S('33','22','A5o','K9o','QTo','T9o','98o'),
  HJ: S('AA','KK','QQ','JJ','TT','99','88','77','66','55','44','33','AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s','KQs','KJs','KTs','K9s','K8s','K7s','QJs','QTs','Q9s','Q8s','JTs','J9s','T9s','T8s','98s','97s','87s','86s','76s','65s','AKo','AQo','AJo','ATo','A9o','A8o','KQo','KJo','QJo','JTo','KTo','QTo','T9o'),
  HJ_m: S('22','K6s','Q7s','J8s','98o','87o'),
  CO: S('AA','KK','QQ','JJ','TT','99','88','77','66','55','44','33','22','AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s','KQs','KJs','KTs','K9s','K8s','K7s','K6s','QJs','QTs','Q9s','Q8s','Q7s','JTs','J9s','J8s','T9s','T8s','T7s','98s','97s','96s','87s','86s','85s','76s','75s','65s','64s','54s','AKo','AQo','AJo','ATo','A9o','A8o','A7o','KQo','KJo','QJo','JTo','KTo','QTo','T9o','98o','87o'),
  CO_m: S('K5s','Q6s','J7s','K9o','Q9o','J9o'),
  BTN: S('AA','KK','QQ','JJ','TT','99','88','77','66','55','44','33','22','AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s','KQs','KJs','KTs','K9s','K8s','K7s','K6s','K5s','K4s','K3s','QJs','QTs','Q9s','Q8s','Q7s','Q6s','JTs','J9s','J8s','J7s','T9s','T8s','T7s','T6s','98s','97s','96s','95s','87s','86s','85s','84s','76s','75s','74s','65s','64s','63s','54s','53s','AKo','AQo','AJo','ATo','A9o','A8o','A7o','A6o','A5o','KQo','KJo','QJo','JTo','KTo','QTo','T9o','98o','97o','87o','86o'),
  BTN_m: S('K2s','Q5s','J6s','T5s','K9o','Q9o','J9o','T8o'),
  SB: S('AA','KK','QQ','JJ','TT','99','88','77','66','55','44','33','AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s','KQs','KJs','KTs','K9s','K8s','K7s','QJs','QTs','Q9s','Q8s','JTs','J9s','J8s','T9s','T8s','98s','97s','87s','86s','76s','75s','65s','64s','54s','AKo','AQo','AJo','ATo','A9o','A8o','KQo','KJo','QJo','JTo','KTo','QTo','T9o','98o'),
  SB_m: S('22','K6s','Q7s','J7s','96s','85s','A7o','K9o','Q9o'),
  BB: S('AA','KK','QQ','JJ','TT','99','88','77','66','55','44','AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s','KQs','KJs','KTs','K9s','K8s','QJs','QTs','Q9s','JTs','J9s','T9s','T8s','98s','87s','76s','65s','54s','AKo','AQo','AJo','ATo','A9o','KQo','KJo','QJo','JTo','KTo','QTo','T9o'),
  BB_m: S('33','22','K7s','Q8s','J8s','97s','86s','75s','64s','A8o','K9o','Q9o','98o'),
};

// hands trimmed from the range at ≤20 BB
const SHORT_TRIM = S('53s','63s','74s','84s','95s','T6s','97o','86o','87o','98o','T8o','T9o','J9o','Q9o','K9o','A5o','A6o','A7o');

export const SB_LIMP = S('22','33','44','55','A2s','A3s','A4s','A5s','A6s','K2s','K3s','K4s','K5s','K6s','K7s','K8s','Q6s','Q7s','Q8s','J7s','J8s','T7s','T8s','97s','98s','86s','87s','75s','76s','64s','65s','54s');

export const SHOVE10 = {
  UTG: S('55','66','77','88','99','TT','JJ','QQ','KK','AA','ATo','AJo','AQo','AKo','A8s','A9s','ATs','AJs','AQs','AKs','KQs','KJs','QJs'),
  UTG1: S('44','55','66','77','88','99','TT','JJ','QQ','KK','AA','A9o','ATo','AJo','AQo','AKo','A5s','A6s','A7s','A8s','A9s','ATs','AJs','AQs','AKs','KQo','KQs','KJs','KTs','QJs','QTs','JTs'),
  LJ: S('22','33','44','55','66','77','88','99','TT','JJ','QQ','KK','AA','A8o','A9o','ATo','AJo','AQo','AKo','A2s','A3s','A4s','A5s','A6s','A7s','A8s','A9s','ATs','AJs','AQs','AKs','KTo','KJo','KQo','K2s','K3s','K4s','K5s','K6s','K7s','K8s','K9s','KTs','KJs','KQs','QTo','QJo','Q2s','Q3s','Q4s','Q5s','Q6s','Q7s','Q8s','Q9s','QTs','QJs','JTs','T9s','98s'),
  HJ: S('22','33','44','55','66','77','88','99','TT','JJ','QQ','KK','AA','A5o','A6o','A7o','A8o','A9o','ATo','AJo','AQo','AKo','A2s','A3s','A4s','A5s','A6s','A7s','A8s','A9s','ATs','AJs','AQs','AKs','K9o','KTo','KJo','KQo','K2s','K3s','K4s','K5s','K6s','K7s','K8s','K9s','KTs','KJs','KQs','Q9o','QTo','QJo','Q2s','Q3s','Q4s','Q5s','Q6s','Q7s','Q8s','Q9s','QTs','QJs','J9o','JTo','J5s','J6s','J7s','J8s','J9s','JTs','T8s','T9s','98s','87s','76s'),
  CO: S('22','33','44','55','66','77','88','99','TT','JJ','QQ','KK','AA','A2o','A3o','A4o','A5o','A6o','A7o','A8o','A9o','ATo','AJo','AQo','AKo','A2s','A3s','A4s','A5s','A6s','A7s','A8s','A9s','ATs','AJs','AQs','AKs','K8o','K9o','KTo','KJo','KQo','K2s','K3s','K4s','K5s','K6s','K7s','K8s','K9s','KTs','KJs','KQs','Q8o','Q9o','QTo','QJo','Q2s','Q3s','Q4s','Q5s','Q6s','Q7s','Q8s','Q9s','QTs','QJs','J8o','J9o','JTo','J2s','J3s','J4s','J5s','J6s','J7s','J8s','J9s','JTs','T8o','T9o','T5s','T6s','T7s','T8s','T9s','98o','98s','87s','76s','65s','54s'),
  BTN: S('22','33','44','55','66','77','88','99','TT','JJ','QQ','KK','AA','A2o','A3o','A4o','A5o','A6o','A7o','A8o','A9o','ATo','AJo','AQo','AKo','A2s','A3s','A4s','A5s','A6s','A7s','A8s','A9s','ATs','AJs','AQs','AKs','K2o','K3o','K4o','K5o','K6o','K7o','K8o','K9o','KTo','KJo','KQo','K2s','K3s','K4s','K5s','K6s','K7s','K8s','K9s','KTs','KJs','KQs','Q5o','Q6o','Q7o','Q8o','Q9o','QTo','QJo','Q2s','Q3s','Q4s','Q5s','Q6s','Q7s','Q8s','Q9s','QTs','QJs','J7o','J8o','J9o','JTo','J2s','J3s','J4s','J5s','J6s','J7s','J8s','J9s','JTs','T7o','T8o','T9o','T2s','T3s','T4s','T5s','T6s','T7s','T8s','T9s','97s','98s','87s','86s','76s','75s','65s','64s','54s'),
  SB: S('22','33','44','55','66','77','88','99','TT','JJ','QQ','KK','AA','A2o','A3o','A4o','A5o','A6o','A7o','A8o','A9o','ATo','AJo','AQo','AKo','A2s','A3s','A4s','A5s','A6s','A7s','A8s','A9s','ATs','AJs','AQs','AKs','K2o','K3o','K4o','K5o','K6o','K7o','K8o','K9o','KTo','KJo','KQo','K2s','K3s','K4s','K5s','K6s','K7s','K8s','K9s','KTs','KJs','KQs','Q5o','Q6o','Q7o','Q8o','Q9o','QTo','QJo','Q2s','Q3s','Q4s','Q5s','Q6s','Q7s','Q8s','Q9s','QTs','QJs','J7o','J8o','J9o','JTo','J2s','J3s','J4s','J5s','J6s','J7s','J8s','J9s','JTs','T7o','T8o','T9o','T2s','T3s','T4s','T5s','T6s','T7s','T8s','T9s','97o','98o','87o','76o','97s','98s','87s','86s','76s','75s','65s','64s','54s'),
};

// ---------- table geometry ----------

export const positionsByPlayers = {
  2: ['SB/BTN', 'BB'], 3: ['BTN', 'SB', 'BB'], 4: ['UTG', 'BTN', 'SB', 'BB'],
  5: ['UTG', 'CO', 'BTN', 'SB', 'BB'], 6: ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'],
  7: ['UTG', 'UTG+1', 'MP', 'CO', 'BTN', 'SB', 'BB'],
  8: ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  9: ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
};

export function mapToBase8(players, pos) {
  if (players === 8) return pos.replace('UTG+1', 'UTG1').replace('UTG+2', 'UTG2');
  if (players === 9) { if (pos === 'UTG+1') return 'UTG1'; if (pos === 'UTG+2') return 'LJ'; return pos.replace('UTG+1', 'UTG1').replace('UTG+2', 'LJ'); }
  if (players === 7) { if (pos === 'UTG') return 'UTG1'; if (pos === 'UTG+1') return 'LJ'; if (pos === 'MP') return 'HJ'; return pos; }
  if (players === 6) { if (pos === 'UTG') return 'LJ'; if (pos === 'MP') return 'HJ'; return pos; }
  if (players === 5) { if (pos === 'UTG') return 'HJ'; return pos; }
  if (players === 4) { if (pos === 'UTG') return 'CO'; return pos; }
  if (players === 3) return pos === 'BTN' ? 'BTN' : pos === 'SB' ? 'SB' : 'BB';
  if (players === 2) return pos === 'SB/BTN' ? 'BTN' : 'BB';
  return 'HJ';
}

function normBase(players, pos) {
  const bp = mapToBase8(players, pos).replace('UTG+1', 'UTG1').replace('UTG+2', 'UTG2');
  return bp === 'UTG2' ? 'LJ' : bp;
}

// ---------- preflop hand key ----------

export function normalizeHandKey(r1, s1, r2, s2) {
  if (!r1 || !s1 || !r2 || !s2) return { ok: false, msg: 'Please select both cards.' };
  if (r1 === r2 && s1 === s2) return { ok: false, msg: "You can't select the same card twice." };
  let hiR = r1, loR = r2, hiS = s1, loS = s2;
  if (rankIndex[r2] < rankIndex[r1]) { hiR = r2; hiS = s2; loR = r1; loS = s1; }
  if (hiR === loR) return { ok: true, key: hiR + loR, display: `${hiR}${hiS} ${loR}${loS}`, cat: hiR + loR };
  const suited = hiS === loS;
  const key = hiR + loR + (suited ? 's' : 'o');
  return { ok: true, key, display: `${hiR}${hiS} ${loR}${loS}`, cat: key };
}

// ---------- RFI status for a base position (range grid + quiz) ----------

/** returns 'open' | 'mix' | 'fold' */
export function rfiStatus(basePos, key, depth = 100) {
  const main = ranges8_RFI[basePos] || new Set();
  const mix = ranges8_RFI[basePos + '_m'] || new Set();
  if (depth <= 20) {
    if (main.has(key) && !SHORT_TRIM.has(key)) return 'open';
    if (mix.has(key) && !SHORT_TRIM.has(key)) return 'mix';
    return 'fold';
  }
  if (main.has(key)) return 'open';
  if (mix.has(key)) return 'mix';
  return 'fold';
}

export function shoveStatus(basePos, key) {
  return (SHOVE10[basePos] || SHOVE10.BTN).has(key) ? 'shove' : 'fold';
}

// ---------- vs-open (3-bet) & BB-defend ranges (100 BB) ----------

const OPENER_EARLY = S('UTG', 'UTG1', 'LJ', 'HJ');
export function openerTier(pos) {
  return OPENER_EARLY.has(pos) ? 'early' : 'late';
}

// hero responding IN POSITION (BTN / CO) to an open
const VSOPEN_IP = {
  early: {
    value: S('QQ', 'KK', 'AA', 'AKs', 'AKo', 'AQs'),
    bluff: S('A5s', 'A4s', 'A3s', 'KJs'),
    call: S('JJ', 'TT', '99', '88', '77', 'AJs', 'ATs', 'A9s', 'KQs', 'KTs', 'QJs', 'QTs', 'JTs', 'T9s', '98s', '87s', '76s', 'AQo'),
  },
  late: {
    value: S('TT', 'JJ', 'QQ', 'KK', 'AA', 'AKs', 'AKo', 'AQs', 'AQo', 'AJs'),
    bluff: S('A5s', 'A4s', 'A3s', 'A2s', 'K9s', 'K8s', 'K7s', 'K6s', 'K5s', 'Q9s', 'J9s', 'T8s', '97s', '86s', '65s', '54s'),
    call: S('99', '88', '77', '66', '55', '44', '33', '22', 'ATs', 'A9s', 'KQs', 'KJs', 'KTs', 'QJs', 'QTs', 'JTs', 'T9s', '98s', '87s', '76s', 'KQo', 'AJo', 'ATo', 'KJo', 'QJo'),
  },
};

// BB defending an open (getting a price → very wide calls)
const BB_DEFEND = {
  early: {
    value: S('QQ', 'KK', 'AA', 'AKs', 'AKo', 'AQs'),
    bluff: S('A5s', 'A4s', 'K5s', 'K4s', '76s', '65s'),
    call: S('22', '33', '44', '55', '66', '77', '88', '99', 'JJ', 'TT', 'ATs', 'A9s', 'A8s', 'A7s', 'A6s', 'A3s', 'A2s', 'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'K7s', 'K6s', 'QJs', 'QTs', 'Q9s', 'Q8s', 'JTs', 'J9s', 'J8s', 'T9s', 'T8s', '98s', '97s', '87s', '86s', '75s', '64s', '54s', 'AJo', 'ATo', 'A9o', 'KQo', 'KJo', 'KTo', 'QJo', 'QTo', 'JTo'),
  },
  late: {
    value: S('TT', 'JJ', 'QQ', 'KK', 'AA', 'AKs', 'AKo', 'AQs', 'AQo'),
    bluff: S('A5s', 'A4s', 'A3s', 'A2s', 'K7s', 'K6s', 'K5s', 'K4s', 'K3s', 'K2s', '96s', '85s', '74s', '53s', 'J8s', 'T7s'),
    call: S('22', '33', '44', '55', '66', '77', '88', '99', 'ATs', 'A9s', 'A8s', 'A7s', 'A6s', 'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'QJs', 'QTs', 'Q9s', 'Q8s', 'Q7s', 'Q6s', 'Q5s', 'JTs', 'J9s', 'J7s', 'J6s', 'T9s', 'T8s', 'T6s', 'T5s', '98s', '97s', '96s', '95s', '87s', '86s', '84s', '76s', '75s', '74s', '65s', '64s', '63s', '54s', '53s', '43s', '32s', 'Q4s', 'Q3s', 'Q2s', 'J5s', 'J4s', 'T4s', '94s', '93s', 'AJo', 'ATo', 'A9o', 'A8o', 'A7o', 'A6o', 'A5o', 'A4o', 'A3o', 'A2o', 'KQo', 'KJo', 'KTo', 'K9o', 'K8o', 'K7o', 'K6o', 'K5o', 'QJo', 'QTo', 'Q9o', 'Q8o', 'Q7o', 'JTo', 'J9o', 'J8o', 'J7o', 'T9o', 'T8o', 'T7o', '98o', '97o', '96o', '87o', '86o', '76o', '75o', '65o', '64o', '54o'),
  },
};

/**
 * mode: 'rfi' | 'vsopen' | 'defend'
 * returns 'raise' | 'mix' | 'call' | 'fold'
 */
export function rangeStatus(mode, heroPos, vsPos, key) {
  if (mode === 'rfi') {
    const st = rfiStatus(heroPos, key, 100);
    return st === 'open' ? 'raise' : st; // 'mix' | 'fold'
  }
  const tier = openerTier(vsPos);
  const inBlind = mode === 'defend' || heroPos === 'BB' || heroPos === 'SB';
  const tbl = inBlind ? BB_DEFEND[tier] : VSOPEN_IP[tier];
  if (tbl.value.has(key)) return 'raise';
  if (tbl.bluff.has(key)) return 'mix';
  if (tbl.call.has(key)) return 'call';
  return 'fold';
}

// ---------- action advisor ----------

function openSize(stackBB, pos) {
  if (stackBB <= 12) return null;
  const isLate = pos === 'BTN' || pos === 'CO';
  if (stackBB <= 20) return pos === 'SB' ? 2.5 : 2.0;
  if (stackBB <= 40) return pos === 'SB' ? 2.5 : isLate ? 2.2 : 2.5;
  return pos === 'SB' ? 3.0 : isLate ? 2.2 : 2.5;
}
function threeBetSize(stackBB, pos) {
  if (stackBB <= 12) return null;
  const isOOP = pos === 'SB' || pos === 'BB';
  if (stackBB <= 20) return isOOP ? 7.0 : 6.0;
  if (stackBB <= 40) return isOOP ? 9.5 : 7.5;
  return isOOP ? 11.5 : 8.5;
}
function fourBetSize(stackBB) {
  if (stackBB <= 25) return null;
  if (stackBB <= 40) return 18.0;
  return 21.0;
}

function baseRfiDecision(pos, key, depth) {
  const st = rfiStatus(pos, key, depth);
  if (st === 'open') return { tier: 'OPEN', weight: 'pure' };
  if (st === 'mix') return { tier: 'OPEN', weight: 'mix' };
  return { tier: 'FOLD' };
}

function vsOpenDecision(pos, key, depth) {
  if (depth <= 12) {
    const s = SHOVE10[pos] || SHOVE10.BTN;
    return s.has(key) ? { tier: 'SHOVE' } : { tier: 'FOLD' };
  }
  const EARLY = S('UTG', 'UTG1', 'LJ'), MID = S('HJ', 'CO'), BLIND = S('BB');
  const vE = S('QQ', 'KK', 'AA', 'AKs', 'AKo');
  const vM = S('JJ', 'QQ', 'KK', 'AA', 'AKs', 'AKo', 'AQs');
  const vL = S('TT', 'JJ', 'QQ', 'KK', 'AA', 'AKs', 'AKo', 'AQs', 'AQo', 'AJs', 'KQs');
  const bE = S('A5s', 'A4s');
  const bM = S('A5s', 'A4s', 'A3s', 'KTs', 'QTs', 'JTs');
  const bL = S('A2s', 'A3s', 'A4s', 'A5s', 'K9s', 'Q9s', 'J9s', 'T9s', '98s');
  const cE = S('TT', 'JJ', 'AQs', 'AJs', 'KQs');
  const cM = S('99', 'TT', 'JJ', 'AQs', 'AJs', 'ATs', 'KQs', 'KJs', 'QJs', 'JTs');
  const cL = S('77', '88', '99', 'TT', 'JJ', 'AQs', 'AJs', 'ATs', 'A9s', 'KQs', 'KJs', 'KTs', 'QJs', 'QTs', 'JTs', 'T9s', '98s', '87s');
  const grp = EARLY.has(pos) ? 'EARLY' : MID.has(pos) ? 'MID' : 'LATE';
  const v = grp === 'EARLY' ? vE : grp === 'MID' ? vM : vL;
  const b = grp === 'EARLY' ? bE : grp === 'MID' ? bM : bL;
  const c = grp === 'EARLY' ? cE : grp === 'MID' ? cM : cL;
  if (BLIND.has(pos)) {
    if (S('QQ', 'KK', 'AA', 'AKs', 'AKo', 'AQs').has(key)) return { tier: '3BET_VALUE' };
    if (S('99', 'TT', 'JJ', 'AQs', 'AJs', 'ATs', 'KQs', 'QJs', 'JTs', 'T9s', '98s').has(key)) return { tier: 'CALL' };
    return { tier: 'FOLD' };
  }
  if (v.has(key)) return { tier: '3BET_VALUE' };
  if (b.has(key) && depth >= 20) return { tier: '3BET_BLUFF' };
  if (c.has(key)) return { tier: 'CALL' };
  return { tier: 'FOLD' };
}

function vs3BetDecision(pos, key, depth) {
  if (depth <= 12) {
    return S('TT', 'JJ', 'QQ', 'KK', 'AA', 'AQs', 'AKs', 'AQo', 'AKo').has(key) ? { tier: 'SHOVE' } : { tier: 'FOLD' };
  }
  const fv = depth <= 25 ? S('QQ', 'KK', 'AA', 'AKs', 'AKo') : S('QQ', 'KK', 'AA', 'AKs', 'AKo', 'AQs');
  const cv = depth <= 25 ? S('JJ', 'TT', 'AQs') : S('JJ', 'TT', '99', 'AQs', 'AJs', 'KQs');
  if (fv.has(key)) return { tier: depth <= 25 ? '4BET_SHOVE' : '4BET_SIZE' };
  if (cv.has(key)) return { tier: 'CALL' };
  return { tier: 'FOLD' };
}

/** scenario: 'RFI' | 'VS_OPEN' | 'VS_3BET'. returns { cls, text }. */
export function decideAction(players, pos, depth, scenario, key, allowLimp) {
  const base = normBase(players, pos);
  if (depth <= 12 && scenario === 'RFI') {
    const s = SHOVE10[base] || SHOVE10.BTN;
    return s.has(key)
      ? { cls: 'raise', text: `${key} → Shove all-in` }
      : { cls: 'fold', text: `${key} → Fold` };
  }
  if (scenario === 'RFI') {
    if (base === 'BB') return { cls: 'error', text: "RFI doesn't apply from the BB." };
    const d = baseRfiDecision(base, key, depth);
    if (d.tier === 'FOLD') return { cls: 'fold', text: `${key} → Fold` };
    if (base === 'SB' && allowLimp && depth >= 20 && SB_LIMP.has(key)) return { cls: 'call', text: `${key} → Limp (complete)` };
    const sz = openSize(depth, base) ?? 'all-in';
    const mx = d.weight === 'mix' ? ' (mix)' : '';
    return { cls: d.weight === 'mix' ? 'mix' : 'raise', text: `${key} → Raise ${sz} BB${mx}` };
  }
  if (scenario === 'VS_OPEN') {
    const d = vsOpenDecision(base, key, depth);
    if (d.tier === 'FOLD') return { cls: 'fold', text: `${key} → Fold` };
    if (d.tier === 'SHOVE') return { cls: 'raise', text: `${key} → Shove (re-jam)` };
    if (d.tier === 'CALL') return { cls: 'call', text: `${key} → Call` };
    const sz = threeBetSize(depth, base) ?? 'all-in';
    if (d.tier === '3BET_VALUE') return { cls: 'raise', text: `${key} → 3-bet to ${sz} BB (value)` };
    if (d.tier === '3BET_BLUFF') return { cls: 'mix', text: `${key} → 3-bet to ${sz} BB (bluff/mix)` };
    return { cls: 'fold', text: `${key} → Fold` };
  }
  if (scenario === 'VS_3BET') {
    const d = vs3BetDecision(base, key, depth);
    if (d.tier === 'FOLD') return { cls: 'fold', text: `${key} → Fold` };
    if (d.tier === 'SHOVE' || d.tier === '4BET_SHOVE') return { cls: 'raise', text: `${key} → 4-bet shove` };
    if (d.tier === 'CALL') return { cls: 'call', text: `${key} → Call` };
    const sz = fourBetSize(depth);
    return { cls: 'raise', text: `${key} → 4-bet to ${sz} BB` };
  }
  return { cls: 'error', text: 'Unknown scenario.' };
}

// ---------- pot odds / equity / SPR ----------

/** equity % you need to call: call / (pot + villain bet + call). */
export function potOddsPct(potBeforeBet, villainBet) {
  const total = potBeforeBet + villainBet;
  const call = villainBet;
  return (call / (total + call)) * 100;
}

/** rule of 4 (flop) / rule of 2 (turn), capped at 100. */
export function equityFromOuts(outs, street) {
  if (!(outs > 0)) return 0;
  return Math.min(outs * (street === 'flop' ? 4 : 2), 100);
}

/** EV in BB of calling, given your equity %. Win = pot + villain's bet; lose = the call. */
export function evOfCall(potBeforeBet, villainBet, equityPct) {
  const win = potBeforeBet + villainBet;
  const call = villainBet;
  const e = equityPct / 100;
  return e * win - (1 - e) * call;
}

export function sprInterp(spr) {
  let label;
  if (spr < 1) label = 'Extremely low — committed with any pair or better';
  else if (spr < 2) label = 'Very low — committed with top pair+';
  else if (spr < 4) label = 'Low — need strong hand (top pair top kicker+)';
  else if (spr < 7) label = 'Medium — two pair+ to felt it; draws become profitable';
  else label = 'High — speculative hands gain value; sets and straights pay off';
  return {
    num: spr,
    label,
    guide: [
      ['<2', 'Committed — hard to fold top pair'],
      ['2–4', 'Strong hand needed to call off'],
      ['4–9', 'Two pair / sets become correct calls'],
      ['9+', 'Deep — implied odds drive decisions'],
    ],
  };
}

// ---------- Monte-Carlo equity ----------

// card index: rank 0..12 (2..A) << 2 | suit 0..3 (s h d c)
const EQ_RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const EQ_SUITS = ['s', 'h', 'd', 'c'];
export const EQ_SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
const rNum = { A: 12, K: 11, Q: 10, J: 9, T: 8, 9: 7, 8: 6, 7: 5, 6: 4, 5: 3, 4: 2, 3: 1, 2: 0 };
const sNum = { s: 0, h: 1, d: 2, c: 3 };

export function cardIndex(rank, suit) {
  if (!rank || !suit) return null;
  return rNum[rank] * 4 + sNum[suit];
}
export function cardLabel(idx) {
  return EQ_RANKS[12 - (idx >> 2)] + EQ_SUIT_SYM[EQ_SUITS[idx & 3]];
}
export { EQ_RANKS, EQ_SUITS };

export function evalFive(cards) {
  const ranks = cards.map((c) => c >> 2).sort((a, b) => b - a);
  const suits = cards.map((c) => c & 3);
  const isFlush = suits.every((s) => s === suits[0]);
  let strHi = -1;
  if (new Set(ranks).size === 5) {
    if (ranks[0] - ranks[4] === 4) strHi = ranks[0];
    else if (ranks[0] === 12 && ranks[1] === 3 && ranks[2] === 2 && ranks[3] === 1 && ranks[4] === 0) strHi = 3;
  }
  const cnt = {};
  ranks.forEach((r) => (cnt[r] = (cnt[r] || 0) + 1));
  const grps = Object.entries(cnt).map(([r, c]) => [+r, +c]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const [r0, c0] = grps[0];
  const [r1, c1] = grps[1] || [0, 0];
  const rest = ranks.filter((r) => r !== r0);
  if (isFlush && strHi >= 0) return [8, strHi];
  if (c0 === 4) return [7, r0, r1];
  if (c0 === 3 && c1 === 2) return [6, r0, r1];
  if (isFlush) return [5, ...ranks];
  if (strHi >= 0) return [4, strHi];
  if (c0 === 3) { const k = rest.sort((a, b) => b - a); return [3, r0, ...k.slice(0, 2)]; }
  if (c0 === 2 && c1 === 2) {
    const p1 = Math.max(r0, r1), p2 = Math.min(r0, r1);
    const k = ranks.find((r) => r !== r0 && r !== r1) ?? 0;
    return [2, p1, p2, k];
  }
  if (c0 === 2) { const k = rest.sort((a, b) => b - a); return [1, r0, ...k.slice(0, 3)]; }
  return [0, ...ranks.slice(0, 5)];
}

export function cmpH(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? -1;
    const bi = b[i] ?? -1;
    if (ai !== bi) return ai > bi ? 1 : -1;
  }
  return 0;
}

export function bestHand(cards) {
  const n = cards.length;
  if (n === 5) return evalFive(cards);
  if (n === 6) {
    let best = null;
    for (let i = 0; i < 6; i++) {
      const sc = evalFive(cards.filter((_, k) => k !== i));
      if (!best || cmpH(sc, best) > 0) best = sc;
    }
    return best;
  }
  let best = null;
  for (let i = 0; i < 6; i++)
    for (let j = i + 1; j < 7; j++) {
      const sc = evalFive(cards.filter((_, k) => k !== i && k !== j));
      if (!best || cmpH(sc, best) > 0) best = sc;
    }
  return best;
}

/** hand key ('AKs' | 'AKo' | 'AA') from two card indices. */
export function comboKey(c1, c2) {
  const hi = Math.max(c1 >> 2, c2 >> 2);
  const lo = Math.min(c1 >> 2, c2 >> 2);
  const hc = RANKS[12 - hi];
  const lc = RANKS[12 - lo];
  if (hi === lo) return hc + lc;
  return hc + lc + ((c1 & 3) === (c2 & 3) ? 's' : 'o');
}

function matchRange(c1, c2, spec) {
  if (!spec || spec === 'random' || spec === 'ANY') return true;
  if (spec instanceof Set) return spec.has(comboKey(c1, c2));
  // string presets
  const r1 = Math.max(c1 >> 2, c2 >> 2);
  const r2 = Math.min(c1 >> 2, c2 >> 2);
  const suited = (c1 & 3) === (c2 & 3);
  const pair = r1 === r2;
  if (spec === 'premium') return (pair && r1 >= 9) || (r1 === 12 && r2 === 11);
  if (spec === 'strong') return (pair && r1 >= 7) || (r1 === 12 && r2 >= 8 && suited) || (r1 === 12 && r2 >= 10) || (r1 === 11 && r2 === 10 && suited);
  if (spec === 'wide') return pair || (r1 >= 8 && r2 >= 8) || (suited && r1 - r2 <= 1 && r1 >= 3) || (suited && r1 >= 9);
  return true;
}

export function inRange(c1, c2, range) {
  return matchRange(c1, c2, range);
}

/**
 * Monte-Carlo equity.
 *   heroCards  — [c1,c2] for a fixed hand, or null when opts.hero is a range
 *   opts       — string villain preset (back-compat), or:
 *                { hero, villain, villainHand }
 *                hero/villain: 'random' | preset string | Set of hand keys
 *                villainHand: [c1,c2] to pin the villain to one hand
 * Returns { hero, villain, tie } as fixed(1) strings, or null.
 */
export function runMC(heroCards, boardCards, opts, iters = 1500) {
  const o = typeof opts === 'string' ? { villain: opts } : opts || {};
  const heroRange = o.hero;
  const fixedHero = !heroRange && Array.isArray(heroCards) && heroCards.length === 2;
  const villainHand = o.villainHand && o.villainHand.length === 2 ? o.villainHand : null;

  const used = new Set([
    ...(fixedHero ? heroCards : []),
    ...(villainHand || []),
    ...boardCards,
  ]);
  const deck = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
  const boardNeed = 5 - boardCards.length;

  let heroW = 0, tie = 0, total = 0;
  for (let iter = 0; iter < iters; iter++) {
    for (let j = deck.length - 1; j > 0; j--) {
      const k = (Math.random() * (j + 1)) | 0;
      [deck[j], deck[k]] = [deck[k], deck[j]];
    }
    const con = new Set();
    const takeRange = (spec) => {
      for (let a = 0; a < deck.length - 1; a++) {
        if (con.has(deck[a])) continue;
        for (let b = a + 1; b < deck.length; b++) {
          if (con.has(deck[b])) continue;
          if (matchRange(deck[a], deck[b], spec)) {
            con.add(deck[a]);
            con.add(deck[b]);
            return [deck[a], deck[b]];
          }
        }
      }
      return null;
    };
    const takeN = (n) => {
      const r = [];
      for (const c of deck) {
        if (con.has(c)) continue;
        r.push(c);
        con.add(c);
        if (r.length === n) break;
      }
      return r;
    };

    const hero = fixedHero ? heroCards : takeRange(heroRange || 'random');
    if (!hero) continue;
    const villain = villainHand || takeRange(o.villain || 'random');
    if (!villain) continue;
    const extra = takeN(boardNeed);
    if (extra.length < boardNeed) continue;
    const board = [...boardCards, ...extra];
    const cmp = cmpH(bestHand([...hero, ...board]), bestHand([...villain, ...board]));
    total++;
    if (cmp > 0) heroW++;
    else if (cmp === 0) tie++;
  }
  if (!total) return null;
  return {
    hero: ((heroW + tie / 2) / total * 100).toFixed(1),
    villain: ((total - heroW - tie + tie / 2) / total * 100).toFixed(1),
    tie: (tie / total * 100).toFixed(1),
  };
}
