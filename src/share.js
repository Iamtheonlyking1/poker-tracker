// URL snapshot encode/decode + WhatsApp / plain-text summary. No DOM deps beyond
// window.location / btoa / atob (all present in browsers).

import { net, settle, reconciliation, totalIn } from './settle.js';
import { fmtMoney, setCurrency } from './money.js';

// Compact serialization: short keys, drop buy-in timestamps.
function pack(session) {
  return {
    n: session.name,
    b: session.defaultBuyIn,
    t: session.startedAt,
    c: session.currency || 'INR',
    p: session.players.map((p) => ({
      n: p.name,
      i: p.buyIns.map((x) => x.amount),
      o: p.cashOut,
    })),
  };
}

function unpack(o) {
  return {
    id: 'shared',
    name: o.n,
    defaultBuyIn: o.b,
    startedAt: o.t,
    currency: o.c || 'INR',
    status: 'settled',
    players: (o.p || []).map((p) => ({
      id: Math.random().toString(36).slice(2, 9),
      name: p.n,
      buyIns: (p.i || []).map((amount) => ({ amount, ts: 0 })),
      cashOut: p.o ?? null,
    })),
  };
}

function b64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(s)));
}

export function encodeSession(session) {
  return b64urlEncode(JSON.stringify(pack(session)));
}

export function decodeSession(payload) {
  try {
    return unpack(JSON.parse(b64urlDecode(payload)));
  } catch (e) {
    return null;
  }
}

/** Full shareable URL for a session, pointing at the current page. */
export function shareUrl(session) {
  const base = location.href.split('#')[0];
  return `${base}#s=${encodeSession(session)}`;
}

/** Reads ?/#s= payload from the current URL, returns a session or null. */
export function sessionFromUrl() {
  const m = location.hash.match(/[#&]s=([^&]+)/);
  if (!m) return null;
  return decodeSession(m[1]);
}

/** Plain-text results summary, WhatsApp-friendly. */
export function summaryText(session, { withLink = true } = {}) {
  setCurrency(session.currency || 'INR');
  const lines = [];
  lines.push(`\u{1F0CF} ${session.name}`);
  const d = new Date(session.startedAt);
  lines.push(d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }));
  lines.push('');

  const rows = session.players
    .map((p) => ({ name: p.name, net: net(p) || 0, in: totalIn(p) }))
    .sort((a, b) => b.net - a.net);

  lines.push('*Results*');
  for (const r of rows) {
    const sign = r.net > 0 ? '+' : r.net < 0 ? '-' : '';
    lines.push(`${r.name}: ${sign}${fmtMoney(Math.abs(r.net))}`);
  }

  const rec = reconciliation(session.players);
  if (!rec.balanced) {
    const word = rec.delta > 0 ? 'extra' : 'missing';
    lines.push('');
    lines.push(`⚠️ Pot off by ${fmtMoney(Math.abs(rec.delta))} (${word})`);
  }

  const transfers = settle(session.players);
  lines.push('');
  lines.push('*Settle up*');
  if (transfers.length === 0) {
    lines.push('Everyone square. Nothing to pay.');
  } else {
    for (const t of transfers) {
      lines.push(`${t.from} pays ${t.to} ${fmtMoney(t.amount)}`);
    }
  }

  if (withLink) {
    lines.push('');
    lines.push(shareUrl(session));
  }
  return lines.join('\n');
}

export function whatsappUrl(session) {
  return `https://wa.me/?text=${encodeURIComponent(summaryText(session))}`;
}
