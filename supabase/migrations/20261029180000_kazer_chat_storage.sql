-- KAZER: armazenamento do chat no Postgres do Supabase.
--
-- Puramente aditiva: só cria colunas, tabelas, índices e funções novas. Nenhuma
-- tabela, política, dado ou migração existente é alterada ou removida.
--
-- Desenho:
--   * O backend chama estas funções com o JWT da própria pessoa. Toda função
--     confere `auth.uid()`, então nem um erro no backend vaza conversa de outra
--     conta (defesa em profundidade junto com o RLS que já existe).
--   * Operações que precisam ser atômicas (gravar pergunta + reservar resposta +
--     debitar cota + podar histórico) acontecem numa função só, com trava de
--     linha, para duas abas simultâneas não furarem o limite.
--   * "Leve por padrão": no máximo 100 conversas por conta (a mais antiga sai
--     quando uma nova entra), resumo de raciocínio limitado e eventos de uso
--     antigos podados.
--
-- Reversão: ver docs/supabase-chat-storage.md (as colunas novas são opcionais e
-- as funções podem ser removidas sem tocar nos dados).

begin;

-- ---------------------------------------------------------------------------
-- 1. Colunas que o chat precisa nas tabelas que já existem
-- ---------------------------------------------------------------------------

alter table public.messages
  add column if not exists seq integer,
  add column if not exists thinking text,
  add column if not exists status text,
  add column if not exists error_code text,
  add column if not exists stop_reason text,
  add column if not exists client_id text,
  add column if not exists finished_at timestamptz;

update public.messages set seq = 1 where seq is null;
update public.messages set status = 'complete' where status is null;

alter table public.messages
  alter column seq set not null,
  alter column status set not null,
  alter column status set default 'complete';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_status_check'
  ) then
    alter table public.messages
      add constraint messages_status_check
      check (status in ('complete', 'streaming', 'error', 'stopped'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'messages_thinking_len_check'
  ) then
    -- Resumo de raciocínio é auxiliar: fica curto para o banco não inchar.
    alter table public.messages
      add constraint messages_thinking_len_check
      check (thinking is null or char_length(thinking) <= 20000);
  end if;
end $$;

create unique index if not exists messages_conversation_seq_key
  on public.messages(conversation_id, seq);
-- Idempotência: reenviar o mesmo pedido não cria outra mensagem.
create unique index if not exists messages_conversation_client_key
  on public.messages(conversation_id, client_id) where client_id is not null;

alter table public.attachments
  add column if not exists kind text,
  add column if not exists name text;

update public.attachments set kind = 'file' where kind is null;
update public.attachments set name = 'arquivo' where name is null;

alter table public.attachments
  alter column kind set not null,
  alter column name set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attachments_kind_check') then
    alter table public.attachments
      add constraint attachments_kind_check check (kind in ('image', 'text', 'pdf', 'file'));
  end if;
end $$;

create index if not exists attachments_message_idx on public.attachments(message_id);
-- Anexos enviados ao servidor e nunca usados numa mensagem (limpeza diária).
create index if not exists attachments_orphan_idx
  on public.attachments(created_at) where message_id is null;

-- Plano da conta numa tabela própria: `public.profiles` concede UPDATE ao
-- próprio usuário, então guardar o plano lá deixaria qualquer pessoa se
-- promover pelo PostgREST. Aqui o cliente só lê; quem escreve é o backend
-- (service_role) ou o webhook de pagamento.
create table if not exists public.kazer_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'ultra')),
  renews_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Tabelas novas do chat
-- ---------------------------------------------------------------------------

create table if not exists public.kazer_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint kazer_preferences_size check (pg_column_size(data) <= 8192)
);

create table if not exists public.kazer_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists kazer_memories_user_idx
  on public.kazer_memories(user_id, created_at);

-- Biblioteca: o que o KAZER produziu (código, documento, diagrama, ilustração).
create table if not exists public.kazer_artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  kind text not null check (kind in ('code', 'document', 'diagram', 'image', 'data')),
  title text not null check (char_length(title) <= 200),
  language text,
  content text not null check (char_length(content) <= 400000),
  created_at timestamptz not null default now()
);

create index if not exists kazer_artifacts_user_idx
  on public.kazer_artifacts(user_id, created_at desc);
create index if not exists kazer_artifacts_message_idx
  on public.kazer_artifacts(message_id);

-- ---------------------------------------------------------------------------
-- 3. RLS e grants das tabelas novas (mesmo padrão das existentes)
-- ---------------------------------------------------------------------------

alter table public.kazer_plans enable row level security;
alter table public.kazer_preferences enable row level security;
alter table public.kazer_memories enable row level security;
alter table public.kazer_artifacts enable row level security;

revoke all on table public.kazer_plans, public.kazer_preferences, public.kazer_memories,
  public.kazer_artifacts from anon, authenticated;
-- Plano: leitura apenas. Nenhum insert/update/delete para o cliente.
grant select on table public.kazer_plans to authenticated;
grant select, insert, update, delete on table public.kazer_preferences to authenticated;
grant select, insert, delete on table public.kazer_memories to authenticated;
grant select, delete on table public.kazer_artifacts to authenticated;

drop policy if exists kazer_plans_read_own on public.kazer_plans;
create policy kazer_plans_read_own on public.kazer_plans
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists kazer_preferences_own on public.kazer_preferences;
create policy kazer_preferences_own on public.kazer_preferences
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists kazer_memories_own on public.kazer_memories;
create policy kazer_memories_own on public.kazer_memories
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists kazer_artifacts_own on public.kazer_artifacts;
create policy kazer_artifacts_own on public.kazer_artifacts
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 4. Planos e cotas
-- ---------------------------------------------------------------------------

