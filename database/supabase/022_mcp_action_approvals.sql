-- One-time, per-action approval tickets for remote MCP tool calls.
-- Payloads are authenticated-encrypted by the API and readable only by service_role.
create table if not exists public.kazer_mcp_approvals (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'approved', 'denied', 'error')),
  payload_encrypted text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  constraint kazer_mcp_approvals_payload_lifecycle_check check (
    (status in ('pending', 'processing') and payload_encrypted is not null and char_length(payload_encrypted) between 1 and 1000000)
    or (status in ('approved', 'denied', 'error') and payload_encrypted is null)
  ),
  constraint kazer_mcp_approvals_expiry_check check (
    expires_at > created_at and expires_at <= created_at + interval '15 minutes'
  ),
  constraint kazer_mcp_approvals_claim_state_check check (
    (status = 'pending' and claimed_at is null and completed_at is null)
    or (status = 'processing' and claimed_at is not null and completed_at is null)
    or (status in ('approved', 'denied', 'error') and claimed_at is not null and completed_at is not null)
  )
);

create index if not exists kazer_mcp_approvals_user_status_expiry_idx
  on public.kazer_mcp_approvals (user_id, status, expires_at);
create index if not exists kazer_mcp_approvals_expiry_idx
  on public.kazer_mcp_approvals (expires_at);

alter table public.kazer_mcp_approvals enable row level security;
alter table public.kazer_mcp_approvals force row level security;
revoke all on public.kazer_mcp_approvals from public, anon, authenticated;
grant all on public.kazer_mcp_approvals to service_role;

comment on table public.kazer_mcp_approvals is
  'Short-lived, single-use MCP action approvals. Encrypted payloads are accessible only to the KAZER server role.';
