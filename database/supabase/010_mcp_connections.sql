create table if not exists public.kazer_mcp_connections (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  type text not null default 'remote' check (type = 'remote'),
  base_url text not null,
  access_token text,
  status text not null default 'disconnected' check (status in ('connected', 'disconnected')),
  tools_count integer not null default 0 check (tools_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kazer_mcp_connections_user_idx on public.kazer_mcp_connections(user_id, created_at desc);
alter table public.kazer_mcp_connections enable row level security;
alter table public.kazer_mcp_connections force row level security;
drop policy if exists "users can read own kazer mcp connections" on public.kazer_mcp_connections;
create policy "users can read own kazer mcp connections" on public.kazer_mcp_connections for select using (auth.uid() = user_id);
revoke all on public.kazer_mcp_connections from anon;
revoke all on public.kazer_mcp_connections from authenticated;
comment on table public.kazer_mcp_connections is 'Configurações MCP remotas do KAZER; tokens cifrados no servidor e nunca expostos ao cliente.';
