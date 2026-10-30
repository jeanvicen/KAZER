-- RLS: o papel `authenticated` (o que o PostgREST usa) só enxerga os próprios
-- dados, mesmo acessando as tabelas direto, sem passar pelas funções do chat.

begin;

do $$
declare
  ana uuid;
  bia uuid;
  conv uuid;
  visible integer;
begin
  insert into auth.users (email) values ('ana.rls@kazer.local') returning id into ana;
  insert into auth.users (email) values ('bia.rls@kazer.local') returning id into bia;
  insert into public.profiles (id, email) values (ana, 'ana.rls@kazer.local'), (bia, 'bia.rls@kazer.local');

  insert into public.conversations (user_id, title) values (ana, 'Só da Ana') returning id into conv;
  insert into public.messages (conversation_id, user_id, role, content, seq, status)
  values (conv, ana, 'user', 'segredo', 1, 'complete');
  insert into public.kazer_memories (user_id, content) values (ana, 'memória da Ana');
  insert into public.kazer_preferences (user_id, data) values (ana, '{"style":"direto"}');
  insert into public.kazer_artifacts (user_id, conversation_id, kind, title, content)
  values (ana, conv, 'code', 'script.py', 'print(1)');
  insert into public.kazer_plans (user_id, plan) values (ana, 'free'), (bia, 'pro');

  -- Como a Bia, pelo papel do PostgREST.
  perform set_config('request.jwt.claim.sub', bia::text, true);
  set local role authenticated;

  select count(*) into visible from public.conversations;
  assert visible = 0, 'RLS: Bia não vê conversa da Ana (viu ' || visible || ')';
  select count(*) into visible from public.messages;
  assert visible = 0, 'RLS: Bia não vê mensagem da Ana';
  select count(*) into visible from public.kazer_memories;
  assert visible = 0, 'RLS: Bia não vê memória da Ana';
  select count(*) into visible from public.kazer_preferences;
  assert visible = 0, 'RLS: Bia não vê preferência da Ana';
  select count(*) into visible from public.kazer_artifacts;
  assert visible = 0, 'RLS: Bia não vê artefato da Ana';

  -- Escrita em nome de outra conta é bloqueada pelo WITH CHECK.
  begin
    insert into public.kazer_memories (user_id, content) values (ana, 'injetada');
    raise exception 'RLS: a inserção em nome da Ana devia ter sido bloqueada';
  exception when insufficient_privilege then
    null;
  end;

  -- O plano não pode ser alterado pelo navegador: o cliente só tem SELECT.
  perform set_config('request.jwt.claim.sub', ana::text, true);
  begin
    update public.kazer_plans set plan = 'ultra' where user_id = ana;
    raise exception 'RLS: o cliente não devia conseguir mudar o próprio plano';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.kazer_plans (user_id, plan) values (ana, 'ultra');
    raise exception 'RLS: o cliente não devia conseguir criar o próprio plano';
  exception when insufficient_privilege then
    null;
  end;
  select count(*) into visible from public.kazer_plans where user_id = bia;
  assert visible = 0, 'RLS: Ana não vê o plano da Bia';

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'TODOS OS TESTES DE RLS PASSARAM';
end $$;

rollback;
