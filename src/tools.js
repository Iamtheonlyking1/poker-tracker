// The poker study tools, rebuilt as native views in the felt/gold theme.
// Each exported view returns a node array, same shape as app.js's game views.

import { h, avatar } from './ui.js';
import * as fx from './fx.js';
import { fmtMoney, currencySymbol, currencyCode } from './money.js';
import * as poker from './poker.js';
import { drawLineChart, drawBarChart } from './charts.js';
import {
  loadHistory,
  loadSessionLog,
  addSessionLog,
  deleteSessionLog,
  loadQuizScore,
  saveQuizScore,
  loadRoster,
  upsertRosterPlayer,
  deleteRosterPlayer,
} from './state.js';
import { net } from './settle.js';
import { exportBlob, importAll, summarize, markExported } from './backup.js';

// ---------- controller hook (set once by app.js to avoid a circular import) ----------

let nav = { go() {}, toast() {}, state: {} };
export function setNav(n) {
  nav = n;
}

// ---------- shared building blocks ----------

const toolHead = (title) =>
  h('div', { class: 'tool-head' },
    h('button', { class: 'sm ghost icon-only', 'aria-label': 'Home', html: fx.icon('home'), onclick: () => nav.go('home') }),
    h('h1', {}, title),
  );

const backbar = () =>
  h('div', { class: 'actionbar' },
    h('button', { class: 'ghost wide', html: fx.icon('back') + 'Home', onclick: () => nav.go('home') }),
  );

const sel = (opts, attrs = {}) =>
  h('select', attrs, ...opts.map((o) => {
    const [val, label] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: String(val) }, label);
  }));

const statBox = (val, label, tone) =>
  h('div', { class: 'stat-box' + (tone ? ' t-' + tone : '') },
    h('div', { class: 'sb-val' }, val),
    h('div', { class: 'sb-lbl' }, label),
  );

const refTable = (headers, rows) => {
  const t = h('table', { class: 'ref-table' });
  t.append(h('tr', {}, ...headers.map((x) => h('th', {}, x))));
  rows.forEach((r) => t.append(h('tr', {}, ...r.map((c, i) => h('td', { class: i === 0 ? 'rt-key' : '' }, c)))));
  return h('div', { class: 'scroll-x' }, t);
};

const notesList = (items) =>
  h('div', { class: 'notes' }, ...items.map((it) => {
    const [k, v] = Array.isArray(it) ? it : [null, it];
    return h('div', { class: 'note' }, k ? h('b', {}, k) : null, h('span', {}, v));
  }));

// ---------- Home hub ----------

const TILES = [
  ['roster', 'users', 'Players', 'Saved regulars & notes'],
  ['bbcalc', 'calc', 'BB Calc', 'Stack in big blinds'],
  ['ranges', 'grid', 'Ranges', 'Opening charts by seat'],
  ['action', 'target', 'Action', 'Preflop advisor'],
  ['odds', 'percent', 'Odds & SPR', 'Pot odds, equity, SPR'],
  ['quiz', 'dice', 'Range Quiz', 'Drill your ranges'],
  ['equity', 'graph', 'Equity', 'Hand vs range'],
  ['study', 'book', 'Study', 'Sizing, blockers, theory'],
  ['sessions', 'ledger', 'My Sessions', 'Personal cash-game log'],
  ['data', 'database', 'Data', 'Back up & restore'],
];

export function viewHome() {
  const s = nav.state.session;
  const hist = loadHistory();
  return [
    h('h1', { html: fx.icon('spade') + 'Poker Night' }),
    h('p', { class: 'muted' }, 'Run the game. Sharpen the game.'),
    h('div', { class: 'card cta' },
      s
        ? h('div', {},
            h('div', { class: 'pmeta' }, 'Game in progress'),
            h('div', { class: 'pname' }, s.name),
          )
        : h('div', {},
            h('div', { class: 'pname' }, "Tonight's game"),
            h('div', { class: 'pmeta' }, 'Track buy-ins, settle up clean'),
          ),
      s
        ? h('button', { class: 'primary wide', html: 'Resume game' + fx.icon('forward'),
            onclick: () => nav.go(s.players.some((p) => p.cashOut != null) ? 'cashout' : 'live') })
        : h('button', { class: 'primary wide', html: fx.icon('spade') + 'New game', onclick: () => nav.go('setup') }),
    ),
    h('h2', {}, 'Tools'),
    h('div', { class: 'tool-grid' },
      ...TILES.map(([v, ic, name, desc]) =>
        h('button', { class: 'tool-tile', onclick: () => nav.go(v) },
          h('span', { class: 'tt-ic', html: fx.icon(ic) }),
          h('span', { class: 'tt-name' }, name),
          h('span', { class: 'tt-desc' }, desc),
        ),
      ),
    ),
    h('button', { class: 'ghost wide', html: fx.icon('trophy') + `Game history${hist.length ? ` (${hist.length})` : ''}`, onclick: () => nav.go('history') }),
  ];
}

// ---------- BB calc ----------

export function viewBBCalc() {
  const stackIn = h('input', { type: 'number', inputmode: 'numeric', placeholder: 'e.g. 25000', min: '0', enterkeyhint: 'done' });
  const bbIn = h('input', { type: 'number', inputmode: 'numeric', placeholder: 'e.g. 1200', min: '1', enterkeyhint: 'done' });
  const out = h('div', { class: 'big-result empty', 'aria-live': 'polite' }, 'Enter values above');
  const calc = () => {
    const st = parseFloat(stackIn.value);
    const bb = parseFloat(bbIn.value);
    if (!(st >= 0) || !(bb > 0)) {
      out.className = 'big-result empty';
      out.textContent = 'Enter a valid stack and big blind';
      return;
    }
    out.className = 'big-result';
    out.textContent = (st / bb).toFixed(1) + ' BB';
  };
  [stackIn, bbIn].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') calc(); }));

  return [
    toolHead('BB Calc'),
    h('div', { class: 'card' },
      h('h2', {}, 'Stack in big blinds'),
      h('label', {}, 'Stack size (chips)'), stackIn,
      h('label', {}, 'Big blind (chips)'), bbIn,
      h('button', { class: 'primary wide', html: 'Calculate', onclick: calc }),
      out,
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Stack-depth guide'),
      notesList([
        ['< 15 BB', 'Push/fold only. Open-raise sizing is irrelevant.'],
        ['15–25 BB', 'Jam-or-fold. 3-bets are shoves; call-off thresholds tighten.'],
        ['25–40 BB', 'SPR-compressed. Most 3-bet pots are effectively all-in.'],
        ['40–60 BB', 'Transitional. Full range variety but a small 4-bet tree.'],
        ['60–100 BB', 'Full game. Use the Ranges + Action tools.'],
        ['100+ BB', 'Deep. Implied odds grow; speculative hands gain value.'],
      ]),
    ),
    backbar(),
  ];
}

