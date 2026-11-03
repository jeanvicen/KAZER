-- Projetos: criar, listar e isolar entre contas.
--
-- Roda sobre as migrações já aplicadas e termina em rollback.

begin;

do $$
declare
  ana uuid;
  bia uuid;
  conv uuid;
  proj jsonb;
  proj_id uuid;
  listed jsonb;
begin
  insert into auth.users (email) values ('ana.ps@example.com') returning id into ana;
  insert into auth.users (email) values ('bia.ps@example.com') returning id into bia;

  -- ---------- Projetos ----------
  perform set_config('request.jwt.claim.sub', ana::text, true);
  proj := public.kazer_create_project('Lançamento', 'Organizar tudo.', 60);
  proj_id := (proj->>'id')::uuid;
  if proj->>'name' <> 'Lançamento' or (proj->>'conversations')::int <> 0 then
    raise exception 'projeto criado errado: %', proj;
  end if;

  insert into public.conversations (user_id, title) values (ana, 'Primeira') returning id into conv;
  if not public.kazer_set_conversation_project(conv, proj_id) then
    raise exception 'a conversa deveria entrar no projeto';
  end if;

  listed := public.kazer_projects(false);
  if jsonb_array_length(listed) <> 1 or (listed->0->>'conversations')::int <> 1 then
    raise exception 'contagem de conversas errada: %', listed;
  end if;

  -- Arquivar tira da lista principal e põe na dos arquivados.
  perform public.kazer_update_project(proj_id, null, null, true);
  if jsonb_array_length(public.kazer_projects(false)) <> 0 then
    raise exception 'projeto arquivado ainda aparece';
  end if;
  if jsonb_array_length(public.kazer_projects(true)) <> 1 then
    raise exception 'projeto arquivado sumiu';
  end if;
  perform public.kazer_update_project(proj_id, null, null, false);

  -- Bia não enxerga nem mexe.
  perform set_config('request.jwt.claim.sub', bia::text, true);
  if jsonb_array_length(public.kazer_projects(false)) <> 0 then
    raise exception 'FALHA DE ISOLAMENTO: Bia viu o projeto da Ana';
  end if;
  if public.kazer_project(proj_id) is not null then
    raise exception 'FALHA DE ISOLAMENTO: Bia leu o projeto da Ana';
  end if;
  if public.kazer_update_project(proj_id, 'Roubado') then
    raise exception 'FALHA DE ISOLAMENTO: Bia renomeou o projeto da Ana';
  end if;
  if public.kazer_delete_project(proj_id) then
    raise exception 'FALHA DE ISOLAMENTO: Bia apagou o projeto da Ana';
  end if;
  if public.kazer_set_conversation_project(conv, proj_id) then
    raise exception 'FALHA DE ISOLAMENTO: Bia mexeu na conversa da Ana';
  end if;

  -- Apagar solta a conversa em vez de levá-la junto.
  perform set_config('request.jwt.claim.sub', ana::text, true);
  if not public.kazer_delete_project(proj_id) then
    raise exception 'a dona deveria conseguir apagar';
  end if;
  if (select project_id from public.conversations where id = conv) is not null then
    raise exception 'a conversa ficou presa a um projeto apagado';
  end if;
  if (select count(*) from public.conversations where id = conv) <> 1 then
    raise exception 'a conversa foi apagada junto com o projeto';
  end if;


  raise notice 'TODOS OS TESTES DE PROJETOS PASSARAM';
end $$;

rollback;
