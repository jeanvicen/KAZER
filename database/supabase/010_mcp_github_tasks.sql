-- Integração do painel de MCPs, GitHub e tarefas do KAZER.
-- A migração é aditiva: não remove dados existentes.
-- Os endpoints serverless usam SUPABASE_SERVICE_ROLE_KEY e validam auth.uid()
-- antes de acessar estas tabelas; tokens e variáveis sensíveis são cifrados no servidor.

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
  task_type text not null default 'chat' check (task_type in ('chat', 'coding', 'research', 'file')),
  repo_url text,
  selected_agent text,
  selected_model text,
  mcp_connector_ids jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'error', 'stopped')),
  progress integer not null default 0 check (progress between 0 and 100),
  logs jsonb not null default '[]'::jsonb,
  result text,
  error text,
  credit_cost integer not null default 0 check (credit_cost >= 0),
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

create or replace function public.consume_kazer_usage(
  p_credit_amount integer default 10,
  p_attachment_count integer default 0
)
returns table (
  credits_balance integer,
  credits_used integer,
  next_credit_reset_at timestamptz,
  attachment_count integer,
  attachment_limit integer,
  attachment_remaining integer,
  attachment_reset_at timestamptz,
  credits_limit_reached boolean,
  attachment_limit_reached boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.user_usage;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_credit_amount is null or p_credit_amount <= 0 or p_credit_amount > 1000 then
    raise exception 'invalid_credit_amount';
  end if;
  if p_attachment_count is null or p_attachment_count < 0 or p_attachment_count > 10 then
    raise exception 'invalid_attachment_count';
  end if;

  v := public.kazer_apply_usage_reset_locked(auth.uid());
  if v.credits_balance < p_credit_amount then raise exception 'credits_limit_reached'; end if;
  if v.attachment_count + p_attachment_count > v.attachment_limit then
    raise exception 'attachment_limit_reached';
  end if;

  update public.user_usage as u
  set credits_balance = u.credits_balance - p_credit_amount,
      credits_used = u.credits_used + p_credit_amount,
      attachment_count = u.attachment_count + p_attachment_count,
      updated_at = now()
  where u.user_id = auth.uid()
    and u.credits_balance >= p_credit_amount
    and u.attachment_count + p_attachment_count <= u.attachment_limit
  returning u.credits_balance,
    u.credits_used,
    u.next_credit_reset_at,
    u.attachment_count,
    u.attachment_limit,
    greatest(u.attachment_limit - u.attachment_count, 0),
    u.attachment_reset_at,
    u.credits_balance <= 0,
    u.attachment_count >= u.attachment_limit
  into credits_balance,
    credits_used,
    next_credit_reset_at,
    attachment_count,
    attachment_limit,
    attachment_remaining,
    attachment_reset_at,
    credits_limit_reached,
    attachment_limit_reached;

  if not found then raise exception 'credits_limit_reached'; end if;
  return next;
end;
$$;

revoke all on function public.consume_kazer_usage(integer, integer) from public, anon;
grant execute on function public.consume_kazer_usage(integer, integer) to authenticated;
comment on function public.consume_kazer_usage(integer, integer) is 'Consumo atômico de custo variável e anexos por operação do KAZER.';
