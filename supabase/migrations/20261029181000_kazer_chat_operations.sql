-- KAZER: operações do chat como funções do banco.
--
-- Cada função confere `auth.uid()` e filtra por ele, então o backend não
-- consegue ler nem escrever conversa de outra conta nem por engano. As que
-- precisam ser atômicas (gravar pergunta + reservar resposta + debitar cota +
-- podar histórico) fazem tudo numa transação só, com trava de linha.
--
-- Retornos em JSON no mesmo formato que a interface já consome.

begin;

-- Busca de idempotência por conta (reenvio do mesmo pedido).
create index if not exists messages_user_client_idx
  on public.messages(user_id, client_id) where client_id is not null;

-- ---------------------------------------------------------------------------
-- Serialização
-- ---------------------------------------------------------------------------

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
    ), '[]'::jsonb)
  );
$$;

create or replace function public.kazer_conversation_json(c public.conversations)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', c.id,
    'title', coalesce(c.title, 'Nova conversa'),
    'created_at', extract(epoch from c.created_at)::bigint,
    'updated_at', extract(epoch from c.updated_at)::bigint
  );
$$;

-- ---------------------------------------------------------------------------
-- Conversas
-- ---------------------------------------------------------------------------

create or replace function public.kazer_conversations(
  p_limit integer default 30,
  p_before_updated timestamptz default null,
  p_before_id uuid default null,
  p_query text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  rows jsonb;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(public.kazer_conversation_json(c.*) order by c.updated_at desc, c.id desc), '[]'::jsonb)
    into rows
    from (
      select * from public.conversations c
       where c.user_id = uid
         and (p_before_updated is null
              or c.updated_at < p_before_updated
              or (c.updated_at = p_before_updated and c.id < p_before_id))
         and (p_query is null or p_query = ''
              or c.title ilike '%' || replace(replace(p_query, '%', '\%'), '_', '\_') || '%')
       order by c.updated_at desc, c.id desc
       limit greatest(least(p_limit, 100), 1)
    ) c;
  return rows;
end;
$$;

create or replace function public.kazer_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.conversations;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select * into row from public.conversations
   where id = p_conversation_id and user_id = uid;
  if not found then return null; end if;
  return public.kazer_conversation_json(row);
end;
$$;

