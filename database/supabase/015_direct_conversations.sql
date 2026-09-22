-- Kazer: conversas 1-a-1 entre usuários. Aplicar após as migrações de conta e integrações.
create table if not exists public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  user_one uuid not null references auth.users(id) on delete cascade,
  user_two uuid not null references auth.users(id) on delete cascade,
  user_low uuid generated always as (least(user_one, user_two)) stored,
  user_high uuid generated always as (greatest(user_one, user_two)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_one <> user_two),
  unique (user_low, user_high)
);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists direct_conversations_updated_idx on public.direct_conversations(updated_at desc);
create index if not exists direct_messages_conversation_idx on public.direct_messages(conversation_id, created_at);

alter table public.profiles enable row level security;
grant select (id, display_name) on public.profiles to authenticated;
drop policy if exists profiles_directory_read on public.profiles;
create policy profiles_directory_read on public.profiles for select to authenticated using (true);

alter table public.direct_conversations enable row level security;
alter table public.direct_messages enable row level security;
grant select, insert on public.direct_conversations to authenticated;
grant select, insert on public.direct_messages to authenticated;

drop policy if exists direct_conversations_member_read on public.direct_conversations;
create policy direct_conversations_member_read on public.direct_conversations for select to authenticated using (auth.uid() in (user_one, user_two));
drop policy if exists direct_conversations_member_insert on public.direct_conversations;
create policy direct_conversations_member_insert on public.direct_conversations for insert to authenticated with check (auth.uid() in (user_one, user_two));
drop policy if exists direct_messages_member_read on public.direct_messages;
create policy direct_messages_member_read on public.direct_messages for select to authenticated using (exists (select 1 from public.direct_conversations c where c.id = conversation_id and auth.uid() in (c.user_one, c.user_two)));
drop policy if exists direct_messages_member_insert on public.direct_messages;
create policy direct_messages_member_insert on public.direct_messages for insert to authenticated with check (sender_id = auth.uid() and exists (select 1 from public.direct_conversations c where c.id = conversation_id and auth.uid() in (c.user_one, c.user_two)));

create or replace function public.touch_direct_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.direct_conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;
drop trigger if exists direct_messages_touch_conversation on public.direct_messages;
create trigger direct_messages_touch_conversation after insert on public.direct_messages for each row execute function public.touch_direct_conversation();
revoke all on function public.touch_direct_conversation() from public;
