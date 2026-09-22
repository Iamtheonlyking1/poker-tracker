-- Owner analytics: product events + client errors, and an owner-only summary.
-- Nothing here is client-writable — everything goes through the `ingest` Edge
-- Function (service role), same pattern as billing_events/entitlements.

create table public.analytics_events (
  id           uuid primary key default gen_random_uuid(),
  at           timestamptz not null default now(),
  user_id      uuid references auth.users (id) on delete set null,
  device_id    text not null,
  session_id   text not null,
  name         text not null,
  props        jsonb not null default '{}'::jsonb,
  app_version  text
);
create index analytics_events_name_at_idx on public.analytics_events (name, at);
create index analytics_events_user_at_idx on public.analytics_events (user_id, at);

alter table public.analytics_events enable row level security;
revoke all on public.analytics_events from anon, authenticated;

create table public.client_errors (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  user_id     uuid references auth.users (id) on delete set null,
  device_id   text not null,
  message     text not null,
  stack       text,
  ctx         jsonb not null default '{}'::jsonb,
  ua          text,
  app_version text
);
create index client_errors_message_at_idx on public.client_errors (message, at);

alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;

-- Who gets to see the numbers. Lives on entitlements (already locked to
-- service-role writes + own-row select) rather than a new grantable surface.
alter table public.entitlements add column if not exists is_owner boolean not null default false;

-- Set yourself as owner once:
--   update public.entitlements set is_owner = true where user_id =
--     (select id from auth.users where email = 'you@example.com');

-- security definer so it can read across all users' rows; the is_owner check
-- inside is what makes that safe to grant to every authenticated caller.
create or replace function public.admin_overview(days int default 30)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  is_owner_ boolean;
  since timestamptz := now() - (days || ' days')::interval;
  out jsonb;
begin
  select e.is_owner into is_owner_ from public.entitlements e where e.user_id = auth.uid();
  if not coalesce(is_owner_, false) then
    return null;
  end if;

  select jsonb_build_object(
    'since', since,
    'signups', (select count(*) from auth.users where created_at >= since and email is not null),
    'anon_signups', (select count(*) from auth.users where created_at >= since and email is null),
    'active_users', (select count(distinct user_id) from public.documents where updated_at >= since),
    'pro_active', (select count(*) from public.entitlements where plan = 'pro' and status in ('active', 'past_due')),
    'pro_by_term', (
      select coalesce(jsonb_object_agg(plan_term, n), '{}'::jsonb)
      from (
        select plan_term, count(*) n from public.entitlements
        where plan = 'pro' and status in ('active', 'past_due') and plan_term is not null
        group by plan_term
      ) t
    ),
    'launch_price_active', (
      select count(*) from public.entitlements
      where plan = 'pro' and status in ('active', 'past_due') and price_tier = 'launch'
    ),
    'canceled_recent', (select count(*) from public.entitlements where status = 'canceled' and updated_at >= since),
    'payment_events', (
      select coalesce(jsonb_object_agg(event_type, n), '{}'::jsonb)
      from (
        select event_type, count(*) n from public.billing_events
        where processed_at >= since group by event_type
      ) t
    ),
    'games_created', (select count(*) from public.documents where kind = 'session' and updated_at >= since and not deleted),
    'live_games_created', (select count(*) from public.live_games where created_at >= since),
    'top_events', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'n', n) order by n desc), '[]'::jsonb)
      from (
        select name, count(*) n from public.analytics_events
        where at >= since group by name order by count(*) desc limit 20
      ) t
    ),
    'top_errors', (
      select coalesce(jsonb_agg(jsonb_build_object('message', message, 'n', n, 'last_at', last_at) order by n desc), '[]'::jsonb)
      from (
        select message, count(*) n, max(at) last_at from public.client_errors
        where at >= since group by message order by count(*) desc limit 20
      ) t
    ),
    'recent_events', (
      select coalesce(jsonb_agg(jsonb_build_object('at', at, 'name', name, 'props', props) order by at desc), '[]'::jsonb)
      from (select at, name, props from public.analytics_events order by at desc limit 50) t
    )
  ) into out;

  return out;
end;
$$;

revoke all on function public.admin_overview(int) from public;
grant execute on function public.admin_overview(int) to authenticated;
