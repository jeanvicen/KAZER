-- Kazer: remoção do sistema legado de consumo, créditos, planos e limites de anexos.
-- Esta migração é destrutiva apenas para as estruturas exclusivas desse sistema.
-- Auth, perfis, preferências, memórias, conectores, tarefas e conversas permanecem intactos.

begin;

-- O trigger de Auth continua criando apenas o perfil e as preferências da conta.
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
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Remover funções com dependências no tipo/tabelas de uso antes das tabelas.
drop function if exists public.consume_attachment();
drop function if exists public.consume_chat_usage(integer, integer);
drop function if exists public.consume_chat_usage(integer, boolean);
drop function if exists public.consume_kazer_usage(integer, integer);
drop function if exists public.consume_credits(integer);
drop function if exists public.get_my_usage();
drop function if exists public.kazer_apply_usage_reset_locked(uuid);
drop function if exists public.kazer_provision_usage(uuid);
drop function if exists public.kazer_next_daily_reset(timestamptz);

-- O custo não é mais um atributo de uma tarefa: a tarefa descreve execução,
-- progresso, resultado e contexto de integração, não faturamento.
alter table if exists public.kazer_tasks
  drop column if exists credit_cost;

update public.kazer_tasks
set task_type = 'chat'
where task_type = 'file';

alter table public.kazer_tasks
  drop constraint if exists kazer_tasks_task_type_check;

alter table public.kazer_tasks
  add constraint kazer_tasks_task_type_check
  check (task_type in ('chat', 'coding', 'research'));

-- O CASCADE remove policies, triggers e grants vinculados a estas tabelas.
drop table if exists public.user_usage cascade;
drop table if exists public.plan_catalog cascade;

commit;

-- Não há RPC de consumo nem tabela de saldo após esta migração.
