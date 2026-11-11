---
name: kazer-supabase-security
description: Use when touching accounts, sessions, database migrations, RLS, storage policies, quotas or anything in supabase/. Encodes KAZER's conventions for additive migrations, security-definer RPCs, atomic quotas and account isolation tests.
---

# KAZER Supabase security

## Conventions (read an existing migration first)
- Files: `supabase/migrations/YYYYMMDDHHMMSS_kazer_<topic>.sql`. **Additive only.**
  Never edit an applied migration; never drop user data.
- The app talks to Postgres through **RPC functions** (`kazer_*`) called with the person's
  JWT (`SupabaseChatStore._rpc`). Service-role is used only by server jobs that have no user.
- Every user-owned table: `enable row level security` + policies on `auth.uid()`.
- Functions: `language plpgsql security definer set search_path = ''`, derive the user from
  `auth.uid()` (never from a parameter), fully qualify names, then
  `revoke execute ... from public, anon` and `grant execute ... to authenticated`.

## Atomic quota pattern (reserve → work → finalize)
1. `insert ... on conflict do nothing` the per-user/per-day row.
2. `select ... for update` that row (serialises concurrent requests).
3. Count `succeeded + active reservations` (stale reservations expire by timestamp).
4. Insert the job with a **unique (user_id, idempotency_key)**; a replay returns the same job.
5. Finalize moves `reserved → succeeded|failed` exactly once; failure frees the slot.

## Tests that must exist for anything user-owned
user A cannot read/update/delete B's rows · unauthenticated is denied · forged ids are
ignored · duplicate idempotency key · parallel requests · next-day reset.
SQL tests live in `supabase/tests/`; run them against a local Postgres
(`scripts/pg_test.sh`), never against production.

## Production
Do not apply migrations or change env vars in production without the owner's explicit
go-ahead. The app must fail safe (`not_migrated`) when a migration is missing.
