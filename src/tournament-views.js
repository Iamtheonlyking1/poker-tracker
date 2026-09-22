// Tournament screens: setup, the live blind clock, results, and the structure
// editor. Uses the shared `nav` context from tools.js.

import { h, avatar, escapeHtml, nameAdder } from './ui.js';
import { track } from './analytics.js';
import * as fx from './fx.js';
import { fmtMoney, currencySymbol, currencyName, currencyCode, setCurrency } from './money.js';
import { openCurrencyPicker, showResultsImage } from './tools.js';
import { nav } from './tools.js';
import { settle } from './settle.js';
import {
  loadCurrencyPref, saveCurrencyPref, loadRoster, upsertRosterPlayer, loadStructures, saveStructure,
  deleteStructure, loadPayoutStructures, savePayoutStructure, newTournament,
  addTournamentPlayer, save, saveToHistory, clearActive, updateHistorySession,
} from './state.js';
import * as T from './tournament.js';

// ---------- shared bits ----------

const head = (title, back) =>
  h('div', { class: 'tool-head' },
    h('button', { class: 'sm ghost icon-only', 'aria-label': 'Back', html: fx.icon(back === 'home' ? 'home' : 'back'),
      onclick: () => nav.go(back || 'home') }),
    h('h1', {}, title),
  );

const sel = (opts, attrs = {}) =>
  h('select', attrs, ...opts.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: String(v) }, l);
  }));

const num = (attrs = {}) => h('input', { type: 'number', inputmode: 'numeric', ...attrs });

const mmss = (ms) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const levelLabel = (lv) =>
  !lv ? '—' : lv.break ? 'Break' : `${lv.sb} / ${lv.bb}${lv.ante ? `  ·  ante ${lv.ante}` : ''}`;