create or replace function public.kazer_rename_conversation(
  p_conversation_id uuid,
  p_title text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.conversations;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  update public.conversations
     set title = left(p_title, 200)
   where id = p_conversation_id and user_id = uid
  returning * into row;
  if not found then return null; end if;
  return public.kazer_conversation_json(row);
end;
$$;

-- Apaga e devolve os caminhos dos anexos, para o backend removê-los do Storage.
create or replace function public.kazer_delete_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  paths text[];
  owns boolean;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  -- `found` é variável reservada do plpgsql: não reutilizar o nome aqui.
  select true into owns from public.conversations
   where id = p_conversation_id and user_id = uid;
  if owns is null then return null; end if;

  select coalesce(array_agg(a.storage_path), '{}') into paths
    from public.attachments a
    join public.messages m on m.id = a.message_id
   where m.conversation_id = p_conversation_id;

  delete from public.conversations where id = p_conversation_id and user_id = uid;
  return jsonb_build_object('storage_paths', to_jsonb(paths));
end;
$$;

create or replace function public.kazer_delete_all_conversations()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  paths text[];
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select coalesce(array_agg(a.storage_path), '{}') into paths
    from public.attachments a
    join public.messages m on m.id = a.message_id
    join public.conversations c on c.id = m.conversation_id
   where c.user_id = uid;
  delete from public.conversations where user_id = uid;
  return jsonb_build_object('storage_paths', to_jsonb(paths));
end;
$$;

-- ---------------------------------------------------------------------------
-- Mensagens
-- ---------------------------------------------------------------------------

create or replace function public.kazer_messages(
  p_conversation_id uuid,
  p_limit integer default 40,
  p_before_seq integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  owns boolean;
  page jsonb;
  taken integer;
  want integer := greatest(least(p_limit, 100), 1);
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select true into owns from public.conversations
   where id = p_conversation_id and user_id = uid;
  if owns is null then return null; end if;

  with picked as (
    select * from public.messages
     where conversation_id = p_conversation_id
       and (p_before_seq is null or seq < p_before_seq)
     order by seq desc
     limit want + 1
  ), kept as (
    select * from picked order by seq desc limit want
  )
  select coalesce(jsonb_agg(public.kazer_message_json(k.*) order by k.seq), '[]'::jsonb),
         (select count(*) from picked)
    into page, taken
    from kept k;

  return jsonb_build_object('items', page, 'has_more', taken > want);
end;
$$;

-- Histórico enviado ao modelo (a posse é checada pelo chamador do exchange).
create or replace function public.kazer_context_messages(
  p_conversation_id uuid,
  p_up_to_seq integer,
  p_limit integer default 60
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  owns boolean;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select true into owns from public.conversations
   where id = p_conversation_id and user_id = uid;
  if owns is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(public.kazer_message_json(m.*) order by m.seq)
      from (
        select * from public.messages
         where conversation_id = p_conversation_id and seq <= p_up_to_seq
         order by seq desc limit greatest(least(p_limit, 200), 1)
      ) m
  ), '[]'::jsonb);
end;
$$;

create or replace function public.kazer_message(p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.messages;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select m.* into row from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where m.id = p_message_id and c.user_id = uid;
  if not found then return null; end if;
  return public.kazer_message_json(row);
end;
$$;

-- ---------------------------------------------------------------------------
-- Envio: pergunta + resposta reservada + cota + poda, tudo numa transação
-- ---------------------------------------------------------------------------

create or replace function public.kazer_begin_exchange(
  p_conversation_id uuid,
  p_title text,
  p_content text,
  p_client_id text,
  p_attachment_ids uuid[],
  p_options jsonb,
  p_units numeric,
  p_model text default null,
  p_max_conversations integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing public.messages;
  reply public.messages;
  conv public.conversations;
  reservation jsonb;
  request_id uuid := gen_random_uuid();
  next_seq integer;
  attachment_count integer;
  pruned text[] := '{}';
  now_ts timestamptz := now();
  has_conv boolean := false;
  has_reply boolean := false;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  -- 1. Reenvio do mesmo pedido: devolve a troca original, sem cobrar de novo.
  select * into existing from public.messages
   where user_id = uid and client_id = p_client_id limit 1;
  if found then
    select * into reply from public.messages
     where conversation_id = existing.conversation_id and seq = existing.seq + 1;
    has_reply := found;
    select * into conv from public.conversations where id = existing.conversation_id;
    if has_reply and found then
      return jsonb_build_object(
        'duplicate', true,
        'conversation', public.kazer_conversation_json(conv),
        'message', public.kazer_message_json(existing),
        'reply', public.kazer_message_json(reply)
      );
    end if;
    conv := null;
  end if;

  -- 2. Conversa existente precisa ser desta conta (antes de gastar cota).
  if p_conversation_id is not null then
    select * into conv from public.conversations
     where id = p_conversation_id and user_id = uid for update;
    if not found then
      return jsonb_build_object('error', 'not_found');
    end if;
    has_conv := true;
  end if;

  -- 3. Anexos precisam ser desta conta e ainda não enviados.
  if p_attachment_ids is not null and array_length(p_attachment_ids, 1) > 0 then
    select count(*) into attachment_count from public.attachments
     where id = any(p_attachment_ids) and user_id = uid and message_id is null;
    if attachment_count <> array_length(p_attachment_ids, 1) then
      return jsonb_build_object('error', 'attachment_invalid');
    end if;
  end if;

  -- 4. Cota (atômica).
  reservation := public.kazer_reserve_usage(p_units, request_id, p_model);
  if not (reservation->>'allowed')::boolean then
    return jsonb_build_object('error', 'usage_limit', 'usage', reservation);
  end if;

  -- 5. Conversa nova: cria e poda o histórico além do teto.
  if not has_conv then
    insert into public.conversations (user_id, title, created_at, updated_at)
    values (uid, left(coalesce(nullif(p_title, ''), 'Nova conversa'), 200), now_ts, now_ts)
    returning * into conv;

    -- Sai a menos usada recentemente; `created_at` desempata conversas que
    -- tenham o mesmo `updated_at` (duas criadas na mesma transação).
    with extra as (
      select id from public.conversations
       where user_id = uid
         and id <> conv.id  -- a conversa que acabou de nascer nunca é podada
       order by updated_at desc, created_at desc, id desc
       offset greatest(p_max_conversations - 1, 1)
    ), paths as (
      select a.storage_path from public.attachments a
        join public.messages m on m.id = a.message_id
       where m.conversation_id in (select id from extra)
    ), gone as (
      delete from public.conversations where id in (select id from extra)
    )
    select coalesce(array_agg(storage_path), '{}') into pruned from paths;
    next_seq := 1;
  else
    select coalesce(max(seq), 0) + 1 into next_seq
      from public.messages where conversation_id = conv.id;
  end if;

  -- 6. Pergunta e resposta reservada.
  insert into public.messages
    (conversation_id, user_id, role, content, status, client_id, execution_metadata,
     model, seq, created_at, finished_at)
  values
    (conv.id, uid, 'user', p_content, 'complete', p_client_id, coalesce(p_options, '{}'::jsonb),
     p_model, next_seq, now_ts, now_ts)
  returning * into existing;

  insert into public.messages
    (conversation_id, user_id, role, content, status, execution_metadata, model, seq, created_at)
  values
    (conv.id, uid, 'assistant', '', 'streaming', coalesce(p_options, '{}'::jsonb),
     p_model, next_seq + 1, now_ts)
  returning * into reply;

  if p_attachment_ids is not null and array_length(p_attachment_ids, 1) > 0 then
    update public.attachments
       set message_id = existing.id, conversation_id = conv.id
     where id = any(p_attachment_ids) and user_id = uid;
  end if;

  update public.conversations set updated_at = now_ts where id = conv.id
  returning * into conv;

  return jsonb_build_object(
    'duplicate', false,
    'request_id', request_id,
    'conversation', public.kazer_conversation_json(conv),
    'message', public.kazer_message_json(existing),
    'reply', public.kazer_message_json(reply),
    'usage', reservation,
    'pruned_storage_paths', to_jsonb(pruned)
  );
end;
$$;

-- `p_user_id` vale só sem JWT (thread de geração com a chave de serviço); com
-- JWT o auth.uid() vence.
create or replace function public.kazer_update_reply(
  p_reply_id uuid,
  p_content text,
  p_thinking text,
  p_status text default null,
  p_error_code text default null,
  p_stop_reason text default null,
  p_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := coalesce(auth.uid(), p_user_id);
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if p_status is null then
    update public.messages
       set content = p_content, thinking = left(p_thinking, 20000)
     where id = p_reply_id and user_id = uid and status = 'streaming';
  else
    update public.messages
       set content = p_content,
           thinking = left(p_thinking, 20000),
           status = p_status,
           error_code = p_error_code,
           stop_reason = p_stop_reason,
           finished_at = now()
     where id = p_reply_id and user_id = uid;
  end if;
end;
$$;

create or replace function public.kazer_restart_reply(
  p_reply_id uuid,
  p_units numeric,
  p_model text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  reply public.messages;
  question public.messages;
  last_seq integer;
  reservation jsonb;
  request_id uuid := gen_random_uuid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  select m.* into reply from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where m.id = p_reply_id and c.user_id = uid
     and m.role = 'assistant' and m.status in ('error', 'stopped')
   for update of m;
  if not found then return null; end if;

  select max(seq) into last_seq from public.messages where conversation_id = reply.conversation_id;
  select * into question from public.messages
   where conversation_id = reply.conversation_id and seq = reply.seq - 1 and role = 'user';
  if not found or last_seq <> reply.seq then return null; end if;

  reservation := public.kazer_reserve_usage(p_units, request_id, p_model);
  if not (reservation->>'allowed')::boolean then
    return jsonb_build_object('error', 'usage_limit', 'usage', reservation);
  end if;

  update public.messages
     set content = '', thinking = null, status = 'streaming',
         error_code = null, stop_reason = null, finished_at = null, created_at = now()
   where id = p_reply_id
  returning * into reply;
  update public.conversations set updated_at = now() where id = reply.conversation_id;

  return jsonb_build_object(
    'request_id', request_id,
    'question', public.kazer_message_json(question),
    'reply', public.kazer_message_json(reply),
    'usage', reservation
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Anexos, preferências, memórias e limpeza
-- ---------------------------------------------------------------------------

create or replace function public.kazer_create_attachment(
  p_kind text, p_media_type text, p_name text, p_size bigint, p_storage_path text,
  p_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.attachments;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  insert into public.attachments
    (id, user_id, conversation_id, message_id, storage_path, mime_type, size_bytes, kind, name)
  values (coalesce(p_id, gen_random_uuid()), uid, null, null, p_storage_path,
          p_media_type, p_size, p_kind, left(p_name, 200))
  returning * into row;
  return jsonb_build_object('id', row.id, 'kind', row.kind, 'media_type', row.mime_type,
                            'name', row.name, 'size', row.size_bytes,
                            'storage_path', row.storage_path);
end;
$$;

create or replace function public.kazer_attachment(p_attachment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.attachments;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select * into row from public.attachments where id = p_attachment_id and user_id = uid;
  if not found then return null; end if;
  return jsonb_build_object('id', row.id, 'kind', row.kind, 'media_type', row.mime_type,
                            'name', row.name, 'size', row.size_bytes,
                            'storage_path', row.storage_path,
                            'message_id', row.message_id);
end;
$$;

create or replace function public.kazer_discard_attachment(p_attachment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.attachments;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  delete from public.attachments
   where id = p_attachment_id and user_id = uid and message_id is null
  returning * into row;
  if not found then return null; end if;
  return jsonb_build_object('storage_path', row.storage_path);
end;
$$;

create or replace function public.kazer_storage_used()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  used bigint;
  pending integer;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select coalesce(sum(size_bytes), 0), coalesce(count(*) filter (where message_id is null), 0)
    into used, pending from public.attachments where user_id = uid;
  return jsonb_build_object('used', used, 'pending', pending);
end;
$$;

create or replace function public.kazer_get_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return coalesce((select data from public.kazer_preferences where user_id = uid), '{}'::jsonb);
end;
$$;

create or replace function public.kazer_save_preferences(p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  insert into public.kazer_preferences (user_id, data, updated_at)
  values (uid, p_data, now())
  on conflict (user_id) do update set data = excluded.data, updated_at = excluded.updated_at;
end;
$$;

create or replace function public.kazer_list_memories()
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
    select jsonb_agg(jsonb_build_object('id', id, 'content', content,
                                        'created_at', extract(epoch from created_at)::bigint)
                     order by created_at, id)
      from public.kazer_memories where user_id = uid
  ), '[]'::jsonb);
end;
$$;

create or replace function public.kazer_add_memory(p_content text, p_max integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  total integer;
  row public.kazer_memories;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select count(*) into total from public.kazer_memories where user_id = uid;
  if total >= p_max then return null; end if;
  insert into public.kazer_memories (user_id, content) values (uid, p_content)
  returning * into row;
  return jsonb_build_object('id', row.id, 'content', row.content,
                            'created_at', extract(epoch from row.created_at)::bigint);
end;
$$;

create or replace function public.kazer_delete_memory(p_memory_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); gone integer;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  delete from public.kazer_memories where id = p_memory_id and user_id = uid;
  get diagnostics gone = row_count;
  return gone = 1;
end;
$$;

create or replace function public.kazer_clear_memories()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  delete from public.kazer_memories where user_id = uid;
end;
$$;

-- Retenção: anexos enviados e nunca usados, e eventos de uso antigos.
create or replace function public.kazer_purge(
  p_orphan_hours integer default 24,
  p_usage_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  paths text[];
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  with gone as (
    delete from public.attachments
     where user_id = uid and message_id is null
       and created_at < now() - make_interval(hours => p_orphan_hours)
    returning storage_path
  )
  select coalesce(array_agg(storage_path), '{}') into paths from gone;
  delete from public.usage_events
   where user_id = uid and created_at < now() - make_interval(days => p_usage_days);
  return jsonb_build_object('storage_paths', to_jsonb(paths));
end;
$$;

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
    'preferences', coalesce((select data from public.kazer_preferences where user_id = uid), '{}'::jsonb)
  );
end;
$$;

create or replace function public.kazer_find_exchange(p_client_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  question public.messages;
  reply public.messages;
  conv public.conversations;
  has_reply boolean;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select * into question from public.messages
   where user_id = uid and client_id = p_client_id limit 1;
  if not found then return null; end if;
  select * into reply from public.messages
   where conversation_id = question.conversation_id and seq = question.seq + 1;
  has_reply := found;
  select * into conv from public.conversations where id = question.conversation_id;
  if not has_reply or not found then return null; end if;
  return jsonb_build_object(
    'duplicate', true,
    'conversation', public.kazer_conversation_json(conv),
    'message', public.kazer_message_json(question),
    'reply', public.kazer_message_json(reply)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Armazenamento privado dos anexos (só existe num projeto Supabase real)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public)
    values ('kazer-anexos', 'kazer-anexos', false)
    on conflict (id) do nothing;

    execute $pol$drop policy if exists kazer_anexos_own on storage.objects$pol$;
    -- Cada conta só alcança a própria pasta: kazer-anexos/<user_id>/<id>.
    execute $pol$
      create policy kazer_anexos_own on storage.objects
        for all to authenticated
        using (bucket_id = 'kazer-anexos'
               and (storage.foldername(name))[1] = (select auth.uid())::text)
        with check (bucket_id = 'kazer-anexos'
               and (storage.foldername(name))[1] = (select auth.uid())::text)
    $pol$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Permissões: só o papel autenticado executa, e sempre em nome de si mesmo.
-- ---------------------------------------------------------------------------

do $$
declare fn text;
begin
  for fn in
    select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'kazer\_%'
  loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;

-- A provisão de uso continua restrita ao backend confiável.
revoke all on function public.kazer_provision_usage(uuid) from public, anon, authenticated;
grant execute on function public.kazer_provision_usage(uuid) to service_role;

commit;
