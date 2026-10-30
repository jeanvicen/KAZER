-- KAZER: Projetos e Habilidades.
--
-- Projetos juntam conversas em torno de um assunto. Habilidades são instruções
-- que a própria pessoa escreve (formato SKILL.md: nome, descrição e corpo) e
-- que o KAZER segue quando o pedido combina com a descrição.
--
-- Aditiva: cria tabelas e funções novas e acrescenta uma coluna opcional a
-- `conversations`. Nenhuma tabela, política, dado ou migração anterior é
-- alterada ou removida.
--
-- Reversão: ver docs/supabase-chat-storage.md.

begin;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table if not exists public.kazer_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  goal text not null default '' check (char_length(goal) <= 2000),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kazer_projects_user_idx
  on public.kazer_projects(user_id, archived, updated_at desc, id desc);

-- A conversa aponta para o projeto; apagar o projeto solta a conversa em vez
-- de levá-la junto (`set null`), que é o que a interface promete.
alter table public.conversations
  add column if not exists project_id uuid
  references public.kazer_projects(id) on delete set null;

create index if not exists conversations_project_idx
  on public.conversations(project_id) where project_id is not null;

create table if not exists public.kazer_skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text not null check (char_length(description) between 1 and 300),
  instructions text not null check (char_length(instructions) between 1 and 20000),
  enabled boolean not null default true,
  shared boolean not null default false,
  origin text not null default 'propria' check (origin in ('propria', 'catalogo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kazer_skills_user_idx
  on public.kazer_skills(user_id, created_at desc, id desc);
create index if not exists kazer_skills_shared_idx
  on public.kazer_skills(updated_at desc, id desc) where shared;

-- ---------------------------------------------------------------------------
-- RLS e grants
-- ---------------------------------------------------------------------------

alter table public.kazer_projects enable row level security;
alter table public.kazer_skills enable row level security;

drop policy if exists kazer_projects_own on public.kazer_projects;
create policy kazer_projects_own on public.kazer_projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A habilidade publicada é legível por qualquer conta autenticada; escrever,
-- só a dona. É isso que faz o catálogo existir sem abrir a conta de ninguém.
drop policy if exists kazer_skills_read on public.kazer_skills;
create policy kazer_skills_read on public.kazer_skills
  for select using (user_id = auth.uid() or shared);

drop policy if exists kazer_skills_write on public.kazer_skills;
create policy kazer_skills_write on public.kazer_skills
  for insert with check (user_id = auth.uid());

drop policy if exists kazer_skills_update on public.kazer_skills;
create policy kazer_skills_update on public.kazer_skills
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists kazer_skills_delete on public.kazer_skills;
create policy kazer_skills_delete on public.kazer_skills
  for delete using (user_id = auth.uid());

grant select, insert, update, delete on public.kazer_projects to authenticated;
grant select, insert, update, delete on public.kazer_skills to authenticated;

-- ---------------------------------------------------------------------------
-- Projetos
-- ---------------------------------------------------------------------------

create or replace function public.kazer_project_json(p public.kazer_projects, total bigint)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'goal', p.goal,
    'archived', p.archived,
    'conversations', total,
    'created_at', extract(epoch from p.created_at)::bigint,
    'updated_at', extract(epoch from p.updated_at)::bigint
  );
$$;

create or replace function public.kazer_projects(p_archived boolean, p_query text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  needle text := lower(coalesce(p_query, ''));
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(
      public.kazer_project_json(
        p,
        (select count(*) from public.conversations c where c.project_id = p.id)
      )
      order by p.updated_at desc, p.id desc)
      from public.kazer_projects p
     where p.user_id = uid
       and p.archived = p_archived
       and (needle = '' or lower(p.name) like '%' || needle || '%'
            or lower(p.goal) like '%' || needle || '%')
  ), '[]'::jsonb);
end;
$$;

