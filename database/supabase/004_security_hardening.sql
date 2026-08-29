-- Endurecimento aditivo; execute depois das migrações 001, 002 e 003.
-- Não apaga usuários, sessões, preferências ou notificações existentes.

alter table public.profiles force row level security;
alter table public.user_settings force row level security;
alter table public.app_notices force row level security;
alter table public.app_maintenance force row level security;
alter table public.account_notifications force row level security;

-- O nome é mostrado na interface e deve permanecer pequeno e não vazio quando informado.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_display_name_length_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_display_name_length_check
      check (display_name is null or char_length(btrim(display_name)) between 1 and 80) not valid;
  end if;
end
$$;

-- Nenhum cliente pode criar, apagar ou alterar IDs de linhas diretamente.
revoke insert, delete on public.profiles from anon, authenticated;
revoke insert, delete on public.user_settings from anon, authenticated;
revoke insert, delete on public.account_notifications from anon, authenticated;
revoke insert, update, delete on public.app_notices from anon, authenticated;
revoke insert, update, delete on public.app_maintenance from anon, authenticated;

-- Funções internas não devem ser chamadas por clientes; somente o RPC de atividade é público para authenticated.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.touch_user_activity() from public, anon;
grant execute on function public.touch_user_activity() to authenticated;

comment on schema public is 'Acesso de cliente controlado por grants mínimos e Row Level Security; chaves service_role permanecem no servidor.';
