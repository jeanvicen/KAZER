-- Biblioteca: artefatos gravados, listagem das duas origens, filtros,
-- paginação e isolamento entre contas.
--
-- Roda sobre as migrações já aplicadas e termina em rollback, então pode ser
-- executado quantas vezes for preciso no mesmo banco.

begin;

do $$
declare
  ana uuid;
  bia uuid;
  conv uuid;
  pergunta uuid;
  resposta uuid;
  saved jsonb;
  lib jsonb;
  art jsonb;
  art_id uuid;
begin
  insert into auth.users (email) values ('ana.lib@example.com') returning id into ana;
  insert into auth.users (email) values ('bia.lib@example.com') returning id into bia;

  -- Ana conversa e manda um anexo.
  perform set_config('request.jwt.claim.sub', ana::text, true);
  insert into public.conversations (user_id, title) values (ana, 'Com artefatos')
    returning id into conv;
  insert into public.messages (user_id, conversation_id, role, seq, content, status)
    values (ana, conv, 'user', 1, 'faz uma página', 'complete') returning id into pergunta;
  insert into public.messages (user_id, conversation_id, role, seq, content, status)
    values (ana, conv, 'assistant', 2, 'pronto', 'complete') returning id into resposta;
  insert into public.attachments
    (user_id, conversation_id, message_id, storage_path, mime_type, size_bytes, kind, name)
    values (ana, conv, pergunta, ana::text || '/foto.png', 'image/png', 2048, 'image', 'foto.png');

  -- 1. Gravar artefatos de uma resposta
  saved := public.kazer_save_artifacts(
    conv,
    resposta,
    jsonb_build_array(
      jsonb_build_object('kind', 'code', 'title', 'Página inicial',
                         'language', 'html', 'content', repeat('x', 900)),
      jsonb_build_object('kind', 'image', 'title', 'Ícone',
                         'language', 'svg', 'content', repeat('y', 500))
    )
  );
  if jsonb_array_length(saved) <> 2 then
    raise exception 'esperava 2 artefatos, veio %', jsonb_array_length(saved);
  end if;
  if saved->0->>'title' <> 'Página inicial' then
    raise exception 'título errado: %', saved->0->>'title';
  end if;
  -- A listagem nunca carrega o conteúdo junto.
  if saved->0 ? 'content' then
    raise exception 'a listagem não deve trazer o conteúdo';
  end if;
  if (saved->0->>'size')::int <> 900 then
    raise exception 'tamanho errado: %', saved->0->>'size';
  end if;

  -- 2. Gerar a resposta de novo troca os artefatos, não acumula
  saved := public.kazer_save_artifacts(
    conv,
    resposta,
    jsonb_build_array(
      jsonb_build_object('kind', 'code', 'title', 'Página nova',
                         'language', 'html', 'content', repeat('z', 800))
    )
  );
  if jsonb_array_length(saved) <> 1 then
    raise exception 'regerar deveria substituir, veio %', jsonb_array_length(saved);
  end if;
  if (select count(*) from public.kazer_artifacts where message_id = resposta) <> 1 then
    raise exception 'sobrou artefato antigo';
  end if;

  -- 3. A biblioteca traz as duas origens
  lib := public.kazer_library('tudo', 30);
  if jsonb_array_length(lib) <> 2 then
    raise exception 'esperava 2 itens na biblioteca, veio %', jsonb_array_length(lib);
  end if;
  if not (lib @> jsonb_build_array(jsonb_build_object('source', 'pessoa'))
          and lib @> jsonb_build_array(jsonb_build_object('source', 'kazer'))) then
    raise exception 'a biblioteca precisa misturar as duas origens: %', lib;
  end if;

  -- 4. Filtros
  lib := public.kazer_library('imagem', 30);
  if jsonb_array_length(lib) <> 1 or lib->0->>'source' <> 'pessoa' then
    raise exception 'filtro de imagem errado: %', lib;
  end if;
  lib := public.kazer_library('artefato', 30);
  if jsonb_array_length(lib) <> 1 or lib->0->>'source' <> 'kazer' then
    raise exception 'filtro de artefato errado: %', lib;
  end if;
  lib := public.kazer_library('documento', 30);
  if jsonb_array_length(lib) <> 0 then
    raise exception 'não há documentos nesta conta: %', lib;
  end if;

  -- 5. Paginação respeita o limite
  lib := public.kazer_library('tudo', 1);
  if jsonb_array_length(lib) <> 1 then
    raise exception 'o limite não foi respeitado: %', lib;
  end if;

  -- 6. O conteúdo vem só quando pedido pelo id
  art_id := (saved->0->>'id')::uuid;
  art := public.kazer_artifact(art_id);
  if art->>'content' <> repeat('z', 800) then
    raise exception 'conteúdo do artefato errado';
  end if;

  -- 7. Bia não enxerga nem apaga o que é da Ana
  perform set_config('request.jwt.claim.sub', bia::text, true);
  if public.kazer_artifact(art_id) is not null then
    raise exception 'FALHA DE ISOLAMENTO: Bia leu o artefato da Ana';
  end if;
  if public.kazer_delete_artifact(art_id) then
    raise exception 'FALHA DE ISOLAMENTO: Bia apagou o artefato da Ana';
  end if;
  if jsonb_array_length(public.kazer_library('tudo', 30)) <> 0 then
    raise exception 'FALHA DE ISOLAMENTO: Bia viu a biblioteca da Ana';
  end if;

  -- 8. A dona apaga o que é dela
  perform set_config('request.jwt.claim.sub', ana::text, true);
  if not public.kazer_delete_artifact(art_id) then
    raise exception 'a dona deveria conseguir apagar';
  end if;
  if public.kazer_artifact(art_id) is not null then
    raise exception 'o artefato continua lá depois de apagado';
  end if;

  -- 9. Gravar artefato numa resposta de outra conta não acontece
  perform set_config('request.jwt.claim.sub', bia::text, true);
  saved := public.kazer_save_artifacts(
    conv,
    resposta,
    jsonb_build_array(
      jsonb_build_object('kind', 'code', 'title', 'Invasão',
                         'language', 'html', 'content', repeat('w', 500))
    )
  );
  if jsonb_array_length(saved) <> 0 then
    raise exception 'FALHA DE ISOLAMENTO: Bia gravou artefato na resposta da Ana';
  end if;

  raise notice 'TODOS OS TESTES DA BIBLIOTECA PASSARAM';
end $$;

rollback;
