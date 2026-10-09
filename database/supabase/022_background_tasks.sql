-- KAZER: durable, user-scoped background task queue.
-- Additive only. Review and apply through the approved Supabase migration process.
begin;

create table if not exists public.kazer_background_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text,
  message_id text,
  task_type text not null check (task_type in ('chat_response','web_search','document_analysis','file_processing','image_generation','report_generation','computer_agent','upload_processing','other')),
  input_payload jsonb not null,
  input_preview text not null default '',
  status text not null default 'queued' check (status in ('queued','running','streaming','waiting_confirmation','completed','failed','paused','cancelled')),
  stage text,
  progress integer check (progress between 0 and 100),
  partial_result jsonb,
  result jsonb,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  usage_snapshot jsonb,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 128),
  retry_count integer not null default 0 check (retry_count between 0 and 10),
  locked_by text,
  lease_until timestamptz,
  last_client_seen_at timestamptz,
  notification_sent_at timestamptz,
  notification_attempted_at timestamptz,
  notification_claimed_by text,
  notification_lease_until timestamptz,
  result_viewed_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, idempotency_key)
);

create index if not exists kazer_background_tasks_user_created_idx
  on public.kazer_background_tasks (user_id, created_at desc);
create index if not exists kazer_background_tasks_queue_idx
  on public.kazer_background_tasks (status, created_at)
  where status in ('queued','running');
create index if not exists kazer_background_tasks_user_status_idx
  on public.kazer_background_tasks (user_id, status, updated_at desc);

create table if not exists public.kazer_background_task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.kazer_background_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('created','started','progress','paused','resumed','confirmation_required','confirmed','declined','failed','retried','completed','cancelled','viewed')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists kazer_background_task_events_task_idx
  on public.kazer_background_task_events (task_id, created_at);

