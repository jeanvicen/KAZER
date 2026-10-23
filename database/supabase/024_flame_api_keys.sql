-- KAZER: Flame API — chave de IA da própria pessoa (BYOK).
-- A chave é cifrada pelo backend (AES-256-GCM) e nunca é exposta ao cliente.

begin;

create table if not exists public.kazer_model_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic', 'gemini', 'groq', 'openrouter', 'deepseek', 'mistral', 'custom')),
  base_url text not null check (base_url like 'https://%'),
  model text not null check (char_length(model) between 1 and 120),
  api_key_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists kazer_model_keys_updated_at on public.kazer_model_keys;
create trigger kazer_model_keys_updated_at
before update on public.kazer_model_keys
for each row execute function public.kazer_touch_updated_at();

alter table public.kazer_model_keys enable row level security;
alter table public.kazer_model_keys force row level security;
revoke all on public.kazer_model_keys from public, anon, authenticated;

comment on table public.kazer_model_keys is 'Flame API: provedor, modelo e chave cifrada da pessoa; acessada somente pelo backend.';

commit;
