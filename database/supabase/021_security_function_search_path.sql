-- KAZER: endurece o search_path das funções auxiliares de uso mensal.
-- Não altera dados nem a assinatura das funções.

begin;

alter function public.kazer_current_period_start()
  set search_path = public;

alter function public.kazer_next_period_start()
  set search_path = public;

commit;
