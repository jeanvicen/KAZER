create table if not exists public.kazer_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null default 'other' check (category in ('preference','dislike','personal_context','project','goal','habit','communication_style','technical_knowledge','interest','workflow','instruction','important_fact','temporary_context','relationship_context','learning','conversation_context','other')),
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  importance numeric(4,3) not null default 0.5 check (importance >= 0 and importance <= 1),
  confidence numeric(4,3) not null default 0.75 check (confidence >= 0 and confidence <= 1),
  is_pinned boolean not null default false,
  source text not null default 'conversation' check (source in ('conversation','explicit','user_created','system')),
  usage_count integer not null default 0 check (usage_count >= 0),
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kazer_memories_user_updated_idx on public.kazer_memories (user_id, updated_at desc);
create index if not exists kazer_memories_user_category_idx on public.kazer_memories (user_id, category, updated_at desc);
create index if not exists kazer_memories_user_active_idx on public.kazer_memories (user_id, is_pinned, updated_at desc);

create or replace function public.kazer_memories_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists kazer_memories_updated_at on public.kazer_memories;
create trigger kazer_memories_updated_at
before update on public.kazer_memories
for each row execute function public.kazer_memories_touch_updated_at();

create or replace function public.kazer_memories_enforce_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  memory_count integer;
begin
  if new.user_id is null then raise exception 'memory_user_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 90731));
  select count(*) into memory_count from public.kazer_memories where user_id = new.user_id;
  if memory_count >= 5000 then
    delete from public.kazer_memories
    where id in (
      select id from public.kazer_memories
      where user_id = new.user_id and is_pinned = false
      order by (importance + confidence + least(1, usage_count::numeric / 20) + case when last_used_at is null then 0 else greatest(0, 1 - extract(epoch from (now() - last_used_at)) / 2592000) end) asc, updated_at asc
      limit greatest(1, memory_count - 4999)
    );
    select count(*) into memory_count from public.kazer_memories where user_id = new.user_id;
    if memory_count >= 5000 then raise exception 'memory_limit_all_pinned'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists kazer_memories_enforce_limit on public.kazer_memories;
create trigger kazer_memories_enforce_limit
before insert on public.kazer_memories
for each row execute function public.kazer_memories_enforce_limit();

alter table public.kazer_memories enable row level security;
alter table public.kazer_memories force row level security;
revoke all on public.kazer_memories from anon, authenticated;
revoke all on function public.kazer_memories_touch_updated_at() from public, anon, authenticated;
revoke all on function public.kazer_memories_enforce_limit() from public, anon, authenticated;

comment on table public.kazer_memories is 'Memórias condensadas e isoladas por usuário do KAZER; não é histórico literal de conversas.';
comment on column public.kazer_memories.is_pinned is 'Memória protegida contra renovação automática quando o limite de 5.000 é atingido.';
