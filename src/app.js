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
import {
  rupee,
  summaryText,
  shareUrl,
  whatsappUrl,
  sessionFromUrl,
} from './share.js';

const app = document.getElementById('app');

// view: 'setup' | 'live' | 'cashout' | 'results' | 'history' | 'shared'
let state = {
  view: 'setup',
  session: null,
  shared: null, // read-only session from a link
  buyInPresets: [100, 200, 500, 1000],
};

// ---------- helpers ----------

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
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 1800);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch (e) {
    // fallback
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

// ---------- views ----------

function viewSetup() {
  const nameIn = h('input', { type: 'text', id: 'sname', placeholder: 'Friday game', value: 'Poker night' });
  let buyIn = 500;

  const chipRow = h('div', { class: 'chips' });
  const renderChips = () => {
    chipRow.replaceChildren(
      ...state.buyInPresets.map((v) =>
        h(
          'button',
          {
            class: 'chip' + (v === buyIn ? ' on' : ''),
            onclick: () => {
              buyIn = v;
              customIn.value = '';
              renderChips();
            },
          },
          rupee.format(v),
        ),
      ),
    );
  };
  const customIn = h('input', {
    type: 'number',
    inputmode: 'numeric',
    placeholder: 'Custom amount',
    oninput: () => {
      const v = parseInt(customIn.value, 10);
      if (v > 0) buyIn = v;
      renderChips();
    },
  });
  renderChips();

  const playerIn = h('input', {
    type: 'text',
    placeholder: 'Add player name, press Enter',
    onkeydown: (e) => {
      if (e.key === 'Enter' && playerIn.value.trim()) {
        addP(playerIn.value);
        playerIn.value = '';
      }
    },
  });
  const list = h('div', {});
  let pending = [];
  const addP = (n) => {
    pending.push(n.trim());
    renderList();
  };
  const renderList = () => {
    list.replaceChildren(
      ...pending.map((n, i) =>
        h(
          'div',
          { class: 'card' },
          h(
            'div',
            { class: 'row' },
            h('span', { class: 'pname' }, n),
            h('button', { class: 'sm danger', onclick: () => { pending.splice(i, 1); renderList(); } }, 'Remove'),
          ),
        ),
      ),
    );
  };

  const start = h(
    'button',
    {
      class: 'primary wide',
      onclick: () => {
        if (pending.length < 2) return toast('Add at least 2 players');
        const s = newSession({ name: nameIn.value, defaultBuyIn: buyIn });
        pending.forEach((n) => addPlayer(s, n));
        // give each player one starting buy-in
        s.players.forEach((p) => addBuyIn(s, p.id, s.defaultBuyIn));
        state.session = s;
        state.view = 'live';
        clearActive();
        save(s);
        render();
      },
    },
    'Start game',
  );

  return [
    h('h1', {}, '🃏 Poker Night'),
    h('p', { class: 'muted' }, 'Track buy-ins in ₹, settle up at the end.'),
    loadHistory().length
      ? h('button', { class: 'ghost wide', onclick: () => { state.view = 'history'; render(); } }, `View history (${loadHistory().length})`)
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
  return h(
    'div',
    { class: 'topbar' },
    h('div', { class: 'stat' }, h('b', {}, rupee.format(pot)), 'in the pot'),
    h('div', { class: 'stat' }, h('b', {}, String(n)), n === 1 ? 'player' : 'players'),
    h('div', { class: 'stat' }, h('b', {}, rupee.format(n ? Math.round(pot / n) : 0)), 'avg stack'),
  );
}

function viewLive() {
  const s = state.session;
  const cards = s.players.map((p) => {
    const custom = h('input', { type: 'number', inputmode: 'numeric', placeholder: 'Custom ₹', class: 'sm' });
    return h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'row' },
        h(
          'div',
          {},
          h('div', { class: 'pname' }, p.name),
          h('div', { class: 'pmeta' }, `In ${rupee.format(totalIn(p))} · ${p.buyIns.length} buy-in${p.buyIns.length === 1 ? '' : 's'}`),
        ),
        h('button', { class: 'sm danger', onclick: () => confirm(`Remove ${p.name}?`) && mutate((ss) => removePlayer(ss, p.id)) }, '✕'),
      ),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'primary', onclick: () => mutate((ss) => addBuyIn(ss, p.id, ss.defaultBuyIn)) }, `+ ${rupee.format(s.defaultBuyIn)}`),
        h('button', {
          class: 'sm',
          onclick: () => {
            const v = parseInt(custom.value, 10);
            if (v > 0) { mutate((ss) => addBuyIn(ss, p.id, v)); }
          },
        }, 'Add'),
        custom,
      ),
    );
  });

  const addName = h('input', {
    type: 'text',
    placeholder: 'Late joiner name',
    onkeydown: (e) => {
      if (e.key === 'Enter' && addName.value.trim()) {
        const nm = addName.value.trim();
        mutate((ss) => {
          addPlayer(ss, nm);
          const np = ss.players[ss.players.length - 1];
          addBuyIn(ss, np.id, ss.defaultBuyIn);
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
      h('button', { class: 'ghost', disabled: canUndo() ? null : 'true', onclick: undo }, '↶ Undo'),
      h('button', { class: 'primary', onclick: () => { state.view = 'cashout'; render(); } }, 'End game →'),
    ),
  ];
}

function viewCashout() {
  const s = state.session;
  const banner = h('div', {});
  const nextBtn = h('button', { class: 'primary', onclick: () => { state.view = 'results'; render(); } }, 'See settlement →');

  const refresh = () => {
    const rec = reconciliation(s.players);
    if (rec.balanced) {
      banner.className = 'banner ok';
      banner.textContent = `Pot balanced at ${rupee.format(rec.in)}`;
    } else {
      banner.className = 'banner warn';
      banner.textContent =
        rec.delta > 0
          ? `${rupee.format(rec.delta)} more than bought in — recount stacks`
          : `${rupee.format(-rec.delta)} unaccounted — recount stacks`;
    }
    const allIn = s.players.every((p) => p.cashOut !== null && p.cashOut !== undefined);
    if (allIn) nextBtn.removeAttribute('disabled');
    else nextBtn.setAttribute('disabled', 'true');
  };

  const cards = s.players.map((p) => {
    let netSpan = fmtNet(net(p));
    const inp = h('input', {
      type: 'number',
      inputmode: 'numeric',
      placeholder: 'Ending stack ₹',
      value: p.cashOut ?? '',
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
    return h(
      'div',
      { class: 'card' },
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
      h('button', { class: 'ghost', onclick: () => { state.view = 'live'; render(); } }, '← Back'),
      nextBtn,
    ),
  ];
}

function resultsBlock(s, { readOnly = false } = {}) {
  const rec = reconciliation(s.players);
  const rows = s.players
    .map((p) => ({ name: p.name, n: net(p) || 0 }))
    .sort((a, b) => b.n - a.n);
  const transfers = settle(s.players);

  const out = [
    h('h1', {}, s.name),
    h('p', { class: 'muted' }, new Date(s.startedAt).toLocaleString('en-IN', { dateStyle: 'medium' })),
  ];

  if (!rec.balanced) {
    out.push(
      h('div', { class: 'banner warn' },
        rec.delta > 0
          ? `Heads up: stacks add up to ${rupee.format(rec.delta)} more than the pot.`
          : `Heads up: ${rupee.format(-rec.delta)} missing from the pot.`),
    );
  }

  out.push(h('h2', {}, 'Net'));
  for (const r of rows) {
    out.push(
      h('div', { class: 'card' },
        h('div', { class: 'row' },
          h('span', { class: 'pname' }, r.name),
          fmtNet(r.n),
        ),
      ),
    );
  }

  out.push(h('h2', {}, 'Settle up'));
  if (transfers.length === 0) {
    out.push(h('div', { class: 'banner ok' }, 'Everyone square. Nothing to pay.'));
  } else {
    for (const t of transfers) {
      out.push(
        h('div', { class: 'settle-line', html:
          `<b>${escapeHtml(t.from)}</b> pays <b>${escapeHtml(t.to)}</b> ${rupee.format(t.amount)}` }),
      );
    }
  }
  return out;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function viewResults() {
  const s = state.session;
  const blocks = resultsBlock(s);

  blocks.push(
    h('div', { style: 'height:16px' }),
    h('div', { class: 'btn-row' },
      h('button', { class: 'primary wide', onclick: () => window.open(whatsappUrl(s), '_blank') }, '↗ Share to WhatsApp'),
    ),
    h('div', { class: 'btn-row' },
      h('button', { onclick: () => copy(summaryText(s)) }, 'Copy summary'),
      h('button', { onclick: () => copy(shareUrl(s)) }, 'Copy link'),
    ),
    h('div', { class: 'btn-row' },
      h('button', { class: 'wide', onclick: () => {
        saveToHistory(s);
        clearActive();
        toast('Saved to history');
        state.session = null;
        state.view = 'history';
        render();
      } }, '✓ Save to history & finish'),
    ),
    h('div', { class: 'actionbar' },
      h('button', { class: 'ghost', onclick: () => { state.view = 'cashout'; render(); } }, '← Edit cash-outs'),
    ),
  );
  return blocks;
}

function viewShared() {
  const s = state.shared;
  const blocks = resultsBlock(s, { readOnly: true });
  blocks.unshift(h('div', { class: 'banner info' }, 'Shared results — read only'));
  blocks.push(
    h('div', { style: 'height:16px' }),
    h('div', { class: 'btn-row' },
      h('button', { onclick: () => copy(summaryText(s, { withLink: false })) }, 'Copy summary'),
      h('button', { class: 'primary', onclick: () => {
        // import as own editable session
        const imp = JSON.parse(JSON.stringify(s));
        imp.id = Math.random().toString(36).slice(2, 9);
        imp.status = 'live';
        state.session = imp;
        state.shared = null;
        state.view = 'results';
        history.replaceState(null, '', location.pathname);
        save(imp);
        render();
      } }, 'Open as my session'),
    ),
    h('div', { class: 'btn-row' },
      h('button', { class: 'ghost wide', onclick: () => {
        state.shared = null;
        history.replaceState(null, '', location.pathname);
        boot();
      } }, 'Start my own game'),
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
  const out = [h('h1', {}, 'History')];

  if (!hist.length) {
    out.push(h('p', { class: 'muted' }, 'No saved games yet.'));
  } else {
    out.push(h('h2', {}, 'Lifetime'));
    for (const r of lifetimeLeaderboard(hist)) {
      out.push(
        h('div', { class: 'lb-row' },
          h('span', {}, `${r.name} · ${r.games} game${r.games === 1 ? '' : 's'}`),
          fmtNet(r.net),
        ),
      );
    }

    out.push(h('h2', {}, 'Games'));
    for (const s of hist) {
      out.push(
        h('div', { class: 'card' },
          h('div', { class: 'hist-item' },
            h('div', {},
              h('div', { class: 'pname' }, s.name),
              h('div', { class: 'pmeta' }, `${new Date(s.startedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })} · ${s.players.length} players · pot ${rupee.format(potIn(s.players))}`),
            ),
          ),
          h('div', { class: 'btn-row' },
            h('button', { class: 'sm', onclick: () => { state.shared = s; state.view = 'shared'; render(); } }, 'View'),
            h('button', { class: 'sm', onclick: () => copy(shareUrl(s)) }, 'Copy link'),
            h('button', { class: 'sm danger', onclick: () => { if (confirm('Delete this game?')) { deleteFromHistory(s.id); render(); } } }, 'Delete'),
          ),
        ),
      );
    }
  }

  out.push(
    h('div', { class: 'actionbar' },
      h('button', { class: 'primary wide', onclick: () => { state.view = state.session ? 'live' : 'setup'; render(); } },
        state.session ? '← Back to game' : '+ New game'),
    ),
  );
  return out;
}

// ---------- render ----------

function render() {
  let nodes;
  switch (state.view) {
    case 'live': nodes = viewLive(); break;
    case 'cashout': nodes = viewCashout(); break;
    case 'results': nodes = viewResults(); break;
    case 'history': nodes = viewHistory(); break;
    case 'shared': nodes = viewShared(); break;
    default: nodes = viewSetup();
  }
  app.replaceChildren(...nodes.flat().filter(Boolean));
  window.scrollTo({ top: 0 });
}

// ---------- boot ----------

function boot() {
  const shared = sessionFromUrl();
  if (shared && shared.players.length) {
    state.shared = shared;
    state.view = 'shared';
    render();
    return;
  }
  const active = loadActive();
  if (active && active.players.length) {
    state.session = active;
    // resume where it makes sense
    const anyCashOut = active.players.some((p) => p.cashOut != null);
    state.view = anyCashOut ? 'cashout' : 'live';
    render();
    return;
  }
  state.view = 'setup';
  render();
}

boot();
