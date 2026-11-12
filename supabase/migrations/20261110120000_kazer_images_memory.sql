-- KAZER: criação de imagens (cota diária atômica) e memória com procedência.
-- Migração ADITIVA: só cria tabelas/funções e acrescenta colunas.
--
-- 1. kazer_image_usage + kazer_image_jobs: reservar → gerar → concluir.
--    A linha (conta, dia) é travada com FOR UPDATE: duas requisições simultâneas
--    nunca reservam a mesma vaga. Chave de idempotência única por conta.
-- 2. kazer_memories: origem (manual/auto), conversa de origem, confiança e
--    data de atualização; funções para salvar com procedência e editar.
--
-- Histórico: uma versão anterior deste arquivo também criava `kazer_designs`
-- (projetos de um editor gráfico que saiu do produto). Se ela chegou a ser
-- aplicada em algum banco, a tabela ficou sem uso e pode sair com o trecho
-- "Limpeza opcional" no fim do arquivo.
--
-- Reversão (sem perda de dados anteriores): ver o fim do arquivo.

begin;

-- ---------------------------------------------------------------------------
-- 1. Imagens
-- ---------------------------------------------------------------------------

create table if not exists public.kazer_image_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  succeeded integer not null default 0 check (succeeded >= 0),
  primary key (user_id, day)
);

create table if not exists public.kazer_image_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  day date not null,
  status text not null check (status in ('reserved', 'succeeded', 'failed')),
  prompt text not null check (char_length(prompt) <= 800),
  width integer not null check (width between 64 and 4096),
  height integer not null check (height between 64 and 4096),
  provider text not null default '',
  error_code text,
  media_type text check (media_type in ('image/png', 'image/jpeg', 'image/webp')),
  size integer not null default 0 check (size >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (user_id, idempotency_key)
);

create index if not exists kazer_image_jobs_user_day_idx
  on public.kazer_image_jobs(user_id, day, status);
create index if not exists kazer_image_jobs_user_created_idx
  on public.kazer_image_jobs(user_id, created_at desc);

alter table public.kazer_image_usage enable row level security;
alter table public.kazer_image_jobs enable row level security;

revoke all on table public.kazer_image_usage, public.kazer_image_jobs from public, anon, authenticated;
-- Leitura direta só do que é da própria conta; toda escrita passa pelas funções.
grant select on table public.kazer_image_usage, public.kazer_image_jobs to authenticated;

drop policy if exists kazer_image_usage_read_own on public.kazer_image_usage;
create policy kazer_image_usage_read_own on public.kazer_image_usage
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists kazer_image_jobs_read_own on public.kazer_image_jobs;
create policy kazer_image_jobs_read_own on public.kazer_image_jobs
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.kazer_image_job_json(job public.kazer_image_jobs)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', job.id, 'user_id', job.user_id, 'idempotency_key', job.idempotency_key,
    'day', job.day, 'status', job.status, 'prompt', job.prompt,
    'width', job.width, 'height', job.height, 'provider', job.provider,
    'error_code', job.error_code, 'media_type', job.media_type, 'size', job.size,
    'created_at', extract(epoch from job.created_at)::bigint,
    'finished_at', extract(epoch from job.finished_at)::bigint);
$$;

