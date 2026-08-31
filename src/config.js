// Runtime config. The anon key is public by design — RLS is the security
// boundary — so committing it is fine. Keep staging and prod on separate
// Supabase projects. Fill these in once the project exists (see supabase/README.md).

export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

/** Sync + accounts stay completely dark until this is true. */
export function syncConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}
