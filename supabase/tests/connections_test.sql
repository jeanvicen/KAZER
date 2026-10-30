-- Conectores ligados: a credencial é o ponto sensível.
--
-- O teste prende que ela nunca sai em listagem, que `select` direto na tabela
-- é negado e que só a dona chega ao segredo.

begin;

do $$
declare
  ana uuid;
  bia uuid;
  linked jsonb;
  link_id uuid;
begin
  insert into auth.users (email) values ('ana.cn@example.com') returning id into ana;
  insert into auth.users (email) values ('bia.cn@example.com') returning id into bia;

  perform set_config('request.jwt.claim.sub', ana::text, true);
  linked := public.kazer_save_connection(
    'github', 'GitHub', 'https://exemplo.com/mcp', 'token-secreto',
    '[{"name": "listar", "description": "lista"}]'::jsonb, 50
  );
  link_id := (linked->>'id')::uuid;
  if (linked->>'connected')::boolean is not true then
    raise exception 'o conector deveria nascer conectado: %', linked;
  end if;

  -- A listagem nunca carrega endereço nem credencial.
  if public.kazer_connections()::text like '%token-secreto%' then
    raise exception 'FALHA DE SEGREDO: a credencial saiu na listagem';
  end if;
  if public.kazer_connections()::text like '%exemplo.com%' then
    raise exception 'FALHA DE SEGREDO: o endereço saiu na listagem';
  end if;

  -- A dona chega ao segredo pela função certa.
  if public.kazer_connection_secret(link_id)->>'token' <> 'token-secreto' then
    raise exception 'a dona deveria ler a própria credencial';
  end if;

  -- Bia não vê, não lê o segredo, não desliga e não apaga.
  perform set_config('request.jwt.claim.sub', bia::text, true);
  if jsonb_array_length(public.kazer_connections()) <> 0 then
    raise exception 'FALHA DE ISOLAMENTO: Bia viu o conector da Ana';
  end if;
  if public.kazer_connection_secret(link_id) is not null then
    raise exception 'FALHA DE SEGREDO: Bia leu a credencial da Ana';
  end if;
  if public.kazer_set_connection(link_id, false) then
    raise exception 'FALHA DE ISOLAMENTO: Bia desligou o conector da Ana';
  end if;
  if public.kazer_delete_connection(link_id) then
    raise exception 'FALHA DE ISOLAMENTO: Bia apagou o conector da Ana';
  end if;

  -- Ligar o mesmo conector de novo atualiza em vez de duplicar.
  perform set_config('request.jwt.claim.sub', ana::text, true);
  perform public.kazer_save_connection(
    'github', 'GitHub', 'https://outro.com/mcp', 'token-novo', '[]'::jsonb, 50
  );
  if jsonb_array_length(public.kazer_connections()) <> 1 then
    raise exception 'religar duplicou o conector';
  end if;
  if public.kazer_connection_secret(link_id)->>'token' <> 'token-novo' then
    raise exception 'religar não atualizou a credencial';
  end if;

  -- O teto do plano é respeitado.
  if public.kazer_save_connection('slack', 'Slack', 'https://s.com/mcp', '', '[]'::jsonb, 1)
     is not null then
    raise exception 'o limite de conectores não foi respeitado';
  end if;

  -- Desligar mantém a credencial; apagar leva tudo.
  if not public.kazer_set_connection(link_id, false) then
    raise exception 'a dona deveria conseguir desligar';
  end if;
  if public.kazer_connection_secret(link_id)->>'token' <> 'token-novo' then
    raise exception 'desligar não pode apagar a credencial';
  end if;
  if not public.kazer_delete_connection(link_id) then
    raise exception 'a dona deveria conseguir apagar';
  end if;
  if public.kazer_connection_secret(link_id) is not null then
    raise exception 'o conector apagado continua lá';
  end if;

  raise notice 'TODOS OS TESTES DE CONECTORES PASSARAM';
end $$;

rollback;
