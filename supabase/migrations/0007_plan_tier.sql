-- Which plan length and price tier a subscription was sold at, and how many
-- payments it has made. Written only by the razorpay-webhook function (service
-- role); shown read-only in the app so a launch-price customer can see how long
-- their launch price lasts. Safe to re-run.
--   plan_term  : '1m' | '3m' | '6m' | '12m'
--   price_tier : 'launch' | 'list'   (what it was SOLD at)
--   paid_count : successful payments so far (launch price covers the first 2)

alter table public.entitlements
  add column if not exists plan_term  text check (plan_term  in ('1m', '3m', '6m', '12m')),
  add column if not exists price_tier text check (price_tier in ('launch', 'list')),
  add column if not exists paid_count int;
