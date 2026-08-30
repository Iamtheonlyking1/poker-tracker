import {
  newSession,
  addPlayer,
  removePlayer,
  addBuyIn,
  setCashOut,
  save,
  loadActive,
  clearActive,
  loadHistory,
  saveToHistory,
  deleteFromHistory,
  pushUndo,
  popUndo,
  canUndo,
} from './state.js';
import { net, totalIn, potIn, settle, reconciliation } from './settle.js';
import { rupee, summaryText, shareUrl, whatsappUrl, sessionFromUrl } from './share.js';
import * as fx from './fx.js';

const app = document.getElementById('app');

// view: 'setup' | 'live' | 'cashout' | 'results' | 'history' | 'shared'
let state = {
  view: 'setup',
  session: null,
  shared: null,
  buyInPresets: [100, 200, 500, 1000],
};

// ---------- element helper ----------

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
};

function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2000);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch (e) {
    const ta = h('textarea', {});
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Copied');
  }
}

function mutate(fn) {
  pushUndo(state.session);
  fn(state.session);
  save(state.session);
  render();
}

function undo() {
  const prev = popUndo();
  if (prev) {
    state.session = prev;
    save(state.session);
    render();
  }
}

function fmtNet(n) {
  if (n === null) return h('span', { class: 'pmeta' }, 'not cashed out');
  if (n === 0) return h('span', { class: 'pmeta' }, 'even');
  const cls = n > 0 ? 'net-win' : 'net-loss';
  return h('span', { class: cls }, (n > 0 ? '+' : '−') + rupee.format(Math.abs(n)));
}

