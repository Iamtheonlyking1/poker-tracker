-- Which plan length and price tier a subscription was sold at. Written only by
-- the razorpay-webhook function (service role); shown read-only in the app so a
-- launch-price customer can see their price is locked in.
--   plan_term  : '1m' | '3m' | '6m' | '12m'
--   price_tier : 'launch' | 'list'

alter table public.entitlements
  add column if not exists plan_term  text check (plan_term  in ('1m', '3m', '6m', '12m')),
  add column if not exists price_tier text check (price_tier in ('launch', 'list'));
