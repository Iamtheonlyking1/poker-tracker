-- RLS isolation checks. Run with:  supabase test db
-- (pgTAP is enabled by Supabase's local stack.)

begin;
select plan(9);

-- two users
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-0000-0000-0000000000aa', 'a@test.dev', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000bb', 'b@test.dev', 'authenticated', 'authenticated');

-- the signup trigger should have seeded rows for both
select is(
  (select count(*)::int from public.entitlements where user_id in
     ('00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-0000000000bb')),
  2, 'signup trigger seeded an entitlement per user');

-- ---- act as user A ----
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}';

select lives_ok($$
  insert into public.documents (user_id, kind, doc_id, data, client_updated_at)
  values ('00000000-0000-0000-0000-0000000000aa','session','s1','{"n":"A game"}',1000)
$$, 'A inserts its own document');

select throws_ok($$
  insert into public.documents (user_id, kind, doc_id, data, client_updated_at)
  values ('00000000-0000-0000-0000-0000000000bb','session','x','{}',1)
$$, '42501', 'A cannot insert a row owned by B');

select throws_ok($$
  update public.entitlements set plan = 'pro'
  where user_id = '00000000-0000-0000-0000-0000000000aa'
$$, '42501', 'A cannot upgrade its own plan (service-role only)');

-- the server clock, not the client value, wins for updated_at
update public.documents set data = '{"n":"A game v2"}', client_updated_at = 2000
  where user_id = '00000000-0000-0000-0000-0000000000aa' and kind='session' and doc_id='s1';
select ok(
  (select updated_at from public.documents
    where user_id='00000000-0000-0000-0000-0000000000aa' and kind='session' and doc_id='s1')
  >= now() - interval '5 seconds',
  'updated_at is server-set on update');

-- ---- act as user B ----
set local request.jwt.claims to
  '{"sub":"00000000-0000-0000-0000-0000000000bb","role":"authenticated"}';

select is(
  (select count(*)::int from public.documents), 0,
  'B sees none of A''s documents');

select is(
  (select count(*)::int from public.entitlements), 1,
  'B sees only its own entitlement');

select throws_ok($$
  update public.documents set data = '{"hacked":true}'
  where user_id = '00000000-0000-0000-0000-0000000000aa'
$$, null, 'B cannot update A''s document (no rows / denied)');

select lives_ok($$
  insert into public.documents (user_id, kind, doc_id, data, client_updated_at)
  values ('00000000-0000-0000-0000-0000000000bb','roster','r1','{"name":"Sam"}',10)
$$, 'B inserts its own roster record');

select * from finish();
rollback;
