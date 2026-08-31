# Poker Night — backend (Supabase)

Nothing here runs in production yet. This is the schema + tests, ready for the
day a Supabase project exists.

> **Not yet validated against a live database.** Written against Supabase
> conventions but not applied — run `npx supabase db push` + `npx supabase test
> db` against the real project (or a local `supabase start`, needs Docker) as
> the first step of finishing Phase 2.

## When the project is created

1. `npx supabase login` and `npx supabase link --project-ref <ref>`
2. `npx supabase db push` — applies `migrations/0001_init.sql`
3. `npx supabase test db` — runs `tests/rls_test.sql` (pgTAP)
4. In the dashboard: enable **Email OTP** (confirmations off), add **Google** and
   **Apple** providers, and — for Phase 3 — **Anonymous sign-in** (rate-limited).
5. Copy the project URL and the **anon** key into `src/config.js` (the anon key
   is public by design; RLS is the security boundary — keep staging and prod
   projects separate).

## Local dev

`npx supabase start` (needs Docker) brings up Postgres + Auth + Studio on
`localhost:54321-54323`. `npx supabase db reset` re-applies migrations.

## Layout

| Path | What |
|------|------|
| `migrations/0001_init.sql` | `documents`, `profiles`, `entitlements`, RLS, the signup trigger |
| `tests/rls_test.sql` | pgTAP: user B cannot read or write user A's rows; clients can't self-upgrade |
| `config.toml` | local-stack config |
| `functions/` | Edge Functions — added in Phase 5 (billing webhook) and Phase 8 (AI coach) |
