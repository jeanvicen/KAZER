-- KAZER: a Biblioteca.
--
-- Reúne num lugar só o que a pessoa enviou (fotos, documentos, arquivos) e o
-- que o KAZER produziu (artefatos). A tabela `kazer_artifacts` já nasceu na
-- migração 20261029180000; aqui entram as operações.
--
-- Aditiva: só cria funções novas. Nenhuma tabela, política, dado ou migração
-- anterior é alterada.
--
-- Reversão: ver docs/supabase-chat-storage.md (basta remover as funções).

begin;

-- Paginação da biblioteca sem varrer a conta inteira.
create index if not exists attachments_user_sent_idx
  on public.attachments(user_id, created_at desc, id desc)
  where message_id is not null;

-- ---------------------------------------------------------------------------
-- Artefatos
-- ---------------------------------------------------------------------------

create or replace function public.kazer_artifact_json(a public.kazer_artifacts, with_body boolean)
returns jsonb
language sql
stable
as $$
  select jsonb_strip_nulls(
    jsonb_build_object(
      'id', a.id,
      'source', 'kazer',
      'kind', a.kind,
      'title', a.title,
      'language', coalesce(a.language, ''),
      'size', char_length(a.content),
      'conversation_id', a.conversation_id,
      'message_id', a.message_id,
      'created_at', extract(epoch from a.created_at)::bigint
    )
    || case when with_body then jsonb_build_object('content', a.content) else '{}'::jsonb end
  );
$$;

