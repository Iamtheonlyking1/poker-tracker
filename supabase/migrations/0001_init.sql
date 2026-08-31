-- Poker Night — initial schema: accounts, per-record sync, entitlements.
--
-- Design notes
--  * `documents` is a generic per-record store (one row per game / roster entry
--    / etc.), NOT one row per localStorage key. A single JSON-array row would
--    let last-write-wins silently destroy one of two games edited offline on
--    different devices — and that is money data.
--  * Two timestamps, never conflated:
--      client_updated_at  bigint ms  — the LWW merge key, from the writing device
--      updated_at         timestamptz — server clock, the pull cursor; the client
--                                       can never set it (trigger below)
--    Pull query is `updated_at >= cursor` (>= not >, dedupe by kind+doc_id) so a
--    row written in the same microsecond as the cursor is not skipped forever.
--  * Deletes are soft (`deleted` + a tombstone in `data`), matching the client.

-- ---------------------------------------------------------------------------
-- helper: force server-controlled updated_at on every write
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------
create table public.documents (
  user_id           uuid        not null references auth.users (id) on delete cascade,
  kind              text        not null
                      check (kind in ('session','roster','logentry','structure','range','prefs','quiz')),
  doc_id            text        not null,
  data              jsonb       not null default '{}'::jsonb,
  client_updated_at bigint      not null,
  updated_at        timestamptz not null default now(),
  deleted           boolean     not null default false,
  schema_version    int         not null default 1,
  primary key (user_id, kind, doc_id)
);

create index documents_user_updated_idx on public.documents (user_id, updated_at);

create trigger documents_set_updated_at
  before insert or update on public.documents
  for each row execute function public.set_updated_at();

alter table public.documents enable row level security;

revoke all on public.documents from anon;
grant select, insert, update, delete on public.documents to authenticated;

create policy documents_select on public.documents
  for select using (auth.uid() = user_id);
create policy documents_insert on public.documents
  for insert with check (auth.uid() = user_id);
create policy documents_update on public.documents
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy documents_delete on public.documents
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  avatar_url    text,
  home_currency text default 'INR',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

revoke all on public.profiles from anon;
grant select, insert, update on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select using (auth.uid() = user_id);
create policy profiles_insert on public.profiles
  for insert with check (auth.uid() = user_id);
create policy profiles_update on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- entitlements  (what a user is entitled to — Free / Pro)
-- ---------------------------------------------------------------------------
create table public.entitlements (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  plan                     text not null default 'free' check (plan in ('free','pro')),
  status                   text not null default 'active'
                             check (status in ('active','past_due','canceled','expired')),
  limits                   jsonb not null default '{}'::jsonb,
  ai_credits               int  not null default 0,
  ai_credits_reset_at      timestamptz,
  current_period_end       timestamptz,
  provider                 text check (provider in ('razorpay','mor')),
  provider_customer_id     text,
  provider_subscription_id text,
  updated_at               timestamptz not null default now()
);

create trigger entitlements_set_updated_at
  before update on public.entitlements
  for each row execute function public.set_updated_at();

alter table public.entitlements enable row level security;

-- A client may READ its own entitlement and nothing else. All writes are done
-- by the service role from Edge Functions (billing webhooks, AI metering).
-- Revoking the table privileges means a policy slip can't open a write path.
revoke all on public.entitlements from anon, authenticated;
grant select on public.entitlements to authenticated;

create policy entitlements_select on public.entitlements
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- on signup: seed a profile + a free entitlement
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.entitlements (user_id, plan, status)
    values (new.id, 'free', 'active') on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
