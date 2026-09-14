alter table public.kazer_memories
  add column if not exists group_title text;

update public.kazer_memories
set group_title = case category
  when 'preference' then 'Preferências'
  when 'dislike' then 'Preferências'
  when 'personal_context' then 'Sobre você'
  when 'project' then 'Projetos'
  when 'goal' then 'Objetivos'
  when 'habit' then 'Hábitos'
  when 'communication_style' then 'Estilo de comunicação'
  when 'technical_knowledge' then 'Conhecimento técnico'
  when 'interest' then 'Interesses'
  when 'workflow' then 'Fluxo de trabalho'
  when 'instruction' then 'Instruções'
  when 'important_fact' then 'Fatos importantes'
  when 'temporary_context' then 'Contexto temporário'
  when 'relationship_context' then 'Relacionamentos'
  when 'learning' then 'Aprendizado'
  when 'conversation_context' then 'Conversas'
  else 'Outros'
end
where group_title is null or char_length(btrim(group_title)) = 0;

alter table public.kazer_memories
  alter column group_title set default 'Outros',
  alter column group_title set not null,
  add constraint kazer_memories_group_title_length check (char_length(btrim(group_title)) between 1 and 120);

create index if not exists kazer_memories_user_group_updated_idx
  on public.kazer_memories (user_id, group_title, updated_at desc);

comment on column public.kazer_memories.group_title is 'Nome curto e dinâmico do grupo de assunto decidido pela IA e reutilizado por usuário.';
