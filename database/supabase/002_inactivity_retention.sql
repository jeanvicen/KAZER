-- Kazer: índice para a rotina de retenção de contas.
-- Não apaga, altera ou desativa nenhum usuário.

create index if not exists user_settings_last_activity_at_idx
on public.user_settings (last_activity_at);

comment on column public.user_settings.last_activity_at is
  'Último login ou uso registrado do Kazer; a conta pode ser retida até completar três anos sem atividade.';
