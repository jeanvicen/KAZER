-- Kazer: política de tokens do plano Free.
--
-- Regras:
--   1. Conta nova começa com 1.500 tokens de boas-vindas.
--   2. Tokens não expiram nem são zerados por passagem de tempo; só diminuem
--      quando uma operação autenticada é consumida.
--   3. A cada 00:00 UTC, o usuário recebe 300 tokens adicionais.
--   4. A recarga é lazy e atômica: a primeira consulta/ação depois da meia-noite
--      aplica todas as recargas que ficaram pendentes, sem duplicá-las.
--   5. Quando o saldo está zerado, a conta fica aguardando a próxima recarga
--      diária; o servidor continua sendo a fonte de verdade.
--
-- Migração aditiva. Execute depois de 013_memories_retention_cleanup.sql.

alter table public.plan_catalog
  add column if not exists daily_credits integer not null default 300 check (daily_credits >= 0);

update public.plan_catalog
set credits_initial = 1500,
    daily_credits = 300,
    credit_cost = 10,
    credit_window_hours = 24,
    updated_at = now()
where plan = 'free';

create or replace function public.kazer_next_daily_reset(p_now timestamptz default now())
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select ((date_trunc('day', p_now at time zone 'UTC') + interval '1 day') at time zone 'UTC');
$$;

alter table public.user_usage
  add column if not exists welcome_credit_amount integer not null default 1500 check (welcome_credit_amount >= 0),
  add column if not exists daily_credit_amount integer not null default 300 check (daily_credit_amount >= 0),
  add column if not exists welcome_granted_at timestamptz,
  add column if not exists daily_grants_count bigint not null default 0 check (daily_grants_count >= 0);

update public.user_usage u
set welcome_credit_amount = p.credits_initial,
    daily_credit_amount = p.daily_credits,
    welcome_granted_at = coalesce(u.welcome_granted_at, u.created_at, now()),
    credit_window_hours = 24,
    next_credit_reset_at = public.kazer_next_daily_reset(now()),
    attachment_reset_at = public.kazer_next_daily_reset(now()),
    updated_at = now()
from public.plan_catalog p
where p.plan = u.plan;

create or replace function public.kazer_provision_usage(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.plan_catalog%rowtype;
  v_reset timestamptz := public.kazer_next_daily_reset(now());
begin
  if p_user_id is null then return; end if;
  select * into v_plan from public.plan_catalog where plan = 'free';
  insert into public.user_usage (
    user_id, plan, credits_balance, credits_initial, credits_used,
    credit_cost, credit_window_hours,
    welcome_credit_amount, daily_credit_amount, welcome_granted_at, daily_grants_count,
    last_credit_reset_at, next_credit_reset_at,
    attachment_count, attachment_limit, last_attachment_reset_at, attachment_reset_at
  ) values (
    p_user_id, v_plan.plan, v_plan.credits_initial, v_plan.credits_initial, 0,
    v_plan.credit_cost, 24,
    v_plan.credits_initial, v_plan.daily_credits, now(), 0,
    now(), v_reset,
    0, v_plan.attachment_limit, now(), v_reset
  ) on conflict (user_id) do nothing;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(btrim(coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      ''
    )), '')
  ) on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id) on conflict (user_id) do nothing;

  perform public.kazer_provision_usage(new.id);
  return new;
end;
$$;

create or replace function public.kazer_apply_usage_reset_locked(p_user_id uuid)
returns public.user_usage
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usage public.user_usage;
  v_plan public.plan_catalog%rowtype;
  v_now timestamptz := now();
  v_next timestamptz;
  v_grants integer := 0;