// ---------- Ranges ----------

export function viewRanges() {
  const players = sel(['2', '3', '4', '5', '6', '7', '8', '9'], { 'aria-label': 'Players' });
  players.value = '8';
  const pos = sel([], { 'aria-label': 'Position' });
  const depth = sel([['20', '20 BB'], ['40', '40 BB'], ['60', '60 BB'], ['100', '100 BB']], { 'aria-label': 'Stack depth' });
  depth.value = '40';
  const grid = h('div', { class: 'scroll-x' });

  const fillPos = () => {
    const p = parseInt(players.value, 10);
    const list = poker.positionsByPlayers[p] || poker.positionsByPlayers[8];
    pos.replaceChildren(...list.map((x) => h('option', { value: x }, x)));
    pos.value = list[0];
  };
  const render = () => {
    const p = parseInt(players.value, 10);
    const d = parseInt(depth.value, 10);
    let base = poker.mapToBase8(p, pos.value).replace('UTG+1', 'UTG1').replace('UTG+2', 'UTG2');
    if (base === 'UTG2') base = 'LJ';
    const table = h('table', { class: 'range-grid' });
    const hr = h('tr', {}, h('th', {}));
    poker.RANKS.forEach((r) => hr.append(h('th', {}, r)));
    table.append(hr);
    for (let i = 0; i < 13; i++) {
      const tr = h('tr', {}, h('th', {}, poker.RANKS[i]));
      for (let j = 0; j < 13; j++) {
        const k = poker.handKey(i, j);
        const st = poker.rfiStatus(base, k, d);
        tr.append(h('td', { class: 'rg ' + (st === 'open' ? 'rg-open' : st === 'mix' ? 'rg-mix' : 'rg-fold') }, k.length === 2 ? k : k.slice(0, 3)));
      }
      table.append(tr);
    }
    grid.replaceChildren(table);
  };
  fillPos();
  render();
  players.addEventListener('change', () => { fillPos(); render(); });
  pos.addEventListener('change', render);
  depth.addEventListener('change', render);

  return [
    toolHead('Ranges'),
    h('div', { class: 'card' },
      h('h2', {}, 'Opening ranges'),
      h('div', { class: 'field-grid' },
        h('div', {}, h('label', {}, 'Players'), players),
        h('div', {}, h('label', {}, 'Position'), pos),
        h('div', {}, h('label', {}, 'Depth'), depth),
      ),
      h('p', { class: 'muted small' }, 'Upper-right = suited · lower-left = offsuit · diagonal = pairs. 8-max RFI model mapped by seat.'),
      grid,
      h('div', { class: 'legend' },
        h('span', {}, h('i', { class: 'sw sw-open' }), 'Open'),
        h('span', {}, h('i', { class: 'sw sw-mix' }), 'Mix'),
        h('span', {}, h('i', { class: 'sw sw-fold' }), 'Fold'),
      ),
    ),
    backbar(),
  ];
}

// ---------- Action advisor ----------

export function viewAction() {
  const players = sel(['2', '3', '4', '5', '6', '7', '8', '9']);
  players.value = '8';
  const pos = sel([]);
  const stack = sel([['10', '10 BB — push/fold'], ['20', '20 BB'], ['40', '40 BB'], ['60', '60 BB'], ['100', '100 BB']]);
  stack.value = '40';
  const scenario = sel([['RFI', 'Unopened pot (RFI)'], ['VS_OPEN', 'Facing an open raise'], ['VS_3BET', 'Facing a 3-bet']]);
  const r1 = sel([['', 'Rank'], ...poker.RANKS.map((x) => [x, x])]);
  const s1 = sel([['', 'Suit'], ...poker.SUITS.map((x) => [x, x])]);
  const r2 = sel([['', 'Rank'], ...poker.RANKS.map((x) => [x, x])]);
  const s2 = sel([['', 'Suit'], ...poker.SUITS.map((x) => [x, x])]);
  const handText = h('div', { class: 'hand-big' }, '—');
  const handSub = h('div', { class: 'pmeta' }, 'Select both cards');
  const result = h('div', { class: 'result-line', hidden: 'true', role: 'status', 'aria-live': 'polite' });
  const limp = h('input', { type: 'checkbox', checked: 'true' });

  const fillPos = () => {
    const p = parseInt(players.value, 10);
    const list = poker.positionsByPlayers[p] || poker.positionsByPlayers[8];
    pos.replaceChildren(...list.map((x) => h('option', { value: x }, x)));
    pos.value = list[0];
  };
  const preview = () => {
    const n = poker.normalizeHandKey(r1.value, s1.value, r2.value, s2.value);
    if (!n.ok) { handText.textContent = '—'; handSub.textContent = 'Select both cards'; return; }
    handText.textContent = n.cat;
    handSub.textContent = n.display + ' → ' + n.cat;
  };
  const compute = () => {
    const n = poker.normalizeHandKey(r1.value, s1.value, r2.value, s2.value);
    if (!n.ok) { result.hidden = false; result.className = 'result-line rl-fold'; result.textContent = n.msg; return; }
    const d = poker.decideAction(parseInt(players.value, 10), pos.value, parseInt(stack.value, 10), scenario.value, n.key, limp.checked);
    result.hidden = false;
    result.className = 'result-line rl-' + d.cls;
    result.textContent = `${d.text}  ·  ${pos.value}, ${players.value}-max, ${stack.value} BB`;
    fx.haptic(8);
  };
  fillPos();
  preview();
  players.addEventListener('change', () => { fillPos(); result.hidden = true; });
  [pos, stack, scenario, r1, s1, r2, s2, limp].forEach((el) => el.addEventListener('change', () => { preview(); result.hidden = true; }));

  return [
    toolHead('Action'),
    h('div', { class: 'card' },
      h('h2', {}, 'Preflop advisor'),
      h('p', { class: 'muted small' }, 'Rules-based GTO helper: RFI · vs open · vs 3-bet. Adapts to stack depth.'),
      h('label', {}, 'Players'), players,
      h('label', {}, 'Your position'), pos,
      h('label', {}, 'Stack depth'), stack,
      h('label', {}, 'Scenario'), scenario,
      h('label', { class: 'check' }, limp, h('span', {}, 'Allow SB limps (RFI, 20 BB+)')),
      h('button', { class: 'primary wide', html: 'What should I do?', onclick: compute }),
      result,
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Your hole cards'),
      h('div', { class: 'field-grid' },
        h('div', {}, h('label', {}, 'Card 1'), h('div', { class: 'card-pick' }, r1, s1)),
        h('div', {}, h('label', {}, 'Card 2'), h('div', { class: 'card-pick' }, r2, s2)),
      ),
      h('div', { class: 'hand-box' }, handText, handSub),
      notesList([
        ['Raise', 'Open or re-raise — value or semi-bluff'],
        ['Mix', 'Solver frequency hand: sometimes raise, sometimes call'],
        ['Call', 'Flat or limp, no aggression'],
        ['Fold', 'Standard fold at this stack & scenario'],
      ]),
    ),
    backbar(),
  ];
}

