-- KAZER: cobrança dos planos pagos (créditos dos modelos premium e plano que vence).
--
-- 1. kazer_credit_usage: quanto cada conta gastou de crédito no mês, em
--    micro-dólares. Fica FORA de kazer_preferences porque o próprio usuário
--    pode editar as preferências pelo PostgREST — aqui ele só lê. Quem soma é o
--    backend, com a chave de serviço, pela função kazer_charge_credits.
-- 2. kazer_plan_of passa a respeitar renews_at: se o webhook de cancelamento se
--    perder, o plano pago não fica eterno (3 dias de tolerância para o banco
--    processar a renovação).

begin;

create table if not exists public.kazer_credit_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  spent_micro bigint not null default 0 check (spent_micro >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

alter table public.kazer_credit_usage enable row level security;
revoke all on table public.kazer_credit_usage from anon, authenticated;
grant select on table public.kazer_credit_usage to authenticated;

drop policy if exists kazer_credit_usage_read_own on public.kazer_credit_usage;
create policy kazer_credit_usage_read_own on public.kazer_credit_usage
  for select to authenticated using ((select auth.uid()) = user_id);

-- Soma atômica (sem corrida entre respostas simultâneas). Só service_role.
create or replace function public.kazer_charge_credits(
  p_user_id uuid,
  p_month text,
  p_micro bigint
)
returns bigint
language sql
security definer
set search_path = public
as $$
  insert into public.kazer_credit_usage (user_id, month, spent_micro, updated_at)
  values (p_user_id, p_month, greatest(p_micro, 0), now())
  on conflict (user_id, month)
  do update set spent_micro = public.kazer_credit_usage.spent_micro + greatest(p_micro, 0),
                updated_at = now()
  returning spent_micro;
$$;

revoke execute on function public.kazer_charge_credits(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.kazer_charge_credits(uuid, text, bigint) to service_role;

create or replace function public.kazer_plan_of(target_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select plan from public.kazer_plans
      where user_id = target_user_id
        and (plan = 'free' or renews_at is null or renews_at > now() - interval '3 days')),
    'free'
  );
$$;

revoke execute on function public.kazer_plan_of(uuid) from public, anon;

commit;
