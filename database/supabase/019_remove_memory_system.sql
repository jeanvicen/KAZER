-- KAZER: remoção definitiva do sistema de memórias.
-- A confirmação explícita do usuário autorizou apagar os dados existentes.

drop table if exists public.kazer_memories cascade;
drop function if exists public.kazer_memories_touch_updated_at();
drop function if exists public.kazer_memories_enforce_limit();

-- A operação é intencionalmente destrutiva: a tabela já não deve existir após esta migração.