-- Reservas que ninguém concluiu (função que morreu no meio) viram falha e liberam a vaga.
create or replace function public.kazer_image_expire(p_uid uuid, p_stale_seconds integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.kazer_image_jobs
     set status = 'failed', error_code = 'image_stale', finished_at = now(), updated_at = now()
   where user_id = p_uid and status = 'reserved'
     and updated_at < now() - make_interval(secs => greatest(p_stale_seconds, 30));
$$;

create or replace function public.kazer_image_usage_today(p_stale_seconds integer default 600)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  done integer;
  active integer;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  perform public.kazer_image_expire(uid, p_stale_seconds);
  select coalesce((select succeeded from public.kazer_image_usage
                    where user_id = uid and day = today), 0) into done;
  select count(*) into active from public.kazer_image_jobs
   where user_id = uid and day = today and status = 'reserved';
  return jsonb_build_object('succeeded', done, 'active', active);
end;
$$;

-- Reserva uma vaga do dia (UTC). Devolve {job, replayed, reason}.
-- reason: '' (reservou), 'quota' (dia usado), 'busy' (há pedido em andamento).
create or replace function public.kazer_image_reserve(
  p_key text,
  p_prompt text,
  p_width integer,
  p_height integer,
  p_limit integer,
  p_stale_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  -- O limite vem do servidor (configuração central dos planos). O teto aqui é só
  -- uma trava a mais: chamar a função direto nunca gera imagem, apenas a reserva.
  allowed integer := least(greatest(coalesce(p_limit, 0), 0), 50);
  done integer;
  active integer;
  job public.kazer_image_jobs;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  -- Uma operação de imagem por conta de cada vez (reservar e concluir usam a mesma
  -- trava): sem corrida e sem deadlock entre as duas funções.
  perform pg_advisory_xact_lock(hashtextextended('kazer_images:' || uid::text, 0));

  select * into job from public.kazer_image_jobs
   where user_id = uid and idempotency_key = p_key;
  if found then
    return jsonb_build_object('job', public.kazer_image_job_json(job), 'replayed', true, 'reason', '');
  end if;

  insert into public.kazer_image_usage (user_id, day) values (uid, today)
  on conflict (user_id, day) do nothing;
  -- Trava da conta para o dia: serializa pedidos simultâneos.
  select succeeded into done from public.kazer_image_usage
   where user_id = uid and day = today for update;

  perform public.kazer_image_expire(uid, p_stale_seconds);
  select count(*) into active from public.kazer_image_jobs
   where user_id = uid and day = today and status = 'reserved';

  if done >= allowed then
    return jsonb_build_object('job', null, 'replayed', false, 'reason', 'quota');
  end if;
  if done + active >= allowed then
    return jsonb_build_object('job', null, 'replayed', false, 'reason', 'busy');
  end if;

  insert into public.kazer_image_jobs (user_id, idempotency_key, day, status, prompt, width, height)
  values (uid, p_key, today, 'reserved', p_prompt, p_width, p_height)
  returning * into job;
  return jsonb_build_object('job', public.kazer_image_job_json(job), 'replayed', false, 'reason', '');
end;
$$;

-- Conclui um pedido reservado exatamente uma vez. Sucesso conta no dia; falha não.
create or replace function public.kazer_image_finish(
  p_id uuid,
  p_ok boolean,
  p_provider text default '',
  p_error text default null,
  p_media_type text default null,
  p_size integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  job public.kazer_image_jobs;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kazer_images:' || uid::text, 0));
  update public.kazer_image_jobs
     set status = case when p_ok then 'succeeded' else 'failed' end,
         provider = left(coalesce(p_provider, ''), 40),
         error_code = case when p_ok then null else left(coalesce(p_error, 'image_failed'), 40) end,
         media_type = case when p_ok then p_media_type else null end,
         size = case when p_ok then greatest(coalesce(p_size, 0), 0) else 0 end,
         finished_at = now(), updated_at = now()
   where id = p_id and user_id = uid and status = 'reserved'
  returning * into job;
  if not found then return null; end if;
  if p_ok then
    insert into public.kazer_image_usage (user_id, day, succeeded) values (uid, job.day, 1)
    on conflict (user_id, day) do update set succeeded = public.kazer_image_usage.succeeded + 1;
  end if;
  return public.kazer_image_job_json(job);
end;
$$;

create or replace function public.kazer_images(p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(public.kazer_image_job_json(j) order by j.created_at desc, j.id)
      from (select * from public.kazer_image_jobs
             where user_id = uid and status = 'succeeded' and media_type is not null
             order by created_at desc, id limit least(greatest(p_limit, 1), 100)) j
  ), '[]'::jsonb);
end;
$$;

create or replace function public.kazer_image(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid(); job public.kazer_image_jobs;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select * into job from public.kazer_image_jobs where id = p_id and user_id = uid;
  if not found then return null; end if;
  return public.kazer_image_job_json(job);
end;
$$;

-- Tira a imagem da galeria. A linha fica: o dia usado continua contado.
create or replace function public.kazer_delete_image(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid(); gone integer;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  update public.kazer_image_jobs
     set prompt = '', media_type = null, size = 0, error_code = 'deleted'
   where id = p_id and user_id = uid and status = 'succeeded' and media_type is not null;
  get diagnostics gone = row_count;
  return gone = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Memória com procedência
-- ---------------------------------------------------------------------------

alter table public.kazer_memories
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'auto')),
  add column if not exists conversation_id uuid,
  add column if not exists confidence real not null default 1.0
    check (confidence between 0 and 1),
  add column if not exists updated_at timestamptz;

create or replace function public.kazer_memory_json(m public.kazer_memories)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'content', m.content,
    'created_at', extract(epoch from m.created_at)::bigint,
    'source', m.source, 'conversation_id', m.conversation_id, 'confidence', m.confidence,
    'updated_at', extract(epoch from m.updated_at)::bigint);
$$;

create or replace function public.kazer_list_memories()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(public.kazer_memory_json(m) order by m.created_at, m.id)
      from public.kazer_memories m where m.user_id = uid
  ), '[]'::jsonb);
