// Deploy: paste as function "ingest". Turn "Enforce JWT Verification" OFF —
// signed-out visitors send events too (before they ever sign in), so this
// can't require a Supabase session the way create-subscription does. A
// present, valid Authorization header is still read and trusted (the gateway
// would already have rejected a garbled one) to attribute events to a user;
// its absence just means an anonymous row.
//
// Secrets: none beyond the auto-provided SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
//
// The allowlist/sanitising logic here is mirrored in
// supabase/functions/_shared/analytics-rules.js, which is what's unit-tested
// (tests/analytics-rules.test.js) — keep the two in sync if you change either.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function decodeJwtSub(token) {
  try {
    const seg = token.split('.')[1];
    const pad = (4 - (seg.length % 4)) % 4;
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
    return JSON.parse(atob(b64)).sub || null;
  } catch (_e) {
    return null;
  }
}

// ---- mirrors _shared/analytics-rules.js ----
const EVENT_NAMES = new Set([
  'screen_view', 'tool_open', 'game_start', 'game_settle', 'share',
  'signin_method', 'signup', 'upgrade_view', 'upgrade_pick_term',
  'upgrade_checkout_open', 'upgrade_checkout_result', 'sync_error', 'live_join',
]);
const PROP_KEYS = new Set([
  'view', 'tool', 'tab', 'mode', 'players', 'pool', 'method', 'outcome',
  'reason', 'term', 'status', 'via',
]);
const MAX_STRING = 200;
const MAX_BATCH = 50;

function cleanValue(v) {
  if (typeof v === 'boolean' || typeof v === 'number') return Number.isFinite(v) || typeof v === 'boolean' ? v : null;
  if (typeof v === 'string') return v.slice(0, MAX_STRING);
  return null;
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
function sanitizeEvent(raw, userId, at) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '');
  if (!EVENT_NAMES.has(name)) return null;
  const deviceId = String(raw.deviceId || '').slice(0, 100);
  const sessionId = String(raw.sessionId || '').slice(0, 100);
  if (!deviceId || !sessionId) return null;
  return {
    user_id: userId, device_id: deviceId, session_id: sessionId, name,
    props: cleanProps(raw.props),
    app_version: raw.appVersion ? String(raw.appVersion).slice(0, 40) : null,
    at,
  };
}
function sanitizeError(raw, userId, at) {
  if (!raw || typeof raw !== 'object') return null;
  const message = String(raw.message || '').slice(0, MAX_STRING);
  if (!message) return null;
  const deviceId = String(raw.deviceId || '').slice(0, 100);
  if (!deviceId) return null;
  return {
    user_id: userId, device_id: deviceId, message,
    stack: raw.stack ? String(raw.stack).slice(0, 2000) : null,
    ctx: cleanProps(raw.ctx),
    ua: raw.ua ? String(raw.ua).slice(0, 200) : null,
    app_version: raw.appVersion ? String(raw.appVersion).slice(0, 40) : null,
    at,
  };
}
function sanitizeBatch(items, userId, at) {
  const events = [];
  const errors = [];
  if (!Array.isArray(items)) return { events, errors };
  for (const raw of items) {
    if (raw && raw.kind === 'error') {
      if (errors.length >= MAX_BATCH) continue;
      const e = sanitizeError(raw, userId, at);
      if (e) errors.push(e);
    } else {
      if (events.length >= MAX_BATCH) continue;
      const e = sanitizeEvent(raw, userId, at);
      if (e) events.push(e);
    }
  }
  return { events, errors };
}
// ---- end mirror ----

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body: { items?: unknown } = {};
  try { body = await req.json(); } catch (_e) { return json({ ok: true }); } // malformed body: no-op, not an error the client should retry

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const userId = token ? decodeJwtSub(token) : null;
  const at = new Date().toISOString();
  const { events, errors } = sanitizeBatch(body.items, userId, at);
  if (!events.length && !errors.length) return json({ ok: true, stored: 0 });

  // one device sending an unreasonable volume — drop the batch rather than
  // let it fill the table; the client-side queue already coalesces normally
  const deviceId = events[0]?.device_id || errors[0]?.device_id;
  if (deviceId) {
    const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
    const svc = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/analytics_events?device_id=eq.${encodeURIComponent(deviceId)}&at=gte.${oneMinAgo}&select=id`,
      { headers: { ...svc, Prefer: 'count=exact', Range: '0-0' } },
    );
    const range = countRes.headers.get('content-range') || '';
    const recent = parseInt(range.split('/')[1] || '0', 10);
    if (recent > 300) return json({ ok: true, stored: 0, throttled: true });
  }

  const svc = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  const writes = [];
  if (events.length) writes.push(fetch(`${SUPABASE_URL}/rest/v1/analytics_events`, { method: 'POST', headers: svc, body: JSON.stringify(events) }));
  if (errors.length) writes.push(fetch(`${SUPABASE_URL}/rest/v1/client_errors`, { method: 'POST', headers: svc, body: JSON.stringify(errors) }));
  const results = await Promise.all(writes);
  if (results.some((r) => !r.ok)) return json({ error: 'partial write failure' }, 500);

  return json({ ok: true, stored: events.length + errors.length });
});
