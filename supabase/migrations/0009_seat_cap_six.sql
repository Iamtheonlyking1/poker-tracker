-- Free-tier live-table seat cap: 8 -> 6. Same 3 places 0004_limits.sql set it
-- (new-signup seed, existing-user backfill, trigger fallback default) — the
-- fallback matters because plan_limit() falls through to it whenever a free
-- user's limits jsonb predates this change and doesn't have live_seats: 6.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.entitlements (user_id, plan, status, limits)
    values (new.id, 'free', 'active',
            '{"synced_sessions":10,"live_games":1,"live_seats":6,"hand_log":25}'::jsonb)
    on conflict do nothing;
  return new;
end;
$$;

-- only touch free users still on the old value — never overwrite a plan a
-- Pro/past_due user was given by hand, and never re-lower someone an owner
-- has already deliberately raised above 6.
update public.entitlements
  set limits = jsonb_set(limits, '{live_seats}', '6')
  where plan = 'free' and (limits ->> 'live_seats')::int = 8;

create or replace function public.enforce_seat_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare cnt int; lim int; owner uuid;
begin
  select owner_id into owner from public.live_games where id = new.game_id;
  select count(*) into cnt from public.live_members where game_id = new.game_id;
  lim := coalesce(public.plan_limit(owner, 'live_seats', 6), 6);
  if cnt >= lim then
    raise exception 'FREE_LIMIT live_seats' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
