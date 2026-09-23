// Live currency conversion for "My Sessions" entries logged in a currency
// other than your main one. Free, no-key API (open.er-api.com, daily-updated
// mid-market rates) — this is a home-game log, not a trading app, so a rate
// that's up to a day old is plenty accurate. In-memory only cache (resets on
// reload): a session usually logs a handful of entries at once, no need to
// persist a whole rate table to localStorage for that.

const cache = new Map(); // base currency -> { at, rates }
const TTL_MS = 60 * 60 * 1000; // 1h — avoid refetching on every entry in one sitting

async function ratesFor(base) {
  const hit = cache.get(base);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rates;
  const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`);
  if (!res.ok) throw new Error('Rate service unavailable');
  const data = await res.json();
  if (data.result !== 'success' || !data.rates) throw new Error('Rate service returned no data');
  cache.set(base, { at: Date.now(), rates: data.rates });
  return data.rates;
}

/**
 * Convert `amount` from one ISO currency code to another at today's rate.
 * Same code both sides is a free no-network no-op. Resolves { amount, rate }.
 * Throws (offline, unknown code, service down) — caller decides the fallback.
 */
export async function convert(amount, from, to) {
  if (from === to) return { amount, rate: 1 };
  const rates = await ratesFor(from);
  const rate = rates[to];
  if (!(rate > 0)) throw new Error(`No rate available for ${from} → ${to}`);
  return { amount: amount * rate, rate };
}
