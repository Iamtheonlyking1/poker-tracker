-- Keeps the free-tier project from being auto-paused after 7 idle days.
-- Supabase counts real database WRITES as activity (read-only pings are
-- reported not to count), so a scheduled GitHub Action (see
-- .github/workflows/keepalive.yml) calls this function, which inserts one
-- row. Security definer + a hard cap of 10 rows means the public anon key
-- can call it but can't be abused to fill the database. No table access is
-- granted to anon/authenticated directly.

create table if not exists public.keepalive (
  id        bigserial primary key,
  pinged_at timestamptz not null default now()
);
alter table public.keepalive enable row level security;
revoke all on public.keepalive from anon, authenticated;

create or replace function public.keepalive_ping()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.keepalive default values;
  delete from public.keepalive
    where id not in (select id from public.keepalive order by id desc limit 10);
end;
$$;

revoke all on function public.keepalive_ping() from public;
grant execute on function public.keepalive_ping() to anon;
