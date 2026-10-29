-- The existing KAZER auth trigger provisions the monthly usage row on signup.
-- Keep this function small, idempotent and free of user-provided content.

begin;

create or replace function public.kazer_provision_usage(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.kazer_monthly_usage (user_id, period_start, message_count, attachment_count)
  values (target_user_id, date_trunc('month', now())::date, 0, 0)
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.kazer_provision_usage(uuid) from public, anon, authenticated;
grant execute on function public.kazer_provision_usage(uuid) to service_role;

commit;
