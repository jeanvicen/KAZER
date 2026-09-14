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
  select count(*) into memory_count
  from public.kazer_memories
  where user_id = new.user_id;

  if memory_count >= 5000 then
    delete from public.kazer_memories
    where id in (
      select id
      from public.kazer_memories
      where user_id = new.user_id
        and is_pinned = false
      order by (
        (coalesce(importance, 0.5) * 0.45)
        + (coalesce(confidence, 0.75) * 0.25)
        + least(1, coalesce(usage_count, 0)::numeric / 20) * 0.15
        + case
            when last_used_at is null then 0
            else greatest(0, 1 - extract(epoch from (now() - last_used_at)) / 2592000) * 0.10
          end
        + greatest(0, 1 - extract(epoch from (now() - coalesce(updated_at, created_at))) / 7776000) * 0.05
      ) asc,
      coalesce(last_used_at, created_at) asc,
      updated_at asc
      limit greatest(1, memory_count - 4999)
    );

    select count(*) into memory_count
    from public.kazer_memories
    where user_id = new.user_id;

    if memory_count >= 5000 then
      raise exception 'memory_limit_all_pinned';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists kazer_memories_enforce_limit on public.kazer_memories;
create trigger kazer_memories_enforce_limit
before insert on public.kazer_memories
for each row execute function public.kazer_memories_enforce_limit();

revoke all on function public.kazer_memories_enforce_limit() from public, anon, authenticated;
comment on function public.kazer_memories_enforce_limit() is 'Mantém no máximo 5.000 memórias por usuário, removendo primeiro registros não fixados com menor relevância, uso e recência.';
