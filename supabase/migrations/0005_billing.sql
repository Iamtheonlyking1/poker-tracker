-- Phase 5 — billing. `entitlements` already has provider/provider_customer_id/
-- provider_subscription_id/current_period_end (from 0001) — no change needed
-- there. This just adds a webhook audit + dedupe log: Razorpay retries
-- undelivered webhooks, so the handler must be able to tell "already
-- processed this exact event" from "new event" before touching entitlements.

create table public.billing_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null default 'razorpay',
  event_id     text not null,          -- our own dedupe key, not Razorpay's (see the webhook)
  event_type   text not null,
  user_id      uuid references auth.users (id) on delete set null,
  payload      jsonb not null,
  processed_at timestamptz not null default now(),
  unique (provider, event_id)
);

alter table public.billing_events enable row level security;

-- No client access at all, in either direction — only the webhook Edge
-- Function (using the service role, which bypasses RLS) ever touches this.
revoke all on public.billing_events from anon, authenticated;