begin
  perform public.kazer_provision_usage(p_user_id);
  select * into v_usage from public.user_usage where user_id = p_user_id for update;
  if not found then return null; end if;

  select * into v_plan from public.plan_catalog where plan = v_usage.plan;
  if v_usage.next_credit_reset_at <= v_now or v_usage.attachment_reset_at <= v_now then
    v_next := public.kazer_next_daily_reset(v_now);

    -- Conta quantas viradas de dia ficaram pendentes. Isso permite que uma
    -- conta inativa receba os 300 tokens de cada dia sem duplicar recargas.
    if v_usage.next_credit_reset_at <= v_now then
      v_grants := greatest(
        1,
        floor(extract(epoch from (v_now - v_usage.next_credit_reset_at)) / 86400)::integer + 1
      );
    end if;

    update public.user_usage
    set credits_balance = credits_balance + (case when v_grants > 0 then v_plan.daily_credits * v_grants else 0 end),
        credits_initial = v_plan.credits_initial,
        credit_cost = v_plan.credit_cost,
        credit_window_hours = 24,
        welcome_credit_amount = v_plan.credits_initial,
        daily_credit_amount = v_plan.daily_credits,
        daily_grants_count = daily_grants_count + v_grants,
        last_credit_reset_at = case when v_grants > 0 then v_now else last_credit_reset_at end,
        next_credit_reset_at = case when v_grants > 0 then v_next else next_credit_reset_at end,
        attachment_count = case when v_usage.attachment_reset_at <= v_now then 0 else attachment_count end,
        attachment_limit = v_plan.attachment_limit,
        last_attachment_reset_at = case when v_usage.attachment_reset_at <= v_now then v_now else last_attachment_reset_at end,
        attachment_reset_at = case when v_usage.attachment_reset_at <= v_now then v_next else attachment_reset_at end,
        updated_at = v_now
    where user_id = p_user_id
    returning * into v_usage;
  else
    -- Mantém a configuração do plano sincronizada mesmo quando ainda não é
    -- hora de conceder a próxima recarga.
    update public.user_usage
    set credits_initial = v_plan.credits_initial,
        credit_cost = v_plan.credit_cost,
        credit_window_hours = 24,
        welcome_credit_amount = v_plan.credits_initial,
        daily_credit_amount = v_plan.daily_credits,
        attachment_limit = v_plan.attachment_limit,
        updated_at = v_now
    where user_id = p_user_id
    returning * into v_usage;
  end if;
  return v_usage;
end;
$$;

-- Inicializa contas criadas antes desta migração sem alterar o saldo atual.
-- O saldo existente continua válido e, a partir da próxima meia-noite, as
-- recargas de 300 passam a ser somadas em vez de substituir o saldo.
insert into public.user_usage (
  user_id, plan, credits_balance, credits_initial, credits_used,
  credit_cost, credit_window_hours,
  welcome_credit_amount, daily_credit_amount, welcome_granted_at, daily_grants_count,
  last_credit_reset_at, next_credit_reset_at,
  attachment_count, attachment_limit, last_attachment_reset_at, attachment_reset_at
)
select u.id, p.plan, p.credits_initial, p.credits_initial, 0,
  p.credit_cost, 24,
  p.credits_initial, p.daily_credits, now(), 0,
  now(), public.kazer_next_daily_reset(now()),
  0, p.attachment_limit, now(), public.kazer_next_daily_reset(now())
from auth.users u
cross join public.plan_catalog p
where p.plan = 'free'
on conflict (user_id) do nothing;

drop function if exists public.get_my_usage();

