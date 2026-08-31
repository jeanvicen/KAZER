-- Kazer: créditos e limite diário de anexos por usuário.
-- Migração aditiva: não apaga tabelas, usuários nem dados existentes.

create table if not exists public.plan_catalog (
  plan text primary key,
  credits_initial integer not null check (credits_initial >= 0),
  attachment_limit integer not null check (attachment_limit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.plan_catalog (plan, credits_initial, attachment_limit)
values ('free', 1500, 5)
on conflict (plan) do update
set credits_initial = excluded.credits_initial,
    attachment_limit = excluded.attachment_limit,
    updated_at = now();

create table if not exists public.user_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' references public.plan_catalog(plan),
  credits_balance integer not null default 1500 check (credits_balance >= 0),
  credits_initial integer not null default 1500 check (credits_initial >= 0),
  credits_used integer not null default 0 check (credits_used >= 0),
  last_credit_reset_at timestamptz not null default now(),
  next_credit_reset_at timestamptz not null,
  attachment_count integer not null default 0 check (attachment_count >= 0),
  attachment_limit integer not null default 5 check (attachment_limit >= 0),
  last_attachment_reset_at timestamptz not null default now(),
  attachment_reset_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_usage_next_credit_reset_idx on public.user_usage (next_credit_reset_at);
create index if not exists user_usage_attachment_reset_idx on public.user_usage (attachment_reset_at);

create or replace function public.kazer_next_daily_reset(p_now timestamptz default now())
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select ((date_trunc('day', p_now at time zone 'UTC') + interval '1 day') at time zone 'UTC');
$$;

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
    last_credit_reset_at, next_credit_reset_at,
    attachment_count, attachment_limit, last_attachment_reset_at, attachment_reset_at
  ) values (
    p_user_id, v_plan.plan, v_plan.credits_initial, v_plan.credits_initial, 0,
    now(), v_reset, 0, v_plan.attachment_limit, now(), v_reset
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.user_usage (user_id, plan, credits_balance, credits_initial, credits_used,
  last_credit_reset_at, next_credit_reset_at, attachment_count, attachment_limit,
  last_attachment_reset_at, attachment_reset_at)
select u.id, p.plan, p.credits_initial, p.credits_initial, 0, now(), public.kazer_next_daily_reset(now()),
  0, p.attachment_limit, now(), public.kazer_next_daily_reset(now())
from auth.users u cross join public.plan_catalog p
where p.plan = 'free'
on conflict (user_id) do nothing;

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
begin
  perform public.kazer_provision_usage(p_user_id);
  select * into v_usage from public.user_usage where user_id = p_user_id for update;
  select * into v_plan from public.plan_catalog where plan = v_usage.plan;
  if v_usage.next_credit_reset_at <= v_now or v_usage.attachment_reset_at <= v_now then
    v_next := public.kazer_next_daily_reset(v_now);
    update public.user_usage
    set credits_balance = case when v_usage.next_credit_reset_at <= v_now then v_plan.credits_initial else credits_balance end,
        credits_initial = v_plan.credits_initial,
        credits_used = case when v_usage.next_credit_reset_at <= v_now then 0 else credits_used end,
        last_credit_reset_at = case when v_usage.next_credit_reset_at <= v_now then v_now else last_credit_reset_at end,
        next_credit_reset_at = case when v_usage.next_credit_reset_at <= v_now then v_next else next_credit_reset_at end,
        attachment_count = case when v_usage.attachment_reset_at <= v_now then 0 else attachment_count end,
        attachment_limit = v_plan.attachment_limit,
        last_attachment_reset_at = case when v_usage.attachment_reset_at <= v_now then v_now else last_attachment_reset_at end,
        attachment_reset_at = case when v_usage.attachment_reset_at <= v_now then v_next else attachment_reset_at end,
        updated_at = v_now
    where user_id = p_user_id
    returning * into v_usage;
  end if;
  return v_usage;
end;
$$;

create or replace function public.get_my_usage()
returns table (
  user_id uuid, plan text, credits_balance integer, credits_initial integer, credits_used integer,
  last_credit_reset_at timestamptz, next_credit_reset_at timestamptz,
  attachment_count integer, attachment_limit integer, attachment_remaining integer,
  last_attachment_reset_at timestamptz, attachment_reset_at timestamptz,
  credits_limit_reached boolean, attachment_limit_reached boolean
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
    v.last_credit_reset_at, v.next_credit_reset_at, v.attachment_count, v.attachment_limit,
    greatest(v.attachment_limit - v.attachment_count, 0), v.last_attachment_reset_at, v.attachment_reset_at,
    v.credits_balance <= 0, v.attachment_count >= v.attachment_limit;
end;
$$;

create or replace function public.consume_credits(p_amount integer)
returns table (credits_balance integer, credits_used integer, next_credit_reset_at timestamptz, credits_limit_reached boolean)
language plpgsql
security definer
set search_path = public
as $$
declare v public.user_usage;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000 then raise exception 'invalid_credit_amount'; end if;
  v := public.kazer_apply_usage_reset_locked(auth.uid());
  if v.credits_balance < p_amount then raise exception 'credits_limit_reached'; end if;
  update public.user_usage
  set credits_balance = credits_balance - p_amount, credits_used = credits_used + p_amount, updated_at = now()
  where user_id = auth.uid() and credits_balance >= p_amount
  returning user_usage.credits_balance, user_usage.credits_used, user_usage.next_credit_reset_at, user_usage.credits_balance <= 0
  into credits_balance, credits_used, next_credit_reset_at, credits_limit_reached;
  if not found then raise exception 'credits_limit_reached'; end if;
  return next;
end;
$$;

create or replace function public.consume_attachment()
returns table (attachment_count integer, attachment_limit integer, attachment_remaining integer,
  attachment_reset_at timestamptz, attachment_limit_reached boolean)
language plpgsql
security definer
set search_path = public
as $$
declare v public.user_usage;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v := public.kazer_apply_usage_reset_locked(auth.uid());
  if v.attachment_count >= v.attachment_limit then raise exception 'attachment_limit_reached'; end if;
  update public.user_usage
  set attachment_count = attachment_count + 1, updated_at = now()
  where user_id = auth.uid() and attachment_count < attachment_limit
  returning user_usage.attachment_count, user_usage.attachment_limit,
    greatest(user_usage.attachment_limit - user_usage.attachment_count, 0),
    user_usage.attachment_reset_at, user_usage.attachment_count >= user_usage.attachment_limit
  into attachment_count, attachment_limit, attachment_remaining, attachment_reset_at, attachment_limit_reached;
  if not found then raise exception 'attachment_limit_reached'; end if;
  return next;
end;
$$;

alter table public.plan_catalog enable row level security;
alter table public.user_usage enable row level security;

revoke all on public.plan_catalog from public, anon, authenticated;
revoke all on public.user_usage from public, anon, authenticated;
revoke all on function public.kazer_next_daily_reset(timestamptz) from public, anon, authenticated;
revoke all on function public.kazer_provision_usage(uuid) from public, anon, authenticated;
revoke all on function public.kazer_apply_usage_reset_locked(uuid) from public, anon, authenticated;
revoke all on function public.get_my_usage() from public, anon;
revoke all on function public.consume_credits(integer) from public, anon;
revoke all on function public.consume_attachment() from public, anon;
grant execute on function public.get_my_usage() to authenticated;
grant execute on function public.consume_credits(integer) to authenticated;
grant execute on function public.consume_attachment() to authenticated;

 drop trigger if exists user_usage_set_updated_at on public.user_usage;
 create trigger user_usage_set_updated_at before update on public.user_usage for each row execute function public.set_updated_at();
 drop trigger if exists plan_catalog_set_updated_at on public.plan_catalog;
 create trigger plan_catalog_set_updated_at before update on public.plan_catalog for each row execute function public.set_updated_at();

comment on table public.user_usage is 'Estado oficial e persistente de créditos e anexos, isolado por usuário; nunca confiar em valores do navegador.';
comment on table public.plan_catalog is 'Configuração central de limites por plano.';
comment on function public.get_my_usage() is 'Aplica reset diário UTC no servidor e retorna o estado oficial do usuário autenticado.';
comment on function public.consume_credits(integer) is 'Consumo atômico de créditos com reset e proteção contra concorrência.';
comment on function public.consume_attachment() is 'Consumo atômico de um envio de anexo com reset e proteção contra concorrência.';

-- Reforce também as funções legadas já existentes.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_user_activity() from public, anon;
grant execute on function public.touch_user_activity() to authenticated;

-- Corrige o aviso de search_path mutável do trigger existente.
alter function public.set_updated_at() set search_path = public;

create or replace function public.consume_chat_usage(p_credit_amount integer default 1, p_has_attachment boolean default false)
returns table (
  credits_balance integer, credits_used integer, next_credit_reset_at timestamptz,
  attachment_count integer, attachment_limit integer, attachment_remaining integer,
  attachment_reset_at timestamptz, credits_limit_reached boolean, attachment_limit_reached boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare v public.user_usage;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_credit_amount is null or p_credit_amount <= 0 or p_credit_amount > 1000 then raise exception 'invalid_credit_amount'; end if;
  v := public.kazer_apply_usage_reset_locked(auth.uid());
  if v.credits_balance < p_credit_amount then raise exception 'credits_limit_reached'; end if;
  if p_has_attachment and v.attachment_count >= v.attachment_limit then raise exception 'attachment_limit_reached'; end if;
  update public.user_usage
  set credits_balance = credits_balance - p_credit_amount,
      credits_used = credits_used + p_credit_amount,
      attachment_count = attachment_count + case when p_has_attachment then 1 else 0 end,
      updated_at = now()
  where user_id = auth.uid()
    and credits_balance >= p_credit_amount
    and (not p_has_attachment or attachment_count < attachment_limit)
  returning user_usage.credits_balance, user_usage.credits_used, user_usage.next_credit_reset_at,
    user_usage.attachment_count, user_usage.attachment_limit,
    greatest(user_usage.attachment_limit - user_usage.attachment_count, 0),
    user_usage.attachment_reset_at, user_usage.credits_balance <= 0,
    user_usage.attachment_count >= user_usage.attachment_limit
  into credits_balance, credits_used, next_credit_reset_at, attachment_count,
    attachment_limit, attachment_remaining, attachment_reset_at,
    credits_limit_reached, attachment_limit_reached;
  if not found then
    if p_has_attachment and v.attachment_count >= v.attachment_limit then raise exception 'attachment_limit_reached'; end if;
    raise exception 'credits_limit_reached';
  end if;
  return next;
end;
$$;

revoke all on function public.consume_chat_usage(integer, boolean) from public, anon;
grant execute on function public.consume_chat_usage(integer, boolean) to authenticated;
comment on function public.consume_chat_usage(integer, boolean) is 'Reserva atomicamente o custo de uma operação de chat e, se aplicável, um envio de anexo.';
