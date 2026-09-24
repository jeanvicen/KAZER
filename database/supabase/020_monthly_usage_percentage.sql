-- KAZER: uso mensal gradual por usuário.
-- Regra: 10 eventos (mensagens + anexos) = 1%; 1000 eventos = 100%.
-- O período é calculado em UTC e reinicia automaticamente no primeiro dia do mês.

begin;

create table if not exists public.kazer_monthly_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  period_start date not null,
  message_count bigint not null default 0 check (message_count >= 0),
  attachment_count bigint not null default 0 check (attachment_count >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists kazer_monthly_usage_period_idx
  on public.kazer_monthly_usage (period_start, updated_at desc);

alter table public.kazer_monthly_usage enable row level security;
alter table public.kazer_monthly_usage force row level security;
revoke all on public.kazer_monthly_usage from public, anon, authenticated;

create or replace function public.kazer_current_period_start()
returns date
language sql
stable
as $$
  select date_trunc('month', timezone('UTC', now()))::date;
$$;

create or replace function public.kazer_next_period_start()
returns timestamptz
language sql
stable
as $$
  select (date_trunc('month', timezone('UTC', now())) + interval '1 month') at time zone 'UTC';
$$;

create or replace function public.kazer_prepare_monthly_usage(p_user_id uuid)
returns public.kazer_monthly_usage
language plpgsql
security definer
set search_path = public
as $$
declare
  current_period date := public.kazer_current_period_start();
  usage_row public.kazer_monthly_usage;
begin
  if p_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  insert into public.kazer_monthly_usage (user_id, period_start)
  values (p_user_id, current_period)
  on conflict (user_id) do nothing;

  select * into usage_row
  from public.kazer_monthly_usage
  where user_id = p_user_id
  for update;

  if usage_row.period_start <> current_period then
    update public.kazer_monthly_usage
    set period_start = current_period,
        message_count = 0,
        attachment_count = 0,
        updated_at = now()
    where user_id = p_user_id
    returning * into usage_row;
  end if;

  return usage_row;
end;
$$;

create or replace function public.get_my_usage()
returns table (
  plan text,
  usage_percent integer,
  usage_percentage integer,
  percent_used integer,
  monthly_message_count bigint,
  monthly_attachment_count bigint,
  monthly_event_count bigint,
  usage_limit integer,
  usage_used bigint,
  usage_limit_reached boolean,
  next_reset_at timestamptz,
  monthly_reset_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  usage_row public.kazer_monthly_usage;
  total_events bigint;
  used_percent integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  usage_row := public.kazer_prepare_monthly_usage(auth.uid());
  total_events := usage_row.message_count + usage_row.attachment_count;
  used_percent := least(100, floor(total_events::numeric / 10)::integer);

  return query select
    'free'::text,
    used_percent,
    used_percent,
    used_percent,
    usage_row.message_count,
    usage_row.attachment_count,
    total_events,
    1000,
    total_events,
    total_events >= 1000,
    public.kazer_next_period_start(),
    public.kazer_next_period_start();
end;
$$;

create or replace function public.consume_kazer_usage(
  p_message_count integer default 1,
  p_attachment_count integer default 0
)
returns table (
  plan text,
  usage_percent integer,
  usage_percentage integer,
  percent_used integer,
  monthly_message_count bigint,
  monthly_attachment_count bigint,
  monthly_event_count bigint,
  usage_limit integer,
  usage_used bigint,
  usage_limit_reached boolean,
  next_reset_at timestamptz,
  monthly_reset_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  usage_row public.kazer_monthly_usage;
  requested_messages integer := greatest(0, coalesce(p_message_count, 0));
  requested_attachments integer := greatest(0, coalesce(p_attachment_count, 0));
  current_events bigint;
  requested_events bigint;
  total_events bigint;
  used_percent integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if requested_messages = 0 and requested_attachments = 0 then
    raise exception 'invalid_usage_amount' using errcode = '22023';
  end if;
  if requested_messages > 1 or requested_attachments > 10 then
    raise exception 'usage_amount_too_large' using errcode = '22023';
  end if;

  usage_row := public.kazer_prepare_monthly_usage(auth.uid());
  current_events := usage_row.message_count + usage_row.attachment_count;
  if current_events >= 1000 then
    raise exception 'usage_limit_reached' using errcode = 'P0001';
  end if;

  requested_events := requested_messages + requested_attachments;
  update public.kazer_monthly_usage
  set message_count = message_count + requested_messages,
      attachment_count = attachment_count + requested_attachments,
      updated_at = now()
  where user_id = auth.uid()
  returning * into usage_row;

  total_events := least(1000, usage_row.message_count + usage_row.attachment_count);
  used_percent := least(100, floor(total_events::numeric / 10)::integer);

  return query select
    'free'::text,
    used_percent,
    used_percent,
    used_percent,
    usage_row.message_count,
    usage_row.attachment_count,
    total_events,
    1000,
    total_events,
    total_events >= 1000,
    public.kazer_next_period_start(),
    public.kazer_next_period_start();
end;
$$;

revoke all on function public.kazer_current_period_start() from public, anon, authenticated;
revoke all on function public.kazer_next_period_start() from public, anon, authenticated;
revoke all on function public.kazer_prepare_monthly_usage(uuid) from public, anon, authenticated;
revoke all on function public.get_my_usage() from public, anon;
revoke all on function public.consume_kazer_usage(integer, integer) from public, anon;
grant execute on function public.get_my_usage() to authenticated;
grant execute on function public.consume_kazer_usage(integer, integer) to authenticated;

comment on table public.kazer_monthly_usage is 'Contagem mensal isolada por usuário: 10 eventos equivalem a 1% e o contador reinicia automaticamente no primeiro dia do mês UTC.';

commit;
