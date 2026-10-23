-- KAZER: conector Vercel e assinatura KAZER Pro.
-- Migração aditiva. Tabelas acessadas apenas pelo backend (service role);
-- o cliente lê o plano através de get_my_usage().

begin;

-- ── Conector Vercel ───────────────────────────────────────────────────────
create table if not exists public.kazer_vercel_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  vercel_user_id text not null,
  username text not null,
  display_name text,
  team_id text,
  access_token_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists kazer_vercel_connections_updated_at on public.kazer_vercel_connections;
create trigger kazer_vercel_connections_updated_at
before update on public.kazer_vercel_connections
for each row execute function public.kazer_touch_updated_at();

alter table public.kazer_vercel_connections enable row level security;
alter table public.kazer_vercel_connections force row level security;
revoke all on public.kazer_vercel_connections from public, anon, authenticated;
comment on table public.kazer_vercel_connections is 'Conexão Vercel do usuário; o token é cifrado e acessado somente pelo backend.';

-- ── Assinatura Pro ────────────────────────────────────────────────────────
create table if not exists public.kazer_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'pro' check (plan in ('pro')),
  status text not null default 'active' check (status in ('active', 'expired', 'canceled')),
  current_period_end timestamptz not null,
  last_checkout_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kazer_billing_checkouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'abacatepay',
  provider_billing_id text unique,
  plan text not null default 'pro',
  cycle text not null check (cycle in ('monthly', 'yearly')),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'failed')),
  checkout_url text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kazer_billing_checkouts_user_idx
  on public.kazer_billing_checkouts (user_id, created_at desc);

drop trigger if exists kazer_subscriptions_updated_at on public.kazer_subscriptions;
create trigger kazer_subscriptions_updated_at
before update on public.kazer_subscriptions
for each row execute function public.kazer_touch_updated_at();

drop trigger if exists kazer_billing_checkouts_updated_at on public.kazer_billing_checkouts;
create trigger kazer_billing_checkouts_updated_at
before update on public.kazer_billing_checkouts
for each row execute function public.kazer_touch_updated_at();

alter table public.kazer_subscriptions enable row level security;
alter table public.kazer_subscriptions force row level security;
alter table public.kazer_billing_checkouts enable row level security;
alter table public.kazer_billing_checkouts force row level security;
revoke all on public.kazer_subscriptions from public, anon, authenticated;
revoke all on public.kazer_billing_checkouts from public, anon, authenticated;

