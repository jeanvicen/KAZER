-- Kazer: 150 mensagens por janela de 5 horas.
-- O plano Free mantém 1500 créditos; cada mensagem consome 10 créditos.

alter table public.plan_catalog
  add column if not exists credit_cost integer not null default 10 check (credit_cost > 0),
  add column if not exists credit_window_hours integer not null default 5 check (credit_window_hours > 0);

update public.plan_catalog
set credit_cost = 10, credit_window_hours = 5, updated_at = now()
where plan = 'free';

alter table public.user_usage
  add column if not exists credit_cost integer not null default 10 check (credit_cost > 0),
  add column if not exists credit_window_hours integer not null default 5 check (credit_window_hours > 0);

update public.user_usage u
set credit_cost = p.credit_cost,
    credit_window_hours = p.credit_window_hours,
    next_credit_reset_at = case when u.next_credit_reset_at > now() + make_interval(hours => p.credit_window_hours)
      then now() + make_interval(hours => p.credit_window_hours)
      else u.next_credit_reset_at end,
    updated_at = now()
from public.plan_catalog p
where p.plan = u.plan;

create or replace function public.kazer_next_daily_reset(p_now timestamptz default now())
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select p_now + interval '5 hours';
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
    user_id, plan, credits_balance, credits_initial, credits_used, credit_cost, credit_window_hours,
    last_credit_reset_at, next_credit_reset_at,
    attachment_count, attachment_limit, last_attachment_reset_at, attachment_reset_at
  ) values (
    p_user_id, v_plan.plan, v_plan.credits_initial, v_plan.credits_initial, 0, v_plan.credit_cost, v_plan.credit_window_hours,
    now(), v_reset, 0, v_plan.attachment_limit, now(), v_reset
  ) on conflict (user_id) do nothing;
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
begin
  perform public.kazer_provision_usage(p_user_id);
  select * into v_usage from public.user_usage where user_id = p_user_id for update;
  select * into v_plan from public.plan_catalog where plan = v_usage.plan;
  if v_usage.next_credit_reset_at <= v_now or v_usage.attachment_reset_at <= v_now then
    v_next := v_now + make_interval(hours => v_plan.credit_window_hours);
    update public.user_usage
    set credits_balance = case when v_usage.next_credit_reset_at <= v_now then v_plan.credits_initial else credits_balance end,
        credits_initial = v_plan.credits_initial,
        credits_used = case when v_usage.next_credit_reset_at <= v_now then 0 else credits_used end,
        credit_cost = v_plan.credit_cost,
        credit_window_hours = v_plan.credit_window_hours,
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

create or replace function public.consume_chat_usage(p_credit_amount integer default 10, p_has_attachment boolean default false)
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
  update public.user_usage as u
  set credits_balance = u.credits_balance - p_credit_amount,
      credits_used = u.credits_used + p_credit_amount,
      attachment_count = u.attachment_count + case when p_has_attachment then 1 else 0 end,
      updated_at = now()
  where u.user_id = auth.uid()
    and u.credits_balance >= p_credit_amount
    and (not p_has_attachment or u.attachment_count < u.attachment_limit)
  returning u.credits_balance, u.credits_used, u.next_credit_reset_at,
    u.attachment_count, u.attachment_limit, greatest(u.attachment_limit - u.attachment_count, 0),
    u.attachment_reset_at, u.credits_balance <= 0, u.attachment_count >= u.attachment_limit
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
