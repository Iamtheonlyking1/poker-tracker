// Deploy: paste as function "get-quote". Turn "Enforce JWT Verification"
// OFF — this needs to work for a visitor who hasn't signed in yet (pricing
// should be visible before anyone creates an account), and nothing it returns
// is sensitive: just whether the launch-price window is currently open.
//
// Secrets: LAUNCH_ENDS_AT (same one create-subscription reads).
// (Pure logic mirrored in supabase/functions/_shared/plans.js's
// launchActive(), which is unit-tested — tests/plans.test.js.)

const LAUNCH_ENDS_AT = Deno.env.get('LAUNCH_ENDS_AT');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function launchActive(now = Date.now()) {
  if (!LAUNCH_ENDS_AT) return false;
  const t = Date.parse(LAUNCH_ENDS_AT);
  return Number.isFinite(t) && now < t;
}

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const active = launchActive();
  return json({ launchActive: active, launchEndsAt: active ? LAUNCH_ENDS_AT : null });
});