// net span that counts up on the results screen
function netCount(n) {
  if (n === 0) return h('span', { class: 'pmeta' }, 'even');
  const cls = n > 0 ? 'net-win' : 'net-loss';
  const sign = n > 0 ? '+' : '−';
  return h('span', { class: cls, 'data-count': String(n) }, sign + rupee.format(Math.abs(n)));
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- views ----------

function viewSetup() {
  const nameIn = h('input', { type: 'text', placeholder: 'Friday game', value: 'Poker night' });
  let buyIn = 500;

  const chipRow = h('div', { class: 'chips' });
  const renderChips = () => {
    chipRow.replaceChildren(
      ...state.buyInPresets.map((v) =>
        h('button', {
          class: 'chip' + (v === buyIn ? ' on' : ''),
          onclick: () => { buyIn = v; customIn.value = ''; renderChips(); fx.attachRipples(chipRow); },
        }, rupee.format(v)),
      ),
    );
    fx.attachRipples(chipRow);
  };
  const customIn = h('input', {
    type: 'number', inputmode: 'numeric', placeholder: 'Custom amount',
    oninput: () => { const v = parseInt(customIn.value, 10); if (v > 0) buyIn = v; renderChips(); },
  });
  renderChips();

  let pending = [];
  const list = h('div', {});
  const renderList = () => {
    list.replaceChildren(
      ...pending.map((n, i) =>
        h('div', { class: 'card' },
          h('div', { class: 'row' },
            h('span', { class: 'pname' }, n),
            h('button', { class: 'sm danger icon-only', 'aria-label': 'Remove ' + n, html: fx.icon('close'),
              onclick: () => { pending.splice(i, 1); renderList(); } }),
          ),
        ),
      ),
    );
    fx.attachRipples(list);
  };
  const playerIn = h('input', {
    type: 'text', placeholder: 'Add player name, press Enter',
    onkeydown: (e) => {
      if (e.key === 'Enter' && playerIn.value.trim()) {
        pending.push(playerIn.value.trim());
        playerIn.value = '';
        renderList();
      }
    },
  });

  const start = h('button', {
    class: 'primary wide',
    html: 'Deal me in' + fx.icon('forward'),
    onclick: () => {
      if (pending.length < 2) return toast('Add at least 2 players');
      const s = newSession({ name: nameIn.value, defaultBuyIn: buyIn });
      pending.forEach((n) => addPlayer(s, n));
      s.players.forEach((p) => addBuyIn(s, p.id, s.defaultBuyIn));
      state.session = s;
      clearActive();
      save(s);
      go('live');
    },
  });

  return [
    h('h1', { html: fx.icon('spade') + 'Poker Night' }),
    h('p', { class: 'muted' }, 'Track buy-ins in ₹, settle up clean at the end.'),
    loadHistory().length
      ? h('button', { class: 'ghost wide', html: fx.icon('trophy') + `History (${loadHistory().length})`, onclick: () => go('history') })
      : null,
    h('h2', {}, 'Session'),
    h('label', {}, 'Name'),
    nameIn,
    h('label', {}, 'Default buy-in'),
    chipRow,
    customIn,
    h('h2', {}, 'Players'),
    playerIn,
    list,
    h('div', { style: 'height:16px' }),
    start,
  ];
}

function topbar(session) {
  const pot = potIn(session.players);
  const n = session.players.length;
  return h('div', { class: 'topbar' },
    h('div', { class: 'stat' }, h('b', { id: 'pot-amt', class: 'gold' }, rupee.format(pot)), 'in the pot'),
    h('div', { class: 'stat' }, h('b', {}, String(n)), n === 1 ? 'player' : 'players'),
    h('div', { class: 'stat' }, h('b', {}, rupee.format(n ? Math.round(pot / n) : 0)), 'avg stack'),
  );
}

function viewLive() {
  const s = state.session;

  const bump = (rect, amount) => {
    fx.floatUp(rect, '+' + rupee.format(amount));
    fx.pop(document.getElementById('pot-amt'));
  };

  const cards = s.players.map((p) => {
    const custom = h('input', { type: 'number', inputmode: 'numeric', placeholder: 'Custom ₹' });
    const addCustom = (e) => {
      const v = parseInt(custom.value, 10);
      if (!(v > 0)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      mutate((ss) => addBuyIn(ss, p.id, v));
      bump(rect, v);
    };
    custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCustom(e); });

    return h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('div', {},
          h('div', { class: 'pname' }, p.name),
          h('div', { class: 'pmeta' }, `In ${rupee.format(totalIn(p))} · ${p.buyIns.length} buy-in${p.buyIns.length === 1 ? '' : 's'}`),
        ),
        h('button', { class: 'sm danger icon-only', 'aria-label': 'Remove ' + p.name, html: fx.icon('close'),
          onclick: () => confirm(`Remove ${p.name}?`) && mutate((ss) => removePlayer(ss, p.id)) }),
      ),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'primary', html: fx.icon('plus') + rupee.format(s.defaultBuyIn),
          onclick: (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            mutate((ss) => addBuyIn(ss, p.id, ss.defaultBuyIn));
            bump(rect, s.defaultBuyIn);
          },
        }),
        custom,
        h('button', { class: 'sm icon-only', 'aria-label': 'Add custom buy-in for ' + p.name, html: fx.icon('plus'), onclick: addCustom }),
      ),
    );
  });

  const addName = h('input', {
    type: 'text', placeholder: 'Late joiner name',
    onkeydown: (e) => {
      if (e.key === 'Enter' && addName.value.trim()) {
        const nm = addName.value.trim();
        mutate((ss) => {
          addPlayer(ss, nm);
          addBuyIn(ss, ss.players[ss.players.length - 1].id, ss.defaultBuyIn);
        });
      }
    },
  });

  return [
    h('h1', {}, s.name),
    topbar(s),
    ...cards,
    h('h2', {}, 'Add player'),
    addName,
    h('div', { class: 'actionbar' },
      h('button', { class: 'ghost', disabled: canUndo() ? null : 'true', html: fx.icon('undo') + 'Undo', onclick: undo }),
      h('button', { class: 'primary', html: 'End game' + fx.icon('forward'), onclick: () => go('cashout') }),
    ),
  ];
}