// ---------- Odds & SPR ----------

const OUTS_REF = [
  ['Flush draw', '9', '~35%'],
  ['Open-ended straight', '8', '~32%'],
  ['Two overcards', '6', '~24%'],
  ['Flush + gutshot', '12', '~45%'],
  ['Flush + pair', '15', '~54%'],
  ['Gutshot', '4', '~17%'],
  ['One overcard', '3', '~13%'],
  ['Pocket pair → set', '2', '~8%'],
];

export function viewOdds() {
  const potIn = h('input', { type: 'number', inputmode: 'decimal', placeholder: 'e.g. 12', min: '0' });
  const betIn = h('input', { type: 'number', inputmode: 'decimal', placeholder: 'e.g. 8', min: '0' });
  const outsIn = h('input', { type: 'number', inputmode: 'numeric', placeholder: 'e.g. 9', min: '0', max: '20' });
  const street = sel([['flop', 'Flop — 2 cards (rule of 4)'], ['turn', 'Turn — 1 card (rule of 2)']]);
  const res = h('div', {});
  const verdict = h('div', { class: 'banner', hidden: 'true' });

  const calc = () => {
    const p = parseFloat(potIn.value);
    const b = parseFloat(betIn.value);
    const o = parseInt(outsIn.value, 10);
    if (!(p >= 0) || !(b > 0)) { res.replaceChildren(); verdict.hidden = true; return; }
    const need = poker.potOddsPct(p, b);
    const eq = poker.equityFromOuts(o, street.value);
    const ev = o > 0 ? poker.evOfCall(p, b, eq) : null;
    const boxes = [statBox(need.toFixed(1) + '%', 'Equity needed', 'gold')];
    if (o > 0) boxes.push(statBox(eq.toFixed(1) + '%', `Equity (rule of ${street.value === 'flop' ? '4' : '2'})`, eq >= need ? 'win' : 'loss'));
    if (ev !== null) boxes.push(statBox((ev >= 0 ? '+' : '') + ev.toFixed(2) + ' BB', 'EV of calling', ev >= 0 ? 'win' : 'loss'));
    boxes.push(statBox((p + b + b).toFixed(1) + ' BB', 'Pot after call'));
    res.replaceChildren(h('div', { class: 'stat-grid' }, ...boxes));
    if (o > 0) {
      verdict.hidden = false;
      const diff = eq - need;
      if (diff >= 3) { verdict.className = 'banner ok'; verdict.textContent = `Clear call — ${eq.toFixed(0)}% beats the ${need.toFixed(0)}% you need`; }
      else if (Math.abs(diff) < 3) { verdict.className = 'banner warn'; verdict.textContent = `Close — needs implied odds or a read (${eq.toFixed(0)}% vs ${need.toFixed(0)}%)`; }
      else { verdict.className = 'banner loss'; verdict.textContent = `Fold — ${eq.toFixed(0)}% short of the ${need.toFixed(0)}% needed`; }
    } else verdict.hidden = true;
  };
  [potIn, betIn, outsIn].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') calc(); }));
  street.addEventListener('change', calc);

  // SPR sub-tool
  const sprPot = h('input', { type: 'number', inputmode: 'decimal', placeholder: 'e.g. 10', min: '0' });
  const sprStack = h('input', { type: 'number', inputmode: 'decimal', placeholder: 'e.g. 45', min: '0' });
  const sprRes = h('div', {});
  const sprCalc = () => {
    const p = parseFloat(sprPot.value);
    const st = parseFloat(sprStack.value);
    if (!(p > 0) || !(st >= 0)) { sprRes.replaceChildren(); return; }
    const info = poker.sprInterp(st / p);
    sprRes.replaceChildren(
      h('div', { class: 'spr-num' }, info.num.toFixed(1)),
      h('div', { class: 'pmeta center' }, info.label),
      h('div', { class: 'spr-guide' }, ...info.guide.flatMap(([r, t]) => [h('b', {}, r), h('span', {}, t)])),
    );
  };
  [sprPot, sprStack].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') sprCalc(); }));

  return [
    toolHead('Odds & SPR'),
    h('div', { class: 'card' },
      h('h2', {}, 'Pot odds & equity'),
      h('label', {}, 'Pot before villain’s bet (BB)'), potIn,
      h('label', {}, 'Villain’s bet (BB)'), betIn,
      h('label', {}, 'Your outs'), outsIn,
      h('label', {}, 'Street'), street,
      h('button', { class: 'primary wide', html: 'Calculate', onclick: calc }),
      res,
      verdict,
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Common outs'),
      refTable(['Draw', 'Outs', 'Flop %'], OUTS_REF),
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'SPR calculator'),
      h('label', {}, 'Pot size (BB)'), sprPot,
      h('label', {}, 'Effective stack (BB)'), sprStack,
      h('button', { class: 'primary wide', html: 'Calculate SPR', onclick: sprCalc }),
      sprRes,
    ),
    backbar(),
  ];
}

