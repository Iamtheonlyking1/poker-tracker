-- entitlements.provider had a CHECK constraint from the original design that
-- only allowed 'razorpay' or 'mor' — a gap from the Razorpay->Dodo migration:
-- dodo-webhook writes provider:'dodo', which that constraint silently
-- rejected every single time (PATCH fails -> "entitlement update failed" ->
-- account never actually flips to Pro, even though the checkout itself
-- succeeded). Add 'dodo' to the allowed list; keep the old values too in
-- case any historical row still has them.

alter table public.entitlements drop constraint entitlements_provider_check;
alter table public.entitlements add constraint entitlements_provider_check
  check (provider in ('razorpay', 'mor', 'dodo'));