-- Ativação idempotente chamada pelo webhook (service role).
create or replace function public.kazer_activate_pro(p_checkout_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  checkout public.kazer_billing_checkouts;
  extension interval;
begin
  select * into checkout from public.kazer_billing_checkouts where id = p_checkout_id for update;
  if not found or checkout.status = 'paid' then
    return;
  end if;
  extension := case when checkout.cycle = 'yearly' then interval '1 year' else interval '1 month' end;
  update public.kazer_billing_checkouts set status = 'paid', paid_at = now() where id = checkout.id;
  insert into public.kazer_subscriptions (user_id, plan, status, current_period_end, last_checkout_id)
  values (checkout.user_id, 'pro', 'active', now() + extension, checkout.id)
  on conflict (user_id) do update
    set status = 'active',
        current_period_end = greatest(public.kazer_subscriptions.current_period_end, now()) + extension,
        last_checkout_id = excluded.last_checkout_id;
end;
$$;

create or replace function public.kazer_user_plan(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when exists (
    select 1 from public.kazer_subscriptions
    where user_id = p_user_id and status = 'active' and current_period_end > now()
  ) then 'pro' else 'free' end;
$$;

create or replace function public.kazer_plan_event_limit(p_plan text)
returns integer
language sql
immutable
as $$
  select case when p_plan = 'pro' then 10000 else 1000 end;
$$;

revoke all on function public.kazer_activate_pro(uuid) from public, anon, authenticated;
revoke all on function public.kazer_user_plan(uuid) from public, anon, authenticated;
revoke all on function public.kazer_plan_event_limit(text) from public, anon, authenticated;

-- ── Uso mensal sensível ao plano ─────────────────────────────────────────
create or replace function public.get_my_usage()
returns table (
  plan text,
  usage_percent integer,
  usage_percentage integer,
  percent_used integer,
  monthly_message_count bigint,
  monthly_attachment_count bigint,
  monthly_event_count bigint,
  usage_limit integer,
  usage_used bigint,
  usage_limit_reached boolean,
  next_reset_at timestamptz,
  monthly_reset_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  usage_row public.kazer_monthly_usage;
  current_plan text;
  event_limit integer;
  total_events bigint;
  used_percent integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  current_plan := public.kazer_user_plan(auth.uid());
  event_limit := public.kazer_plan_event_limit(current_plan);
  usage_row := public.kazer_prepare_monthly_usage(auth.uid());
  total_events := usage_row.message_count + usage_row.attachment_count;
  used_percent := least(100, floor(total_events::numeric * 100 / event_limit)::integer);
  return query select current_plan, used_percent, used_percent, used_percent,
    usage_row.message_count, usage_row.attachment_count, total_events, event_limit,
    total_events, total_events >= event_limit,
    public.kazer_next_period_start(), public.kazer_next_period_start();
end;
$$;

create or replace function public.consume_kazer_usage(
  p_message_count integer default 1,
  p_attachment_count integer default 0
)
returns table (
  plan text,
  usage_percent integer,
  usage_percentage integer,
  percent_used integer,
  monthly_message_count bigint,
  monthly_attachment_count bigint,
  monthly_event_count bigint,
  usage_limit integer,
  usage_used bigint,
  usage_limit_reached boolean,
  next_reset_at timestamptz,
  monthly_reset_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  usage_row public.kazer_monthly_usage;
  requested_messages integer := greatest(0, coalesce(p_message_count, 0));
  requested_attachments integer := greatest(0, coalesce(p_attachment_count, 0));
  current_plan text;
  event_limit integer;
  total_events bigint;
  used_percent integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if requested_messages = 0 and requested_attachments = 0 then
    raise exception 'invalid_usage_amount' using errcode = '22023';
  end if;
  if requested_messages > 1 or requested_attachments > 10 then
    raise exception 'usage_amount_too_large' using errcode = '22023';
  end if;
  current_plan := public.kazer_user_plan(auth.uid());
  event_limit := public.kazer_plan_event_limit(current_plan);
  usage_row := public.kazer_prepare_monthly_usage(auth.uid());
  if usage_row.message_count + usage_row.attachment_count >= event_limit then
    raise exception 'usage_limit_reached' using errcode = 'P0001';
  end if;
  update public.kazer_monthly_usage
  set message_count = message_count + requested_messages,
      attachment_count = attachment_count + requested_attachments,
      updated_at = now()
  where user_id = auth.uid()
  returning * into usage_row;
  total_events := least(event_limit, usage_row.message_count + usage_row.attachment_count);
  used_percent := least(100, floor(total_events::numeric * 100 / event_limit)::integer);
  return query select current_plan, used_percent, used_percent, used_percent,
    usage_row.message_count, usage_row.attachment_count, total_events, event_limit,
    total_events, total_events >= event_limit,
    public.kazer_next_period_start(), public.kazer_next_period_start();
end;
$$;

revoke all on function public.get_my_usage() from public, anon;
revoke all on function public.consume_kazer_usage(integer, integer) from public, anon;
grant execute on function public.get_my_usage() to authenticated;
grant execute on function public.consume_kazer_usage(integer, integer) to authenticated;

comment on table public.kazer_subscriptions is 'Assinatura KAZER Pro ativada somente pelo webhook de pagamento confirmado.';
comment on table public.kazer_billing_checkouts is 'Cobranças PIX criadas pelo backend; status muda para paid apenas via webhook validado.';

commit;