// ---------- Range quiz ----------

export function viewQuiz() {
  let score = loadQuizScore();
  const mode = sel([['rfi', 'Open Raise — RFI (100 BB)'], ['shove', 'Push/Fold (≤12 BB)']]);
  const posFilter = sel([
    ['all', 'All positions'], ['early', 'Early (UTG–LJ)'], ['late', 'Late (CO/BTN/SB)'],
    ['BTN', 'BTN only'], ['CO', 'CO only'], ['UTG', 'UTG only'],
  ]);
  const handEl = h('div', { class: 'hand-big' }, '—');
  const ctxEl = h('div', { class: 'pmeta center' }, '');
  const fb = h('div', { class: 'quiz-fb', hidden: 'true' });
  const nextBtn = h('button', { class: 'ghost wide', html: 'Next hand' + fx.icon('forward'), hidden: 'true' });
  const openBtn = h('button', { class: 'quiz-ans qa-open' }, 'Open / Raise');
  const foldBtn = h('button', { class: 'quiz-ans qa-fold' }, 'Fold');
  const card = h('div', { class: 'card quiz-card', hidden: 'true' },
    handEl, ctxEl, h('div', { class: 'quiz-btns' }, openBtn, foldBtn), fb, nextBtn);

  const pctEl = h('div', { class: 'score-big' }, '—');
  const cEl = h('b', {}, '0');
  const tEl = h('b', {}, '0');
  const wEl = h('b', {}, '0');
  const streakEl = h('span', { class: 'streak' }, '🔥 0 streak');
  const renderScore = () => {
    pctEl.textContent = score.total ? Math.round((score.correct / score.total) * 100) + '%' : '—';
    cEl.textContent = score.correct;
    tEl.textContent = score.total;
    wEl.textContent = score.wrong;
    streakEl.textContent = `🔥 ${score.streak} streak`;
  };
  renderScore();

  let cur = null;
  const positions = () => {
    const f = posFilter.value;
    if (f === 'all') return poker.BASE_POSITIONS;
    if (f === 'early') return ['UTG', 'UTG1', 'LJ'];
    if (f === 'late') return ['CO', 'BTN', 'SB'];
    return [f];
  };
  const next = () => {
    const pl = positions();
    const p = pl[Math.floor(Math.random() * pl.length)];
    const hand = poker.CANONICAL[Math.floor(Math.random() * poker.CANONICAL.length)];
    const m = mode.value;
    cur = { pos: p, hand, mode: m, answer: m === 'shove' ? poker.shoveStatus(p, hand) : poker.rfiStatus(p, hand, 100) };
    handEl.textContent = hand;
    ctxEl.innerHTML = `<b>${p === 'UTG1' ? 'UTG+1' : p}</b> · ${m === 'shove' ? '≤12 BB — shove or fold?' : '100 BB — open or fold?'}`;
    fb.hidden = true;
    nextBtn.hidden = true;
    openBtn.textContent = m === 'shove' ? 'Shove' : 'Open / Raise';
    openBtn.disabled = false;
    foldBtn.disabled = false;
    card.hidden = false;
  };
  const answer = (choice) => {
    openBtn.disabled = true;
    foldBtn.disabled = true;
    const correct = cur.answer;
    const isAggr = correct === 'open' || correct === 'shove';
    const userAggr = choice === 'open';
    const right = (userAggr && isAggr) || (!userAggr && correct === 'fold');
    const isMix = correct === 'mix';
    score.total++;
    if (right || isMix) { score.correct++; score.streak++; } else { score.wrong++; score.streak = 0; }
    saveQuizScore(score);
    renderScore();
    fb.hidden = false;
    if (right) { fb.className = 'quiz-fb fb-ok'; fb.textContent = `Correct — ${cur.hand} from ${cur.pos} = ${correct}`; fx.haptic(10); }
    else if (isMix) { fb.className = 'quiz-fb fb-mix'; fb.textContent = `Mix hand — ${cur.hand} is a mixed strategy here. Both are defensible.`; }
    else { fb.className = 'quiz-fb fb-bad'; fb.textContent = `Wrong — ${cur.hand} from ${cur.pos} = ${correct}`; fx.haptic([10, 40, 10]); }
    nextBtn.hidden = false;
  };
  openBtn.addEventListener('click', () => answer('open'));
  foldBtn.addEventListener('click', () => answer('fold'));
  nextBtn.addEventListener('click', next);

  return [
    toolHead('Range Quiz'),
    h('div', { class: 'card' },
      h('h2', {}, 'Drill preflop ranges'),
      h('label', {}, 'Mode'), mode,
      h('label', {}, 'Positions'), posFilter,
      h('button', { class: 'primary wide', html: 'Start', onclick: next }),
      h('button', { class: 'ghost wide', html: fx.icon('trash') + 'Reset score',
        onclick: () => { score = { correct: 0, total: 0, wrong: 0, streak: 0 }; saveQuizScore(score); renderScore(); card.hidden = true; } }),
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Score'),
      pctEl,
      h('div', { class: 'pmeta center' }, 'Accuracy'),
      h('div', { class: 'score-row' },
        h('div', {}, cEl, h('span', {}, 'Correct')),
        h('div', {}, tEl, h('span', {}, 'Answered')),
        h('div', {}, wEl, h('span', {}, 'Wrong')),
      ),
      h('div', { class: 'center' }, streakEl),
    ),
    card,
    backbar(),
  ];
}

// ---------- Equity ----------