function viewCashout() {
  const s = state.session;
  const banner = h('div', {});
  const nextBtn = h('button', { class: 'primary', html: 'Settlement' + fx.icon('forward'), onclick: () => go('results') });
  let wasBalanced = reconciliation(s.players).balanced;

  const refresh = () => {
    const rec = reconciliation(s.players);
    if (rec.balanced) {
      banner.className = 'banner ok';
      banner.innerHTML = fx.icon('check') + `Pot balanced at ${rupee.format(rec.in)}`;
      if (!wasBalanced) { banner.classList.add('flash'); setTimeout(() => banner.classList.remove('flash'), 800); }
    } else {
      banner.className = 'banner warn';
      banner.textContent =
        rec.delta > 0
          ? `${rupee.format(rec.delta)} more than bought in — recount stacks`
          : `${rupee.format(-rec.delta)} unaccounted — recount stacks`;
    }
    wasBalanced = rec.balanced;
    const allIn = s.players.every((p) => p.cashOut !== null && p.cashOut !== undefined);
    if (allIn) nextBtn.removeAttribute('disabled');
    else nextBtn.setAttribute('disabled', 'true');
  };

  const cards = s.players.map((p) => {
    let netSpan = fmtNet(net(p));
    const inp = h('input', {
      type: 'number', inputmode: 'numeric', placeholder: 'Ending stack ₹', value: p.cashOut ?? '',
      oninput: () => {
        const v = inp.value === '' ? null : parseInt(inp.value, 10);
        setCashOut(s, p.id, Number.isNaN(v) ? null : v);
        save(s);
        const fresh = fmtNet(net(p));
        netSpan.replaceWith(fresh);
        netSpan = fresh;
        refresh();
      },
    });
    return h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('div', {},
          h('div', { class: 'pname' }, p.name),
          h('div', { class: 'pmeta' }, `In ${rupee.format(totalIn(p))}`),
        ),
        netSpan,
      ),
      inp,
    );
  });

  refresh();

  return [
    h('h1', {}, 'Cash out'),
    banner,
    ...cards,
    h('div', { class: 'actionbar' },
      h('button', { class: 'ghost', html: fx.icon('back') + 'Back', onclick: () => go('live') }),
      nextBtn,
    ),
  ];
}

function resultsBlock(s, { animate = false } = {}) {
  const rec = reconciliation(s.players);
  const rows = s.players.map((p) => ({ name: p.name, n: net(p) || 0 })).sort((a, b) => b.n - a.n);
  const transfers = settle(s.players);

  const out = [
    h('h1', {}, s.name),
    h('p', { class: 'muted' }, new Date(s.startedAt).toLocaleString('en-IN', { dateStyle: 'medium' })),
  ];

  if (!rec.balanced) {
    out.push(h('div', { class: 'banner warn' },
      rec.delta > 0
        ? `Heads up: stacks add up to ${rupee.format(rec.delta)} more than the pot.`
        : `Heads up: ${rupee.format(-rec.delta)} missing from the pot.`));
  }

  out.push(h('h2', {}, 'Net'));
  for (const r of rows) {
    out.push(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('span', { class: 'pname' }, r.name), animate ? netCount(r.n) : fmtNet(r.n)),
    ));
  }

  out.push(h('h2', {}, 'Settle up'));
  if (transfers.length === 0) {
    out.push(h('div', { class: 'banner ok', html: fx.icon('check') + 'Everyone square. Nothing to pay.' }));
  } else {
    for (const t of transfers) {
      out.push(h('div', { class: 'settle-line',
        html: `<b>${escapeHtml(t.from)}</b> pays <b>${escapeHtml(t.to)}</b> ${rupee.format(t.amount)}` }));
    }
  }
  return out;
}

function viewResults() {
  const s = state.session;
  const blocks = resultsBlock(s, { animate: true });
  blocks.push(
    h('div', { style: 'height:16px' }),
    h('div', { class: 'btn-row' },
      h('button', { class: 'primary wide', html: fx.icon('share') + 'Share to WhatsApp', onclick: () => window.open(whatsappUrl(s), '_blank') }),
    ),
    h('div', { class: 'btn-row' },
      h('button', { html: fx.icon('copy') + 'Copy summary', onclick: () => copy(summaryText(s)) }),
      h('button', { html: fx.icon('copy') + 'Copy link', onclick: () => copy(shareUrl(s)) }),
    ),
    h('div', { class: 'btn-row' },
      h('button', { class: 'wide', html: fx.icon('check') + 'Save to history & finish', onclick: () => {
        saveToHistory(s);
        clearActive();
        toast('Saved to history');
        state.session = null;
        go('history');
      } }),
    ),
    h('div', { class: 'actionbar' },
      h('button', { class: 'ghost', html: fx.icon('back') + 'Edit cash-outs', onclick: () => go('cashout') }),
    ),
  );
  return blocks;
}

function viewShared() {
  const s = state.shared;
  const blocks = resultsBlock(s, { animate: true });
  blocks.unshift(h('div', { class: 'banner info', html: fx.icon('eye') + 'Shared results — read only' }));
  blocks.push(
    h('div', { style: 'height:16px' }),
    h('div', { class: 'btn-row' },
      h('button', { html: fx.icon('copy') + 'Copy summary', onclick: () => copy(summaryText(s, { withLink: false })) }),
      h('button', { class: 'primary', html: fx.icon('check') + 'Open as my session', onclick: () => {
        const imp = JSON.parse(JSON.stringify(s));
        imp.id = Math.random().toString(36).slice(2, 9);
        imp.status = 'live';
        state.session = imp;
        state.shared = null;
        history.replaceState(null, '', location.pathname);
        save(imp);
        go('results');
      } }),
    ),
    h('div', { class: 'btn-row' },
      h('button', { class: 'ghost wide', html: fx.icon('spade') + 'Start my own game', onclick: () => {
        state.shared = null;
        history.replaceState(null, '', location.pathname);
        boot();
      } }),
    ),
  );
  return blocks;
}

