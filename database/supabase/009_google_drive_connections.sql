create table if not exists public.kazer_google_drive_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scope text not null,
  updated_at timestamptz not null default now()
);

alter table public.kazer_google_drive_connections enable row level security;
alter table public.kazer_google_drive_connections force row level security;

drop policy if exists "users can read own google drive connection" on public.kazer_google_drive_connections;
create policy "users can read own google drive connection" on public.kazer_google_drive_connections for select using (auth.uid() = user_id);

revoke all on public.kazer_google_drive_connections from anon;
revoke all on public.kazer_google_drive_connections from authenticated;
comment on table public.kazer_google_drive_connections is 'Tokens OAuth do Google Drive cifrados no servidor; nunca expor access_token ao cliente.';
