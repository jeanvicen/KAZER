-- Remoção definitiva do recurso de Skills e dos dados associados.
begin;
drop function if exists public.kazer_delete_skill(uuid);
drop function if exists public.kazer_update_skill(uuid, text, text, text, boolean, boolean);
drop function if exists public.kazer_create_skill(text, text, text, text, integer);
drop function if exists public.kazer_skill(uuid, boolean);
drop function if exists public.kazer_shared_skills(text, integer);
drop function if exists public.kazer_skills();
drop function if exists public.kazer_skill_json(public.kazer_skills, boolean);
drop table if exists public.kazer_skills;
commit;