export function viewEquity() {
  const mkRank = (req) => sel([...(req ? [] : [['', '—']]), ...poker.EQ_RANKS.map((x) => [x, x])]);
  const mkSuit = (req) => sel([...(req ? [] : [['', '—']]), ...poker.EQ_SUITS.map((x) => [x, poker.EQ_SUIT_SYM[x]])]);
  const hR1 = mkRank(true), hS1 = mkSuit(true), hR2 = mkRank(true), hS2 = mkSuit(true);
  hR1.value = 'A'; hS1.value = 's'; hR2.value = 'K'; hS2.value = 'd';
  const board = Array.from({ length: 5 }, () => ({ r: mkRank(false), s: mkSuit(false) }));
  const range = sel([
    ['premium', 'Premium — JJ+, AK (~4%)'],
    ['strong', 'Strong — 99+, ATs+, AQo+ (~12%)'],
    ['wide', 'Wide — pairs, broadways, SC (~30%)'],
    ['random', 'Random — any two'],
  ]);
  range.value = 'strong';
  const res = h('div', {}, h('p', { class: 'muted empty' }, 'Enter your hand and run.'));
  const runBtn = h('button', { class: 'primary wide', html: 'Run simulation' });

  const run = () => {
    const c1 = poker.cardIndex(hR1.value, hS1.value);
    const c2 = poker.cardIndex(hR2.value, hS2.value);
    if (c1 == null || c2 == null) { res.replaceChildren(h('div', { class: 'banner loss' }, 'Select both hole cards.')); return; }
    if (c1 === c2) { res.replaceChildren(h('div', { class: 'banner loss' }, 'Both hole cards are the same.')); return; }
    const b = board.map(({ r, s }) => poker.cardIndex(r.value, s.value)).filter((c) => c != null);
    const all = [c1, c2, ...b];
    if (new Set(all).size < all.length) { res.replaceChildren(h('div', { class: 'banner loss' }, 'Duplicate cards.')); return; }
    runBtn.textContent = 'Running…';
    runBtn.disabled = true;
    setTimeout(() => {
      const r = poker.runMC([c1, c2], b, range.value, 1500);
      runBtn.textContent = 'Run simulation';
      runBtn.disabled = false;
      if (!r) { res.replaceChildren(h('div', { class: 'banner warn' }, 'Not enough villain combos. Try a wider range.')); return; }
      const hp = parseFloat(r.hero);
      const tone = hp >= 55 ? 'win' : hp >= 40 ? 'gold' : 'loss';
      res.replaceChildren(
        h('div', { class: 'big-result t-' + tone }, r.hero + '%'),
        h('div', { class: 'pmeta center' }, 'Your equity'),
        h('div', { class: 'eq-bar' },
          h('i', { style: `width:${r.hero}%` }),
          h('i', { class: 'tie', style: `width:${r.tie}%` }),
          h('i', { class: 'vil', style: `width:${r.villain}%` }),
        ),
        h('div', { class: 'stat-grid' },
          statBox(r.hero + '%', 'Hero', tone),
          statBox(r.villain + '%', 'Villain', 'loss'),
        ),
        h('p', { class: 'muted small' }, `Board: ${b.length ? b.map(poker.cardLabel).join(' ') : 'preflop'} · tie ${r.tie}% · 1,500 sims`),
      );
      fx.haptic(12);
    }, 10);
  };
  runBtn.addEventListener('click', run);

  return [
    toolHead('Equity'),
    h('div', { class: 'card' },
      h('h2', {}, 'Hand vs range'),
      h('p', { class: 'muted small' }, 'Monte-Carlo simulation, 1,500 runs.'),
      h('label', {}, 'Your hand'),
      h('div', { class: 'field-grid two' },
        h('div', { class: 'card-pick' }, hR1, hS1),
        h('div', { class: 'card-pick' }, hR2, hS2),
      ),
      h('label', {}, 'Board (optional)'),
      h('div', { class: 'board-grid' }, ...board.map(({ r, s }) => h('div', { class: 'card-pick' }, r, s))),
      h('label', {}, 'Villain range'), range,
      runBtn,
    ),
    h('div', { class: 'card' }, h('h2', {}, 'Result'), res),
    backbar(),
  ];
}

// ---------- Study ----------

const SIZING = [
  ['25% pot', 'Thin value on ultra-dry boards; deny equity cheaply vs weak ranges', 'AA on 2-2-7 rainbow; K-7-2 vs wide BB'],
  ['33% pot', 'Low SPR; value-heavy range on dry boards; high-frequency c-bets', 'Single-raised pot on A-x-x dry; nut flushes on two-tone turn'],
  ['50% pot', 'Balanced polar range; most common river size; draws + top of range', 'Flush draws; top pair good kicker; value on non-monotone'],
  ['66% pot', 'Moderately polar; equity denial on dynamic boards; semi-bluffs', 'Wet flops (J-T-9); sets; combo draws'],
  ['75% pot', 'OOP protection; strong hands vs multi-street draws', 'OOP two pair on turn vs flush/straight draws'],
  ['Pot', 'Heavily polar; nuts vs bluffs only; force fold-or-call', 'Sets vs 4-flush board; river jams; nut straights on paired boards'],
  ['Overbet', 'Nut-heavy range advantage; boards where one player has all the strong hands', 'Monotone boards (IP has all flushes); paired boards with sets'],
];

const BLOCKERS = [
  ['Ace in your hand', [
    'Removes 3 combos of AA (6 → 3) — villain less likely to hold the nuts in 3-bet pots',
    'Blocks AKs, AKo, AQs — fewer premium Ax to 4-bet-call with',
    'Great 4-bet bluff blocker; also blocks strong calling hands → good bluff candidate',
  ]],
  ['King in your hand', [
    'Blocks KK (6 → 3), KQs, KJs, KTs — reduces villain’s strong broadways',
    'Good 3-bet bluff card BTN vs UTG — unblocks villain’s folding range',
  ]],
  ['Flush card in hand', [
    'Each suited card you hold removes a card from villain’s flush-draw combos',
    'Holding A♥ on a 3-heart board → villain can’t have the nut flush; bluff-catch easier',
    'Bluffing with a flush blocker on the river is a core GTO concept',
  ]],
  ['Straight card in hand', [
    'Holding 9 on J-T-8 blocks the nut straight (QJ9x / 97x combos ~halved)',
    'Good bluff card when you block the nuts AND unblock villain’s weak hands',
  ]],
  ['The "unblocking" principle', [
    'Good bluffs should UNBLOCK villain’s folding range',
    'Bluff 6♥5♥ on K♠7♣2♦ — doesn’t block Kx / 7x which villain folds',
    'Avoid K♥6♥ on K-7-2 — the K reduces villain’s Kx folds',
  ]],
];

