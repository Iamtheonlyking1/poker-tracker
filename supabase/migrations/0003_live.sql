-- Phase 3 — live table sync. A shared game is an append-only event log; every
-- device folds the same log into the same session state, so concurrent buy-ins
-- can never overwrite each other (unlike the last-write-wins document sync).

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
create table public.live_games (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users (id) on delete cascade,
  join_code       text not null unique,
  name            text not null default 'Poker night',
  currency        text not null default 'INR',
  default_buy_in  int  not null default 500,
  kind            text not null default 'cash' check (kind in ('cash', 'tournament')),
  status          text not null default 'live' check (status in ('live', 'settled')),
  created_at      timestamptz not null default now(),
  settled_at      timestamptz
);
create index live_games_code_idx on public.live_games (join_code);

create table public.live_members (
  game_id       uuid not null references public.live_games (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  display_name  text,
  role          text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (game_id, user_id)
);

create table public.live_events (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.live_games (id) on delete cascade,
  actor_id    uuid not null references auth.users (id),
  seq         bigserial,                -- global monotonic; order within a game by seq
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index live_events_game_seq_idx on public.live_events (game_id, seq);

-- ---------------------------------------------------------------------------
-- membership helper (SECURITY DEFINER so RLS policies don't recurse)
-- ---------------------------------------------------------------------------
create or replace function public.is_live_member(p_game uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.live_members
    where game_id = p_game and user_id = auth.uid()
  );
$$;

create or replace function public.live_member_role(p_game uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.live_members
  where game_id = p_game and user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.live_games   enable row level security;
alter table public.live_members enable row level security;
alter table public.live_events  enable row level security;

revoke all on public.live_games, public.live_members, public.live_events from anon;
grant select on public.live_games, public.live_members, public.live_events to authenticated;
grant insert on public.live_events to authenticated;
grant update (last_seen_at, display_name) on public.live_members to authenticated;

-- games: members can see it; the owner can update it
create policy live_games_select on public.live_games
  for select using (public.is_live_member(id));
create policy live_games_update on public.live_games
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- members: you can see the roster of a game you're in; you may update your own row
create policy live_members_select on public.live_members
  for select using (public.is_live_member(game_id));
create policy live_members_update on public.live_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- events: members read; owners/editors append their own
create policy live_events_select on public.live_events
  for select using (public.is_live_member(game_id));
create policy live_events_insert on public.live_events
  for insert with check (
    actor_id = auth.uid()
    and public.live_member_role(game_id) in ('owner', 'editor')
  );

-- ---------------------------------------------------------------------------
-- RPCs: create + join (both add a membership row, which RLS can't do directly)
-- ---------------------------------------------------------------------------
create or replace function public.create_live_game(
  p_name text, p_currency text, p_buyin int, p_code text, p_display text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare gid uuid;
begin
  insert into public.live_games (owner_id, join_code, name, currency, default_buy_in)
    values (auth.uid(), p_code, coalesce(p_name, 'Poker night'), coalesce(p_currency, 'INR'), coalesce(p_buyin, 500))
    returning id into gid;
  insert into public.live_members (game_id, user_id, display_name, role)
    values (gid, auth.uid(), p_display, 'owner');
  return gid;
end;
$$;

create or replace function public.join_live_game(p_code text, p_display text default null)
returns public.live_games
language plpgsql
security definer
set search_path = public
as $$
declare g public.live_games;
begin
  select * into g from public.live_games where join_code = upper(p_code) and status = 'live';
  if not found then
    raise exception 'no live game with that code';
  end if;
  insert into public.live_members (game_id, user_id, display_name, role)
    values (g.id, auth.uid(), p_display, 'editor')
    on conflict (game_id, user_id) do update set last_seen_at = now();
  return g;
end;
$$;

grant execute on function public.create_live_game(text, text, int, text, text) to authenticated;
grant execute on function public.join_live_game(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: joiners subscribe to new events + the game status flip
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.live_events;
alter publication supabase_realtime add table public.live_games;
