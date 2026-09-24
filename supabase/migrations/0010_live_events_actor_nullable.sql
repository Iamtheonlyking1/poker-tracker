-- Account deletion (auth.admin.deleteUser) needs every table referencing
-- auth.users to have an ON DELETE rule — live_events.actor_id was NOT NULL
-- with no rule at all (defaults to RESTRICT), so deleting a user who has
-- EVER posted a buy-in/rebuy in a shared table would hard-fail with a
-- foreign-key violation. Anonymize instead of blocking: the event (and the
-- money math the other players in that game are built on) stays, just with
-- no attributable actor once that user's account is gone.

alter table public.live_events alter column actor_id drop not null;
alter table public.live_events drop constraint live_events_actor_id_fkey;
alter table public.live_events add constraint live_events_actor_id_fkey
  foreign key (actor_id) references auth.users (id) on delete set null;
