-- Integração do painel de MCPs, GitHub e tarefas do KAZER.
-- A migração é aditiva: não remove dados existentes.
-- Os endpoints serverless usam SUPABASE_SERVICE_ROLE_KEY e validam auth.uid()
-- antes de acessar estas tabelas; credenciais e variáveis sensíveis são cifradas no servidor.

create table if not exists public.kazer_mcp_connectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text,
  type text not null default 'remote' check (type in ('local', 'remote')),
  base_url text,
  command text,
  secret_payload text,
  status text not null default 'disconnected' check (status in ('connected', 'disconnected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kazer_mcp_transport_check check (
    (type = 'remote' and base_url is not null and command is null)
    or (type = 'local' and command is not null and base_url is null)
  )
);

create index if not exists kazer_mcp_connectors_user_updated_idx
  on public.kazer_mcp_connectors (user_id, updated_at desc);

create table if not exists public.kazer_github_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  github_user_id text not null,
  login text not null,
  display_name text,
  avatar_url text,
  access_token_encrypted text not null,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists kazer_github_connections_github_user_idx
  on public.kazer_github_connections (github_user_id);

create table if not exists public.kazer_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  prompt text not null check (char_length(prompt) between 1 and 8000),
  task_type text not null default 'chat' check (task_type in ('chat', 'coding', 'research')),
  repo_url text,
  selected_agent text,
  selected_model text,
  mcp_connector_ids jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'error', 'stopped')),
  progress integer not null default 0 check (progress between 0 and 100),
  logs jsonb not null default '[]'::jsonb,
  result text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists kazer_tasks_user_created_idx
  on public.kazer_tasks (user_id, created_at desc);

create index if not exists kazer_tasks_user_status_idx
  on public.kazer_tasks (user_id, status, updated_at desc);

create or replace function public.kazer_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists kazer_mcp_connectors_updated_at on public.kazer_mcp_connectors;
create trigger kazer_mcp_connectors_updated_at
before update on public.kazer_mcp_connectors
for each row execute function public.kazer_touch_updated_at();

drop trigger if exists kazer_github_connections_updated_at on public.kazer_github_connections;
create trigger kazer_github_connections_updated_at
before update on public.kazer_github_connections
for each row execute function public.kazer_touch_updated_at();

drop trigger if exists kazer_tasks_updated_at on public.kazer_tasks;
create trigger kazer_tasks_updated_at
before update on public.kazer_tasks
for each row execute function public.kazer_touch_updated_at();

alter table public.kazer_mcp_connectors enable row level security;
alter table public.kazer_mcp_connectors force row level security;
alter table public.kazer_github_connections enable row level security;
alter table public.kazer_github_connections force row level security;
alter table public.kazer_tasks enable row level security;
alter table public.kazer_tasks force row level security;

revoke all on public.kazer_mcp_connectors from anon, authenticated;
revoke all on public.kazer_github_connections from anon, authenticated;
revoke all on public.kazer_tasks from anon, authenticated;
revoke all on function public.kazer_touch_updated_at() from public, anon, authenticated;

comment on table public.kazer_mcp_connectors is 'Configurações de MCP do usuário; secret_payload contém dados cifrados e nunca é exposto ao cliente.';
comment on table public.kazer_github_connections is 'Conexão GitHub do usuário; o token OAuth é cifrado e acessado somente pelo backend.';
comment on table public.kazer_tasks is 'Histórico de tarefas e atividades do KAZER, isolado por usuário.';