const ordWord = (n) => n + (['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const payoutSummary = (rows) =>
  `${rows.length} place${rows.length === 1 ? '' : 's'} paid · ` +
  rows.map((r) => (Number.isInteger(r.pct) ? r.pct : r.pct.toFixed(1))).join(' / ') + '%';

// a name typed while setting up or running a tournament is worth remembering
// for next time — but don't churn the roster for a name already saved.
function maybeSaveToRoster(name) {
  const clean = (name || '').trim();
  if (!clean) return;
  if (loadRoster().some((r) => r.name.toLowerCase() === clean.toLowerCase())) return;
  upsertRosterPlayer({ name: clean });
}

// ---------- setup ----------

function defaultDraft() {
  return {
    name: 'Tournament',
    currency: loadCurrencyPref(),
    buyIn: 500,
    startStack: 10000,
    structureKey: 'standard',
    structure: T.STRUCTURE_PRESETS.standard.levels.map((l) => ({ ...l })),
    payoutKey: 'top3',
    payouts: T.PAYOUT_PRESETS.top3.rows.map((r) => ({ ...r })),
    rebuyOn: false,
    rebuy: { throughLevel: 4, amount: 0, stack: 0 },
    addonOn: false,
    addon: { throughLevel: 5, amount: 0, stack: 0 },
    pending: [],
  };
}

export function viewTournamentSetup() {
  const d = nav.state.tDraft || (nav.state.tDraft = defaultDraft());
  setCurrency(d.currency);

  const nameIn = h('input', { type: 'text', value: d.name, enterkeyhint: 'done', autocomplete: 'off',
    oninput: () => { d.name = nameIn.value; } });

  const curBtn = h('button', { class: 'ghost wide field-btn', onclick: () => {
    openCurrencyPicker(d.currency, (code) => {
      d.currency = code;
      setCurrency(code);
      nav.render();
    });
  }, html: `<span class="cur-sym">${currencySymbol(d.currency)}</span><span class="cur-name">${currencyName(d.currency)}</span><span class="cur-code">${d.currency}</span>${fx.icon('forward')}` });

  const buyInIn = num({ value: d.buyIn, oninput: () => { d.buyIn = parseInt(buyInIn.value, 10) || 0; } });
  const stackIn = num({ value: d.startStack, oninput: () => { d.startStack = parseInt(stackIn.value, 10) || 0; } });

  const structOpts = [
    ...Object.entries(T.STRUCTURE_PRESETS).map(([k, v]) => [k, v.name]),
    ...loadStructures().map((s) => ['saved:' + s.id, s.name]),
  ];
  const structSel = sel(structOpts, { onchange: () => {
    d.structureKey = structSel.value;
    if (structSel.value.startsWith('saved:')) {
      const st = loadStructures().find((s) => 'saved:' + s.id === structSel.value);
      d.structure = st ? st.levels.map((l) => ({ ...l })) : d.structure;
    } else {
      d.structure = T.STRUCTURE_PRESETS[structSel.value].levels.map((l) => ({ ...l }));
    }
    nav.render();
  } });
  structSel.value = d.structureKey;
  const nLevels = d.structure.filter((l) => !l.break).length;

  const payoutOpts = [
    ...(d.payoutKey === 'custom' ? [['custom', 'Custom — ' + payoutSummary(d.payouts)]] : []),
    ...Object.entries(T.PAYOUT_PRESETS).map(([k, v]) => [k, v.name]),
    ...loadPayoutStructures().map((p) => ['saved:' + p.id, p.name]),
  ];
  const payoutSel = sel(payoutOpts, { onchange: () => {
    d.payoutKey = payoutSel.value;
    if (payoutSel.value.startsWith('saved:')) {
      const p = loadPayoutStructures().find((x) => 'saved:' + x.id === payoutSel.value);
      d.payouts = p ? p.rows.map((r) => ({ ...r })) : d.payouts;
    } else {
      d.payouts = T.PAYOUT_PRESETS[payoutSel.value].rows.map((r) => ({ ...r }));
    }
    nav.render();
  } });
  payoutSel.value = d.payoutKey;

  const rebuyChk = h('input', { type: 'checkbox', checked: d.rebuyOn ? 'true' : null,
    onchange: () => {
      d.rebuyOn = rebuyChk.checked;
      if (d.rebuyOn && !d.rebuy.amount) { d.rebuy.amount = d.buyIn; d.rebuy.stack = d.startStack; }
      nav.render();
    } });
  const addonChk = h('input', { type: 'checkbox', checked: d.addonOn ? 'true' : null,
    onchange: () => {
      d.addonOn = addonChk.checked;
      if (d.addonOn && !d.addon.amount) { d.addon.amount = d.buyIn; d.addon.stack = d.startStack; }
      nav.render();
    } });

  const periodBlock = (k, label) => h('div', { class: 'card sub' },
    h('div', { class: 'field-grid' },
      h('div', {}, h('label', {}, 'Through level'),
        num({ value: d[k].throughLevel, oninput: (e) => { d[k].throughLevel = parseInt(e.target.value, 10) || 0; } })),
      h('div', {}, h('label', {}, label + ' cost'),
        num({ value: d[k].amount, oninput: (e) => { d[k].amount = parseInt(e.target.value, 10) || 0; } })),
      h('div', {}, h('label', {}, 'Chips'),
        num({ value: d[k].stack, oninput: (e) => { d[k].stack = parseInt(e.target.value, 10) || 0; } })),
    ),
  );

  // players
  const list = h('div', {});
  const renderList = () => {
    list.replaceChildren(
      ...(d.pending.length
        ? d.pending.map((nm, i) =>
            h('div', { class: 'card row' },
              h('div', { class: 'phead' }, avatar(nm), h('div', { class: 'pinfo' }, h('div', { class: 'pname' }, nm))),
              h('button', { class: 'sm danger icon-only', 'aria-label': 'Remove ' + nm, html: fx.icon('close'),
                onclick: () => { d.pending.splice(i, 1); renderList(); renderRoster(); } }),
            ))
        : [h('p', { class: 'muted empty' }, 'Add everyone in.')]),
    );
    fx.attachRipples(list);
  };
  const rosterRow = h('div', { class: 'chips roster-chips' });
  const addP = (nm) => {
    const c = nm.trim();
    if (!c || d.pending.some((x) => x.toLowerCase() === c.toLowerCase())) return;
    d.pending.push(c);
    maybeSaveToRoster(c);
    renderList();
    renderRoster();
  };
  const renderRoster = () => {
    const avail = loadRoster().filter((r) => !d.pending.some((p) => p.toLowerCase() === r.name.toLowerCase()));
    rosterRow.replaceChildren(...avail.map((r) =>
      h('button', { class: 'chip', html: fx.icon('plus') + escapeHtml(r.name), onclick: () => addP(r.name) })));
    rosterRow.hidden = avail.length === 0;
    fx.attachRipples(rosterRow);
  };
  const playerInput = h('input', { type: 'text', placeholder: 'Player name', enterkeyhint: 'done', autocomplete: 'off' });
  const playerIn = nameAdder(playerInput, (name) => { addP(name); playerInput.value = ''; });
  renderList();
  renderRoster();

  const start = h('button', { class: 'primary wide', html: 'Start tournament' + fx.icon('forward'), onclick: () => {
    if (d.pending.length < 2) return nav.toast('Add at least 2 players');
    if (!d.payouts.length) return nav.toast('Add at least one paid place');
    const totalPct = d.payouts.reduce((a, r) => a + (r.pct || 0), 0);
    if (Math.abs(totalPct - 100) > 0.5) return nav.toast(`Payouts add up to ${totalPct.toFixed(1)}%, not 100% — fix in Edit`);
    const s = newTournament({
      name: d.name, currency: d.currency, buyIn: d.buyIn, startStack: d.startStack,
      structure: d.structure,
      payouts: d.payouts,
      rebuy: d.rebuyOn ? { ...d.rebuy } : null,
      addon: d.addonOn ? { ...d.addon } : null,
    });
    d.pending.forEach((nm) => addTournamentPlayer(s, nm));
    T.startClock(s);
    nav.state.session = s;
    nav.state.tDraft = null;
    nav.state.tShowPlayers = false;
    clearActive();
    saveCurrencyPref(d.currency);
    save(s);
    track('game_start', { mode: 'tournament', players: s.players.length });
    fx.haptic(15);
    nav.go('live');
  } });

  return [
    head('New tournament', 'setup'),
    h('div', { class: 'seg' },
      h('button', { class: 'seg-btn', html: 'Cash game', onclick: () => { nav.state.tDraft = null; nav.go('setup'); } }),
      h('button', { class: 'seg-btn on' }, 'Tournament'),
    ),
    h('h2', {}, 'Tournament'),
    h('label', {}, 'Name'), nameIn,
    h('label', {}, 'Currency'), curBtn,
    h('div', { class: 'field-grid two' },
      h('div', {}, h('label', {}, 'Buy-in'), buyInIn),
      h('div', {}, h('label', {}, 'Starting stack'), stackIn),
    ),
    h('label', {}, 'Blind structure'),
    structSel,
    h('div', { class: 'row struct-row' },
      h('span', { class: 'muted small' }, `${nLevels} levels · ${d.structure[0] ? d.structure[0].minutes : 15} min`),
      h('button', { class: 'sm ghost', html: fx.icon('edit') + 'Edit', onclick: () => { nav.state.tReturn = 'tournsetup'; nav.go('structedit'); } }),
    ),
    h('label', {}, 'Payouts'), payoutSel,
    h('div', { class: 'row struct-row' },
      h('span', { class: 'muted small' }, payoutSummary(d.payouts)),
      h('button', { class: 'sm ghost', html: fx.icon('edit') + 'Edit', onclick: () => { nav.state.tReturn = 'tournsetup'; nav.go('payoutedit'); } }),
    ),
    h('label', { class: 'check' }, rebuyChk, h('span', {}, 'Allow rebuys / re-entry')),
    d.rebuyOn ? periodBlock('rebuy', 'Rebuy') : null,
    h('label', { class: 'check' }, addonChk, h('span', {}, 'Allow an add-on')),
    d.addonOn ? periodBlock('addon', 'Add-on') : null,
    h('h2', {}, 'Players'),
    playerIn,
    rosterRow,
    list,
    h('div', { style: 'height:16px' }),
    start,
  ];
}

// ---------- structure editor ----------

export function viewStructEdit() {
  const back = nav.state.tReturn || 'home';
  // edit the draft's structure directly if we came from setup
  const draft = nav.state.tDraft;
  let levels = draft ? draft.structure : (nav.state.tStructure || T.STRUCTURE_PRESETS.standard.levels.map((l) => ({ ...l })));
  if (!draft) nav.state.tStructure = levels;

  const listEl = h('div', {});
  const render = () => {
    let ln = 0;
    listEl.replaceChildren(...levels.map((lv, i) => {
      if (!lv.break) ln += 1;
      const f = (key, w = 64) => num({
        value: lv[key] ?? 0, class: 'sm', style: `width:${w}px`,
        oninput: (e) => { lv[key] = parseInt(e.target.value, 10) || 0; },
      });
      return h('div', { class: 'card struct-lv' + (lv.break ? ' brk' : '') },
        h('div', { class: 'row' },
          h('b', {}, lv.break ? 'Break' : 'Level ' + ln),
          h('button', { class: 'sm danger icon-only', 'aria-label': 'Remove', html: fx.icon('close'),
            onclick: () => { levels.splice(i, 1); render(); } }),
        ),
        lv.break
          ? h('div', { class: 'lv-fields' }, h('label', {}, 'Minutes'), f('minutes'))
          : h('div', { class: 'lv-fields' },
              h('span', {}, h('label', {}, 'SB'), f('sb')),
              h('span', {}, h('label', {}, 'BB'), f('bb')),
              h('span', {}, h('label', {}, 'Ante'), f('ante')),
              h('span', {}, h('label', {}, 'Min'), f('minutes')),
            ),
      );
    }));
  };
  render();

  const addLevel = () => {
    const last = [...levels].reverse().find((l) => !l.break);
    const bb = last ? Math.round(last.bb * 1.5) : 100;
    levels.push({ sb: Math.round(bb / 2), bb, ante: last ? last.ante : 0, minutes: last ? last.minutes : 15 });
    render();
  };
  const addBreak = () => { levels.push({ break: true, minutes: 10 }); render(); };

  return [
    head('Blind structure', back),
    h('div', { class: 'btn-row' },
      h('button', { class: 'ghost', html: fx.icon('plus') + 'Level', onclick: addLevel }),
      h('button', { class: 'ghost', html: fx.icon('plus') + 'Break', onclick: addBreak }),
    ),
    listEl,
    h('div', { class: 'btn-row' },
      h('button', { class: 'ghost wide', html: fx.icon('download') + 'Save as preset', onclick: () => {
        const name = prompt('Name this structure:');
        if (name && name.trim()) { saveStructure(name.trim(), levels.map((l) => ({ ...l }))); nav.toast('Saved'); }
      } }),
    ),
    h('div', { class: 'actionbar' },
      h('button', { class: 'primary wide', html: fx.icon('check') + 'Done', onclick: () => {
        if (draft) draft.structureKey = 'custom';
        nav.go(back);
      } }),
    ),
  ];
}

// ---------- payout editor ----------

export function viewPayoutEdit() {
  const back = nav.state.tReturn || 'home';
  const draft = nav.state.tDraft;
  let rows = draft ? draft.payouts : (nav.state.tPayouts || T.PAYOUT_PRESETS.top3.rows.map((r) => ({ ...r })));
  if (!draft) nav.state.tPayouts = rows;

  const listEl = h('div', {});
  const totalEl = h('div', { class: 'pmeta center' });
  const renumber = () => rows.forEach((r, i) => { r.place = i + 1; });
  const renderTotal = () => {
    const total = rows.reduce((a, r) => a + (r.pct || 0), 0);
    const onTarget = Math.abs(total - 100) < 0.05;
    totalEl.textContent = `Total: ${total % 1 ? total.toFixed(1) : total}%` + (onTarget ? '' : ' — should be 100%');
    totalEl.className = 'pmeta center' + (onTarget ? ' net-win' : ' net-loss');
  };
  const render = () => {
    listEl.replaceChildren(...rows.map((r, i) =>
      h('div', { class: 'kitty-row' },
        h('span', { class: 'kr-name' }, ordWord(r.place) + ' place'),
        h('input', { type: 'number', inputmode: 'decimal', class: 'sm', style: 'width:90px', value: r.pct,
          oninput: (e) => { r.pct = parseFloat(e.target.value) || 0; renderTotal(); } }),
        h('span', { class: 'muted small' }, '%'),
        h('button', { class: 'sm danger icon-only', 'aria-label': 'Remove', html: fx.icon('close'),
          onclick: () => { rows.splice(i, 1); renumber(); render(); renderTotal(); } }),
      )));
  };
  render();
  renderTotal();

  const addPlace = () => {
    const last = rows[rows.length - 1];
    rows.push({ place: rows.length + 1, pct: last ? Math.max(0, Math.round(last.pct / 2)) : 0 });
    render();
    renderTotal();
  };
  const normalize = () => {
    const total = rows.reduce((a, r) => a + (r.pct || 0), 0);
    if (!total) return;
    rows.forEach((r) => { r.pct = Math.round((r.pct / total) * 1000) / 10; });
    render();
    renderTotal();
  };
  const evenSplit = () => {
    if (!rows.length) return;
    const each = Math.floor(1000 / rows.length) / 10;
    rows.forEach((r, i) => { r.pct = i === 0 ? Math.round((100 - each * (rows.length - 1)) * 10) / 10 : each; });
    render();
    renderTotal();
  };

  return [
    head('Payouts', back),
    h('p', { class: 'muted small' }, 'How many places get paid, and how much of the pool each one gets — fully your call.'),
    listEl,
    totalEl,
    h('div', { class: 'btn-row' },
      h('button', { class: 'ghost', html: fx.icon('plus') + 'Place', onclick: addPlace }),
      h('button', { class: 'ghost', html: fx.icon('scale') + 'Normalize to 100%', onclick: normalize }),
      h('button', { class: 'ghost', html: fx.icon('grid') + 'Split evenly', onclick: evenSplit }),
    ),
    h('div', { class: 'btn-row' },
      h('button', { class: 'ghost wide', html: fx.icon('download') + 'Save as preset', onclick: () => {
        const name = prompt('Name this payout structure:');
        if (name && name.trim()) { savePayoutStructure(name.trim(), rows.map((r) => ({ ...r }))); nav.toast('Saved'); }
      } }),
    ),
    h('div', { class: 'actionbar' },
      h('button', { class: 'primary wide', html: fx.icon('check') + 'Done', onclick: () => {
        if (!rows.length) return nav.toast('Add at least one paid place');
        if (draft) draft.payoutKey = 'custom';
        nav.go(back);
      } }),
    ),
  ];
}

// ---------- live: the blind clock ----------

let _lastLevelIdx = -1;

export function tournamentTick() {
  const s = nav.state.session;
  if (!s || s.type !== 'tournament' || !s.clock) return;
  const rolled = T.advanceIfDue(s);
  if (rolled) {
    save(s);
    fx.haptic([20, 60, 20, 60, 40]);
    nav.render();
    return;
  }
  const el = document.getElementById('tclock');
  if (el) el.textContent = mmss(T.levelRemainingMs(s));
}

export function viewTournamentLive() {
  const s = nav.state.session;
  const lv = T.currentLevel(s);
  const paused = T.isPaused(s);
  _lastLevelIdx = s.clock.levelIdx;

  const upcoming = T.upcomingLevels(s, 8);
  const upcomingStrip = upcoming.length
    ? h('div', { class: 'tc-upcoming scroll-x' },
        h('div', { class: 'tc-upcoming-row' },
          ...upcoming.map((u) =>
            h('div', { class: 'tc-up-chip' + (u.level.break ? ' brk' : '') },
              h('div', { class: 'tc-up-lv' }, u.level.break ? 'Break' : 'Lv ' + u.number),
              h('div', { class: 'tc-up-blinds' }, levelLabel(u.level)),
            )),
        ))
    : null;

  const clock = h('div', { class: 'tclock-wrap' + (paused ? ' paused' : '') + (lv && lv.break ? ' brk' : '') },
    h('div', { class: 'tc-level' }, lv && lv.break ? 'BREAK' : `Level ${T.levelNumber(s)}`),
    h('div', { class: 'tc-blinds' }, levelLabel(lv)),
    h('div', { class: 'tc-time', id: 'tclock' }, mmss(T.levelRemainingMs(s))),
    h('div', { class: 'tc-ctrls' },
      h('button', { class: 'sm ghost icon-only', 'aria-label': 'Previous level', html: fx.icon('back'),
        onclick: () => { T.gotoLevel(s, s.clock.levelIdx - 1); save(s); nav.render(); } }),
      h('button', { class: 'sm primary', html: fx.icon(paused ? 'play' : 'pause') + (paused ? 'Resume' : 'Pause'),
        onclick: () => { paused ? T.resumeClock(s) : T.pauseClock(s); save(s); nav.render(); } }),
      h('button', { class: 'sm ghost icon-only', 'aria-label': 'Next level', html: fx.icon('forward'),
        onclick: () => { T.gotoLevel(s, s.clock.levelIdx + 1); save(s); nav.render(); } }),
    ),
    upcomingStrip,
  );

  const left = T.playersLeft(s);
  const strip = h('div', { class: 'statstrip' },
    h('span', {}, `${left} / ${s.players.length} left`),
    h('span', {}, `avg ${s.startStack ? Math.round(T.avgStack(s)).toLocaleString('en-IN') : 0}`),
    h('span', {}, `pool ${fmtMoney(T.prizePool(s))}`),
    h('span', {}, `${T.totalEntries(s)} entries`),
  );

  const cRebuy = T.canRebuy(s);
  const cAddon = T.canAddon(s);
  const cards = s.players
    .slice()
    .sort((a, b) => (a.finish == null ? -1 : 1) - (b.finish == null ? -1 : 1) || (b.finish || 0) - (a.finish || 0))
    .map((p) => {
      const out = p.finish != null;
      const inv = T.invested(p);
      return h('div', { class: 'card' + (out ? ' tp-out' : '') },
        h('div', { class: 'row' },
          h('div', { class: 'phead' },
            avatar(p.name),
            h('div', { class: 'pinfo' },
              h('div', { class: 'pname' }, p.name),
              h('div', { class: 'pmeta' }, out
                ? `Out — ${ordinal(p.finish)}`
                : `${p.entries.length} entr${p.entries.length === 1 ? 'y' : 'ies'} · ${fmtMoney(inv)}`),
            ),
          ),
        ),
        out
          ? (cRebuy
              ? h('div', { class: 'btn-row' }, h('button', { class: 'sm', html: fx.icon('undo') + 'Re-enter',
                  onclick: () => { T.reenter(s, p.id); save(s); fx.haptic(12); nav.render(); } }))
              : null)
          : h('div', { class: 'btn-row' },
              cRebuy ? h('button', { class: 'sm', html: fx.icon('plus') + 'Rebuy',
                onclick: () => { T.addEntry(s, p.id, 'rebuy'); save(s); fx.haptic(10); nav.render(); } }) : null,
              cAddon && !T.hasAddon(p) ? h('button', { class: 'sm', html: fx.icon('plus') + 'Add-on',
                onclick: () => { T.addEntry(s, p.id, 'addon'); save(s); fx.haptic(10); nav.render(); } }) : null,
              h('button', { class: 'sm danger', html: fx.icon('flag') + 'Bust out',
                onclick: () => { if (confirm(`Bust out ${p.name}?`)) { T.bustOut(s, p.id); save(s); fx.haptic([12, 40, 12]); nav.render(); } } }),
            ),
      );
    });

  const lateInput = h('input', { type: 'text', placeholder: 'Late entry name', enterkeyhint: 'done', autocomplete: 'off' });
  const lateIn = nameAdder(lateInput, (name) => {
    maybeSaveToRoster(name);
    T.addLatePlayer(s, name);
    save(s);
    nav.render();
  });

  if (nav.state.tShowPlayers == null) nav.state.tShowPlayers = false;
  const showPlayers = nav.state.tShowPlayers;
  const playersToggle = h('button', {
    class: 'ghost wide',
    html: fx.icon('users') + (showPlayers ? 'Hide players' : `Show players (${s.players.length})`),
    onclick: () => { nav.state.tShowPlayers = !showPlayers; nav.render(); },
  });

  return [
    h('div', { class: 'head-row' },
      h('h1', {}, s.name),
      h('div', { class: 'hr-actions' },
        h('button', { class: 'sm ghost icon-only', 'aria-label': 'Tools', html: fx.icon('grid'), onclick: () => nav.go('home') }),
      ),
    ),
    clock,
    strip,
    playersToggle,
    showPlayers ? h('div', { class: 'cards' }, ...cards) : null,
    h('h2', {}, 'Late entry'),
    lateIn,
    h('div', { class: 'actionbar' },
      h('button', { class: 'ghost', html: fx.icon('back') + 'Home', onclick: () => nav.go('home') }),
      h('button', { class: 'primary', html: 'Results' + fx.icon('forward'), onclick: () => nav.go('results') }),
    ),
  ];
}

// ---------- results ----------

export function viewTournamentResults(fromHistory) {
  const s = fromHistory ? nav.state.shared : nav.state.session;
  const stillIn = s.players.filter((p) => p.finish == null);
  const pay = T.payouts(s);
  const nets = T.tournamentNets(s);
  const transfers = settle(T.tournamentSettleInput(s));
  const durMs = (s.settledAt || Date.now()) - s.startedAt;
  const skey = (t) => `${t.from}|${t.to}|${t.amount}`;
  const persist = () => (fromHistory ? updateHistorySession(s) : save(s));

  const out = [
    fromHistory ? head(s.name, 'history') : h('h1', {}, s.name),
    h('div', { class: 'statstrip' },
      h('span', {}, new Date(s.startedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })),
      h('span', {}, `${T.totalEntries(s)} entries`),
      h('span', {}, `pool ${fmtMoney(T.prizePool(s))}`),
      h('span', { html: fx.icon('clock') + fmtDurationMs(durMs) }),
    ),
  ];

  if (stillIn.length > 1) {
    out.push(h('div', { class: 'banner warn' }, `${stillIn.length} players still in — chop or finish the tournament.`));
    out.push(chopEditor(s, stillIn, persist));
  } else if (stillIn.length === 1 && stillIn[0].finish == null) {
    stillIn[0].finish = 1;
  }

  out.push(h('h2', {}, 'Payouts'));
  out.push(h('div', { class: 'card' },
    ...pay.map((r) => h('div', { class: 'kr-line' },
      `${ordinal(r.place)} — ${r.name || '?'}`,
      h('b', { class: 'net-win', style: 'float:right' }, fmtMoney(r.amount)))),
  ));

  out.push(h('h2', {}, 'Net'));
  out.push(h('div', { class: 'cards' }, ...nets.slice().sort((a, b) => b.net - a.net).map((r) =>
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('div', { class: 'phead' }, avatar(r.name), h('div', { class: 'pinfo' },
          h('div', { class: 'pname' }, r.name),
          h('div', { class: 'pmeta' }, `in ${fmtMoney(r.invested)}${r.won ? ` · won ${fmtMoney(r.won)}` : ''}`))),
        r.net === 0
          ? h('span', { class: 'pmeta' }, 'even')
          : h('span', { class: r.net > 0 ? 'net-win' : 'net-loss' }, (r.net > 0 ? '+' : '−') + fmtMoney(Math.abs(r.net))),
      )))));

  const settledCount = transfers.filter((t) => s.settled && s.settled[skey(t)]).length;
  out.push(h('h2', {}, transfers.length ? `Settle up · ${settledCount}/${transfers.length} paid` : 'Settle up'));
  if (!transfers.length) {
    out.push(h('div', { class: 'banner ok', html: fx.icon('check') + 'Nothing to move.' }));
  } else {
    for (const t of transfers) {
      const done = s.settled && s.settled[skey(t)];
      out.push(h('div', { class: 'settle-line tappable' + (done ? ' done' : ''), role: 'button',
        html: fx.icon(done ? 'check' : 'circle', 'sl-check') + `<span><b>${escapeHtml(t.from)}</b> pays <b>${escapeHtml(t.to)}</b> ${fmtMoney(t.amount)}</span>`,
        onclick: () => {
          s.settled = s.settled || {};
          if (s.settled[skey(t)]) delete s.settled[skey(t)]; else { s.settled[skey(t)] = true; fx.haptic(10); }
          persist();
          nav.render();
        } }));
    }
  }

  const imgData = {
    title: s.name,
    dateMs: s.startedAt,
    subtitle: `${T.totalEntries(s)} entries · pool ${fmtMoney(T.prizePool(s))} · ${fmtDurationMs(durMs)}`,
    nets: nets.map((r) => ({ name: r.name, net: r.net })),
    transfers,
    kitty: null,
    fmt: (n) => fmtMoney(n),
  };
  out.push(
    h('div', { style: 'height:16px' }),
    h('div', { class: 'btn-row' },
      h('button', { class: 'wide', html: fx.icon('image') + 'Save results image', onclick: () => showResultsImage(imgData) }),
    ),
  );

  if (!fromHistory) {
    out.push(
      h('div', { class: 'btn-row' },
        h('button', { class: 'wide', html: fx.icon('check') + 'Save to history & finish', onclick: () => {
          saveToHistory(s);
          track('game_settle', { mode: 'tournament', players: s.players.length, pool: T.prizePool(s) });
          clearActive();
          nav.state.session = null;
          fx.haptic(20);
          nav.toast('Saved to history');
          nav.go('history');
        } }),
      ),
      h('div', { class: 'actionbar' },
        h('button', { class: 'ghost wide', html: fx.icon('back') + 'Back to clock', onclick: () => nav.go('live') }),
      ),
    );
  } else {
    out.push(h('div', { class: 'actionbar' },
      h('button', { class: 'ghost wide', html: fx.icon('back') + 'History', onclick: () => nav.go('history') })));
  }
  return out;
}

