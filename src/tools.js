// The poker study tools, rebuilt as native views in the felt/gold theme.
// Each exported view returns a node array, same shape as app.js's game views.

import { h, avatar } from './ui.js';
import * as fx from './fx.js';
import { fmtMoney, currencySymbol, currencyCode, allCurrencies, currencyName, setCurrency } from './money.js';
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
  loadCustomRanges,
  saveCustomRange,
  deleteCustomRange,
  loadSoundOn,
  saveSoundOn,
} from './state.js';
import { sessionNets, icmEquities, payouts as tPayouts, prizePool as tPrizePool } from './tournament.js';
import { exportBlob, importAll, summarize, markExported } from './backup.js';
import { qrSvg } from './qr.js';
import { resultsImageBlob, resultsImageFile } from './share-image.js';
import { setSoundEnabled, chip as soundChip } from './sound.js';
import { installBanner, installGuideNodes } from './install.js';
import { syncConfigured } from './config.js';
import { syncPill } from './sync-ui.js';

// ---------- controller hook (set once by app.js to avoid a circular import) ----------

// A shared, mutable context. app.js fills it at boot; other view modules
// (tournament-views) import this same object.
export const nav = { go() {}, toast() {}, state: {}, save() {}, render() {} };
export function setNav(n) {
  Object.assign(nav, n);
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

// ---------- bottom-sheet currency picker (shared with app.js + tournament) ----------

export function openCurrencyPicker(currentCode, onPick) {
  const all = allCurrencies();
  const rows = h('div', { class: 'sheet-list' });
  const search = h('input', {
    type: 'search', placeholder: 'Search currency or code', 'aria-label': 'Search currency',
    autocomplete: 'off', enterkeyhint: 'search',
  });
  const paint = (q) => {
    const term = q.trim().toLowerCase();
    const list = term
      ? all.filter((c) => c.code.toLowerCase().includes(term) || c.name.toLowerCase().includes(term))
      : all;
    const items = list.slice(0, 400).map((c) =>
      h('button', {
        class: 'currency-row' + (c.code === currentCode ? ' on' : ''),
        onclick: () => { close(); onPick(c.code); },
      },
        h('span', { class: 'cur-sym' }, c.symbol),
        h('span', { class: 'cur-name' }, c.name),
        h('span', { class: 'cur-code' }, c.code),
      ),
    );
    if (!list.length) items.push(h('p', { class: 'muted empty' }, 'No currency matches that.'));
    rows.replaceChildren(...items);
  };
  search.addEventListener('input', () => paint(search.value));
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose currency' },
    h('div', { class: 'sheet-head' },
      h('b', {}, 'Currency'),
      h('button', { class: 'sm ghost icon-only', 'aria-label': 'Close', html: fx.icon('close'), onclick: () => close() }),
    ),
    search,
    rows,
  );
  const wrap = h('div', { class: 'sheet-wrap' },
    h('div', { class: 'sheet-backdrop', onclick: () => close() }),
    sheet,
  );
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    document.removeEventListener('keydown', onKey);
    wrap.classList.add('closing');
    setTimeout(() => wrap.remove(), 200);
  }
  document.addEventListener('keydown', onKey);
  document.body.append(wrap);
  paint('');
  setTimeout(() => search.focus(), 60);
}

// ---------- generic bottom sheet (share image / QR) ----------

export function openSheet(title, bodyNodes) {
  const body = h('div', { class: 'sheet-list' }, ...[].concat(bodyNodes).filter(Boolean));
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' },
      h('b', {}, title),
      h('button', { class: 'sm ghost icon-only', 'aria-label': 'Close', html: fx.icon('close'), onclick: () => close() }),
    ),
    body,
  );
  const wrap = h('div', { class: 'sheet-wrap' },
    h('div', { class: 'sheet-backdrop', onclick: () => close() }),
    sheet,
  );
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    document.removeEventListener('keydown', onKey);
    wrap.classList.add('closing');
    setTimeout(() => wrap.remove(), 200);
  }
  document.addEventListener('keydown', onKey);
  document.body.append(wrap);
  fx.attachRipples(wrap);
  return { close, body };
}

export function showQR(url) {
  let svg = '';
  try {
    svg = qrSvg(url, { ecc: 'M', border: 3, dark: '#0b1f16', light: '#ffffff' });
  } catch (e) {
    nav.toast('Link too long for a QR');
    return;
  }
  openSheet('Scan to open', [
    h('div', { class: 'qr-box', html: svg }),
    h('p', { class: 'muted small qr-url' }, url),
    h('button', { class: 'ghost wide', html: fx.icon('copy') + 'Copy link', onclick: async () => {
      try { await navigator.clipboard.writeText(url); nav.toast('Link copied'); } catch (e) { nav.toast('Copy failed'); }
    } }),
  ]);
}

