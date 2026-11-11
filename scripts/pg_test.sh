#!/usr/bin/env bash
# Testa as migrações e os testes SQL do KAZER num Postgres LOCAL e descartável.
#
#   bash scripts/pg_test.sh
#
# Sobe um cluster temporário, cria um Supabase "de mentira" (papéis anon /
# authenticated / service_role, esquema auth com auth.uid() lendo o JWT da
# sessão, esquema storage), aplica TODAS as migrações em ordem e roda cada
# arquivo de supabase/tests/. Nunca toca em banco de produção.
#
# Sai com 0 quando tudo passa, 1 quando algo falha e 77 quando não há Postgres
# instalado (NÃO RODOU — não conte como aprovado).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${PG_BIN:-}"
if [ -z "$BIN" ]; then
  for dir in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin /opt/homebrew/opt/postgresql*/bin; do
    [ -x "$dir/initdb" ] && BIN="$dir"
  done
fi
if [ -z "$BIN" ] || [ ! -x "$BIN/initdb" ]; then
  echo "NÃO RODOU: Postgres (initdb) não encontrado. Defina PG_BIN=/caminho/bin." >&2
  exit 77
fi

WORK="$(mktemp -d)"
PORT="${PG_TEST_PORT:-54329}"
RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  # initdb não roda como root: usa o usuário postgres do sistema.
  id postgres >/dev/null 2>&1 || { echo "NÃO RODOU: rodando como root sem usuário postgres." >&2; exit 77; }
  chown postgres "$WORK"
  RUN_AS="runuser -u postgres --"
fi
cleanup() {
  $RUN_AS "$BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

$RUN_AS "$BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
$RUN_AS "$BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -k $WORK" -w -l "$WORK/log" start >/dev/null
export PSQL="$BIN/psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $PORT -U postgres"
$PSQL -d postgres -c "create database kazer_test" >/dev/null
export PSQL="$PSQL -d kazer_test"

# --- Supabase mínimo: só o que as migrações e os testes usam. ---
$PSQL <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create schema auth;
create schema storage;
create schema extensions;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  email_confirmed_at timestamptz,
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text);
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;
-- A tabela de perfis já existia no projeto antes das migrações do repositório.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant usage on schema auth, storage, public, extensions to anon, authenticated, service_role;
grant all on all tables in schema auth, storage to service_role;
grant select, insert, update, delete on storage.objects to authenticated;
SQL

fail=0
echo "== Migrações =="
for file in "$ROOT"/supabase/migrations/*.sql; do
  if $PSQL -f "$file" >"$WORK/out" 2>&1; then
    echo "  ok    $(basename "$file")"
  else
    echo "  FALHOU $(basename "$file")"; sed 's/^/        /' "$WORK/out" | tail -8; fail=1
  fi
done

echo "== Testes SQL =="
for file in "$ROOT"/supabase/tests/*.sql; do
  if $PSQL -f "$file" >"$WORK/out" 2>&1; then
    echo "  ok    $(basename "$file")"
  else
    echo "  FALHOU $(basename "$file")"; sed 's/^/        /' "$WORK/out" | tail -8; fail=1
  fi
done

if [ -f "$ROOT/scripts/pg_concurrency.py" ]; then
  echo "== Concorrência da cota de imagens =="
  if python3 "$ROOT/scripts/pg_concurrency.py"; then echo "  ok"; else echo "  FALHOU"; fail=1; fi
fi

[ "$fail" = "0" ] && echo "TUDO OK" || echo "HÁ FALHAS"
exit "$fail"
