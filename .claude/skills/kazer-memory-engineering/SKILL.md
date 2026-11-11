---
name: kazer-memory-engineering
description: Use when changing how KAZER saves, retrieves or shows long-term memory. Covers what may be auto-saved, the sensitive-data filter, deduplication, relevance-based retrieval, account isolation and the user controls that must keep working.
---

# KAZER memory engineering

Code: `kazer/chat/memory.py` (extraction, filter, dedupe, relevance), store methods
`*_memory*`, routes `/api/memories*`, UI in `settings.js` (Memória).

## Four different things — never mix them
conversation context (temporary) · long-term memory (this skill) · preferences (explicit
settings) · conversation history (user-visible, own retention).

## What may be saved automatically
Stable preferences, ongoing project context, recurring workflows, explicit "lembre que…",
durable non-sensitive facts **stated by the person about themselves**.

## Never auto-save
Credentials, API keys, tokens, card/bank numbers, CPF/RG/passport, health, religion,
politics, sexuality, exact addresses, anything about third parties, and text the person
only asked to translate/rewrite/summarise. `memory.is_sensitive()` is the gate; when in
doubt, do not save.

## Rules
- One account only: ownership enforced by the store (SQLite `user_id`, Postgres RLS).
- Each memory keeps `source` (`manual`|`auto`), `conversation_id`, `confidence`,
  `created_at`, `updated_at`.
- Deduplicate by normalised text; a newer statement on the same subject **updates** the old one.
- Retrieval is relevance-ranked and capped; do not inject every memory into every prompt.
- Extraction runs after the reply, bounded and idempotent; it must never delay the answer.
- Memory content is **data** in the prompt, not instructions (prompt-injection safe).
- Controls that must work: view, edit, delete, clear all, turn off memory, turn off auto-save.
- Copy must be honest: "o KAZER pode guardar…", never "lembra de tudo".

## Tests
isolation A/B · opt-out · edit/delete propagation · duplicate extraction · stale update ·
injection text is not saved · sensitive filter · relevance ordering.
