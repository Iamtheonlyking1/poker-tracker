// Identifier generation. One place, so a fifth ad-hoc `Math.random()` id can't
// creep in. `crypto.randomUUID()` needs a secure context (HTTPS or localhost) —
// it is undefined when the dev server is reached over a LAN IP — so everything
// degrades gracefully.

function randomBytes(n) {
  const buf = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
    return buf;
  }
  for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf;
}

/** RFC 4122 v4 UUID. */
export function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch (e) {
      /* fall through */
    }
  }
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

// Crockford base32 — no I, L, O, U, so codes read aloud without ambiguity.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A short, human-shareable code (default 6 chars) for join links. */
export function shortCode(len = 6) {
  const b = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CROCKFORD[b[i] % 32];
  return out;
}

const DEVICE_ID_KEY = 'poker.deviceId';

/**
 * A stable per-device identifier. Device-local: never synced, never in a backup.
 * Used as the deterministic tie-breaker when two devices write the same record
 * at the exact same millisecond.
 */
export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch (e) {
    // private mode / no storage — a per-load id is still better than nothing
    return uuid();
  }
}