const CONCEPTS = [
  ['MDF — Minimum Defence Frequency', [
    'MDF = Pot ÷ (Pot + Bet). Half-pot bet → 67%. Pot-size → 50%.',
    'Fold more than (1 − MDF) and villain profits with any two cards as a bluff',
    'Use MDF to build calling ranges vs large bets — mix in raises and folds',
  ]],
  ['Alpha — break-even bluff frequency', [
    'α = Bet ÷ (Pot + Bet). Half-pot bluff needs 33% fold equity; pot-size needs 50%.',
    'If villain folds more than α, the bluff is immediately profitable regardless of your hand',
  ]],
  ['Range advantage & nut advantage', [
    'Range advantage: whose range connects better with the board (average equity)',
    'Nut advantage: who has more combos of the strongest hands — drives sizing',
    'IP has both on dry high boards (A-7-2); BB has range advantage on 7-6-5',
  ]],
  ['Polarization vs condensed range', [
    'Polar: only nuts + bluffs → prefer large sizes (pot, overbet)',
    'Condensed: medium hands, no nutted combos → prefer small sizes',
    '3-bet pot caller is condensed (no AA/KK); the 3-bettor is polar',
  ]],
  ['GTO vs exploitative', [
    'GTO: unexploitable baseline vs unknowns',
    'vs Fish (VPIP 50+, low PFR): remove bluffs, value-bet thinner, size up',
    'vs Nit (<15% VPIP): 3-bet wider, steal every unopened pot, fold to 3-bets',
    'Use GTO as a baseline; deviate once you have two or more reliable reads',
  ]],
];

export function viewStudy() {
  const sizing = h('div', { class: 'inner-panel' },
    refTable(['Size', 'When to use', 'Common spots'], SIZING),
    h('p', { class: 'muted small' }, 'Smaller sizes → higher frequency, more bluffs. Larger → more polar. Match size to range polarity, not just hand strength.'),
  );
  const blockers = h('div', { class: 'inner-panel', hidden: 'true' },
    ...BLOCKERS.map(([t, pts]) => h('div', { class: 'concept-item' },
      h('div', { class: 'concept-hd' }, t), notesList(pts))),
  );
  const concepts = h('div', { class: 'inner-panel', hidden: 'true' },
    ...CONCEPTS.map(([t, pts]) => h('div', { class: 'concept-item' },
      h('div', { class: 'concept-hd' }, t), notesList(pts))),
  );
  const panels = { sizing, blockers, concepts };
  const order = ['sizing', 'blockers', 'concepts'];
  const tabBtns = order.map((k) =>
    h('button', { class: 'inner-tab' + (k === 'sizing' ? ' on' : ''), onclick: () => {
      tabBtns.forEach((btn, i) => btn.classList.toggle('on', order[i] === k));
      order.forEach((x) => { panels[x].hidden = x !== k; });
    } }, k[0].toUpperCase() + k.slice(1)),
  );

  return [
    toolHead('Study'),
    h('div', { class: 'card' },
      h('div', { class: 'inner-tabs' }, ...tabBtns),
      sizing, blockers, concepts,
    ),
    backbar(),
  ];
}

// ---------- My Sessions (cash-game ledger) ----------

const PTYPES = [
  ['Nit', 'VPIP <15 · PFR <12', [['red', 'Fold to 3-bets'], ['win', 'Steal wide']]],
  ['TAG', 'VPIP 20-28 · PFR 16-22', [['blue', 'Play GTO'], ['gold', 'Respect 3-bets']]],
  ['LAG', 'VPIP 28+ · PFR 22+ · 3b 8%+', [['win', '4-bet more'], ['red', 'Tighten 3-bet bluffs']]],
  ['Fish / station', 'VPIP 45+ · PFR <10', [['win', 'Value-bet thin'], ['red', 'No bluffs']]],
  ['Maniac', 'VPIP 55+ · PFR 45+ · 3b 15%+', [['win', 'Call down wider'], ['gold', 'Trap AA/KK']]],
];