end;
$$;

create or replace function public.kazer_save_memory(
  p_content text,
  p_max integer default 100,
  p_source text default 'manual',
  p_conversation_id uuid default null,
  p_confidence real default 1.0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid(); total integer; m public.kazer_memories;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kazer_memories:' || uid::text, 0));
  select count(*) into total from public.kazer_memories where user_id = uid;
  if total >= p_max then return null; end if;
  insert into public.kazer_memories (user_id, content, source, conversation_id, confidence, updated_at)
  values (uid, p_content, case when p_source = 'auto' then 'auto' else 'manual' end,
          p_conversation_id, least(greatest(coalesce(p_confidence, 1.0), 0), 1), now())
  returning * into m;
  return public.kazer_memory_json(m);
end;
$$;

create or replace function public.kazer_update_memory(
  p_memory_id uuid,
  p_content text,
  p_source text default null,
  p_conversation_id uuid default null,
  p_confidence real default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid(); m public.kazer_memories;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  update public.kazer_memories
     set content = p_content, updated_at = now(),
         source = case when p_source in ('manual', 'auto') then p_source else source end,
         conversation_id = coalesce(p_conversation_id, conversation_id),
         confidence = coalesce(least(greatest(p_confidence, 0), 1), confidence)
   where id = p_memory_id and user_id = uid
  returning * into m;
  if not found then return null; end if;
  return public.kazer_memory_json(m);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões: nada para public/anon; contas autenticadas e o servidor.
-- ---------------------------------------------------------------------------

do $$
declare fn text;
begin
  foreach fn in array array[
    'kazer_image_usage_today(integer)',
    'kazer_image_reserve(text, text, integer, integer, integer, integer)',
    'kazer_image_finish(uuid, boolean, text, text, text, integer)',
    'kazer_images(integer)',
    'kazer_image(uuid)',
    'kazer_delete_image(uuid)',
    'kazer_list_memories()',
    'kazer_save_memory(text, integer, text, uuid, real)',
    'kazer_update_memory(uuid, text, text, uuid, real)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
  -- Auxiliares: só as funções acima chamam.
  foreach fn in array array[
    'kazer_image_expire(uuid, integer)',
    'kazer_image_job_json(public.kazer_image_jobs)',
    'kazer_memory_json(public.kazer_memories)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
  end loop;
end $$;

commit;

-- Reversão manual (apaga só o que esta migração criou):
--   drop function if exists public.kazer_image_usage_today, public.kazer_image_reserve,
--     public.kazer_image_finish, public.kazer_images, public.kazer_image,
--     public.kazer_delete_image, public.kazer_image_expire, public.kazer_image_job_json,
--     public.kazer_save_memory, public.kazer_update_memory;
--   drop table if exists public.kazer_image_jobs, public.kazer_image_usage;
--   -- kazer_list_memories volta à versão de 20261029181000; as colunas novas de
--   -- kazer_memories podem ficar (têm padrão) ou sair com `alter table ... drop column`.
--
-- Limpeza opcional (só se a versão antiga deste arquivo foi aplicada; confira antes
-- que a tabela está vazia ou que ninguém precisa dos projetos):
--   drop function if exists public.kazer_designs, public.kazer_design,
--     public.kazer_save_design, public.kazer_delete_design, public.kazer_design_json;
--   drop table if exists public.kazer_designs;
