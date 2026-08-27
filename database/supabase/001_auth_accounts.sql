-- Kazer: autenticação, conta, preferências e retenção.
-- Esta migração é aditiva: não apaga tabelas, usuários ou dados existentes.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notifications_enabled boolean not null default true,
  install_prompt_enabled boolean not null default true,
  appearance text not null default 'dark' check (appearance in ('dark', 'light', 'system')),
  language text not null default 'pt-BR' check (language in ('pt-BR', 'en-US')),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 140),
  message text not null check (char_length(btrim(message)) between 1 and 4000),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists public.app_maintenance (
  id boolean primary key default true check (id = true),
  enabled boolean not null default false,
  title text not null default 'Kazer em desenvolvimento',
  message text not null default 'Estamos preparando uma atualização. Volte em breve.',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.app_maintenance (id)
values (true)
on conflict (id) do nothing;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();

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
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, display_name)
select
  u.id,
  nullif(btrim(coalesce(
    u.raw_user_meta_data ->> 'display_name',
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    ''
  )), '')
from auth.users as u
on conflict (id) do nothing;

insert into public.user_settings (user_id)
select u.id
from auth.users as u
on conflict (user_id) do nothing;

create or replace function public.touch_user_activity()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  update public.user_settings
  set last_activity_at = now()
  where user_id = auth.uid()
  returning last_activity_at;
$$;

revoke all on function public.touch_user_activity() from public;
grant execute on function public.touch_user_activity() to authenticated;

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.app_notices enable row level security;
alter table public.app_maintenance enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select, update (display_name) on public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

revoke all on public.user_settings from anon, authenticated;
grant select on public.user_settings to authenticated;
grant update (notifications_enabled, install_prompt_enabled, appearance, language) on public.user_settings to authenticated;

drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own
on public.user_settings for select
to authenticated
using (user_id = auth.uid());

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own
on public.user_settings for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

revoke all on public.app_notices from anon, authenticated;
grant select on public.app_notices to anon, authenticated;

drop policy if exists app_notices_read_active on public.app_notices;
create policy app_notices_read_active
on public.app_notices for select
to anon, authenticated
using (is_active = true and (expires_at is null or expires_at > now()));

revoke all on public.app_maintenance from anon, authenticated;
grant select on public.app_maintenance to anon, authenticated;

drop policy if exists app_maintenance_read on public.app_maintenance;
create policy app_maintenance_read
on public.app_maintenance for select
to anon, authenticated
using (true);

comment on table public.profiles is 'Dados públicos mínimos da conta Kazer; o e-mail permanece no Supabase Auth.';
comment on table public.user_settings is 'Preferências e última atividade da conta; a atualização de atividade ocorre pelo RPC protegido.';
comment on table public.app_notices is 'Avisos globais publicados pelo painel administrativo.';
comment on table public.app_maintenance is 'Estado global de desenvolvimento/manutenção do Kazer.';
