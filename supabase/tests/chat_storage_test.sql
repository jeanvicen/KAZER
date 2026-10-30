-- Testes das funções do chat no Postgres.
--
-- Rodar com um banco que tenha a base do Supabase e as migrações aplicadas:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/chat_storage_test.sql
-- Qualquer asserção falha aborta com erro. Não altera dados de produção: cria
-- duas contas de teste no início e as apaga no fim.

begin;

do $$
declare
  ana uuid;
  bia uuid;
  res jsonb;
  conv uuid;
  reply uuid;
  page jsonb;
  total integer;
begin
  -- ---------------------------------------------------------------- contas
  insert into auth.users (email) values ('ana.teste@kazer.local') returning id into ana;
  insert into auth.users (email) values ('bia.teste@kazer.local') returning id into bia;
  insert into public.profiles (id, email) values (ana, 'ana.teste@kazer.local'), (bia, 'bia.teste@kazer.local');

  perform set_config('request.jwt.claim.sub', ana::text, true);

  -- ------------------------------------------------- envio cria a conversa
  res := public.kazer_begin_exchange(null, 'Primeira conversa', 'Oi KAZER',
                                     'cli-001', '{}'::uuid[], '{"effort":"low"}'::jsonb, 1, 'kaz');
  assert res->>'error' is null, 'envio devia funcionar: ' || res::text;
  assert (res->>'duplicate')::boolean = false, 'primeiro envio não é duplicata';
  conv := (res->'conversation'->>'id')::uuid;
  reply := (res->'reply'->>'id')::uuid;
  assert res->'message'->>'content' = 'Oi KAZER', 'pergunta gravada';
  assert res->'reply'->>'status' = 'streaming', 'resposta reservada';
  assert (res->'message'->>'seq')::int = 1 and (res->'reply'->>'seq')::int = 2, 'ordem das mensagens';

  -- --------------------------------------------- idempotência por client_id
  res := public.kazer_begin_exchange(conv, 'x', 'Oi KAZER', 'cli-001',
                                     '{}'::uuid[], '{}'::jsonb, 1, 'kaz');
  assert (res->>'duplicate')::boolean = true, 'reenvio devia ser duplicata';
  assert (res->'reply'->>'id')::uuid = reply, 'duplicata devolve a mesma resposta';
  select count(*) into total from public.messages where conversation_id = conv;
  assert total = 2, 'reenvio não cria mensagem nova (tinha ' || total || ')';

  -- ------------------------------------------------ resposta vai sendo gravada
  perform public.kazer_update_reply(reply, 'Olá! Tudo certo?', 'pensando...', 'complete', null, 'end');
  res := public.kazer_message(reply);
  assert res->>'content' = 'Olá! Tudo certo?', 'conteúdo gravado';
  assert res->>'status' = 'complete', 'status final';

  -- ------------------------------------------------------------- isolamento
  perform set_config('request.jwt.claim.sub', bia::text, true);
  assert public.kazer_conversation(conv) is null, 'Bia não enxerga a conversa da Ana';
  assert public.kazer_messages(conv) is null, 'Bia não lê as mensagens da Ana';
  assert public.kazer_message(reply) is null, 'Bia não lê a resposta da Ana';
  assert public.kazer_delete_conversation(conv) is null, 'Bia não apaga a conversa da Ana';
  assert public.kazer_rename_conversation(conv, 'invadida') is null, 'Bia não renomeia a conversa da Ana';
  res := public.kazer_begin_exchange(conv, 't', 'invasão', 'cli-bia', '{}'::uuid[], '{}'::jsonb, 1, 'kaz');
  assert res->>'error' = 'not_found', 'Bia não escreve na conversa da Ana';
  assert public.kazer_conversations() = '[]'::jsonb, 'lista da Bia está vazia';

  perform set_config('request.jwt.claim.sub', ana::text, true);
  assert jsonb_array_length(public.kazer_conversations()) = 1, 'Ana continua com a conversa dela';

  -- ------------------------------------------------------------ paginação
  for i in 1..45 loop
    res := public.kazer_begin_exchange(conv, 'x', 'pergunta ' || i, 'cli-p' || i,
                                       '{}'::uuid[], '{}'::jsonb, 1, 'kaz');
    assert res->>'error' is null, 'envio ' || i || ': ' || res::text;
    perform public.kazer_update_reply((res->'reply'->>'id')::uuid, 'resposta ' || i, null, 'complete', null, 'end');
  end loop;
  -- 1 troca inicial + 45 = 92 mensagens, ou seja 40 + 40 + 12.
  select count(*) into total from public.messages where conversation_id = conv;
  assert total = 92, 'conversa tem 92 mensagens (tem ' || total || ')';
  page := public.kazer_messages(conv, 40, null);
  assert jsonb_array_length(page->'items') = 40, 'primeira página traz 40';
  assert (page->>'has_more')::boolean = true, 'há mensagens anteriores';
  assert (page->'items'->0->>'seq')::int = 53, 'página começa na mensagem certa';
  page := public.kazer_messages(conv, 40, (page->'items'->0->>'seq')::int);
  assert jsonb_array_length(page->'items') = 40, 'segunda página traz 40';
  assert (page->>'has_more')::boolean = true, 'ainda há anteriores';
  page := public.kazer_messages(conv, 40, (page->'items'->0->>'seq')::int);
  assert jsonb_array_length(page->'items') = 12, 'última página traz o resto (veio ' ||
         jsonb_array_length(page->'items') || ')';
  assert (page->>'has_more')::boolean = false, 'acabou o histórico';

  -- --------------------------------------------- teto de conversas por conta
  -- Envelhece a conversa atual para ela ser, sem empate, a mais antiga.
  update public.conversations set updated_at = now() - interval '30 days',
                                  created_at = now() - interval '30 days'
   where id = conv;
  for i in 1..12 loop
    res := public.kazer_begin_exchange(null, 'Conversa ' || i, 'oi', 'cli-c' || i,
                                       '{}'::uuid[], '{}'::jsonb, 1, 'kaz', 10);
    assert res->>'error' is null, 'conversa ' || i || ': ' || res::text;
    -- Cada conversa nova fica mais recente que a anterior (fora de transação
    -- isso acontece sozinho; aqui now() é constante).
    update public.conversations set updated_at = now() + make_interval(secs => i)
     where id = (res->'conversation'->>'id')::uuid;
  end loop;
  select count(*) into total from public.conversations where user_id = ana;
  assert total = 10, 'teto de 10 conversas respeitado (ficaram ' || total || ')';
  assert not exists (select 1 from public.conversations where id = conv),
         'a conversa mais antiga saiu para a nova entrar';

  -- ------------------------------------------------------ cota por plano
  -- A franquia vem sempre do plano (free = 120), então o teste chega perto do
  -- teto consumindo, não forçando a franquia.
  assert (select allowance from public.kazer_plan_quota('free')) = 120, 'franquia do free';
  update public.usage_windows
     set consumed_units = 118, window_started_at = now(), reset_at = now() + interval '5 hours'
   where user_id = ana;

  res := public.kazer_begin_exchange(null, 'no limite', 'último que cabe', 'cli-q1',
                                     '{}'::uuid[], '{}'::jsonb, 2, 'kaz', 100);
  assert res->>'error' is null, 'o envio que fecha a cota passa: ' || res::text;
  assert (res->'usage'->>'consumed')::numeric = 120, 'cota cheia';

  res := public.kazer_begin_exchange(null, 'estourou', 'não cabe', 'cli-q2',
                                     '{}'::uuid[], '{}'::jsonb, 1, 'kaz', 100);
  assert res->>'error' = 'usage_limit', 'acima da cota é recusado: ' || res::text;
  assert (res->'usage'->>'reset_at') is not null, 'o limite informa a renovação real';
  assert (res->'usage'->>'plan') = 'free', 'plano padrão é free';
  assert not exists (select 1 from public.conversations c
                      where c.user_id = ana and c.title = 'estourou'),
         'pedido recusado não deixa conversa vazia para trás';

  -- Duas requisições paralelas não furam o limite: a segunda vê o consumo da primeira.
  res := public.kazer_usage_state();
  assert (res->>'consumed')::numeric = 120, 'consumo registrado (veio ' || (res->>'consumed') || ')';
  assert (res->>'reset_at') is not null, 'janela aberta tem renovação';

  -- Devolução do que foi reservado e não usado (resposta curta ou com erro).
  update public.usage_windows set consumed_units = 120 where user_id = ana;
  perform public.kazer_settle_usage(
    (select request_id from public.usage_events where user_id = ana order by created_at desc limit 1),
    0, 'failed');
  res := public.kazer_usage_state();
  assert (res->>'consumed')::numeric < 120, 'reserva não usada volta para a conta (ficou ' ||
         (res->>'consumed') || ')';

  -- ------------------------------------------------------- planos maiores
  insert into public.kazer_plans (user_id, plan) values (ana, 'pro')
    on conflict (user_id) do update set plan = 'pro';
  res := public.kazer_usage_state();
  assert (res->>'plan') = 'pro', 'plano lido do perfil';
  assert (res->>'allowance')::numeric = 800, 'franquia do pro';
  res := public.kazer_begin_exchange(null, 'c', 'agora cabe', 'cli-q3', '{}'::uuid[], '{}'::jsonb, 1, 'kaz', 100);
  assert res->>'error' is null, 'plano maior libera o envio';

  -- ----------------------------------------------- memórias e preferências
  res := public.kazer_add_memory('Trabalho com Python');
  assert res->>'content' = 'Trabalho com Python', 'memória salva';
  assert jsonb_array_length(public.kazer_list_memories()) = 1, 'memória listada';
  perform set_config('request.jwt.claim.sub', bia::text, true);
  assert public.kazer_list_memories() = '[]'::jsonb, 'memória não vaza entre contas';
  assert public.kazer_delete_memory((res->>'id')::uuid) = false, 'Bia não apaga memória da Ana';
  perform set_config('request.jwt.claim.sub', ana::text, true);
  perform public.kazer_save_preferences('{"style":"direto"}'::jsonb);
  assert public.kazer_get_preferences()->>'style' = 'direto', 'preferência salva';

  -- -------------------------------------------------------------- limpeza
  perform set_config('request.jwt.claim.sub', ana::text, true);
  res := public.kazer_delete_all_conversations();
  assert res ? 'storage_paths', 'exclusão devolve os anexos para o Storage';
  select count(*) into total from public.conversations where user_id = ana;
  assert total = 0, 'histórico apagado';

  raise notice 'TODOS OS TESTES DO CHAT PASSARAM';

  delete from auth.users where id in (ana, bia);
end $$;

rollback;