-- Grava os artefatos de uma resposta. Gerar a resposta de novo troca os
-- artefatos dela: os antigos saem na mesma transação.
--
-- `p_user_id` existe porque a gravação acontece na thread da geração, que pode
-- estar com o token vencido; o `coalesce` garante que o JWT ganha quando existe.
create or replace function public.kazer_save_artifacts(
  p_conversation_id uuid,
  p_message_id uuid,
  p_items jsonb,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := coalesce(auth.uid(), p_user_id);
  owns boolean;
  saved jsonb;
begin
  if uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select true into owns
    from public.messages m
   where m.id = p_message_id and m.user_id = uid;
  if not found then
    return '[]'::jsonb;
  end if;

  delete from public.kazer_artifacts where message_id = p_message_id and user_id = uid;

  with novos as (
    insert into public.kazer_artifacts
      (user_id, conversation_id, message_id, kind, title, language, content)
    select
      uid,
      p_conversation_id,
      p_message_id,
      item->>'kind',
      item->>'title',
      nullif(item->>'language', ''),
      item->>'content'
    from jsonb_array_elements(p_items) as item
    returning *
  )
  select coalesce(jsonb_agg(public.kazer_artifact_json(novos, false) order by novos.created_at), '[]'::jsonb)
    into saved
    from novos;

  return saved;
end;
$$;

create or replace function public.kazer_artifact(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  art public.kazer_artifacts;
begin
  if uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  select * into art from public.kazer_artifacts where id = p_id and user_id = uid;
  if not found then
    return null;
  end if;
  return public.kazer_artifact_json(art, true);
end;
$$;

create or replace function public.kazer_delete_artifact(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  delete from public.kazer_artifacts where id = p_id and user_id = uid;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- A biblioteca em si
-- ---------------------------------------------------------------------------

-- Junta as duas origens numa ordenação só (mais recente primeiro). A paginação
-- usa `(created_at, id)`, então dois itens nascidos no mesmo instante não se
-- escondem nem se repetem.
create or replace function public.kazer_library(
  p_kind text,
  p_limit integer,
  p_before_at bigint default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cut timestamptz := case when p_before_at is null then null
                          else to_timestamp(p_before_at) end;
  rows jsonb;
begin
  if uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  with enviados as (
    select
      a.created_at,
      a.id,
      jsonb_build_object(
        'id', a.id,
        'source', 'pessoa',
        'kind', a.kind,
        'media_type', a.mime_type,
        'name', coalesce(a.name, ''),
        'title', coalesce(a.name, ''),
        'size', a.size_bytes,
        'message_id', a.message_id,
        'created_at', extract(epoch from a.created_at)::bigint
      ) as item
    from public.attachments a
    where a.user_id = uid
      and a.message_id is not null
      and (
        p_kind = 'tudo'
        or (p_kind = 'imagem' and a.kind = 'image')
        or (p_kind = 'documento' and a.kind in ('text', 'pdf'))
      )
      and (cut is null or (a.created_at, a.id) < (cut, p_before_id))
    order by a.created_at desc, a.id desc
    limit p_limit
  ),
  feitos as (
    select
      k.created_at,
      k.id,
      public.kazer_artifact_json(k, false) as item
    from public.kazer_artifacts k
    where k.user_id = uid
      and p_kind in ('tudo', 'artefato')
      and (cut is null or (k.created_at, k.id) < (cut, p_before_id))
    order by k.created_at desc, k.id desc
    limit p_limit
  ),
  tudo as (
    select * from enviados
    union all
    select * from feitos
  )
  select coalesce(jsonb_agg(item order by created_at desc, id desc), '[]'::jsonb)
    into rows
    from (select * from tudo order by created_at desc, id desc limit p_limit) as pagina;

  return rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- A mensagem passa a dizer o que rendeu, para a faixa sobreviver ao recarregar
-- ---------------------------------------------------------------------------

-- Substitui a versão de 20261029181000 acrescentando 'artifacts' (sem o
-- conteúdo: a listagem não precisa dele). O resto do corpo é idêntico.
create or replace function public.kazer_message_json(m public.messages)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', m.id,
    'conversation_id', m.conversation_id,
    'seq', m.seq,
    'role', m.role,
    'content', m.content,
    'thinking', coalesce(m.thinking, ''),
    'status', m.status,
    'error', m.error_code,
    'stop', m.stop_reason,
    'options', coalesce(m.execution_metadata, '{}'::jsonb),
    'created_at', extract(epoch from m.created_at)::bigint,
    'finished_at', case when m.finished_at is null then null
                        else extract(epoch from m.finished_at)::bigint end,
    'attachments', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', a.id, 'kind', a.kind, 'media_type', a.mime_type,
                                  'name', a.name, 'size', a.size_bytes)
               order by a.created_at, a.id)
        from public.attachments a where a.message_id = m.id
    ), '[]'::jsonb),
    'artifacts', coalesce((
      select jsonb_agg(public.kazer_artifact_json(k, false) order by k.created_at, k.id)
        from public.kazer_artifacts k where k.message_id = m.id
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Exportação: portabilidade é de tudo, então os artefatos entram junto
-- ---------------------------------------------------------------------------

-- Substitui a versão de 20261029181000 acrescentando 'artifacts'. O resto do
-- corpo é idêntico.
create or replace function public.kazer_export()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return jsonb_build_object(
    'conversations', coalesce((
      select jsonb_agg(
        public.kazer_conversation_json(c.*) || jsonb_build_object('messages', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'role', m.role, 'content', m.content, 'status', m.status,
                   'created_at', extract(epoch from m.created_at)::bigint,
                   'attachments', coalesce((
                     select jsonb_agg(jsonb_build_object('name', a.name, 'media_type', a.mime_type,
                                                         'size', a.size_bytes))
                       from public.attachments a where a.message_id = m.id), '[]'::jsonb))
                 order by m.seq)
            from public.messages m where m.conversation_id = c.id), '[]'::jsonb))
        order by c.created_at)
        from public.conversations c where c.user_id = uid), '[]'::jsonb),
    'memories', coalesce((
      select jsonb_agg(jsonb_build_object('content', content,
                                          'created_at', extract(epoch from created_at)::bigint)
                       order by created_at)
        from public.kazer_memories where user_id = uid), '[]'::jsonb),
    'artifacts', coalesce((
      select jsonb_agg(public.kazer_artifact_json(k, true) order by k.created_at)
        from public.kazer_artifacts k where k.user_id = uid), '[]'::jsonb),
    'preferences', coalesce((select data from public.kazer_preferences where user_id = uid), '{}'::jsonb)
  );
end;
$$;

-- Mesmos grants das demais funções do chat.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'kazer_artifact_json', 'kazer_save_artifacts', 'kazer_artifact',
         'kazer_delete_artifact', 'kazer_library', 'kazer_export', 'kazer_message_json'
       )
  loop
    execute format('grant execute on function %s to authenticated, service_role', fn.sig);
  end loop;
end $$;

commit;
