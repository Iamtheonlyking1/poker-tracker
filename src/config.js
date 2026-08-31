// Runtime config. The anon key is public by design — RLS is the security
// boundary — so committing it is fine. Keep staging and prod on separate
// Supabase projects. See supabase/README.md.

// ── Supabase project (poker-night-prod). The anon key is public by design —
//    Row-Level Security is the boundary. ────────────────────────────────────────
const SUPABASE_URL = 'https://dmwsruvedmtepkdseiov.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtd3NydXZlZG10ZXBrZHNlaW92Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxNDQzMDgsImV4cCI6MjEwMzcyMDMwOH0.X3lsW5EXjpOnRkGwTuSPK5EBrW8czNrRDkqcD8qHhno';
// ────────────────────────────────────────────────────────────────────────────

// Optional override without editing this file: set window.POKER_CONFIG in a
// small inline <script> in index.html (e.g. per-environment on Cloudflare).
const env = (typeof window !== 'undefined' && window.POKER_CONFIG) || {};
let url = env.supabaseUrl || SUPABASE_URL;
let anon = env.supabaseAnonKey || SUPABASE_ANON_KEY;

/** Test hook / runtime override. */
export function setConfig(u, k) {
  url = u || '';
  anon = k || '';
}

export const getSupabaseUrl = () => url;
export const getSupabaseAnonKey = () => anon;

/** Accounts + sync stay completely dark until this is true. */
export function syncConfigured() {
  return !!(url && anon);
}
