-- Projetos e Habilidades: criar, listar, isolar entre contas e o catálogo
-- aberto (publicada se lê, não publicada não).
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
  sk jsonb;
  sk_id uuid;
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

  -- ---------- Habilidades ----------
  sk := public.kazer_create_skill(
    'Revisor de receitas', 'quando pedirem receita', 'Liste os ingredientes antes.',
    'propria', 40
  );
  sk_id := (sk->>'id')::uuid;
  if sk->>'origin' <> 'propria' or (sk->>'enabled')::boolean is not true then
    raise exception 'habilidade criada errada: %', sk;
  end if;
  if sk->>'instructions' is null then
    raise exception 'a habilidade da dona deve vir com as instruções';
  end if;

  if jsonb_array_length(public.kazer_skills()) <> 1 then
    raise exception 'a habilidade não apareceu na lista da dona';
  end if;

  -- Sem publicar, o catálogo está vazio e ninguém mais lê.
  if jsonb_array_length(public.kazer_shared_skills()) <> 0 then
    raise exception 'habilidade não publicada apareceu no catálogo';
  end if;
  perform set_config('request.jwt.claim.sub', bia::text, true);
  if public.kazer_skill(sk_id, false) is not null then
    raise exception 'FALHA DE ISOLAMENTO: Bia leu habilidade não publicada';
  end if;
  if jsonb_array_length(public.kazer_skills()) <> 0 then
    raise exception 'FALHA DE ISOLAMENTO: Bia viu a habilidade da Ana';
  end if;
  if public.kazer_update_skill(sk_id, 'Roubada') then
    raise exception 'FALHA DE ISOLAMENTO: Bia alterou a habilidade da Ana';
  end if;
  if public.kazer_delete_skill(sk_id) then
    raise exception 'FALHA DE ISOLAMENTO: Bia apagou a habilidade da Ana';
  end if;

  -- Publicada: entra no catálogo e qualquer conta lê (sem virar dona).
  perform set_config('request.jwt.claim.sub', ana::text, true);
  perform public.kazer_update_skill(sk_id, null, null, null, null, true);
  perform set_config('request.jwt.claim.sub', bia::text, true);
  listed := public.kazer_shared_skills();
  if jsonb_array_length(listed) <> 1 then
    raise exception 'o catálogo deveria ter a habilidade publicada: %', listed;
  end if;
  -- A listagem do catálogo nunca carrega as instruções.
  if listed->0 ? 'instructions' then
    raise exception 'o catálogo não deve trazer as instruções na listagem';
  end if;
  if public.kazer_skill(sk_id, false) is null then
    raise exception 'a habilidade publicada deveria ser legível';
  end if;
  -- Continua não sendo dela.
  if public.kazer_update_skill(sk_id, 'Minha agora') then
    raise exception 'FALHA DE ISOLAMENTO: publicar deu escrita a terceiros';
  end if;

  -- Instalar é copiar: a cópia é da Bia e não mexe na original.
  sk := public.kazer_create_skill(
    listed->0->>'name', listed->0->>'description',
    public.kazer_skill(sk_id, false)->>'instructions', 'catalogo', 40
  );
  if sk->>'origin' <> 'catalogo' or (sk->>'id')::uuid = sk_id then
    raise exception 'a instalação deveria criar uma cópia nova: %', sk;
  end if;
  perform public.kazer_update_skill((sk->>'id')::uuid, 'Meu revisor');
  perform set_config('request.jwt.claim.sub', ana::text, true);
  if public.kazer_skill(sk_id)->>'name' <> 'Revisor de receitas' then
    raise exception 'mexer na cópia alterou a original';
  end if;

  -- O limite por conta é respeitado.
  if public.kazer_create_skill('Extra', 'descrição', 'corpo', 'propria', 1) is not null then
    raise exception 'o limite de habilidades não foi respeitado';
  end if;
  if public.kazer_create_project('Extra', '', 0) is not null then
    raise exception 'o limite de projetos não foi respeitado';
  end if;

  raise notice 'TODOS OS TESTES DE PROJETOS E HABILIDADES PASSARAM';
end $$;

rollback;