function ptypeTable() {
  const t = h('table', { class: 'ref-table' });
  t.append(h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Stats'), h('th', {}, 'Adjust')));
  PTYPES.forEach(([name, stats, tags]) => {
    t.append(h('tr', {},
      h('td', { class: 'rt-key' }, name),
      h('td', { class: 'ptype-stats' }, stats),
      h('td', {}, ...tags.map(([tone, label]) => h('span', { class: 'adjust-tag t-' + tone }, label))),
    ));
  });
  return h('div', { class: 'scroll-x' }, t);
}

export function viewSessions() {
  const sym = () => currencySymbol(currencyCode());
  let list = loadSessionLog();
  const fmt = (n) => (n >= 0 ? '+' : '−') + sym() + Math.abs(n).toFixed(2);
  const fmtAbs = (n) => sym() + Math.abs(n).toFixed(2);

  const dateIn = h('input', { type: 'date', 'aria-label': 'Date' });
  dateIn.value = new Date().toISOString().split('T')[0];
  const gameIn = h('input', { type: 'text', placeholder: 'e.g. NL50, 1/2 live' });
  const buyIn = h('input', { type: 'number', inputmode: 'decimal', placeholder: 'e.g. 100', min: '0' });
  const cashIn = h('input', { type: 'number', inputmode: 'decimal', placeholder: 'e.g. 145', min: '0' });
  const hoursIn = h('input', { type: 'number', inputmode: 'decimal', placeholder: 'e.g. 3.5', min: '0', step: '0.25' });
  const notesIn = h('input', { type: 'text', placeholder: 'Reads, leaks, observations…' });

  const totals = h('div', { class: 'stat-grid' });
  const logWrap = h('div', {});
  const pnlCanvas = h('canvas', { class: 'chart', height: '150' });
  const barCanvas = h('canvas', { class: 'chart', height: '150' });

  const renderTotals = () => {
    const profit = list.reduce((a, s) => a + (s.cashout - s.buyin), 0);
    const hours = list.reduce((a, s) => a + (s.hours || 0), 0);
    const buyins = list.reduce((a, s) => a + s.buyin, 0);
    totals.replaceChildren(
      statBox(fmt(profit), 'Total profit', profit >= 0 ? 'win' : 'loss'),
      statBox(String(list.length), 'Sessions'),
      statBox(hours > 0 ? fmt(profit / hours) : '—', 'Hourly'),
      statBox(buyins > 0 ? ((profit / buyins) * 100).toFixed(1) + '%' : '—', 'Avg ROI'),
    );
  };
  const renderLog = () => {
    if (!list.length) { logWrap.replaceChildren(h('p', { class: 'muted empty' }, 'No sessions yet. Add your first above.')); return; }
    const table = h('table', { class: 'sess-table' });
    table.append(h('tr', {}, ...['Date', 'Game', 'Buy-in', 'Cash-out', 'P/L', 'Hrs', ''].map((x) => h('th', {}, x))));
    [...list].reverse().forEach((s) => {
      const p = s.cashout - s.buyin;
      table.append(h('tr', {},
        h('td', {}, s.date),
        h('td', {}, s.game || '—'),
        h('td', {}, fmtAbs(s.buyin)),
        h('td', {}, fmtAbs(s.cashout)),
        h('td', { class: p >= 0 ? 'net-win' : 'net-loss' }, fmt(p)),
        h('td', {}, (s.hours || 0) + 'h'),
        h('td', {}, h('button', { class: 'sm ghost icon-only', 'aria-label': 'Delete session', html: fx.icon('trash'),
          onclick: () => { if (confirm('Delete this session?')) { list = deleteSessionLog(s.id); redraw(); } } })),
      ));
    });
    logWrap.replaceChildren(h('div', { class: 'scroll-x' }, table));
  };
  const redraw = () => {
    renderTotals();
    renderLog();
    let run = 0;
    requestAnimationFrame(() => {
      drawLineChart(pnlCanvas, list.map((s) => (run += s.cashout - s.buyin)), sym());
      drawBarChart(barCanvas, list.map((s) => s.cashout - s.buyin), sym());
    });
  };
  const add = () => {
    const buyin = parseFloat(buyIn.value);
    const cashout = parseFloat(cashIn.value);
    if (!dateIn.value || !(buyin >= 0) || !(cashout >= 0)) { nav.toast('Fill in date, buy-in and cash-out'); return; }
    list = addSessionLog({
      date: dateIn.value, game: gameIn.value.trim(), buyin, cashout,
      hours: parseFloat(hoursIn.value) || 0, notes: notesIn.value.trim(),
    });
    [gameIn, buyIn, cashIn, hoursIn, notesIn].forEach((el) => (el.value = ''));
    fx.haptic(12);
    redraw();
  };
  redraw();

  return [
    toolHead('My Sessions'),
    h('div', { class: 'card' },
      h('h2', {}, 'Log a session'),
      h('label', {}, 'Date'), dateIn,
      h('label', {}, 'Game / stakes'), gameIn,
      h('label', {}, 'Buy-in'), buyIn,
      h('label', {}, 'Cash-out'), cashIn,
      h('label', {}, 'Hours'), hoursIn,
      h('label', {}, 'Notes'), notesIn,
      h('button', { class: 'primary wide', html: fx.icon('plus') + 'Add session', onclick: add }),
    ),
    h('div', { class: 'card' }, h('h2', {}, 'Totals'), totals),
    h('div', { class: 'card' }, h('h2', {}, 'History'), logWrap),
    h('div', { class: 'card' },
      h('h2', {}, 'Analytics'),
      h('div', { class: 'chart-lbl' }, 'Cumulative P&L'), pnlCanvas,
      h('div', { class: 'chart-lbl' }, 'Profit per session'), barCanvas,
    ),
    h('div', { class: 'card' }, h('h2', {}, 'Player types'), ptypeTable()),
    backbar(),
  ];
}

// ---------- Players roster ----------

function rosterLifetime(name) {
  const key = name.trim().toLowerCase();
  let games = 0;
  let total = 0;
  for (const s of loadHistory()) {
    for (const p of s.players || []) {
      if (p.name.trim().toLowerCase() === key) {
        games += 1;
        total += net(p) || 0;
      }
    }
  }
  return { games, total };
}

export function viewRoster() {
  let roster = loadRoster();
  const list = h('div', {});

  const render = () => {
    roster = loadRoster();
    list.replaceChildren(
      ...(roster.length
        ? roster.map((r) => {
            const lt = rosterLifetime(r.name);
            const noteEl = h('input', {
              type: 'text', value: r.note || '', placeholder: 'Private note — reads, leaks…',
              'aria-label': 'Note for ' + r.name,
              onchange: () => upsertRosterPlayer({ id: r.id, name: r.name, note: noteEl.value }),
            });
            return h('div', { class: 'card' },
              h('div', { class: 'row' },
                h('div', { class: 'phead' },
                  avatar(r.name),
                  h('div', { class: 'pinfo' },
                    h('div', { class: 'pname' }, r.name),
                    h('div', { class: 'pmeta' },
                      lt.games
                        ? `${lt.games} game${lt.games === 1 ? '' : 's'} · ${lt.total >= 0 ? '+' : '−'}${fmtMoney(Math.abs(lt.total))} lifetime`
                        : 'No games yet'),
                  ),
                ),
                h('div', { class: 'card-actions' },
                  lt.games
                    ? h('button', { class: 'sm ghost icon-only', 'aria-label': 'Stats for ' + r.name, html: fx.icon('graph'),
                        onclick: () => { nav.state.statsPlayer = r.name; nav.go('playerstats'); } })
                    : null,
                  h('button', { class: 'sm danger icon-only', 'aria-label': 'Remove ' + r.name, html: fx.icon('trash'),
                    onclick: () => { if (confirm(`Remove ${r.name} from the roster?`)) { deleteRosterPlayer(r.id); render(); } } }),
                ),
              ),
              noteEl,
            );
          })
        : [h('p', { class: 'muted empty' }, 'No saved players yet. Add your regulars below.')]),
    );
  };
  render();

  const addIn = h('input', {
    type: 'text', placeholder: 'Player name, press Enter', enterkeyhint: 'done', autocomplete: 'off',
    onkeydown: (e) => {
      if (e.key === 'Enter' && addIn.value.trim()) {
        upsertRosterPlayer({ name: addIn.value.trim() });
        addIn.value = '';
        render();
        fx.haptic(10);
      }
    },
  });

  return [
    toolHead('Players'),
    h('div', { class: 'card' },
      h('h2', {}, 'Add a regular'),
      addIn,
      h('p', { class: 'muted small' }, 'Saved players show up as one-tap chips when you start a game. Notes stay on this device only.'),
    ),
    list,
    backbar(),
  ];
}

// ---------- per-player home-game stats ----------

export function viewPlayerStats(name) {
  const key = (name || '').trim().toLowerCase();
  const games = [];
  for (const s of loadHistory()) {
    for (const p of s.players || []) {
      if (p.name.trim().toLowerCase() === key) games.push({ when: s.startedAt || 0, n: net(p) || 0 });
    }
  }
  games.sort((a, b) => a.when - b.when);
  const n = games.length;
  const total = games.reduce((a, g) => a + g.n, 0);
  const wins = games.filter((g) => g.n > 0).length;
  const best = n ? Math.max(...games.map((g) => g.n)) : 0;
  const worst = n ? Math.min(...games.map((g) => g.n)) : 0;
  const avg = n ? Math.round(total / n) : 0;
  const signed = (v) => (v >= 0 ? '+' : '−') + fmtMoney(Math.abs(v));

  const chart = h('canvas', { class: 'chart', height: '150' });
  if (n > 1) {
    requestAnimationFrame(() => {
      let run = 0;
      drawLineChart(chart, games.map((g) => (run += g.n)), currencySymbol(currencyCode()));
    });
  }

  return [
    h('div', { class: 'tool-head' },
      h('button', { class: 'sm ghost icon-only', 'aria-label': 'Back', html: fx.icon('back'), onclick: () => nav.go('history') }),
      h('h1', {}, name || 'Player'),
    ),
    n
      ? h('div', { class: 'card' },
          h('div', { class: 'stat-grid' },
            statBox(String(n), n === 1 ? 'Game' : 'Games'),
            statBox(signed(total), 'Net', total >= 0 ? 'win' : 'loss'),
            statBox(Math.round((wins / n) * 100) + '%', 'Win rate'),
            statBox(signed(avg), 'Avg / game', avg >= 0 ? 'win' : 'loss'),
            statBox(best > 0 ? '+' + fmtMoney(best) : fmtMoney(0), 'Best night', best > 0 ? 'win' : ''),
            statBox(worst < 0 ? '−' + fmtMoney(-worst) : fmtMoney(0), 'Worst night', worst < 0 ? 'loss' : ''),
          ),
        )
      : h('p', { class: 'muted empty' }, 'No saved games for this player yet.'),
    n > 1 ? h('div', { class: 'card' }, h('div', { class: 'chart-lbl' }, 'Cumulative net'), chart) : null,
    h('div', { class: 'actionbar' },
      h('button', { class: 'ghost wide', html: fx.icon('back') + 'History', onclick: () => nav.go('history') }),
    ),
  ];
}

// ---------- Data (backup / restore) ----------

export function viewData() {
  const status = h('p', { class: 'muted' });
  const setStatus = () => {
    const s = summarize();
    const ago = s.lastExportAt
      ? (() => {
          const d = Math.floor((Date.now() - s.lastExportAt) / 86400000);
          return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
        })()
      : 'never';
    status.textContent = `${s.games} game${s.games === 1 ? '' : 's'} · ${s.sessions} session${s.sessions === 1 ? '' : 's'} · ${s.roster} roster · last backup ${ago}`;
  };
  setStatus();

  const doExport = () => {
    try {
      const blob = exportBlob();
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `poker-night-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      markExported();
      setStatus();
      nav.toast('Backup downloaded');
    } catch (e) {
      nav.toast('Export failed');
    }
  };

  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: 'true' });
  fileIn.addEventListener('change', () => {
    const file = fileIn.files && fileIn.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let obj;
      try { obj = JSON.parse(reader.result); } catch (e) { nav.toast('Not a valid file'); return; }
      const mode = confirm('Replace everything with this backup?\n\nOK = replace all\nCancel = merge (keep both)')
        ? 'replace'
        : 'merge';
      const res = importAll(obj, { mode });
      if (!res.ok) { nav.toast(res.error || 'Import failed'); return; }
      nav.toast(`Restored — ${res.summary.games} games, ${res.summary.sessions} sessions`);
      fx.haptic([12, 40, 12]);
      nav.go('home');
    };
    reader.readAsText(file);
    fileIn.value = '';
  });

  return [
    toolHead('Data'),
    h('div', { class: 'card' },
      h('h2', {}, 'Backup'),
      status,
      h('p', { class: 'muted small' }, 'Everything lives in this browser only. Download a backup file now and again — restoring it moves your history to a new phone or brings it back after a wipe.'),
      h('button', { class: 'primary wide', html: fx.icon('download') + 'Download backup', onclick: doExport }),
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Restore'),
      h('p', { class: 'muted small' }, 'Load a backup file. You choose replace (wipe and load) or merge (keep both sets, de-duped).'),
      h('button', { class: 'ghost wide', html: fx.icon('upload') + 'Restore from file', onclick: () => fileIn.click() }),
      fileIn,
    ),
    backbar(),
  ];
}

// ---------- registry ----------

export const TOOL_VIEWS = {
  home: viewHome,
  roster: viewRoster,
  data: viewData,
  playerstats: () => viewPlayerStats(nav.state.statsPlayer),
  bbcalc: viewBBCalc,
  ranges: viewRanges,
  action: viewAction,
  odds: viewOdds,
  quiz: viewQuiz,
  equity: viewEquity,
  study: viewStudy,
  sessions: viewSessions,
};
