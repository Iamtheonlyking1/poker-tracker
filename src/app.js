import {
  newSession,
  addPlayer,
  removePlayer,
  renamePlayer,
  addBuyIn,
  rebuyAll,
  setCashOut,
  save,
  loadActive,
  clearActive,
  loadHistory,
  saveToHistory,
  deleteFromHistory,
  loadCurrencyPref,
  saveCurrencyPref,
  pushUndo,
  popUndo,
  canUndo,
} from './state.js';
import { net, totalIn, potIn, settle, reconciliation } from './settle.js';
import { summaryText, shareUrl, whatsappUrl, sessionFromUrl } from './share.js';
import { fmtMoney, setCurrency, currencyName, currencySymbol, allCurrencies } from './money.js';
import { h, escapeHtml, fmtNet, netCount, avatar, fmtDuration } from './ui.js';
import * as fx from './fx.js';

const app = document.getElementById('app');

// view: 'setup' | 'live' | 'cashout' | 'results' | 'history' | 'shared'
let state = {
  view: 'setup',
  session: null,
  shared: null,
  buyInPresets: [100, 200, 500, 1000],
  _tick: null,
};

// ---------- small helpers ----------

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

function go(view) {
  state.view = view;
  render({ nav: true });
}

function elapsedPill(s) {
  return h('span', {
    class: 'timer',
    html: fx.icon('clock') + `<span id="elapsed">${fmtDuration(Date.now() - s.startedAt)}</span>`,
  });
}

