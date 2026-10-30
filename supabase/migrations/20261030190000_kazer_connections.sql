-- KAZER: conectores ligados.
--
-- Guarda o endereço MCP e a credencial de cada conector que a conta ligou. A
-- credencial é o ponto sensível desta migração:
--
--   * Ela **nunca** sai em listagem: `kazer_connections()` devolve nome,
--     ferramentas e estado, e nada mais. Quem precisa dela é só o servidor,
--     na hora de executar a ferramenta, por `kazer_connection_secret()`.
--   * Essa função é `security definer` e exige `auth.uid()`, então ela só
--     devolve o segredo da própria conta.
--   * `select` direto na tabela é negado a `authenticated`: o acesso passa
--     pelas funções. Sem isso, um `GET` no PostgREST leria a credencial.
--
-- Aditiva: só cria tabela e funções novas.
--
-- Reversão: ver docs/supabase-chat-storage.md.

begin;

create table if not exists public.kazer_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connector_id text not null check (char_length(connector_id) between 1 and 80),
  name text not null check (char_length(name) between 1 and 80),
  url text not null check (char_length(url) <= 500),
  token text not null default '' check (char_length(token) <= 4000),
  tools jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, connector_id)
);

create index if not exists kazer_connections_user_idx
  on public.kazer_connections(user_id, created_at, id);

alter table public.kazer_connections enable row level security;

-- Sem política de leitura direta: nem a dona lê a linha crua pelo PostgREST.
-- Tudo passa pelas funções abaixo, que escolhem o que devolver.
drop policy if exists kazer_connections_none on public.kazer_connections;

revoke all on public.kazer_connections from anon, authenticated;

create or replace function public.kazer_connection_json(c public.kazer_connections)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', c.id,
    'connector_id', c.connector_id,
    'name', c.name,
    'connected', true,
    'enabled', c.enabled,
    'tools', c.tools,
    'created_at', extract(epoch from c.created_at)::bigint
  );
$$;

create or replace function public.kazer_connections()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(public.kazer_connection_json(c) order by c.created_at, c.id)
      from public.kazer_connections c where c.user_id = uid
  ), '[]'::jsonb);
end;
$$;

-- O único caminho até a credencial, e só para a própria conta.
create or replace function public.kazer_connection_secret(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.kazer_connections;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select * into row from public.kazer_connections where id = p_id and user_id = uid;
  if not found then return null; end if;
  return public.kazer_connection_json(row)
         || jsonb_build_object('url', row.url, 'token', row.token);
end;
$$;

create or replace function public.kazer_save_connection(
  p_connector_id text,
  p_name text,
  p_url text,
  p_token text,
  p_tools jsonb,
  p_max integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.kazer_connections;
  already boolean;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select true into already
    from public.kazer_connections
   where user_id = uid and connector_id = p_connector_id;
  if not found
     and (select count(*) from public.kazer_connections where user_id = uid) >= p_max then
    return null;
  end if;

  insert into public.kazer_connections
    (user_id, connector_id, name, url, token, tools)
    values (uid, left(p_connector_id, 80), left(p_name, 80), left(p_url, 500),
            left(coalesce(p_token, ''), 4000), coalesce(p_tools, '[]'::jsonb))
  on conflict (user_id, connector_id) do update
    set name = excluded.name,
        url = excluded.url,
        token = excluded.token,
        tools = excluded.tools,
        enabled = true,
        updated_at = now()
  returning * into row;
  return public.kazer_connection_json(row);
end;
$$;

create or replace function public.kazer_set_connection(p_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  update public.kazer_connections set enabled = p_enabled, updated_at = now()
   where id = p_id and user_id = uid;
  return found;
end;
$$;

create or replace function public.kazer_delete_connection(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  delete from public.kazer_connections where id = p_id and user_id = uid;
  return found;
end;
$$;

do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'kazer_connection_json', 'kazer_connections', 'kazer_connection_secret',
         'kazer_save_connection', 'kazer_set_connection', 'kazer_delete_connection'
       )
  loop
    execute format('grant execute on function %s to authenticated, service_role', fn.sig);
  end loop;
end $$;

commit;
