-- KAZER: central de conectores (OAuth oficial ou chave pelo cartão seguro).
-- Migração aditiva. Acesso somente pelo backend (service role); as
-- credenciais ficam cifradas com AES-256-GCM em secret_encrypted.

begin;

create table if not exists public.kazer_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (char_length(provider) between 2 and 120),
  account_label text,
  auth_kind text not null default 'token' check (auth_kind in ('oauth', 'token', 'custom')),
  base_url text,
  secret_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists kazer_connections_user_idx on public.kazer_connections (user_id);

drop trigger if exists kazer_connections_updated_at on public.kazer_connections;
create trigger kazer_connections_updated_at
before update on public.kazer_connections
for each row execute function public.kazer_touch_updated_at();

alter table public.kazer_connections enable row level security;
alter table public.kazer_connections force row level security;
revoke all on public.kazer_connections from public, anon, authenticated;
comment on table public.kazer_connections is 'Conectores do usuário; credenciais cifradas, lidas somente pelo backend.';

commit;