create or replace function public.kazer_create_project(p_name text, p_goal text, p_max integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.kazer_projects;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if (select count(*) from public.kazer_projects where user_id = uid and not archived) >= p_max then
    return null;
  end if;
  insert into public.kazer_projects (user_id, name, goal)
    values (uid, left(p_name, 200), left(coalesce(p_goal, ''), 2000))
    returning * into row;
  return public.kazer_project_json(row, 0);
end;
$$;

create or replace function public.kazer_project(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.kazer_projects;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select * into row from public.kazer_projects where id = p_id and user_id = uid;
  if not found then return null; end if;
  return public.kazer_project_json(
    row, (select count(*) from public.conversations c where c.project_id = row.id)
  );
end;
$$;

create or replace function public.kazer_update_project(
  p_id uuid, p_name text default null, p_goal text default null, p_archived boolean default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  update public.kazer_projects
     set name = coalesce(left(p_name, 200), name),
         goal = coalesce(left(p_goal, 2000), goal),
         archived = coalesce(p_archived, archived),
         updated_at = now()
   where id = p_id and user_id = uid;
  return found;
end;
$$;

create or replace function public.kazer_delete_project(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  -- As conversas do projeto continuam; só ficam sem projeto.
  update public.conversations set project_id = null where project_id = p_id and user_id = uid;
  delete from public.kazer_projects where id = p_id and user_id = uid;
  return found;
end;
$$;

create or replace function public.kazer_set_conversation_project(
  p_conversation_id uuid, p_project_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if p_project_id is not null then
    perform 1 from public.kazer_projects where id = p_project_id and user_id = uid;
    if not found then return false; end if;
  end if;
  update public.conversations set project_id = p_project_id
   where id = p_conversation_id and user_id = uid;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Habilidades
-- ---------------------------------------------------------------------------

create or replace function public.kazer_skill_json(s public.kazer_skills, with_body boolean)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'description', s.description,
    'enabled', s.enabled,
    'shared', s.shared,
    'origin', s.origin,
    'created_at', extract(epoch from s.created_at)::bigint,
    'updated_at', extract(epoch from s.updated_at)::bigint
  ) || case when with_body then jsonb_build_object('instructions', s.instructions)
            else '{}'::jsonb end;
$$;

create or replace function public.kazer_skills()
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
    select jsonb_agg(public.kazer_skill_json(s, true) order by s.created_at desc, s.id desc)
      from public.kazer_skills s where s.user_id = uid
  ), '[]'::jsonb);
end;
$$;

create or replace function public.kazer_shared_skills(p_query text default '', p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare needle text := lower(coalesce(p_query, ''));
begin
  return coalesce((
    select jsonb_agg(public.kazer_skill_json(s, false) order by s.updated_at desc, s.id desc)
      from (
        select * from public.kazer_skills
         where shared
           and (needle = '' or lower(name) like '%' || needle || '%'
                or lower(description) like '%' || needle || '%')
         order by updated_at desc, id desc
         limit p_limit
      ) s
  ), '[]'::jsonb);
end;
$$;

-- `p_user_id` nulo: só devolve se a habilidade for pública (é o catálogo).
create or replace function public.kazer_skill(p_id uuid, p_mine boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.kazer_skills;
begin
  if p_mine then
    if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
    select * into row from public.kazer_skills where id = p_id and user_id = uid;
  else
    select * into row from public.kazer_skills where id = p_id and shared;
  end if;
  if not found then return null; end if;
  return public.kazer_skill_json(row, true);
end;
$$;

create or replace function public.kazer_create_skill(
  p_name text, p_description text, p_instructions text, p_origin text, p_max integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.kazer_skills;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if (select count(*) from public.kazer_skills where user_id = uid) >= p_max then
    return null;
  end if;
  insert into public.kazer_skills (user_id, name, description, instructions, origin)
    values (uid, left(p_name, 60), left(p_description, 300), left(p_instructions, 20000),
            case when p_origin = 'catalogo' then 'catalogo' else 'propria' end)
    returning * into row;
  return public.kazer_skill_json(row, true);
end;
$$;

create or replace function public.kazer_update_skill(
  p_id uuid,
  p_name text default null,
  p_description text default null,
  p_instructions text default null,
  p_enabled boolean default null,
  p_shared boolean default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  update public.kazer_skills
     set name = coalesce(left(p_name, 60), name),
         description = coalesce(left(p_description, 300), description),
         instructions = coalesce(left(p_instructions, 20000), instructions),
         enabled = coalesce(p_enabled, enabled),
         shared = coalesce(p_shared, shared),
         updated_at = now()
   where id = p_id and user_id = uid;
  return found;
end;
$$;

create or replace function public.kazer_delete_skill(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  delete from public.kazer_skills where id = p_id and user_id = uid;
  return found;
end;
$$;

-- A conversa passa a dizer de qual projeto ela é.
create or replace function public.kazer_conversation_json(c public.conversations)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'project_id', c.project_id,
    'created_at', extract(epoch from c.created_at)::bigint,
    'updated_at', extract(epoch from c.updated_at)::bigint
  );
$$;

do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'kazer_project_json', 'kazer_projects', 'kazer_create_project', 'kazer_project',
         'kazer_update_project', 'kazer_delete_project', 'kazer_set_conversation_project',
         'kazer_skill_json', 'kazer_skills', 'kazer_shared_skills', 'kazer_skill',
         'kazer_create_skill', 'kazer_update_skill', 'kazer_delete_skill',
         'kazer_conversation_json'
       )
  loop
    execute format('grant execute on function %s to authenticated, service_role', fn.sig);
  end loop;
end $$;

commit;
