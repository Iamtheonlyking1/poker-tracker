// Pure validation/sanitising rules for the `ingest` Edge Function — what event
// names and prop keys are allowed, and how a raw client-sent item is cleaned
// into something safe to store. No I/O, so this is what tests/analytics-rules
// .test.js exercises directly.
//
// supabase/functions/ingest/index.ts keeps its OWN inline copy (Dashboard-
// pasted Edge Functions can't share files across functions without the CLI).
// Keep the two in sync if you change either.

export const EVENT_NAMES = new Set([
  'screen_view',
  'tool_open',
  'game_start',
  'game_settle',
  'share',
  'signin_method',
  'signup',
  'upgrade_view',
  'upgrade_pick_term',
  'upgrade_checkout_open',
  'upgrade_checkout_result',
  'sync_error',
  'live_join',
]);

// One flat allowlist across all event names, not a schema per event — small
// fixed vocabulary, easy to reason about, easy to extend.
export const PROP_KEYS = new Set([
  'view', 'tool', 'tab', 'mode', 'players', 'pool', 'method', 'outcome',
  'reason', 'term', 'status', 'via',
]);

const MAX_STRING = 200;
const MAX_BATCH = 50;

function cleanValue(v) {
  if (typeof v === 'boolean' || typeof v === 'number') return Number.isFinite(v) || typeof v === 'boolean' ? v : null;
  if (typeof v === 'string') return v.slice(0, MAX_STRING);
  return null; // no nested objects/arrays — keeps props flat and PII-shaped-out
}

function cleanProps(props) {
  const out = {};
  if (!props || typeof props !== 'object') return out;
  for (const [k, v] of Object.entries(props)) {
    if (!PROP_KEYS.has(k)) continue;
    const c = cleanValue(v);
    if (c !== null) out[k] = c;
  }
  return out;
}

/** `raw` is one item of the client's batch. Returns a clean row or null to drop it. */
export function sanitizeEvent(raw, { userId, at = new Date() } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '');
  if (!EVENT_NAMES.has(name)) return null;
  const deviceId = String(raw.deviceId || '').slice(0, 100);
  const sessionId = String(raw.sessionId || '').slice(0, 100);
  if (!deviceId || !sessionId) return null;
  return {
    user_id: userId || null,
    device_id: deviceId,
    session_id: sessionId,
    name,
    props: cleanProps(raw.props),
    app_version: raw.appVersion ? String(raw.appVersion).slice(0, 40) : null,
    at: at.toISOString(),
  };
}

/** Same idea for the error side of a batch. */
export function sanitizeError(raw, { userId, at = new Date() } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const message = String(raw.message || '').slice(0, MAX_STRING);
  if (!message) return null;
  const deviceId = String(raw.deviceId || '').slice(0, 100);
  if (!deviceId) return null;
  return {
    user_id: userId || null,
    device_id: deviceId,
    message,
    stack: raw.stack ? String(raw.stack).slice(0, 2000) : null,
    ctx: cleanProps(raw.ctx),
    ua: raw.ua ? String(raw.ua).slice(0, 200) : null,
    app_version: raw.appVersion ? String(raw.appVersion).slice(0, 40) : null,
    at: at.toISOString(),
  };
}

/**
 * Split + sanitise a whole batch. `items` = [{kind:'event'|'error', ...}].
 * Returns { events: [...], errors: [...] } — invalid/unknown items are
 * silently dropped, capped at MAX_BATCH each so one call can't flood the table.
 */
export function sanitizeBatch(items, opts = {}) {
  const events = [];
  const errors = [];
  if (!Array.isArray(items)) return { events, errors };
  for (const raw of items) {
    if (events.length >= MAX_BATCH && errors.length >= MAX_BATCH) break;
    if (raw && raw.kind === 'error') {
      if (errors.length >= MAX_BATCH) continue;
      const e = sanitizeError(raw, opts);
      if (e) errors.push(e);
    } else {
      if (events.length >= MAX_BATCH) continue;
      const e = sanitizeEvent(raw, opts);
      if (e) events.push(e);
    }
  }
  return { events, errors };
}

export { MAX_BATCH };