function lifetimeLeaderboard(hist) {
  const agg = new Map();
  for (const s of hist) {
    for (const p of s.players) {
      const key = p.name.trim().toLowerCase();
      const cur = agg.get(key) || { name: p.name.trim(), net: 0, games: 0 };
      cur.net += net(p) || 0;
      cur.games += 1;
      agg.set(key, cur);
    }
  }
  return [...agg.values()].sort((a, b) => b.net - a.net);
}

function viewHistory() {
  const hist = loadHistory();
  const out = [h('h1', { html: fx.icon('trophy') + 'History' })];

  if (!hist.length) {
    out.push(h('p', { class: 'muted' }, 'No saved games yet.'));
  } else {
    out.push(h('h2', {}, 'Lifetime'));
    lifetimeLeaderboard(hist).forEach((r, i) => {
      out.push(h('div', { class: 'lb-row' },
        h('span', {}, h('span', { class: 'rank' }, `${i + 1}`), `${r.name} · ${r.games} game${r.games === 1 ? '' : 's'}`),
        fmtNet(r.net),
      ));
    });

    out.push(h('h2', {}, 'Games'));
    for (const s of hist) {
      out.push(h('div', { class: 'card' },
        h('div', { class: 'hist-item' },
          h('div', {},
            h('div', { class: 'pname' }, s.name),
            h('div', { class: 'pmeta' }, `${new Date(s.startedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })} · ${s.players.length} players · pot ${rupee.format(potIn(s.players))}`),
          ),
        ),
        h('div', { class: 'btn-row' },
          h('button', { class: 'sm', html: fx.icon('eye') + 'View', onclick: () => { state.shared = s; go('shared'); } }),
          h('button', { class: 'sm', html: fx.icon('copy') + 'Link', onclick: () => copy(shareUrl(s)) }),
          h('button', { class: 'sm danger icon-only', 'aria-label': 'Delete game', html: fx.icon('trash'),
            onclick: () => { if (confirm('Delete this game?')) { deleteFromHistory(s.id); render(); } } }),
        ),
      ));
    }
  }

  out.push(h('div', { class: 'actionbar' },
    h('button', { class: 'primary wide',
      html: (state.session ? fx.icon('back') + 'Back to game' : fx.icon('spade') + 'New game'),
      onclick: () => go(state.session ? 'live' : 'setup') }),
  ));
  return out;
}

// ---------- render ----------

function nodesFor(view) {
  switch (view) {
    case 'live': return viewLive();
    case 'cashout': return viewCashout();
    case 'results': return viewResults();
    case 'history': return viewHistory();
    case 'shared': return viewShared();
    default: return viewSetup();
  }
}

let lastView = null;

function render(opts = {}) {
  const view = state.view;
  const nav = opts.nav || lastView !== view;

  const firstPaint = lastView === null;
  const paint = () => {
    app.replaceChildren(...nodesFor(view).flat().filter(Boolean));
    lastView = view;
    fx.attachRipples(app);
    if (nav) fx.staggerIn(app);
  };

  if (nav && !firstPaint) fx.withTransition(paint);
  else paint();

  if (nav) {
    window.scrollTo({ top: 0 });
    if (view === 'results' || view === 'shared') requestAnimationFrame(afterResults);
  }
}

function afterResults() {
  fx.celebrate();
  app.querySelectorAll('[data-count]').forEach((el) => {
    const to = Number(el.dataset.count);
    const sign = to > 0 ? '+' : '−';
    fx.countUp(el, Math.abs(to), (v) => sign + rupee.format(Math.round(v)));
  });
}

function go(view) {
  state.view = view;
  render({ nav: true });
}

// ---------- boot ----------

function boot() {
  const shared = sessionFromUrl();
  if (shared && shared.players.length) {
    state.shared = shared;
    go('shared');
    return;
  }
  const active = loadActive();
  if (active && active.players.length) {
    state.session = active;
    const anyCashOut = active.players.some((p) => p.cashOut != null);
    go(anyCashOut ? 'cashout' : 'live');
    return;
  }
  go('setup');
}

boot();
