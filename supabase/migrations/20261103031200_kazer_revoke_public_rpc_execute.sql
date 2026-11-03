-- KAZER: remove execução pública herdada pelas RPCs autenticadas.
-- Revogar apenas de anon não basta porque anon herda EXECUTE de PUBLIC.

begin;

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'kazer_%' or p.proname in ('touch_valid_activity', 'touch_user_activity'))
  loop
    execute format('revoke execute on function %s from public, anon', fn.sig);
  end loop;
end $$;

commit;