create or replace function public.get_my_usage()
returns table (
  user_id uuid, plan text, credits_balance integer, credits_initial integer, credits_used integer,
  last_credit_reset_at timestamptz, next_credit_reset_at timestamptz,
  attachment_count integer, attachment_limit integer, attachment_remaining integer,
  last_attachment_reset_at timestamptz, attachment_reset_at timestamptz,
  credits_limit_reached boolean, attachment_limit_reached boolean,
  waiting_for_daily_tokens boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare v public.user_usage;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v := public.kazer_apply_usage_reset_locked(auth.uid());
  return query select v.user_id, v.plan, v.credits_balance, v.credits_initial, v.credits_used,
    v.last_credit_reset_at, v.next_credit_reset_at,
    v.attachment_count, v.attachment_limit, greatest(v.attachment_limit - v.attachment_count, 0),
    v.last_attachment_reset_at, v.attachment_reset_at,
    v.credits_balance <= 0, v.attachment_count >= v.attachment_limit,
    v.credits_balance <= 0 and v.next_credit_reset_at > now();
end;
$$;

drop function if exists public.consume_kazer_usage(integer, integer);

create or replace function public.consume_kazer_usage(
  p_credit_amount integer default 10,
  p_attachment_count integer default 0
)
returns table (
  credits_balance integer, credits_used integer, next_credit_reset_at timestamptz,
  attachment_count integer, attachment_limit integer, attachment_remaining integer,
  attachment_reset_at timestamptz, credits_limit_reached boolean, attachment_limit_reached boolean,
  waiting_for_daily_tokens boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare v public.user_usage;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_credit_amount is null or p_credit_amount <= 0 or p_credit_amount > 1000 then
    raise exception 'invalid_credit_amount';
  end if;
  if p_attachment_count is null or p_attachment_count < 0 or p_attachment_count > 10 then
    raise exception 'invalid_attachment_count';
  end if;

  v := public.kazer_apply_usage_reset_locked(auth.uid());
  if v.credits_balance < p_credit_amount then raise exception 'credits_limit_reached'; end if;
  if v.attachment_count + p_attachment_count > v.attachment_limit then
    raise exception 'attachment_limit_reached';
  end if;

  update public.user_usage as u
  set credits_balance = u.credits_balance - p_credit_amount,
      credits_used = u.credits_used + p_credit_amount,
      attachment_count = u.attachment_count + p_attachment_count,
      updated_at = now()
  where u.user_id = auth.uid()
    and u.credits_balance >= p_credit_amount
    and u.attachment_count + p_attachment_count <= u.attachment_limit
  returning u.credits_balance, u.credits_used, u.next_credit_reset_at,
    u.attachment_count, u.attachment_limit, greatest(u.attachment_limit - u.attachment_count, 0),
    u.attachment_reset_at, u.credits_balance <= 0, u.attachment_count >= u.attachment_limit,
    u.credits_balance <= 0 and u.next_credit_reset_at > now()
  into credits_balance, credits_used, next_credit_reset_at,
    attachment_count, attachment_limit, attachment_remaining,
    attachment_reset_at, credits_limit_reached, attachment_limit_reached,
    waiting_for_daily_tokens;

  if not found then raise exception 'credits_limit_reached'; end if;
  return next;
end;
$$;

revoke all on function public.kazer_next_daily_reset(timestamptz) from public, anon, authenticated;
revoke all on function public.kazer_provision_usage(uuid) from public, anon, authenticated;
revoke all on function public.kazer_apply_usage_reset_locked(uuid) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

grant execute on function public.get_my_usage() to authenticated;
grant execute on function public.consume_kazer_usage(integer, integer) to authenticated;

alter table public.plan_catalog enable row level security;
alter table public.user_usage enable row level security;

comment on table public.plan_catalog is 'Configuração central dos limites: 1.500 tokens de boas-vindas e 300 tokens adicionais por 00:00 UTC no Free.';
comment on table public.user_usage is 'Saldo persistente e isolado por usuário; tokens não expiram e recargas diárias são somadas atomicamente.';
comment on column public.user_usage.welcome_credit_amount is 'Quantidade concedida na primeira criação da conta; não é removida por reset diário.';
comment on column public.user_usage.daily_credit_amount is 'Quantidade adicionada a cada virada de dia UTC.';
comment on column public.user_usage.daily_grants_count is 'Quantidade de recargas diárias aplicadas pelo reset lazy.';
comment on function public.kazer_apply_usage_reset_locked(uuid) is 'Aplica recargas diárias pendentes sem zerar saldo ou tokens não usados.';
