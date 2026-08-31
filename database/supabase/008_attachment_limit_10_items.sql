-- Kazer: limite unificado de 10 fotos/arquivos por usuário a cada 5 horas.
-- Cada item enviado conta individualmente, independentemente do tipo.

update public.plan_catalog
set attachment_limit = 10, updated_at = now()
where plan = 'free';

update public.user_usage u
set attachment_limit = p.attachment_limit,
    credit_window_hours = p.credit_window_hours,
    updated_at = now()
from public.plan_catalog p
where p.plan = u.plan;

-- Remove a assinatura anterior que contava apenas 1 por mensagem com anexo.
drop function if exists public.consume_chat_usage(integer, boolean);

create or replace function public.consume_chat_usage(
  p_credit_amount integer default 10,
  p_attachment_count integer default 0
)
returns table (
  credits_balance integer, credits_used integer, next_credit_reset_at timestamptz,
  attachment_count integer, attachment_limit integer, attachment_remaining integer,
  attachment_reset_at timestamptz, credits_limit_reached boolean, attachment_limit_reached boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare v public.user_usage;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_credit_amount is null or p_credit_amount <= 0 or p_credit_amount > 1000 then raise exception 'invalid_credit_amount'; end if;
  if p_attachment_count is null or p_attachment_count < 0 or p_attachment_count > 10 then raise exception 'invalid_attachment_count'; end if;
  v := public.kazer_apply_usage_reset_locked(auth.uid());
  if v.credits_balance < p_credit_amount then raise exception 'credits_limit_reached'; end if;
  if v.attachment_count + p_attachment_count > v.attachment_limit then raise exception 'attachment_limit_reached'; end if;
  update public.user_usage as u
  set credits_balance = u.credits_balance - p_credit_amount,
      credits_used = u.credits_used + p_credit_amount,
      attachment_count = u.attachment_count + p_attachment_count,
      updated_at = now()
  where u.user_id = auth.uid()
    and u.credits_balance >= p_credit_amount
    and u.attachment_count + p_attachment_count <= u.attachment_limit
  returning u.credits_balance, u.credits_used, u.next_credit_reset_at,
    u.attachment_count, u.attachment_limit, greatest(u.attachment_limit - u.attachment_count, 0),
    u.attachment_reset_at, u.credits_balance <= 0, u.attachment_count >= u.attachment_limit
  into credits_balance, credits_used, next_credit_reset_at, attachment_count,
    attachment_limit, attachment_remaining, attachment_reset_at,
    credits_limit_reached, attachment_limit_reached;
  if not found then
    if v.attachment_count + p_attachment_count > v.attachment_limit then raise exception 'attachment_limit_reached'; end if;
    raise exception 'credits_limit_reached';
  end if;
  return next;
end;
$$;

revoke all on function public.consume_chat_usage(integer, integer) from public, anon;
grant execute on function public.consume_chat_usage(integer, integer) to authenticated;
comment on function public.consume_chat_usage(integer, integer) is 'Consome créditos e contabiliza cada foto/arquivo individualmente, com limite de 10 itens a cada 5 horas.';
