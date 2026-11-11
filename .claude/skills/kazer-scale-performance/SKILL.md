---
name: kazer-scale-performance
description: Use when a change affects request cost, concurrency, queues, caching, database load or bundle size, or when asked about how many users KAZER supports. Enforces measuring before claiming and keeping long work out of request handlers.
---

# KAZER scale & performance

## Facts about the current deployment
- One Starlette ASGI app on Vercel functions (stateless, no persistent disk, time-limited).
- Postgres + Auth + Storage on Supabase; model inference on Groq (shared rate limits,
  managed by `kazer/brain/groq_limits.py`).
- In-memory rate limiter and caches are **per instance** — fine as a courtesy limit,
  not a global guarantee. Hard limits live in Postgres.

## Rules
- Never claim capacity without a measurement: `python scripts/load_test.py` and record the
  machine, concurrency, and results in `docs/ESCALA.md` / `docs/architecture/target-architecture.md`.
  Separate "measured locally" from "estimated for production".
- Long-running work (image generation, large documents, renders) uses a durable job row
  (`queued → running → succeeded|failed`) with idempotency and a stale-job sweep; the HTTP
  request must stay well under the platform timeout.
- Paginate with cursors; never load unbounded history. Add an index only with a query that needs it.
- Cache only public or per-user-keyed data with explicit invalidation.
- Front-end: new screens are lazy modules; check file sizes before vendoring anything
  (`ls -la static/assets/vendor`).
- Provider calls: timeout, bounded retry, fallback, cancellation.

## Checklist
- [ ] Does the hot path (send message → first token) gain a query or a network hop? Measure.
- [ ] Is anything per-user stored in a module-level dict? It must be bounded.
- [ ] Polling respects `visibilityState` and backs off.
- [ ] Cost cliffs (GPU, egress, DB size) written down next to the feature.
