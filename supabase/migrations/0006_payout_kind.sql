-- Phase: custom tournament payout structures. Saved payout tables now sync
-- the same way saved blind structures do (kind='structure'), under a new
-- kind='payoutstructure'. The documents.kind check constraint from 0001 only
-- allowed a fixed list — widen it to include the new kind.

alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check
  check (kind in ('session', 'roster', 'logentry', 'structure', 'range', 'prefs', 'quiz', 'payoutstructure'));