-- Cota por plano, em "unidades" (uma mensagem simples = 1). Mudar aqui muda o
-- limite para todo mundo, sem deploy do app.
create or replace function public.kazer_plan_quota(plan_name text)
returns table (allowance numeric, window_hours integer)
language sql
immutable
as $$
  select
    case plan_name when 'ultra' then 3000 when 'pro' then 800 else 120 end::numeric,
    5::integer;
$$;

create or replace function public.kazer_plan_of(target_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select plan from public.kazer_plans where user_id = target_user_id),
    'free'
  );
$$;

-- Reserva atômica de cota. Devolve o estado da janela; `allowed` falso vem com
-- `reset_at` real (nunca um horário inventado).
create or replace function public.kazer_reserve_usage(
  p_units numeric,
  p_request_id uuid,
  p_model text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  plan_name text;
  quota record;
  win record;
  now_ts timestamptz := now();
begin
  if uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if p_units is null or p_units <= 0 or p_units > 1000 then
    raise exception 'invalid_units' using errcode = '22023';
  end if;

  plan_name := public.kazer_plan_of(uid);
  select * into quota from public.kazer_plan_quota(plan_name);

  -- Trava a linha da janela: duas requisições paralelas não furam o limite.
  select * into win from public.usage_windows where user_id = uid for update;

  if win is null then
    insert into public.usage_windows
      (user_id, window_started_at, reset_at, consumed_units, allowance_units)
    values
      (uid, now_ts, now_ts + make_interval(hours => quota.window_hours), 0, quota.allowance)
    returning * into win;
  elsif win.reset_at <= now_ts then
    update public.usage_windows
       set window_started_at = now_ts,
           reset_at = now_ts + make_interval(hours => quota.window_hours),
           consumed_units = 0,
           allowance_units = quota.allowance,
           status = 'active',
           updated_at = now_ts
     where user_id = uid
    returning * into win;
  elsif win.allowance_units <> quota.allowance then
    -- Plano mudou no meio da janela: a nova franquia vale já.
    update public.usage_windows
       set allowance_units = quota.allowance, updated_at = now_ts
     where user_id = uid
    returning * into win;
  end if;

  if win.consumed_units + p_units > win.allowance_units then
    update public.usage_windows
       set status = 'exhausted', updated_at = now_ts
     where user_id = uid;
    return jsonb_build_object(
      'allowed', false,
      'plan', plan_name,
      'reset_at', win.reset_at,
      'allowance', win.allowance_units,
      'consumed', win.consumed_units
    );
  end if;

  update public.usage_windows
     set consumed_units = consumed_units + p_units,
         status = 'active',
         updated_at = now_ts
   where user_id = uid
  returning * into win;

  insert into public.usage_events as ue
    (user_id, request_id, model, usage_units, status)
  values
    (uid, p_request_id, p_model, p_units, 'started')
  on conflict (user_id, request_id) do nothing;

  return jsonb_build_object(
    'allowed', true,
    'plan', plan_name,
    'reset_at', win.reset_at,
    'allowance', win.allowance_units,
    'consumed', win.consumed_units
  );
end;
$$;

-- Fecha o evento de uso com o consumo real e devolve a diferença reservada.
-- `p_user_id` só é usado quando não há JWT na chamada (a thread que gera a
-- resposta roda fora da requisição e usa a chave de serviço). Com JWT, o
-- auth.uid() sempre vence: um backend com bug não consegue apontar para outra
-- conta.
create or replace function public.kazer_settle_usage(
  p_request_id uuid,
  p_final_units numeric,
  p_final_status text,
  p_input_tokens bigint default null,
  p_output_tokens bigint default null,
  p_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := coalesce(auth.uid(), p_user_id);
  reserved numeric;
begin
  if uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if p_final_status not in ('completed', 'failed', 'rejected') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select usage_units into reserved
    from public.usage_events
   where user_id = uid and request_id = p_request_id;
  if reserved is null then
    return;
  end if;

  update public.usage_events as ue
     set usage_units = greatest(p_final_units, 0),
         status = p_final_status,
         input_tokens = coalesce(p_input_tokens, ue.input_tokens),
         output_tokens = coalesce(p_output_tokens, ue.output_tokens)
   where ue.user_id = uid and ue.request_id = p_request_id;

  -- Devolve o que foi reservado e não usado (resposta curta, erro, cancelamento).
  update public.usage_windows
     set consumed_units = greatest(consumed_units - (reserved - greatest(p_final_units, 0)), 0),
         updated_at = now()
   where user_id = uid;
end;
$$;

create or replace function public.kazer_usage_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  plan_name text;
  quota record;
  win record;
begin
  if uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  plan_name := public.kazer_plan_of(uid);
  select * into quota from public.kazer_plan_quota(plan_name);
  select * into win from public.usage_windows where user_id = uid;
  return jsonb_build_object(
    'plan', plan_name,
    'allowance', quota.allowance,
    'consumed', case when win is null or win.reset_at <= now() then 0 else win.consumed_units end,
    'reset_at', case when win is null or win.reset_at <= now() then null else win.reset_at end,
    'renews_at', (select renews_at from public.kazer_plans where user_id = uid)
  );
end;
$$;

commit;
