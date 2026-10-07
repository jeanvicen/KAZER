do $$
declare
  rls_enabled boolean;
  rls_forced boolean;
  affected integer;
begin
  select c.relrowsecurity, c.relforcerowsecurity
    into rls_enabled, rls_forced
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'kazer_mcp_approvals';
  if rls_enabled is distinct from true or rls_forced is distinct from true then
    raise exception 'approval table must enable and force RLS';
  end if;
  if has_table_privilege('anon', 'public.kazer_mcp_approvals', 'SELECT')
    or has_table_privilege('anon', 'public.kazer_mcp_approvals', 'INSERT')
    or has_table_privilege('authenticated', 'public.kazer_mcp_approvals', 'SELECT')
    or has_table_privilege('authenticated', 'public.kazer_mcp_approvals', 'INSERT') then
    raise exception 'client roles must not access approval tickets directly';
  end if;
  if not has_table_privilege('service_role', 'public.kazer_mcp_approvals', 'SELECT')
    or not has_table_privilege('service_role', 'public.kazer_mcp_approvals', 'INSERT')
    or not has_table_privilege('service_role', 'public.kazer_mcp_approvals', 'UPDATE')
    or not has_table_privilege('service_role', 'public.kazer_mcp_approvals', 'DELETE') then
    raise exception 'server role lacks approval ticket privileges';
  end if;

  insert into auth.users (id) values ('00000000-0000-4000-8000-000000000001');
  insert into public.kazer_mcp_approvals (id, user_id, payload_encrypted, expires_at)
    values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'v1.ciphertext', now() + interval '5 minutes');
  update public.kazer_mcp_approvals
    set status = 'processing', claimed_at = now()
    where id = '00000000-0000-4000-8000-000000000002' and status = 'pending';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'first approval claim must win'; end if;
  update public.kazer_mcp_approvals
    set status = 'processing', claimed_at = now()
    where id = '00000000-0000-4000-8000-000000000002' and status = 'pending';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'approval ticket must be single-use'; end if;
  update public.kazer_mcp_approvals
    set status = 'approved', payload_encrypted = null, completed_at = now()
    where id = '00000000-0000-4000-8000-000000000002' and status = 'processing';
end
$$;