// bottom-sheet currency picker with search
function openCurrencyPicker(currentCode, onPick) {
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

// ---------- setup ----------

function viewSetup() {
  const nameIn = h('input', { type: 'text', placeholder: 'Friday game', value: 'Poker night', enterkeyhint: 'done', autocomplete: 'off' });
  let buyIn = 500;
  let currency = loadCurrencyPref();
  setCurrency(currency);

  const curBtn = h('button', { class: 'ghost wide field-btn', onclick: () => {
    openCurrencyPicker(currency, (code) => {
      currency = code;
      setCurrency(code);
      curBtn.innerHTML = curBtnLabel();
      renderChips();
      customIn.setAttribute('placeholder', 'Custom amount');
    });
  } });
  const curBtnLabel = () =>
    `<span class="cur-sym">${currencySymbol(currency)}</span><span class="cur-name">${currencyName(currency)}</span>` +
    `<span class="cur-code">${currency}</span>${fx.icon('forward')}`;
  curBtn.innerHTML = curBtnLabel();

  const chipRow = h('div', { class: 'chips' });
  const renderChips = () => {
    chipRow.replaceChildren(
      ...state.buyInPresets.map((v) =>
        h('button', {
          class: 'chip' + (v === buyIn ? ' on' : ''),
          onclick: () => { buyIn = v; customIn.value = ''; renderChips(); },
        }, fmtMoney(v)),
      ),
    );
    fx.attachRipples(chipRow);
  };
  const customIn = h('input', {
    type: 'number', inputmode: 'numeric', placeholder: 'Custom amount', enterkeyhint: 'done',
    oninput: () => { const v = parseInt(customIn.value, 10); if (v > 0) buyIn = v; renderChips(); },
  });
  renderChips();

  let pending = [];
  const list = h('div', {});
  const renderList = () => {
    list.replaceChildren(
      ...(pending.length
        ? pending.map((n, i) =>
            h('div', { class: 'card row' },
              h('div', { class: 'phead' }, avatar(n), h('div', { class: 'pinfo' }, h('div', { class: 'pname' }, n))),
              h('button', { class: 'sm danger icon-only', 'aria-label': 'Remove ' + n, html: fx.icon('close'),
                onclick: () => { pending.splice(i, 1); renderList(); } }),
            ),
          )
        : [h('p', { class: 'muted empty' }, 'Add everyone at the table.')]),
    );
    fx.attachRipples(list);
  };
  renderList();

  const playerIn = h('input', {
    type: 'text', placeholder: 'Add player name, press Enter', enterkeyhint: 'done', autocomplete: 'off',
    onkeydown: (e) => {
      if (e.key === 'Enter' && playerIn.value.trim()) {
        pending.push(playerIn.value.trim());
        playerIn.value = '';
        renderList();
      }
    },
  });

  const start = h('button', {
    class: 'primary wide', html: 'Deal me in' + fx.icon('forward'),
    onclick: () => {
      if (pending.length < 2) return toast('Add at least 2 players');
      const s = newSession({ name: nameIn.value, defaultBuyIn: buyIn, currency });
      pending.forEach((n) => addPlayer(s, n));
      s.players.forEach((p) => addBuyIn(s, p.id, s.defaultBuyIn));
      state.session = s;
      clearActive();
      saveCurrencyPref(currency);
      save(s);
      fx.haptic(15);
      go('live');
    },
  });

  return [
    h('h1', { html: fx.icon('spade') + 'Poker Night' }),
    h('p', { class: 'muted' }, 'Track buy-ins, settle up clean at the end.'),
    loadHistory().length
      ? h('button', { class: 'ghost wide', html: fx.icon('trophy') + `History (${loadHistory().length})`, onclick: () => go('history') })
      : null,
    h('h2', {}, 'Session'),
    h('label', {}, 'Name'),
    nameIn,
    h('label', {}, 'Currency'),
    curBtn,
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

// ---------- live ----------

function topbar(session) {
  const pot = potIn(session.players);
  const n = session.players.length;
  return h('div', { class: 'topbar' },
    h('div', { class: 'stat' }, h('b', { id: 'pot-amt', class: 'gold' }, fmtMoney(pot)), 'in the pot'),
    h('div', { class: 'stat' }, h('b', {}, String(n)), n === 1 ? 'player' : 'players'),
    h('div', { class: 'stat' }, h('b', {}, fmtMoney(n ? Math.round(pot / n) : 0)), 'avg stack'),
  );
}

function viewLive() {
  const s = state.session;

  const bump = (rect, amount) => {
    fx.floatUp(rect, '+' + fmtMoney(amount));
    fx.pop(document.getElementById('pot-amt'));
    fx.haptic(10);
  };

  const cards = s.players.map((p) => {
    const nameEl = h('div', { class: 'pname' }, p.name);
    const startRename = () => {
      const inp = h('input', { class: 'rename', type: 'text', value: p.name, 'aria-label': 'Player name', enterkeyhint: 'done', autocomplete: 'off' });
      const commit = () => {
        const v = inp.value.trim();
        if (v && v !== p.name) mutate((ss) => renamePlayer(ss, p.id, v));
        else render();
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
      inp.addEventListener('blur', commit);
      nameEl.replaceWith(inp);
      inp.focus();
      inp.select();
    };

    const custom = h('input', { type: 'number', inputmode: 'numeric', placeholder: 'Custom ' + currencySymbol(s.currency), enterkeyhint: 'done' });
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
        h('div', { class: 'phead' },
          avatar(p.name),
          h('div', { class: 'pinfo' },
            nameEl,
            h('div', { class: 'pmeta' }, `In ${fmtMoney(totalIn(p))} · ${p.buyIns.length} buy-in${p.buyIns.length === 1 ? '' : 's'}`),
          ),
        ),
        h('div', { class: 'card-actions' },
          h('button', { class: 'sm ghost icon-only', 'aria-label': 'Rename ' + p.name, html: fx.icon('edit'), onclick: startRename }),
          h('button', { class: 'sm danger icon-only', 'aria-label': 'Remove ' + p.name, html: fx.icon('close'),
            onclick: () => confirm(`Remove ${p.name}?`) && mutate((ss) => removePlayer(ss, p.id)) }),
        ),
      ),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'primary', html: fx.icon('plus') + fmtMoney(s.defaultBuyIn),
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
    type: 'text', placeholder: 'Late joiner name', enterkeyhint: 'done', autocomplete: 'off',
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
    h('div', { class: 'head-row' }, h('h1', {}, s.name), elapsedPill(s)),
    topbar(s),
    h('div', { class: 'subbar' },
      h('button', {
        class: 'sm ghost wide', html: fx.icon('users') + `Round for everyone · ${fmtMoney(s.defaultBuyIn)}`,
        onclick: () => {
          if (!s.players.length) return;
          if (!confirm(`Add a ${fmtMoney(s.defaultBuyIn)} buy-in for all ${s.players.length} players?`)) return;
          mutate((ss) => rebuyAll(ss));
          fx.haptic([12, 30, 12]);
          fx.pop(document.getElementById('pot-amt'));
          toast(`Round added · ${fmtMoney(s.defaultBuyIn * s.players.length)}`);
        },
      }),
    ),
    h('div', { class: 'cards' }, ...cards),
    h('h2', {}, 'Add player'),
    addName,
    h('div', { class: 'actionbar' },
      h('button', { class: 'ghost', disabled: canUndo() ? null : 'true', html: fx.icon('undo') + 'Undo', onclick: undo }),
      h('button', { class: 'primary', html: 'End game' + fx.icon('forward'), onclick: () => go('cashout') }),
    ),
  ];
}

// ---------- cash out ----------

function viewCashout() {
  const s = state.session;
  const banner = h('div', {});
  const nextBtn = h('button', { class: 'primary', html: 'Settlement' + fx.icon('forward'), onclick: () => go('results') });
  let wasBalanced = reconciliation(s.players).balanced;

  const refresh = () => {
    const rec = reconciliation(s.players);
    if (rec.balanced) {
      banner.className = 'banner ok';
      banner.innerHTML = fx.icon('check') + `Pot balanced at ${fmtMoney(rec.in)}`;
      if (!wasBalanced) {
        banner.classList.add('flash');
        setTimeout(() => banner.classList.remove('flash'), 800);
        fx.haptic([12, 40, 12]);
      }
    } else {
      banner.className = 'banner warn';
      banner.textContent =
        rec.delta > 0
          ? `${fmtMoney(rec.delta)} more than bought in — recount stacks`
          : `${fmtMoney(-rec.delta)} unaccounted — recount stacks`;
    }
    wasBalanced = rec.balanced;
    const allIn = s.players.every((p) => p.cashOut !== null && p.cashOut !== undefined);
    if (allIn) nextBtn.removeAttribute('disabled');
    else nextBtn.setAttribute('disabled', 'true');
  };

  const cards = s.players.map((p) => {
    let netSpan = fmtNet(net(p));
    const inp = h('input', {
      type: 'number', inputmode: 'numeric', placeholder: 'Ending stack', enterkeyhint: 'done', value: p.cashOut ?? '',
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
        h('div', { class: 'phead' },
          avatar(p.name),
          h('div', { class: 'pinfo' },
            h('div', { class: 'pname' }, p.name),
            h('div', { class: 'pmeta' }, `In ${fmtMoney(totalIn(p))}`),
          ),
        ),
        netSpan,
      ),
      inp,
    );
  });

  refresh();

  return [
    h('div', { class: 'head-row' }, h('h1', {}, 'Cash out'), elapsedPill(s)),
    banner,
    h('div', { class: 'cards' }, ...cards),
    h('div', { class: 'actionbar' },
      h('button', { class: 'ghost', html: fx.icon('back') + 'Back', onclick: () => go('live') }),
      nextBtn,
    ),
  ];
}

// ---------- results ----------

function resultsBlock(s, { animate = false } = {}) {
  const rec = reconciliation(s.players);
  const rows = s.players.map((p) => ({ name: p.name, n: net(p) || 0 })).sort((a, b) => b.n - a.n);
  const transfers = settle(s.players);
  const durMs = (s.settledAt || Date.now()) - s.startedAt;

  const out = [
    h('h1', {}, s.name),
    h('div', { class: 'statstrip' },
      h('span', {}, new Date(s.startedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })),
      h('span', {}, `${s.players.length} players`),
      h('span', {}, `${fmtMoney(potIn(s.players))} in play`),
      h('span', { html: fx.icon('clock') + fmtDuration(durMs) }),
    ),
  ];

  if (!rec.balanced) {
    out.push(h('div', { class: 'banner warn' },
      rec.delta > 0
        ? `Heads up: stacks add up to ${fmtMoney(rec.delta)} more than the pot.`
        : `Heads up: ${fmtMoney(-rec.delta)} missing from the pot.`));
  }

  out.push(h('h2', {}, 'Net'));
  const netCards = rows.map((r, i) => {
    const winner = i === 0 && r.n > 0;
    return h('div', { class: 'card' + (winner ? ' winner' : '') },
      h('div', { class: 'row' },
        h('div', { class: 'phead' },
          avatar(r.name),
          h('div', { class: 'pinfo' },
            h('div', { class: 'pname' }, winner ? h('span', { class: 'crown', html: fx.icon('crown') }) : null, r.name),
            winner ? h('div', { class: 'pmeta' }, 'Biggest winner') : null,
          ),
        ),
        animate ? netCount(r.n) : fmtNet(r.n),
      ),
    );
  });
  out.push(h('div', { class: 'cards' }, ...netCards));

  out.push(h('h2', {}, 'Settle up'));
  if (transfers.length === 0) {
    out.push(h('div', { class: 'banner ok', html: fx.icon('check') + 'Everyone square. Nothing to pay.' }));
  } else {
    for (const t of transfers) {
      out.push(h('div', { class: 'settle-line',
        html: `<b>${escapeHtml(t.from)}</b> pays <b>${escapeHtml(t.to)}</b> ${fmtMoney(t.amount)}` }));
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
        fx.haptic(20);
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

// ---------- history ----------

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
    out.push(h('p', { class: 'muted empty' }, 'No saved games yet. Finish a game to see it here.'));
  } else {
    out.push(h('h2', {}, 'Lifetime'));
    lifetimeLeaderboard(hist).forEach((r, i) => {
      out.push(h('div', { class: 'lb-row' },
        h('div', { class: 'phead' },
          h('span', { class: 'rank' }, `${i + 1}`),
          avatar(r.name, 30),
          h('div', { class: 'pinfo' },
            h('div', { class: 'pname sm' }, r.name),
            h('div', { class: 'pmeta' }, `${r.games} game${r.games === 1 ? '' : 's'}`),
          ),
        ),
        fmtNet(r.net),
      ));
    });

    out.push(h('h2', {}, 'Games'));
    for (const s of hist) {
      out.push(h('div', { class: 'card' },
        h('div', { class: 'hist-item' },
          h('div', {},
            h('div', { class: 'pname' }, s.name),
            h('div', { class: 'pmeta' }, `${new Date(s.startedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })} · ${s.players.length} players · pot ${fmtMoney(potIn(s.players))}`),
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

  clearInterval(state._tick);
  state._tick = null;

  const paint = () => {
    app.replaceChildren(...nodesFor(view).flat().filter(Boolean));
    lastView = view;
    fx.attachRipples(app);
    if (nav) fx.staggerIn(app);
  };

  if (nav && !firstPaint) fx.withTransition(paint);
  else paint();

  if ((view === 'live' || view === 'cashout') && state.session) {
    state._tick = setInterval(() => {
      const el = document.getElementById('elapsed');
      if (el && state.session) el.textContent = fmtDuration(Date.now() - state.session.startedAt);
    }, 30000);
  }

  if (nav) {
    window.scrollTo({ top: 0 });
    if (view === 'results' || view === 'shared') requestAnimationFrame(afterResults);
  }
}

function afterResults() {
  fx.celebrate();
  fx.haptic([15, 50, 15, 50, 25]);
  app.querySelectorAll('[data-count]').forEach((el) => {
    const to = Number(el.dataset.count);
    const sign = to > 0 ? '+' : '−';
    fx.countUp(el, Math.abs(to), (v) => sign + fmtMoney(Math.round(v)));
  });
}

// ---------- boot ----------

function boot() {
  const shared = sessionFromUrl();
  if (shared && shared.players.length) {
    state.shared = shared;
    setCurrency(shared.currency || 'INR');
    go('shared');
    return;
  }
  const active = loadActive();
  if (active && active.players.length) {
    state.session = active;
    setCurrency(active.currency || 'INR');
    const anyCashOut = active.players.some((p) => p.cashOut != null);
    go(anyCashOut ? 'cashout' : 'live');
    return;
  }
  setCurrency(loadCurrencyPref());
  go('setup');
}

boot();
