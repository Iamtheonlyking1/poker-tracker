-- Server-side "if-newer" upsert. PostgREST does a plain merge-duplicates upsert
-- with no condition, so without this a device that pushes a stale value (it
-- never saw a newer edit from another device) would briefly overwrite the good
-- one on the server. This trigger drops such writes; the losing device
-- reconciles on its next pull.
--
-- Fires before documents_set_updated_at (alphabetical: _reject_stale < _set_updated_at),
-- so a rejected write never advances the cursor either.

create or replace function public.reject_stale_document()
returns trigger
language plpgsql
as $$
begin
  if new.client_updated_at < old.client_updated_at then
    return null;  -- ignore: the row on disk is newer
  end if;
  return new;
end;
$$;

create trigger documents_reject_stale
  before update on public.documents
  for each row execute function public.reject_stale_document();
