-- Kazer: retenção de notificações.
-- Mantém somente notificações recentes e uma confirmação compacta por usuário.
-- Não altera Auth, perfis, memórias, conectores ou tarefas.

create table if not exists public.notificacoes_vistas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  versao_vista integer not null default 0 check (versao_vista >= 0),
  atualizado_em timestamptz not null default now()
);

alter table public.notificacoes_vistas enable row level security;
alter table public.notificacoes_vistas force row level security;
revoke all on public.notificacoes_vistas from anon;
grant select, insert, update on public.notificacoes_vistas to authenticated;

drop policy if exists notificacoes_vistas_select_own on public.notificacoes_vistas;
create policy notificacoes_vistas_select_own
on public.notificacoes_vistas for select
to authenticated
using (user_id = auth.uid());

drop policy if exists notificacoes_vistas_insert_own on public.notificacoes_vistas;
create policy notificacoes_vistas_insert_own
on public.notificacoes_vistas for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists notificacoes_vistas_update_own on public.notificacoes_vistas;
create policy notificacoes_vistas_update_own
on public.notificacoes_vistas for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

comment on table public.notificacoes_vistas is 'Última versão de aviso global visualizada por usuário; uma linha por usuário.';

create or replace function public.cleanup_old_account_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  deleted_count integer;
begin
  delete from public.account_notifications
  where created_at < now() - interval '1 month';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$function$;

revoke all on function public.cleanup_old_account_notifications() from public, anon, authenticated;

-- Se o pg_cron estiver habilitado no projeto, agenda a limpeza diária.
-- Em projetos sem pg_cron a migração continua válida; a função pode ser chamada
-- por um cron externo usando service_role.
do $migration$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.schedule(
        'kazer-cleanup-old-account-notifications',
        '15 3 * * *',
        $job$select public.cleanup_old_account_notifications();$job$
      );
    exception
      when duplicate_object then null;
    end;
  end if;
end
$migration$;

create index if not exists account_notifications_created_at_idx
on public.account_notifications (created_at);
