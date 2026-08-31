// A shared game is an append-only event log. Every device folds the same log
// into the same session — the shape src/app.js's viewLive / viewCashout render.
// Pure and deterministic: order is by `seq`, nothing reads a clock.

const EVENT_TYPES = [
  'add_player',
  'remove_player',
  'rename_player',
  'add_buyin',
  'set_cashout',
  'set_kitty',
  'settle',
];
export { EVENT_TYPES };

/**
 * @param game  { id, name, currency, default_buy_in, created_at, status }
 * @param events [{ seq, type, payload, created_at }]
 * @returns session — { id, name, startedAt, defaultBuyIn, currency, status,
 *                      players:[{id,name,buyIns:[{amount,ts}],cashOut}], kitty?, _live:true }
 */
export function foldEvents(game, events = []) {
  const s = {
    id: game.id,
    name: game.name || 'Poker night',
    startedAt: Date.parse(game.created_at) || Date.now(),
    defaultBuyIn: game.default_buy_in || 500,
    currency: game.currency || 'INR',
    status: game.status === 'settled' ? 'settled' : 'live',
    players: [],
    _live: true,
  };

  const byId = new Map();
  const ensure = (id, name) => {
    let p = byId.get(id);
    if (!p) {
      p = { id, name: name || 'Player', buyIns: [], cashOut: null };
      byId.set(id, p);
      s.players.push(p);
    } else if (name && p.name === 'Player') {
      p.name = name;
    }
    return p;
  };

  for (const e of [...events].sort((a, b) => (a.seq || 0) - (b.seq || 0))) {
    const p = e.payload || {};
    const ts = Date.parse(e.created_at) || 0;
    switch (e.type) {
      case 'add_player':
        ensure(p.playerId, p.name);
        break;
      case 'rename_player': {
        const pl = byId.get(p.playerId);
        if (pl && p.name) pl.name = p.name;
        break;
      }
      case 'remove_player':
        if (byId.delete(p.playerId)) s.players = s.players.filter((x) => x.id !== p.playerId);
        break;
      case 'add_buyin': {
        const pl = ensure(p.playerId, p.name);
        pl.buyIns.push({ amount: Math.max(1, Math.round(p.amount || s.defaultBuyIn)), ts });
        break;
      }
      case 'set_cashout': {
        const pl = byId.get(p.playerId);
        if (pl) pl.cashOut = p.amount == null ? null : Math.max(0, Math.round(p.amount));
        break;
      }
      case 'set_kitty':
        s.kitty = p.kitty || null;
        break;
      case 'settle':
        s.status = 'settled';
        s.settledAt = ts || Date.now();
        break;
      default:
        break; // unknown event types are ignored (forward compatibility)
    }
  }
  return s;
}

/** Convert a folded live session into a plain settled history entry. */
export function toHistoryEntry(folded, extra = {}) {
  return {
    ...folded,
    status: 'settled',
    settledAt: folded.settledAt || Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
    _live: undefined,
    ...extra,
  };
}
