-- KAZER foundation: Supabase-backed application data, lifecycle and usage accounting.
-- Safe to apply after the existing public tables have been created.

begin;

alter table public.profiles
  add column if not exists last_valid_activity_at timestamptz;

update public.profiles
set last_valid_activity_at = coalesce(last_valid_activity_at, created_at, now())
where last_valid_activity_at is null;

alter table public.profiles
  alter column last_valid_activity_at set default now();

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null check (char_length(content) <= 200000),
  model text,
  execution_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  check (conversation_id is not null or message_id is not null)
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  model text,
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  cached_tokens bigint check (cached_tokens is null or cached_tokens >= 0),
  tool_usage jsonb not null default '{}'::jsonb,
  estimated_cost numeric(20, 8) check (estimated_cost is null or estimated_cost >= 0),
  usage_units numeric(20, 8) not null check (usage_units >= 0),
  status text not null check (status in ('started', 'completed', 'failed', 'rejected')),
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create table if not exists public.usage_windows (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  reset_at timestamptz not null,
  consumed_units numeric(20, 8) not null default 0 check (consumed_units >= 0),
  allowance_units numeric(20, 8) not null check (allowance_units > 0),
  status text not null default 'active' check (status in ('active', 'exhausted')),
  updated_at timestamptz not null default now()
);

create table if not exists public.deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  eligible_at timestamptz not null,
  warning_kind text check (warning_kind is null or warning_kind in ('180_days', '30_days', '7_days')),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_user_updated_idx
  on public.conversations(user_id, updated_at desc);
create index if not exists messages_conversation_created_idx
  on public.messages(conversation_id, created_at);
create index if not exists messages_user_created_idx
  on public.messages(user_id, created_at);
create index if not exists attachments_user_created_idx
  on public.attachments(user_id, created_at desc);
create index if not exists usage_events_user_created_idx
  on public.usage_events(user_id, created_at desc);
create index if not exists deletion_jobs_status_eligible_idx
  on public.deletion_jobs(status, eligible_at);

create or replace function public.touch_valid_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set last_valid_activity_at = now(), updated_at = now()
   where id = new.user_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_valid_activity on public.messages;
create trigger messages_touch_valid_activity
after insert on public.messages
for each row execute function public.touch_valid_activity();

-- RLS and least-privilege grants for every application table.
revoke all on table public.profiles, public.conversations, public.messages,
  public.attachments, public.usage_events, public.usage_windows, public.deletion_jobs
  from anon, authenticated;

grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.conversations to authenticated;
grant select, insert, update, delete on table public.messages to authenticated;
grant select, insert, update, delete on table public.attachments to authenticated;
grant select on table public.usage_events, public.usage_windows to authenticated;

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.usage_events enable row level security;
alter table public.usage_windows enable row level security;
alter table public.deletion_jobs enable row level security;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert_own on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists conversations_select_own on public.conversations;
drop policy if exists conversations_insert_own on public.conversations;
drop policy if exists conversations_update_own on public.conversations;
drop policy if exists conversations_delete_own on public.conversations;
create policy conversations_select_own on public.conversations for select to authenticated using ((select auth.uid()) = user_id);
create policy conversations_insert_own on public.conversations for insert to authenticated with check ((select auth.uid()) = user_id);
create policy conversations_update_own on public.conversations for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy conversations_delete_own on public.conversations for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists messages_select_own on public.messages;
drop policy if exists messages_insert_own on public.messages;
drop policy if exists messages_update_own on public.messages;
drop policy if exists messages_delete_own on public.messages;
create policy messages_select_own on public.messages for select to authenticated using ((select auth.uid()) = user_id);
create policy messages_insert_own on public.messages for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = (select auth.uid())));
create policy messages_update_own on public.messages for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy messages_delete_own on public.messages for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists attachments_select_own on public.attachments;
drop policy if exists attachments_insert_own on public.attachments;
drop policy if exists attachments_update_own on public.attachments;
drop policy if exists attachments_delete_own on public.attachments;
create policy attachments_select_own on public.attachments for select to authenticated using ((select auth.uid()) = user_id);
create policy attachments_insert_own on public.attachments for insert to authenticated with check ((select auth.uid()) = user_id);
create policy attachments_update_own on public.attachments for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy attachments_delete_own on public.attachments for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists usage_events_select_own on public.usage_events;
create policy usage_events_select_own on public.usage_events for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists usage_windows_select_own on public.usage_windows;
create policy usage_windows_select_own on public.usage_windows for select to authenticated using ((select auth.uid()) = user_id);

-- Deletion jobs are backend-controlled only; authenticated users get no grants or policies.

commit;
