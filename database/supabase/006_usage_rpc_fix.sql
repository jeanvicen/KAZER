-- Correção: qualifica todas as colunas nas atualizações das RPCs para evitar
-- ambiguidade com variáveis de saída PL/pgSQL.

create or replace function public.consume_credits(p_amount integer)
returns table (credits_balance integer, credits_used integer, next_credit_reset_at timestamptz, credits_limit_reached boolean)
language plpgsql security definer set search_path = public
as $$
declare v public.user_usage;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000 then raise exception 'invalid_credit_amount'; end if;
  v := public.kazer_apply_usage_reset_locked(auth.uid());
  if v.credits_balance < p_amount then raise exception 'credits_limit_reached'; end if;
  update public.user_usage as u
  set credits_balance = u.credits_balance - p_amount,
      credits_used = u.credits_used + p_amount,
      updated_at = now()
  where u.user_id = auth.uid() and u.credits_balance >= p_amount
  returning u.credits_balance, u.credits_used, u.next_credit_reset_at, u.credits_balance <= 0
  into credits_balance, credits_used, next_credit_reset_at, credits_limit_reached;
  if not found then raise exception 'credits_limit_reached'; end if;
  return next;
end;
$$;

create or replace function public.consume_attachment()
returns table (attachment_count integer, attachment_limit integer, attachment_remaining integer,
  attachment_reset_at timestamptz, attachment_limit_reached boolean)
language plpgsql security definer set search_path = public
as $$
declare v public.user_usage;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v := public.kazer_apply_usage_reset_locked(auth.uid());
  if v.attachment_count >= v.attachment_limit then raise exception 'attachment_limit_reached'; end if;
  update public.user_usage as u
  set attachment_count = u.attachment_count + 1, updated_at = now()
  where u.user_id = auth.uid() and u.attachment_count < u.attachment_limit
  returning u.attachment_count, u.attachment_limit, greatest(u.attachment_limit - u.attachment_count, 0),
    u.attachment_reset_at, u.attachment_count >= u.attachment_limit
  into attachment_count, attachment_limit, attachment_remaining, attachment_reset_at, attachment_limit_reached;
  if not found then raise exception 'attachment_limit_reached'; end if;
  return next;
end;
$$;

create or replace function public.consume_chat_usage(p_credit_amount integer default 1, p_has_attachment boolean default false)
returns table (
  credits_balance integer, credits_used integer, next_credit_reset_at timestamptz,
  attachment_count integer, attachment_limit integer, attachment_remaining integer,
  attachment_reset_at timestamptz, credits_limit_reached boolean, attachment_limit_reached boolean
)
language plpgsql security definer set search_path = public
as $$
declare v public.user_usage;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_credit_amount is null or p_credit_amount <= 0 or p_credit_amount > 1000 then raise exception 'invalid_credit_amount'; end if;
  v := public.kazer_apply_usage_reset_locked(auth.uid());
  if v.credits_balance < p_credit_amount then raise exception 'credits_limit_reached'; end if;
  if p_has_attachment and v.attachment_count >= v.attachment_limit then raise exception 'attachment_limit_reached'; end if;
  update public.user_usage as u
  set credits_balance = u.credits_balance - p_credit_amount,
      credits_used = u.credits_used + p_credit_amount,
      attachment_count = u.attachment_count + case when p_has_attachment then 1 else 0 end,
      updated_at = now()
  where u.user_id = auth.uid()
    and u.credits_balance >= p_credit_amount
    and (not p_has_attachment or u.attachment_count < u.attachment_limit)
  returning u.credits_balance, u.credits_used, u.next_credit_reset_at,
    u.attachment_count, u.attachment_limit, greatest(u.attachment_limit - u.attachment_count, 0),
    u.attachment_reset_at, u.credits_balance <= 0, u.attachment_count >= u.attachment_limit
  into credits_balance, credits_used, next_credit_reset_at, attachment_count,
    attachment_limit, attachment_remaining, attachment_reset_at,
    credits_limit_reached, attachment_limit_reached;
  if not found then
    if p_has_attachment and v.attachment_count >= v.attachment_limit then raise exception 'attachment_limit_reached'; end if;
    raise exception 'credits_limit_reached';
  end if;
  return next;
end;
$$;

revoke all on function public.consume_credits(integer) from public, anon;
revoke all on function public.consume_attachment() from public, anon;
revoke all on function public.consume_chat_usage(integer, boolean) from public, anon;
grant execute on function public.consume_credits(integer) to authenticated;
grant execute on function public.consume_attachment() to authenticated;
grant execute on function public.consume_chat_usage(integer, boolean) to authenticated;
