# supabase — banco de dados de produção

**O que é:** o esquema do Postgres do Supabase onde ficam contas, conversas,
biblioteca, projetos, Skills e cobrança. **Toda tabela tem RLS** (cada pessoa só
enxerga o que é dela).

| Pasta | Conteúdo |
|---|---|
| `migrations/` | Migrações SQL em ordem de data (aplicadas uma vez, nunca editadas depois) |
| `tests/` | Testes SQL de RLS e das funções |

Guia: `docs/supabase-chat-storage.md` e `docs/supabase-integration-status.md`.

---
Mapa geral do repositório: [README principal](../README.md).