function chopEditor(s, stillIn, persist) {
  const rows = stillIn.map((p) => {
    const stackIn = num({ class: 'sm', placeholder: 'chips', style: 'width:110px',
      value: (s._chopStacks && s._chopStacks[p.id]) || '' });
    stackIn.dataset.pid = p.id;
    return h('label', { class: 'kitty-row' }, h('span', { class: 'kr-name' }, p.name), stackIn);
  });
  const remainingPool = T.prizePool(s) -
    T.payouts(s).filter((r) => s.players.some((p) => p.name === r.name && p.finish != null)).reduce((a, r) => a + r.amount, 0);

  const apply = (byIcm) => {
    const stacks = rows.map((r) => parseInt(r.querySelector('input').value, 10) || 0);
    const ids = stillIn.map((p) => p.id);
    let amounts;
    if (byIcm && stacks.every((x) => x > 0)) {
      const prizes = T.payouts(s).map((r) => r.amount).slice(0, stacks.length);
      while (prizes.length < stacks.length) prizes.push(0);
      // scale ICM to the remaining pool
      const eq = T.icmEquities(stacks, prizes);
      const sum = eq.reduce((a, b) => a + b, 0) || 1;
      amounts = eq.map((e) => Math.round((e / sum) * remainingPool));
    } else {
      const each = Math.floor(remainingPool / ids.length);
      amounts = ids.map((_, i) => each + (i < remainingPool - each * ids.length ? 1 : 0));
    }
    s.chop = s.chop || {};
    s._chopStacks = {};
    // order still-in by amount desc -> assign finishes 1..k
    const order = ids.map((id, i) => ({ id, amt: amounts[i], st: stacks[i] })).sort((a, b) => b.amt - a.amt);
    let place = 1;
    for (const o of order) {
      s.chop[o.id] = o.amt;
      const pl = s.players.find((x) => x.id === o.id);
      if (pl) pl.finish = place;
      s._chopStacks[o.id] = o.st || '';
      place += 1;
    }
    persist();
    fx.haptic([12, 40, 12]);
    nav.render();
  };

  return h('div', { class: 'card' },
    h('div', { class: 'pmeta' }, `Chop ${fmtMoney(remainingPool)} between ${stillIn.length}`),
    h('div', { class: 'kitty-rows' }, ...rows),
    h('div', { class: 'btn-row' },
      h('button', { class: 'sm ghost', html: 'Split evenly', onclick: () => apply(false) }),
      h('button', { class: 'sm primary', html: 'ICM by stacks', onclick: () => apply(true) }),
    ),
  );
}

// ---------- helpers ----------

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function fmtDurationMs(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const hh = Math.floor(m / 60);
  return hh ? `${hh}h ${m % 60}m` : `${m}m`;
}

// ---------- registry ----------

export const TOURN_VIEWS = {
  tournsetup: viewTournamentSetup,
  structedit: viewStructEdit,
  payoutedit: viewPayoutEdit,
};
