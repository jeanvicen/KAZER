-- Kazer: endurecimento final de uso e créditos.
-- Não altera saldos, valores, recargas, janelas ou limites do plano.
-- Execute depois de 015_direct_conversations.sql.

-- Essas tabelas nunca devem ser consultadas ou alteradas diretamente por clientes.
-- O acesso legítimo ocorre somente pelos RPCs autenticados abaixo, que validam auth.uid().
alter table public.plan_catalog force row level security;
alter table public.user_usage force row level security;

-- Remove superfícies RPC antigas que podiam ser chamadas diretamente por clientes.
-- A aplicação atual usa get_my_usage() e consume_kazer_usage(integer, integer).
revoke all on function public.consume_credits(integer) from public, anon, authenticated;
revoke all on function public.consume_attachment() from public, anon, authenticated;
revoke all on function public.consume_chat_usage(integer, boolean) from public, anon, authenticated;
revoke all on function public.consume_chat_usage(integer, integer) from public, anon, authenticated;

-- Reafirma os únicos RPCs de uso destinados ao cliente autenticado.
revoke all on function public.get_my_usage() from public, anon;
revoke all on function public.consume_kazer_usage(integer, integer) from public, anon;
grant execute on function public.get_my_usage() to authenticated;
grant execute on function public.consume_kazer_usage(integer, integer) to authenticated;

comment on table public.plan_catalog is 'Configuração central da política atual de créditos; acesso direto bloqueado por RLS forçado.';
comment on table public.user_usage is 'Saldo persistente isolado por usuário; acesso direto bloqueado por RLS forçado e consumo somente via RPC autenticado.';
