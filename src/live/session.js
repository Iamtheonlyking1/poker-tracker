// The live-table controller. A shared game lives as an append-only event log in
// Supabase; this fetches it, folds it (src/live/fold.js), keeps it fresh over a
// realtime socket plus a slow poll, and appends new events.

import { db, auth, currentUser } from '../supabase.js';
import { getSupabaseUrl, getSupabaseAnonKey } from '../config.js';
import { foldEvents } from './fold.js';
import { createRealtime } from './realtime.js';
import { shortCode } from '../id.js';
import { report } from '../report.js';

const POLL_MS = 3000;
const HEARTBEAT_MS = 30000;

/** Host a new shared game. Returns { gameId, code }. */
export async function createLiveGame({ name, currency, defaultBuyIn, displayName }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = shortCode(5);
    try {
      const gameId = await db.rpc('create_live_game', {
        p_name: name || 'Poker night',
        p_currency: currency || 'INR',
        p_buyin: Math.max(1, Math.round(defaultBuyIn || 500)),
        p_code: code,
        p_display: displayName || null,
      });
      return { gameId: typeof gameId === 'string' ? gameId : gameId && gameId.id, code };
    } catch (e) {
      if (/duplicate|unique|23505/i.test(String(e.message))) continue; // code clash, retry
      throw e;
    }
  }
  throw new Error('Could not create a game code — try again.');
}

/** Join an existing shared game by its code. Returns the game row. */
export async function joinLiveGame(code, displayName) {
  const res = await db.rpc('join_live_game', {
    p_code: String(code || '').trim().toUpperCase(),
    p_display: displayName || null,
  });
  const game = Array.isArray(res) ? res[0] : res;
  if (!game || !game.id) throw new Error('No live game with that code.');
  return game;
}

/**
 * Open a live session. `onSession(folded)` fires whenever the state changes.
 * Returns controls: append / settle / members / close.
 */
export function openLiveSession(gameId, onSession) {
  let game = null;
  let events = [];
  let members = [];
  let stopped = false;
  let lastSeq = 0;
  let refetching = null;
  let pollTimer = null;
  let hbTimer = null;

  const emit = () => {
    if (game) onSession(foldEvents(game, events));
  };

  async function refetch() {
    if (stopped) return;
    if (refetching) return refetching;
    refetching = (async () => {
      try {
        const g = await db.select('live_games', `id=eq.${gameId}&select=*`);
        game = Array.isArray(g) ? g[0] : g;
        if (!game) return;
        const rows = await db.select('live_events', `game_id=eq.${gameId}&select=id,seq,type,payload,actor_id,created_at&order=seq.asc`);
        events = (Array.isArray(rows) ? rows : []).filter((e) => !e._optimistic);
        lastSeq = events.length ? Number(events[events.length - 1].seq) : 0;
        const mem = await db.select('live_members', `game_id=eq.${gameId}&select=user_id,display_name,role,last_seen_at`);
        members = Array.isArray(mem) ? mem : [];
        emit();
      } catch (e) {
        report(e, { kind: 'live.refetch' });
      } finally {
        refetching = null;
      }
    })();
    return refetching;
  }

  async function append(type, payload) {
    const user = currentUser();
    if (!user) throw new Error('Sign in to change a shared game.');
    const optimistic = {
      id: '_opt_' + Math.random(),
      seq: lastSeq + 0.5,
      type,
      payload,
      actor_id: user.id,
      created_at: new Date().toISOString(),
      _optimistic: true,
    };
    events = [...events, optimistic];
    emit();
    try {
      await db.insert('live_events', [{ game_id: gameId, actor_id: user.id, type, payload }]);
      await refetch();
    } catch (e) {
      events = events.filter((x) => x !== optimistic);
      emit();
      throw e;
    }
  }

  async function settle() {
    await append('settle', {});
    const user = currentUser();
    const owner = game && game.owner_id === (user && user.id);
    if (owner) {
      try {
        await db.update('live_games', `id=eq.${gameId}`, { status: 'settled', settled_at: new Date().toISOString() });
      } catch (e) {
        report(e, { kind: 'live.settle' });
      }
    }
    await refetch();
  }

  async function heartbeat() {
    const user = currentUser();
    if (!user) return;
    try {
      await db.update(
        'live_members',
        `game_id=eq.${gameId}&user_id=eq.${user.id}`,
        { last_seen_at: new Date().toISOString() },
      );
    } catch (e) {
      /* non-critical */
    }
  }

  // realtime: any new event → refetch (the socket is an optimisation; the poll
  // is the guarantee)
  const rt = createRealtime({
    url: getSupabaseUrl().replace(/^http/, 'ws'),
    apikey: getSupabaseAnonKey(),
    getToken: async () => {
      const s = await auth.ensureFresh();
      return s && s.access_token;
    },
  });
  const unsubEvents = rt.subscribeInserts('live_events', `game_id=eq.${gameId}`, () => refetch());
  const unsubGame = rt.subscribeInserts('live_games', `id=eq.${gameId}`, () => refetch());
  rt.connect();

  pollTimer = setInterval(refetch, POLL_MS);
  hbTimer = setInterval(heartbeat, HEARTBEAT_MS);
  refetch();
  heartbeat();

  return {
    append,
    settle,
    members: () => members,
    isOwner: () => {
      const u = currentUser();
      return !!(game && u && game.owner_id === u.id);
    },
    refetch,
    close() {
      stopped = true;
      clearInterval(pollTimer);
      clearInterval(hbTimer);
      unsubEvents();
      unsubGame();
      rt.close();
    },
  };
}
