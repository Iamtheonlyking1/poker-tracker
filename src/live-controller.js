// App-side glue for live tables: holds the one active shared session, wires its
// folded state into the app's render loop, and exposes host / join / leave.

import { nav } from './tools.js';
import { createLiveGame, joinLiveGame, openLiveSession } from './live/session.js';
import { toHistoryEntry } from './live/fold.js';
import { auth, isSignedIn } from './supabase.js';
import { saveToHistory, clearActive } from './state.js';
import { report } from './report.js';

let active = null; // { gameId, code, controls, ownerId }

export function liveActive() {
  return active;
}

function attach(gameId, code) {
  active = { gameId, code, controls: null };
  let first;
  const ready = new Promise((res) => (first = res));
  active.controls = openLiveSession(gameId, (folded) => {
    nav.state.session = folded;
    nav.state.liveGame = active;
    first();
    // a joiner who was on the live screen when the host settles → results
    if (folded.status === 'settled' && nav.state.view === 'live') nav.go('results');
    else (nav.softRender || nav.render)();
  });
  active.ready = ready;
  return active;
}

/** Turn the current local game into a shared one (or start a fresh shared game). */
export async function hostGame(seed) {
  const { gameId, code } = await createLiveGame({
    name: seed && seed.name,
    currency: seed && seed.currency,
    defaultBuyIn: seed && seed.defaultBuyIn,
  });
  attach(gameId, code);

  if (seed && Array.isArray(seed.players) && seed.players.length) {
    for (const p of seed.players) {
      await active.controls.append('add_player', { playerId: p.id, name: p.name });
      for (const b of p.buyIns || []) {
        await active.controls.append('add_buyin', { playerId: p.id, amount: b.amount });
      }
      if (p.cashOut != null) {
        await active.controls.append('set_cashout', { playerId: p.id, amount: p.cashOut });
      }
    }
    clearActive(); // the shared game is now the source of truth
  }
  return code;
}

/** Join a shared game by code — signs in anonymously first if needed. */
export async function joinGame(code, displayName) {
  if (!isSignedIn()) await auth.signInAnonymously();
  const game = await joinLiveGame(code, displayName);
  attach(game.id, game.join_code);
  active.ownerId = game.owner_id;
  await Promise.race([active.ready, new Promise((r) => setTimeout(r, 4000))]);
  return game;
}

export function leaveLive() {
  if (active && active.controls) active.controls.close();
  active = null;
  if (nav.state) nav.state.liveGame = null;
}

/** Save the finished shared game to this device's history (then it doc-syncs). */
export function saveLiveToHistory(folded) {
  try {
    saveToHistory(toHistoryEntry(folded));
  } catch (e) {
    report(e, { kind: 'live.saveHistory' });
  }
  leaveLive();
}
