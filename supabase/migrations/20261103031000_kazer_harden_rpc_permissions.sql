-- KAZER: endurece as RPCs expostas pelo PostgREST.
-- As funções validam auth.uid(), mas não precisam ser invocáveis por anon.
-- Também fixa o search_path dos helpers SQL usados por funções SECURITY DEFINER.

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
       and (p.proname like 'kazer_%' or p.proname = 'touch_valid_activity')
  loop
    execute format('revoke execute on function %s from anon', fn.sig);
  end loop;
end $$;

alter function public.kazer_plan_quota(text) set search_path = public;
alter function public.kazer_artifact_json(public.kazer_artifacts, boolean) set search_path = public;
alter function public.kazer_project_json(public.kazer_projects, bigint) set search_path = public;
alter function public.kazer_connection_json(public.kazer_connections) set search_path = public;

commit;