export async function showResultsImage(data) {
  const name = (slug(data.title) || 'poker-night') + '.png';
  const img = h('img', { class: 'share-img', alt: 'Results card' });
  const status = h('p', { class: 'muted small' }, 'Rendering…');
  const saveBtn = h('button', { class: 'primary wide', html: fx.icon('download') + 'Save image', disabled: 'true' });
  const shareBtn = h('button', { class: 'ghost wide', html: fx.icon('share') + 'Share…' });
  shareBtn.hidden = true;
  openSheet('Results image', [
    h('div', { class: 'share-img-wrap' }, img, status),
    h('div', { class: 'sheet-actions' }, saveBtn, shareBtn),
  ]);
  try {
    const blob = await resultsImageBlob(data);
    const url = URL.createObjectURL(blob);
    img.src = url;
    status.remove();
    saveBtn.removeAttribute('disabled');
    saveBtn.onclick = () => {
      const a = h('a', { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      nav.toast('Image saved');
    };
    try {
      const file = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        shareBtn.hidden = false;
        shareBtn.onclick = async () => {
          try { await navigator.share({ files: [file], title: data.title }); } catch (e) {}
        };
      }
    } catch (e) {}
  } catch (e) {
    status.textContent = 'Could not render the image on this device.';
  }
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---------- Home hub ----------

const TILES = [
  ['roster', 'users', 'Players', 'Saved regulars & notes'],
  ['bbcalc', 'calc', 'BB Calc', 'Stack in big blinds'],
  ['ranges', 'grid', 'Ranges', 'Opening charts by seat'],
  ['action', 'target', 'Action', 'Preflop advisor'],
  ['odds', 'percent', 'Odds & SPR', 'Pot odds, equity, SPR'],
  ['quiz', 'dice', 'Range Quiz', 'Drill your ranges'],
  ['equity', 'graph', 'Equity', 'Hand vs range'],
  ['icm', 'scale', 'ICM / Chop', 'Fair split by chip stacks'],
  ['study', 'book', 'Study', 'Sizing, blockers, theory'],
  ['sessions', 'ledger', 'My Sessions', 'Personal cash-game log'],
  ['data', 'database', 'Data & sound', 'Backup, restore, sound'],
];

export function viewHome() {
  const s = nav.state.session;
  const hist = loadHistory();
  const banner = installBanner(() => openSheet('Add to Home Screen', installGuideNodes()));
  const tiles = syncConfigured()
    ? [['account', 'user', 'Account', 'Sign in · sync your games'], ...TILES]
    : TILES;
  return [
    h('div', { class: 'home-head' },
      h('h1', { html: fx.icon('spade') + 'Poker Night' }),
      syncConfigured() ? syncPill(nav.syncStatus) : null,
    ),
    h('p', { class: 'muted' }, 'Run the game. Sharpen the game.'),
    banner,
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
      ...tiles.map(([v, ic, name, desc]) =>
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

const RG_CLASS = { raise: 'rg-open', mix: 'rg-mix', call: 'rg-call', in: 'rg-open', fold: 'rg-fold' };
const legend = (items) =>
  h('div', { class: 'legend' }, ...items.map(([c, l]) => h('span', {}, h('i', { class: 'sw sw-' + c }), l)));

function paintRangeGrid(gridEl, statusFn, onCell) {
  const table = h('table', { class: 'range-grid' + (onCell ? ' editable' : '') });
  const hr = h('tr', {}, h('th', {}));
  poker.RANKS.forEach((r) => hr.append(h('th', {}, r)));
  table.append(hr);
  for (let i = 0; i < 13; i++) {
    const tr = h('tr', {}, h('th', {}, poker.RANKS[i]));
    for (let j = 0; j < 13; j++) {
      const k = poker.handKey(i, j);
      const td = h('td', { class: 'rg ' + (RG_CLASS[statusFn(k)] || 'rg-fold') }, k.length === 2 ? k : k.slice(0, 3));
      if (onCell) td.addEventListener('click', () => onCell(k, td));
      tr.append(td);
    }
    table.append(tr);
  }
  gridEl.replaceChildren(table);
}

export function viewRanges() {
  const mode = nav.state.rangesMode || (nav.state.rangesMode = 'rfi');
  const setMode = (m) => { nav.state.rangesMode = m; nav.render(); };
  const modeBar = h('div', { class: 'inner-tabs' },
    ...[['rfi', 'Open'], ['vsopen', 'Vs open'], ['defend', 'BB defend'], ['build', 'Build']].map(([m, l]) =>
      h('button', { class: 'inner-tab' + (m === mode ? ' on' : ''), onclick: () => setMode(m) }, l)));

  const grid = h('div', { class: 'scroll-x' });
  let card;

  if (mode === 'rfi') {
    const players = sel(['2', '3', '4', '5', '6', '7', '8', '9'], { 'aria-label': 'Players' });
    players.value = '8';
    const pos = sel([], { 'aria-label': 'Position' });
    const depth = sel([['20', '20 BB'], ['40', '40 BB'], ['60', '60 BB'], ['100', '100 BB']], { 'aria-label': 'Depth' });
    depth.value = '40';
    const fillPos = () => {
      const list = poker.positionsByPlayers[parseInt(players.value, 10)] || poker.positionsByPlayers[8];
      pos.replaceChildren(...list.map((x) => h('option', { value: x }, x)));
      pos.value = list[0];
    };
    const draw = () => {
      let base = poker.mapToBase8(parseInt(players.value, 10), pos.value).replace('UTG+1', 'UTG1').replace('UTG+2', 'UTG2');
      if (base === 'UTG2') base = 'LJ';
      const d = parseInt(depth.value, 10);
      paintRangeGrid(grid, (k) => {
        const st = poker.rfiStatus(base, k, d);
        return st === 'open' ? 'raise' : st;
      });
    };
    fillPos();
    draw();
    players.addEventListener('change', () => { fillPos(); draw(); });
    pos.addEventListener('change', draw);
    depth.addEventListener('change', draw);
    card = h('div', { class: 'card' },
      h('h2', {}, 'Opening range (RFI)'),
      h('div', { class: 'field-grid' },
        h('div', {}, h('label', {}, 'Players'), players),
        h('div', {}, h('label', {}, 'Position'), pos),
        h('div', {}, h('label', {}, 'Depth'), depth)),
      h('p', { class: 'muted small' }, 'Upper-right = suited · lower-left = offsuit · diagonal = pairs.'),
      grid,
      legend([['open', 'Open'], ['mix', 'Mix'], ['fold', 'Fold']]),
    );
  } else if (mode === 'vsopen') {
    const heroSel = sel(['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    heroSel.value = 'BTN';
    const opSel = sel(poker.BASE_POSITIONS);
    opSel.value = 'CO';
    const draw = () => paintRangeGrid(grid, (k) => poker.rangeStatus('vsopen', heroSel.value, opSel.value, k));
    draw();
    [heroSel, opSel].forEach((el) => el.addEventListener('change', draw));
    card = h('div', { class: 'card' },
      h('h2', {}, 'Facing an open'),
      h('div', { class: 'field-grid two' },
        h('div', {}, h('label', {}, 'Your seat'), heroSel),
        h('div', {}, h('label', {}, 'Opener'), opSel)),
      h('p', { class: 'muted small' }, '100 BB. Gold = 3-bet for value, lime = 3-bet bluff / mix, blue = call.'),
      grid,
      legend([['open', '3-bet'], ['mix', 'Bluff/mix'], ['call', 'Call'], ['fold', 'Fold']]),
    );
  } else if (mode === 'defend') {
    const opSel = sel(poker.BASE_POSITIONS.filter((p) => p !== 'BB'));
    opSel.value = 'BTN';
    const draw = () => paintRangeGrid(grid, (k) => poker.rangeStatus('defend', 'BB', opSel.value, k));
    draw();
    opSel.addEventListener('change', draw);
    card = h('div', { class: 'card' },
      h('h2', {}, 'Defending the big blind'),
      h('label', {}, 'Opener'), opSel,
      h('p', { class: 'muted small' }, 'You are in the BB getting a price. Gold = 3-bet, lime = bluff, blue = call.'),
      grid,
      legend([['open', '3-bet'], ['mix', 'Bluff'], ['call', 'Call'], ['fold', 'Fold']]),
    );
  } else {
    // build
    const b = nav.state.rangeBuild || (nav.state.rangeBuild = { hands: [], name: '' });
    const set = new Set(b.hands);
    const count = h('span', { class: 'pmeta' });
    const sync = () => { b.hands = [...set]; count.textContent = `${set.size} combos`; };
    paintRangeGrid(grid, (k) => (set.has(k) ? 'in' : 'fold'), (k, td) => {
      if (set.has(k)) { set.delete(k); td.className = 'rg rg-fold'; } else { set.add(k); td.className = 'rg rg-open'; }
      sync();
    });
    sync();
    const nameIn = h('input', { type: 'text', placeholder: 'Range name', value: b.name, oninput: () => { b.name = nameIn.value; } });
    const saved = loadCustomRanges();
    card = h('div', { class: 'card' },
      h('h2', {}, 'Build a range'),
      h('p', { class: 'muted small' }, 'Tap cells to add / remove, then save it and use it as a hero or villain range in Equity.'),
      grid,
      count,
      nameIn,
      h('div', { class: 'btn-row' },
        h('button', { class: 'primary', html: fx.icon('check') + 'Save', onclick: () => {
          if (!b.name.trim()) return nav.toast('Name it first');
          if (!set.size) return nav.toast('Add some hands');
          saveCustomRange(b.name.trim(), set);
          nav.toast('Saved');
          nav.render();
        } }),
        h('button', { class: 'ghost', html: fx.icon('trash') + 'Clear', onclick: () => { nav.state.rangeBuild = { hands: [], name: b.name }; nav.render(); } }),
      ),
      saved.length
        ? h('div', {},
            h('h2', {}, 'Saved ranges'),
            ...saved.map((r) => h('div', { class: 'kitty-row' },
              h('span', { class: 'kr-name' }, `${r.name} · ${r.hands.length}`),
              h('button', { class: 'sm ghost', html: 'Load', onclick: () => { nav.state.rangeBuild = { hands: [...r.hands], name: r.name }; nav.render(); } }),
              h('button', { class: 'sm danger icon-only', 'aria-label': 'Delete ' + r.name, html: fx.icon('close'),
                onclick: () => { if (confirm(`Delete "${r.name}"?`)) { deleteCustomRange(r.id); nav.render(); } } }),
            )))
        : null,
    );
  }

  return [toolHead('Ranges'), modeBar, card, backbar()];
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
  const pick = (defR, defS, req) => {
    const r = mkRank(req);
    const s = mkSuit(req);
    if (defR) r.value = defR;
    if (defS) s.value = defS;
    return { r, s, idx: () => poker.cardIndex(r.value, s.value), el: h('div', { class: 'card-pick' }, r, s) };
  };

  const custom = loadCustomRanges();
  const rangeOpts = [
    ['random', 'Random — any two'],
    ['wide', 'Wide — pairs, broadways, SC (~30%)'],
    ['strong', 'Strong — 99+, ATs+, AQo+ (~12%)'],
    ['premium', 'Premium — JJ+, AK (~4%)'],
    ...custom.map((c) => ['custom:' + c.id, `${c.name} (${c.hands.length})`]),
  ];
  const rangeSpec = (val) => {
    if (val && val.startsWith('custom:')) {
      const c = custom.find((x) => 'custom:' + x.id === val);
      return c ? new Set(c.hands) : 'random';
    }
    return val;
  };

  // hero
  const hH1 = pick('A', 's', false);
  const hH2 = pick('K', 'd', false);
  const heroHandUI = h('div', { class: 'field-grid two' }, hH1.el, hH2.el);
  const heroRangeSel = sel(rangeOpts);
  heroRangeSel.value = 'strong';
  const heroRangeUI = h('div', { hidden: 'true' }, heroRangeSel);
  let heroMode = 'hand';
  const heroSeg = h('div', { class: 'seg' },
    h('button', { class: 'seg-btn on', onclick: () => setHero('hand') }, 'A hand'),
    h('button', { class: 'seg-btn', onclick: () => setHero('range') }, 'A range'));
  const setHero = (m) => {
    heroMode = m;
    heroHandUI.hidden = m !== 'hand';
    heroRangeUI.hidden = m !== 'range';
    [...heroSeg.children].forEach((btn, i) => btn.classList.toggle('on', ['hand', 'range'][i] === m));
  };

  // villain
  const vH1 = pick('', '', false);
  const vH2 = pick('', '', false);
  const villHandUI = h('div', { class: 'field-grid two', hidden: 'true' }, vH1.el, vH2.el);
  const villRangeSel = sel(rangeOpts);
  villRangeSel.value = 'strong';
  const villRangeUI = h('div', {}, villRangeSel);
  let villMode = 'range';
  const villSeg = h('div', { class: 'seg' },
    h('button', { class: 'seg-btn on', onclick: () => setVill('range') }, 'A range'),
    h('button', { class: 'seg-btn', onclick: () => setVill('hand') }, 'A hand'));
  const setVill = (m) => {
    villMode = m;
    villRangeUI.hidden = m !== 'range';
    villHandUI.hidden = m !== 'hand';
    [...villSeg.children].forEach((btn, i) => btn.classList.toggle('on', ['range', 'hand'][i] === m));
  };

  // board
  const board = Array.from({ length: 5 }, () => pick('', '', false));

  const res = h('div', {}, h('p', { class: 'muted empty' }, 'Set it up and run.'));
  const runBtn = h('button', { class: 'primary wide', html: 'Run simulation' });

  const run = () => {
    const b = board.map((p) => p.idx()).filter((c) => c != null);
    const used = [...b];
    let heroCards = null;
    const opts = {};

    if (heroMode === 'hand') {
      const c1 = hH1.idx();
      const c2 = hH2.idx();
      if (c1 == null || c2 == null) return fail('Pick both of your cards.');
      heroCards = [c1, c2];
      used.push(c1, c2);
    } else {
      opts.hero = rangeSpec(heroRangeSel.value);
    }

    if (villMode === 'hand') {
      const c1 = vH1.idx();
      const c2 = vH2.idx();
      if (c1 == null || c2 == null) return fail("Pick both of the villain's cards.");
      opts.villainHand = [c1, c2];
      used.push(c1, c2);
    } else {
      opts.villain = rangeSpec(villRangeSel.value);
    }

    if (new Set(used).size < used.length) return fail('Duplicate cards.');

    runBtn.textContent = 'Running…';
    runBtn.disabled = true;
    setTimeout(() => {
      const r = poker.runMC(heroCards, b, opts, 2000);
      runBtn.textContent = 'Run simulation';
      runBtn.disabled = false;
      if (!r) return fail('Not enough combos — widen a range.');
      const hp = parseFloat(r.hero);
      const tone = hp >= 55 ? 'win' : hp >= 40 ? 'gold' : 'loss';
      const label = (heroMode === 'hand' ? poker.comboKey(...heroCards) : 'your range') +
        ' vs ' + (villMode === 'hand' ? poker.comboKey(opts.villainHand[0], opts.villainHand[1]) : 'their range');
      res.replaceChildren(
        h('div', { class: 'big-result t-' + tone }, r.hero + '%'),
        h('div', { class: 'pmeta center' }, label),
        h('div', { class: 'eq-bar' },
          h('i', { style: `width:${r.hero}%` }),
          h('i', { class: 'tie', style: `width:${r.tie}%` }),
          h('i', { class: 'vil', style: `width:${r.villain}%` }),
        ),
        h('div', { class: 'stat-grid' },
          statBox(r.hero + '%', 'Hero', tone),
          statBox(r.villain + '%', 'Villain', 'loss'),
        ),
        h('p', { class: 'muted small' }, `Board: ${b.length ? b.map(poker.cardLabel).join(' ') : 'preflop'} · tie ${r.tie}% · 2,000 sims`),
      );
      fx.haptic(12);
    }, 10);
  };
  const fail = (msg) => { res.replaceChildren(h('div', { class: 'banner loss' }, msg)); };
  runBtn.addEventListener('click', run);

  return [
    toolHead('Equity'),
    h('div', { class: 'card' },
      h('h2', {}, 'Your hand'),
      heroSeg,
      heroHandUI,
      heroRangeUI,
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Villain'),
      villSeg,
      villRangeUI,
      villHandUI,
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Board (optional)'),
      h('div', { class: 'board-grid' }, ...board.map((p) => p.el)),
    ),
    runBtn,
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
    for (const r of sessionNets(s)) {
      if (r.name.trim().toLowerCase() === key) {
        games += 1;
        total += r.net;
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
    for (const r of sessionNets(s)) {
      if (r.name.trim().toLowerCase() === key) games.push({ when: s.startedAt || 0, n: r.net });
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

// ---------- ICM / chop ----------

const ordWord = (n) => n + (['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

export function viewICM() {
  const s = nav.state.session;
  const tournActive = !!(s && s.type === 'tournament');

  const st = nav.state.icm || (nav.state.icm = {
    prizes: [1000, 600, 400],
    players: [{ name: '', stack: '' }, { name: '', stack: '' }, { name: '', stack: '' }],
  });
  let { prizes, players } = st;

  const result = h('div', {});
  const compute = () => {
    const P = prizes.map((x) => parseInt(x, 10) || 0).filter((x) => x > 0);
    const rows = players.filter((p) => (parseInt(p.stack, 10) || 0) > 0);
    if (rows.length < 2 || !P.length) {
      result.replaceChildren(h('p', { class: 'muted empty' }, 'Enter at least 2 stacks and one prize.'));
      return;
    }
    const stacks = rows.map((p) => parseInt(p.stack, 10));
    const eq = icmEquities(stacks, P);
    const pool = P.reduce((a, b) => a + b, 0);
    const even = Math.round(pool / rows.length);
    const t = h('table', { class: 'ref-table' });
    t.append(h('tr', {}, h('th', {}, 'Player'), h('th', {}, 'Stack'), h('th', {}, 'Fair chop'), h('th', {}, 'vs even')));
    rows.forEach((p, i) => {
      const amt = Math.round(eq[i]);
      const d = amt - even;
      t.append(h('tr', {},
        h('td', { class: 'rt-key' }, p.name || `P${i + 1}`),
        h('td', {}, stacks[i].toLocaleString('en-IN')),
        h('td', {}, fmtMoney(amt)),
        h('td', { class: d === 0 ? '' : d > 0 ? 'net-win' : 'net-loss' }, d === 0 ? '—' : (d > 0 ? '+' : '−') + fmtMoney(Math.abs(d))),
      ));
    });
    result.replaceChildren(
      h('div', { class: 'pmeta center' }, `Pool ${fmtMoney(pool)} · ${rows.length} players`),
      h('div', { class: 'scroll-x' }, t),
      h('p', { class: 'muted small' }, 'Fair chop = Malmuth–Harville ICM equity. Rounded — nudge by a unit or two so it sums exactly.'),
    );
    fx.haptic(10);
  };

  const prizeList = h('div', {});
  const renderPrizes = () => {
    prizeList.replaceChildren(...prizes.map((v, i) =>
      h('div', { class: 'kitty-row' },
        h('span', { class: 'kr-name' }, ordWord(i + 1) + ' place'),
        h('input', { type: 'number', inputmode: 'numeric', class: 'sm', style: 'width:110px', value: v,
          oninput: (e) => { prizes[i] = e.target.value; } }),
        h('button', { class: 'sm danger icon-only', 'aria-label': 'Remove', html: fx.icon('close'),
          onclick: () => { prizes.splice(i, 1); renderPrizes(); } }),
      )));
  };
  renderPrizes();

  const playerList = h('div', {});
  const renderPlayers = () => {
    playerList.replaceChildren(...players.map((p, i) =>
      h('div', { class: 'kitty-row' },
        h('input', { type: 'text', class: 'sm', placeholder: 'Name', value: p.name, style: 'flex:1;min-width:0;text-align:left',
          oninput: (e) => { p.name = e.target.value; } }),
        h('input', { type: 'number', inputmode: 'numeric', class: 'sm', placeholder: 'chips', style: 'width:92px', value: p.stack,
          oninput: (e) => { p.stack = e.target.value; } }),
        h('button', { class: 'sm danger icon-only', 'aria-label': 'Remove', html: fx.icon('close'),
          onclick: () => { players.splice(i, 1); renderPlayers(); } }),
      )));
  };
  renderPlayers();

  return [
    toolHead('ICM / Chop'),
    tournActive
      ? h('div', { class: 'card' },
          h('div', { class: 'row' },
            h('b', {}, 'From your tournament'),
            h('button', { class: 'sm primary', html: fx.icon('download') + 'Load', onclick: () => {
              const pay = tPayouts(s);
              const stillIn = s.players.filter((x) => x.finish == null);
              nav.state.icm = {
                prizes: pay.map((r) => r.amount),
                players: stillIn.map((x) => ({
                  name: x.name,
                  stack: String(x.entries.reduce((a, e) => a + (e.chips || 0), 0)),
                })),
              };
              nav.render();
            } }),
          ),
          h('p', { class: 'muted small' }, `${s.players.filter((p) => p.finish == null).length} still in · pool ${fmtMoney(tPrizePool(s))} — stacks are your entry chips, edit to your real counts`),
        )
      : null,
    h('div', { class: 'card' },
      h('h2', {}, 'Prizes'),
      prizeList,
      h('button', { class: 'sm ghost', html: fx.icon('plus') + 'Prize', onclick: () => { prizes.push(0); renderPrizes(); } }),
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Players & stacks'),
      playerList,
      h('button', { class: 'sm ghost', html: fx.icon('plus') + 'Player', onclick: () => { players.push({ name: '', stack: '' }); renderPlayers(); } }),
    ),
    h('button', { class: 'primary wide', html: 'Calculate chop', onclick: compute }),
    result,
    backbar(),
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

  const soundToggle = h('input', { type: 'checkbox', role: 'switch', class: 'switch' });
  soundToggle.checked = loadSoundOn();
  soundToggle.addEventListener('change', () => {
    saveSoundOn(soundToggle.checked);
    setSoundEnabled(soundToggle.checked);
    if (soundToggle.checked) { soundChip(); fx.haptic(10); }
  });

  return [
    toolHead('Data & sound'),
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
    h('div', { class: 'card' },
      h('h2', {}, 'Sound'),
      h('label', { class: 'switch-row' },
        h('span', {},
          h('span', { class: 'pname sm', html: fx.icon('volume') + 'Sound effects' }),
          h('span', { class: 'pmeta' }, 'Chip taps on buy-ins, a flourish on results'),
        ),
        soundToggle,
      ),
    ),
    backbar(),
  ];
}

// ---------- Account (sign in + sync) ----------

const inStandalone = () =>
  typeof window !== 'undefined' &&
  ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true);

function authErr(e) {
  const m = String((e && e.message) || e);
  if (/429|rate/i.test(m)) return 'Too many attempts — wait a minute and try again.';
  if (/invalid|expired|token/i.test(m)) return 'That code or password wasn’t right.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Can’t reach the server — check your connection.';
  return 'Something went wrong. Try again.';
}

function oauthRow(sb) {
  if (inStandalone()) return null; // OAuth redirects escape an installed PWA
  return h('div', { class: 'btn-row' },
    h('button', { class: 'ghost', html: 'Continue with Google', onclick: () => sb.auth.signInWithOAuth('google') }),
    h('button', { class: 'ghost', html: 'Continue with Apple', onclick: () => sb.auth.signInWithOAuth('apple') }),
  );
}

export function viewAccount() {
  const root = h('div', { class: 'account-body' }, h('p', { class: 'muted' }, 'Loading…'));
  Promise.all([import('./supabase.js'), import('./auth.js'), import('./sync-boot.js')])
    .then((mods) => paintAccount(root, ...mods))
    .catch(() => root.replaceChildren(h('p', { class: 'muted' }, 'Sign-in isn’t available right now.')));
  return [toolHead('Account'), root, backbar()];
}

function paintAccount(root, sb, au, boot) {
  const st = nav.state.acct || (nav.state.acct = { step: 'email', email: '', busy: false, err: '' });
  const redraw = () => paintAccount(root, sb, au, boot);
  const fail = (e) => {
    st.err = authErr(e);
    st.busy = false;
    redraw();
  };
  const busy = (v) => {
    st.busy = v;
    st.err = '';
    redraw();
  };

  if (sb.isSignedIn()) {
    const u = sb.currentUser() || {};
    const nodes = [
      h('div', { class: 'card' },
        h('div', { class: 'pname sm', html: fx.icon('user') + escapeAttr(u.email || 'Signed in') }),
        h('div', { class: 'pmeta' }, 'Free plan · games sync to every device you sign in on'),
        h('div', { class: 'pmeta', html: fx.icon('cloud') + syncWord(boot.syncStatus()) }),
      ),
    ];
    if (nav.state.acctChoice) {
      nodes.push(h('div', { class: 'card' },
        h('h2', {}, 'This device already has games'),
        h('p', { class: 'muted small' }, 'Keep both sets, or replace this device with what’s in your account.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'primary', html: 'Merge both', onclick: async () => {
            await boot.resolveFirstSync('merge');
            nav.state.acctChoice = false;
            nav.toast('Merged');
            redraw();
          } }),
          h('button', { class: 'ghost', html: 'Use account only', onclick: async () => {
            if (!confirm('Replace this device’s games with your account? Games that exist only on this device will be removed.')) return;
            await boot.resolveFirstSync('cloud');
            nav.state.acctChoice = false;
            nav.render();
          } }),
        ),
      ));
    }
    nodes.push(
      h('div', { class: 'card' },
        h('h2', {}, 'Backup'),
        h('p', { class: 'muted small' }, 'Your data is also in this browser. A downloaded copy is still the safest thing to keep.'),
        h('button', { class: 'ghost wide', html: fx.icon('download') + 'Backup & restore', onclick: () => nav.go('data') }),
      ),
      h('button', { class: 'danger wide', html: fx.icon('logout') + 'Sign out & clear this device',
        onclick: async () => {
          const res = await au.signOutAndWipe({
            flushFn: () => (boot.getEngine() ? boot.getEngine().flush() : Promise.resolve()),
            confirmUnsynced: (n) => confirm(`${n} change${n === 1 ? '' : 's'} haven’t synced yet. Sign out and lose ${n === 1 ? 'it' : 'them'}?`),
          });
          if (res.ok) {
            nav.state.acct = null;
            nav.toast('Signed out');
            nav.go('home');
          }
        } }),
    );
    root.replaceChildren(...nodes);
    return;
  }

  // ---- signed out ----
  const emailIn = h('input', { type: 'email', inputmode: 'email', autocomplete: 'email', placeholder: 'you@example.com', value: st.email, enterkeyhint: 'go' });
  const codeIn = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '6-digit code', enterkeyhint: 'go' });
  const pwIn = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password', enterkeyhint: 'go' });

  const nodes = [
    h('p', { class: 'muted' }, 'Sign in to sync your games across devices. It’s free.'),
    st.err ? h('div', { class: 'banner warn' }, st.err) : null,
  ];

  if (st.step === 'email') {
    const send = async () => {
      const email = emailIn.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(new Error('invalid email'));
      st.email = email;
      busy(true);
      try {
        await sb.auth.sendOtp(email);
        st.step = 'code';
        st.busy = false;
        redraw();
      } catch (e) {
        fail(e);
      }
    };
    emailIn.addEventListener('keydown', (e) => e.key === 'Enter' && send());
    nodes.push(
      h('label', {}, 'Email'),
      emailIn,
      h('button', { class: 'primary wide', disabled: st.busy ? 'true' : null, html: st.busy ? 'Sending…' : 'Email me a code', onclick: send }),
      h('button', { class: 'ghost wide', html: 'Use a password instead', onclick: () => { st.step = 'password'; st.err = ''; redraw(); } }),
      oauthRow(sb),
    );
  } else if (st.step === 'code') {
    const verify = async () => {
      busy(true);
      try {
        await sb.auth.verifyOtp(st.email, codeIn.value.trim());
        nav.state.acct = null;
        nav.toast('Signed in');
        nav.go('home');
      } catch (e) {
        fail(e);
      }
    };
    codeIn.addEventListener('keydown', (e) => e.key === 'Enter' && verify());
    nodes.push(
      h('p', { class: 'muted small' }, `Code sent to ${escapeAttr(st.email)}.`),
      codeIn,
      h('button', { class: 'primary wide', disabled: st.busy ? 'true' : null, html: st.busy ? 'Checking…' : 'Verify', onclick: verify }),
      h('button', { class: 'ghost wide', html: 'Back', onclick: () => { st.step = 'email'; st.err = ''; redraw(); } }),
    );
  } else {
    const go = async (creating) => {
      const email = emailIn.value.trim();
      const pw = pwIn.value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || pw.length < 8) return fail(new Error('invalid'));
      busy(true);
      try {
        await (creating ? sb.auth.signUpWithPassword(email, pw) : sb.auth.signInWithPassword(email, pw));
        nav.state.acct = null;
        nav.toast('Signed in');
        nav.go('home');
      } catch (e) {
        fail(e);
      }
    };
    nodes.push(
      h('label', {}, 'Email'), emailIn,
      h('label', {}, 'Password'), pwIn,
      h('div', { class: 'btn-row' },
        h('button', { class: 'primary', disabled: st.busy ? 'true' : null, html: 'Sign in', onclick: () => go(false) }),
        h('button', { class: 'ghost', disabled: st.busy ? 'true' : null, html: 'Create account', onclick: () => go(true) }),
      ),
      h('button', { class: 'ghost wide', html: 'Email me a code instead', onclick: () => { st.step = 'email'; st.err = ''; redraw(); } }),
      oauthRow(sb),
    );
  }
  root.replaceChildren(...nodes.filter(Boolean));
}

function syncWord(s) {
  return { syncing: 'Syncing…', synced: 'All synced', offline: 'Offline — will catch up', error: 'Sync issue — retrying' }[s] || 'Connecting…';
}
const escapeAttr = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// ---------- registry ----------

export const TOOL_VIEWS = {
  home: viewHome,
  account: viewAccount,
  roster: viewRoster,
  data: viewData,
  playerstats: () => viewPlayerStats(nav.state.statsPlayer),
  icm: viewICM,
  bbcalc: viewBBCalc,
  ranges: viewRanges,
  action: viewAction,
  odds: viewOdds,
  quiz: viewQuiz,
  equity: viewEquity,
  study: viewStudy,
  sessions: viewSessions,
};
