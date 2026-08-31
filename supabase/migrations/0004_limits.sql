-- Phase 4 — free/pro limits. Clients enforce these for UX (which sessions to
-- sync, whether "Play together" is available); these triggers are the backstop
-- against a modified client. Nothing here charges money — plans are granted by
-- hand (update public.entitlements set plan='pro' where user_id = '…') until
-- Phase 5 wires Razorpay.

-- seed the free-plan limits on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.entitlements (user_id, plan, status, limits)
    values (new.id, 'free', 'active',
            '{"synced_sessions":10,"live_games":1,"live_seats":8,"hand_log":25}'::jsonb)
    on conflict do nothing;
  return new;
end;
$$;

-- backfill any rows created before this migration
update public.entitlements
  set limits = '{"synced_sessions":10,"live_games":1,"live_seats":8,"hand_log":25}'::jsonb
  where plan = 'free' and (limits = '{}'::jsonb or limits is null);

-- effective numeric limit for a user (pro = unlimited)
create or replace function public.plan_limit(p_user uuid, p_key text, p_default int)
returns int
language sql
stable
security definer set search_path = public
as $$
  select case
    when e.plan = 'pro' and e.status in ('active', 'past_due') then 2147483647
    else coalesce((e.limits ->> p_key)::int, p_default)
  end
  from public.entitlements e
  where e.user_id = p_user;
$$;

-- ---- documents: cap synced sessions on the free plan ----
create or replace function public.enforce_session_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare cnt int; lim int;
begin
  if new.kind <> 'session' or new.deleted then
    return new;
  end if;
  select count(*) into cnt
    from public.documents
    where user_id = new.user_id and kind = 'session' and not deleted
      and doc_id <> new.doc_id;          -- don't count the row being upserted
  lim := coalesce(public.plan_limit(new.user_id, 'synced_sessions', 10), 10);
  if cnt >= lim then
    raise exception 'FREE_LIMIT synced_sessions' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists documents_session_limit on public.documents;
create trigger documents_session_limit
  before insert on public.documents
  for each row execute function public.enforce_session_limit();

-- ---- live_games: one concurrent shared game on the free plan ----
create or replace function public.enforce_live_game_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare cnt int; lim int;
begin
  select count(*) into cnt
    from public.live_games
    where owner_id = new.owner_id and status = 'live';
  lim := coalesce(public.plan_limit(new.owner_id, 'live_games', 1), 1);
  if cnt >= lim then
    raise exception 'FREE_LIMIT live_games' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists live_games_limit on public.live_games;
create trigger live_games_limit
  before insert on public.live_games
  for each row execute function public.enforce_live_game_limit();

-- ---- live_members: seat cap (charged against the game owner's plan) ----
create or replace function public.enforce_seat_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare cnt int; lim int; owner uuid;
begin
  select owner_id into owner from public.live_games where id = new.game_id;
  select count(*) into cnt from public.live_members where game_id = new.game_id;
  lim := coalesce(public.plan_limit(owner, 'live_seats', 8), 8);
  if cnt >= lim then
    raise exception 'FREE_LIMIT live_seats' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists live_members_seat_limit on public.live_members;
create trigger live_members_seat_limit
  before insert on public.live_members
  for each row execute function public.enforce_seat_limit();
