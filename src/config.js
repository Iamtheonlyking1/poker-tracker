// Runtime config. The anon key is public by design — RLS is the security
// boundary — so committing it is fine. Keep staging and prod on separate
// Supabase projects. See supabase/README.md.

// ── Fill these in once the Supabase project exists ───────────────────────────
const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';
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
