-- Kazer: avisos de retenção antes da exclusão por inatividade.
-- Migração aditiva; não apaga usuários, sessões ou notificações existentes.

create table if not exists public.account_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('inactivity_warning')),
  warning_days integer not null check (warning_days in (50, 30, 5)),
  title text not null check (char_length(btrim(title)) between 1 and 140),
  message text not null check (char_length(btrim(message)) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, kind, warning_days)
);

create index if not exists account_notifications_user_unread_idx
on public.account_notifications (user_id, read_at, created_at desc);

alter table public.account_notifications enable row level security;
revoke all on public.account_notifications from anon, authenticated;
grant select, update (read_at) on public.account_notifications to authenticated;

drop policy if exists account_notifications_select_own on public.account_notifications;
create policy account_notifications_select_own
on public.account_notifications for select
to authenticated
using (user_id = auth.uid());

drop policy if exists account_notifications_update_own on public.account_notifications;
create policy account_notifications_update_own
on public.account_notifications for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

comment on table public.account_notifications is 'Avisos privados e únicos sobre a proximidade da exclusão por inatividade.';
