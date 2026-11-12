-- Imagens (cota diária) e memória com procedência:
-- ciclo reservar → concluir, idempotência, isolamento entre contas e RLS.
-- Rode com scripts/pg_test.sh (Postgres local). Tudo dentro de uma transação
-- desfeita no fim: não deixa dado nenhum.

begin;

do $$
declare
  ana uuid;
  bia uuid;
  r jsonb;
  job uuid;
  job2 uuid;
  d jsonb;
  mem jsonb;
  n integer;
  denied boolean;
begin
  insert into auth.users (email) values ('ana.img@kazer.local') returning id into ana;
  insert into auth.users (email) values ('bia.img@kazer.local') returning id into bia;
  insert into public.profiles (id, email)
  values (ana, 'ana.img@kazer.local'), (bia, 'bia.img@kazer.local');

  -- ---------- Sem sessão: nada funciona ----------
  perform set_config('request.jwt.claim.sub', '', true);
  set local role authenticated;
  denied := false;
  begin
    perform public.kazer_image_reserve('semsessao-0001', 'gato', 1024, 1024, 1);
  exception when sqlstate '28000' then denied := true;
  end;
  assert denied, 'reserva sem sessão deve falhar';
  reset role;

  set local role anon;
  denied := false;
  begin
    perform public.kazer_images(10);
  exception when insufficient_privilege then denied := true;
  end;
  assert denied, 'anon não executa as funções de imagem';
  reset role;

  -- ---------- Ana: uma imagem por dia ----------
  perform set_config('request.jwt.claim.sub', ana::text, true);
  set local role authenticated;

  r := public.kazer_image_reserve('ana-chave-0001', 'um gato dourado', 1024, 1024, 1);
  assert r->>'reason' = '' and (r->>'replayed')::boolean = false, 'primeira reserva entra';
  job := (r->'job'->>'id')::uuid;
  assert r->'job'->>'status' = 'reserved', 'pedido começa reservado';

  r := public.kazer_image_reserve('ana-chave-0001', 'outro texto', 512, 512, 1);
  assert (r->>'replayed')::boolean and (r->'job'->>'id')::uuid = job, 'mesma chave = mesmo pedido';
  assert r->'job'->>'prompt' = 'um gato dourado', 'repetição não troca o pedido';

  r := public.kazer_image_reserve('ana-chave-0002', 'segunda aba', 1024, 1024, 1);
  assert r->>'reason' = 'busy' and r->'job' = 'null'::jsonb, 'segunda aba não fura a vaga em andamento';

  -- Falha não consome o dia.
  d := public.kazer_image_finish(job, false, 'demo', 'image_timeout');
  assert d->>'status' = 'failed', 'falha registrada';
  r := public.kazer_image_usage_today();
  assert (r->>'succeeded')::int = 0 and (r->>'active')::int = 0, 'falha libera a vaga';

  r := public.kazer_image_reserve('ana-chave-0003', 'tentativa nova', 1024, 1024, 1);
  job2 := (r->'job'->>'id')::uuid;
  assert job2 is not null, 'depois da falha dá para tentar de novo';

  d := public.kazer_image_finish(job2, true, 'demo', null, 'image/png', 1234);
  assert d->>'status' = 'succeeded' and (d->>'size')::int = 1234, 'sucesso registrado';
  assert public.kazer_image_finish(job2, true, 'demo', null, 'image/png', 1) is null,
    'concluir duas vezes não conta duas vezes';
  r := public.kazer_image_usage_today();
  assert (r->>'succeeded')::int = 1, 'sucesso conta exatamente uma vez';

  r := public.kazer_image_reserve('ana-chave-0004', 'mais uma', 1024, 1024, 1);
  assert r->>'reason' = 'quota', 'segunda imagem do dia é barrada';
  -- Pedir um limite absurdo direto na função não gera imagem: só o servidor gera.
  r := public.kazer_image_reserve('ana-chave-0005', 'forjado', 1024, 1024, 999999);
  assert r->>'reason' = '', 'reserva forjada entra só como reserva';
  perform public.kazer_image_finish((r->'job'->>'id')::uuid, false, '', 'forjado');

  assert jsonb_array_length(public.kazer_images(10)) = 1, 'galeria tem a imagem concluída';

  -- Escrita direta na tabela é negada (só as funções escrevem).
  denied := false;
  begin
    update public.kazer_image_usage set succeeded = 0 where user_id = ana;
  exception when insufficient_privilege then denied := true;
  end;
  assert denied, 'conta não zera a própria cota pela tabela';
  denied := false;
  begin
    delete from public.kazer_image_jobs where user_id = ana;
  exception when insufficient_privilege then denied := true;
  end;
  assert denied, 'conta não apaga pedidos pela tabela';

  -- Memória da Ana.
  mem := public.kazer_save_memory('Prefere respostas curtas', 100, 'auto', null, 0.7);
  assert mem->>'source' = 'auto', 'memória automática guarda a origem';
  reset role;

  -- ---------- Bia não alcança nada da Ana ----------
  perform set_config('request.jwt.claim.sub', bia::text, true);
  set local role authenticated;

  assert public.kazer_image(job2) is null, 'Bia não lê o pedido da Ana';
  assert public.kazer_image_finish(job2, false, '', 'x') is null, 'Bia não conclui pedido da Ana';
  assert public.kazer_delete_image(job2) = false, 'Bia não apaga imagem da Ana';
  select count(*) into n from public.kazer_image_jobs;
  assert n = 0, 'RLS: Bia não vê pedidos da Ana (viu ' || n || ')';
  select count(*) into n from public.kazer_image_usage;
  assert n = 0, 'RLS: Bia não vê o uso da Ana';
  assert jsonb_array_length(public.kazer_images(10)) = 0, 'galeria da Bia é vazia';

  select count(*) into n from public.kazer_memories;
  assert n = 0, 'RLS: Bia não vê memória da Ana';
  assert public.kazer_update_memory((mem->>'id')::uuid, 'invadida') is null,
    'Bia não edita memória da Ana';
  assert jsonb_array_length(public.kazer_list_memories()) = 0, 'lista de memórias da Bia é vazia';

  -- A cota da Bia é independente.
  r := public.kazer_image_reserve('bia-chave-0001', 'cachorro', 1024, 1024, 1);
  assert r->>'reason' = '', 'Bia tem a própria imagem do dia';
  reset role;

  -- ---------- Ana continua com o que é dela ----------
  perform set_config('request.jwt.claim.sub', ana::text, true);
  set local role authenticated;
  mem := public.kazer_update_memory((mem->>'id')::uuid, 'Prefere respostas bem curtas');
  assert mem->>'content' = 'Prefere respostas bem curtas' and mem->>'updated_at' is not null,
    'Ana edita a própria memória';
  assert public.kazer_delete_image(job2), 'Ana tira a própria imagem da galeria';
  r := public.kazer_image_reserve('ana-chave-0006', 'depois de apagar', 1024, 1024, 1);
  assert r->>'reason' = 'quota', 'apagar a imagem não devolve a cota do dia';
  reset role;

  -- ---------- Dia seguinte (UTC): a cota volta ----------
  update public.kazer_image_jobs set day = day - 1 where user_id = ana;
  update public.kazer_image_usage set day = day - 1 where user_id = ana;
  perform set_config('request.jwt.claim.sub', ana::text, true);
  set local role authenticated;
  r := public.kazer_image_reserve('ana-chave-0007', 'novo dia', 1024, 1024, 1);
  job := (r->'job'->>'id')::uuid;
  assert job is not null, 'no dia seguinte a imagem volta';
  reset role;

  -- ---------- Reserva abandonada expira sozinha ----------
  update public.kazer_image_jobs set updated_at = now() - interval '20 minutes' where id = job;
  perform set_config('request.jwt.claim.sub', ana::text, true);
  set local role authenticated;
  r := public.kazer_image_usage_today(600);
  assert (r->>'active')::int = 0, 'reserva velha não prende a vaga';
  r := public.kazer_image_reserve('ana-chave-0008', 'depois do travamento', 1024, 1024, 1);
  assert r->>'reason' = '', 'vaga recuperada depois de um pedido abandonado';
  assert public.kazer_image_finish(job, true, 'demo', null, 'image/png', 9) is null,
    'pedido expirado não pode ser concluído depois';
  reset role;
end $$;

rollback;