create table if not exists public.kazer_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text,
  auth_secret text,
  platform text not null default 'web' check (platform in ('web','android','ios')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists kazer_push_subscriptions_user_idx
  on public.kazer_push_subscriptions (user_id, updated_at desc);

alter table public.kazer_background_tasks enable row level security;
alter table public.kazer_background_tasks force row level security;
alter table public.kazer_background_task_events enable row level security;
alter table public.kazer_background_task_events force row level security;
alter table public.kazer_push_subscriptions enable row level security;
alter table public.kazer_push_subscriptions force row level security;
revoke all on public.kazer_background_tasks from public, anon, authenticated;
revoke all on public.kazer_background_task_events from public, anon, authenticated;
revoke all on public.kazer_push_subscriptions from public, anon, authenticated;

grant select, insert, update, delete on public.kazer_background_tasks to service_role;
grant select, insert on public.kazer_background_task_events to service_role;
grant select, insert, update, delete on public.kazer_push_subscriptions to service_role;
grant usage, select on sequence public.kazer_background_task_events_id_seq to service_role;

create or replace function public.kazer_enqueue_background_task(
  p_task_type text,
  p_input_payload jsonb,
  p_idempotency_key text,
  p_conversation_id text default null,
  p_message_id text default null,
  p_attachment_count integer default 0,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.kazer_background_tasks;
  v_task public.kazer_background_tasks;
  v_usage jsonb;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_task_type not in ('chat_response','web_search','document_analysis','file_processing','image_generation','report_generation','computer_agent','upload_processing','other') then
    raise exception 'invalid_task_type' using errcode = '22023';
  end if;
  if p_input_payload is null or pg_column_size(p_input_payload) > 7340032 then
    raise exception 'task_payload_too_large' using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128 then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;
  if coalesce(p_attachment_count, 0) < 0 or coalesce(p_attachment_count, 0) > 10 then
    raise exception 'invalid_attachment_count' using errcode = '22023';
  end if;

  select * into v_existing from public.kazer_background_tasks
   where user_id = v_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('task', to_jsonb(v_existing), 'created', false);
  end if;

  select to_jsonb(u) into v_usage
    from public.consume_kazer_usage(1, coalesce(p_attachment_count, 0)) as u;

  insert into public.kazer_background_tasks (
    user_id, conversation_id, message_id, task_type, input_payload, input_preview,
    idempotency_key, metadata, usage_snapshot, last_client_seen_at
  ) values (
    v_user_id,
    nullif(left(coalesce(p_conversation_id, ''), 128), ''),
    nullif(left(coalesce(p_message_id, ''), 128), ''),
    p_task_type,
    p_input_payload,
    left(coalesce(
      (select item->>'content'
       from jsonb_array_elements(case when jsonb_typeof(p_input_payload->'messages') = 'array' then p_input_payload->'messages' else '[]'::jsonb end) with ordinality as entries(item, position)
       where item->>'role' = 'user' order by position desc limit 1),
      p_input_payload->>'question', p_input_payload->>'query', p_input_payload->>'prompt', ''
    ), 400),
    p_idempotency_key,
    case when jsonb_typeof(p_metadata) = 'object' then p_metadata else '{}'::jsonb end,
    v_usage,
    now()
  ) returning * into v_task;

  insert into public.kazer_background_task_events (task_id, user_id, event_type)
  values (v_task.id, v_user_id, 'created');
  return jsonb_build_object('task', to_jsonb(v_task), 'created', true);
exception when unique_violation then
  select * into v_existing from public.kazer_background_tasks
   where user_id = auth.uid() and idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('task', to_jsonb(v_existing), 'created', false); end if;
  raise;
end;
$$;

create or replace function public.kazer_claim_background_task(p_worker_id text, p_lease_seconds integer default 180)
returns setof public.kazer_background_tasks
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_worker_id is null or char_length(p_worker_id) not between 1 and 120 then
    raise exception 'invalid_worker_id' using errcode = '22023';
  end if;

  -- A lease expiry is ambiguous: the provider may already have completed the work.
  -- Mark it failed and require an explicit user retry instead of executing it twice.
  with expired as (
    update public.kazer_background_tasks
       set status = 'failed', stage = 'worker_lost',
           error = 'O worker foi interrompido. A tarefa não foi repetida automaticamente para evitar duplicação.',
           completed_at = now(), updated_at = now(), locked_by = null, lease_until = null
     where status = 'running' and lease_until < now()
     returning id, user_id
  )
  insert into public.kazer_background_task_events (task_id, user_id, event_type, detail)
  select id, user_id, 'failed', jsonb_build_object('reason', 'worker_lease_expired', 'automatic_retry', false)
    from expired;

  return query
    with candidate as (
      select id from public.kazer_background_tasks
      where status = 'queued'
      order by created_at
      for update skip locked
      limit 1
    )
    update public.kazer_background_tasks t
       set status = 'running',
           started_at = coalesce(t.started_at, now()),
           retry_count = t.retry_count + 1,
           stage = coalesce(t.stage, 'processing'),
           locked_by = p_worker_id,
           lease_until = now() + make_interval(secs => greatest(30, least(600, coalesce(p_lease_seconds, 180)))),
           updated_at = now()
      from candidate c where t.id = c.id
      returning t.*;
end;
$$;

create or replace function public.kazer_claim_background_notification(p_worker_id text, p_lease_seconds integer default 120)
returns setof public.kazer_background_tasks
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_worker_id is null or char_length(p_worker_id) not between 1 and 120 then
    raise exception 'invalid_worker_id' using errcode = '22023';
  end if;
  return query
    with candidate as (
      select id from public.kazer_background_tasks
      where status in ('completed','failed','waiting_confirmation')
        and notification_sent_at is null
        and created_at < now() - interval '10 seconds'
        and (last_client_seen_at is null or last_client_seen_at < now() - interval '25 seconds')
        and (notification_lease_until is null or notification_lease_until < now())
        and result_viewed_at is null
        and exists (select 1 from public.kazer_push_subscriptions ps where ps.user_id = kazer_background_tasks.user_id)
      order by coalesce(completed_at, updated_at), created_at
      for update skip locked
      limit 1
    )
    update public.kazer_background_tasks t
       set notification_claimed_by = p_worker_id,
           notification_attempted_at = now(),
           notification_lease_until = now() + make_interval(secs => greatest(30, least(600, coalesce(p_lease_seconds, 120))))
      from candidate c where t.id = c.id
      returning t.*;
end;
$$;


create or replace function public.kazer_purge_background_tasks(p_retention_days integer default 7)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint;
begin
  delete from public.kazer_background_tasks
   where created_at < now() - make_interval(days => greatest(1, least(30, coalesce(p_retention_days, 7))));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.kazer_enqueue_background_task(text,jsonb,text,text,text,integer,jsonb) from public, anon;
grant execute on function public.kazer_enqueue_background_task(text,jsonb,text,text,text,integer,jsonb) to authenticated;
revoke all on function public.kazer_claim_background_task(text,integer) from public, anon, authenticated;
grant execute on function public.kazer_claim_background_task(text,integer) to service_role;
revoke all on function public.kazer_claim_background_notification(text,integer) from public, anon, authenticated;
grant execute on function public.kazer_claim_background_notification(text,integer) to service_role;
revoke all on function public.kazer_purge_background_tasks(integer) from public, anon, authenticated;
grant execute on function public.kazer_purge_background_tasks(integer) to service_role;

comment on table public.kazer_background_tasks is 'Durable queue and result store for user-scoped KAZER tasks; worker-only storage with idempotent enqueue. Task inputs can contain private attachments and must be cleared after success and purged within seven days by the worker.';
comment on table public.kazer_background_task_events is 'Append-only lifecycle history for KAZER background tasks.';
comment on table public.kazer_push_subscriptions is 'Push destinations registered by authenticated KAZER users; accessed only by server APIs.';

commit;
