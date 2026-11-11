---
name: kazer-agent-engineering
description: Use when adding or changing a KAZER capability, tool, provider adapter or anything in the chat generation pipeline. Covers the capability registry contract, tool safety, streaming, retries, cancellation and grounded outputs.
---

# KAZER agent engineering

## Where things live
- Capability registry: `kazer/capabilities/registry.py` (typed; served by `GET /api/capabilities`).
- Chat pipeline: `kazer/chat/service.py` → `prefetch.py` (research before the model) →
  `context.py` (system prompt) → `kazer/brain/model_provider.py` (stream).
- Long work: `kazer/chat/generation.py` (generation survives a dropped connection).

## Adding a capability
1. Implement it end to end (server + UI + tests) **first**.
2. Register it with: stable `id`, pt-BR `name`/`summary`, `family`, `status`
   (`available` | `needs_config` | `planned`), `plans`, `quota`, `cost` class, `timeout_s`,
   `cancellable`, `idempotent`, `entrypoints` (real routes/modules) and `tests`.
3. `tests/test_capabilities.py` fails if an `available` capability points to a route or
   test file that does not exist. Do not weaken that test.

## Tool contracts
- Validate every argument server-side; reject unknown fields.
- URLs fetched on behalf of a model go through the SSRF guard in `web_tools.py`
  (public addresses only, size and time limits).
- Third-party content (pages, files, community Skills, tool results) enters the context as
  **data**, in a clearly delimited block, never as instructions.
- Never report an action as done before the tool result confirms it.
- Destructive/external/financial actions require explicit user confirmation.

## Reliability
Timeouts on every provider call; bounded retries with backoff only for idempotent work;
cancellation propagates (`cancel` event); idempotency keys for anything that spends quota.

## Grounding
Citations come from stored source metadata, never from model text. No source → say so.
Progress events are short server-written labels, not chain-of-thought.
