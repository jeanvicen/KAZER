# kazer/memory — memória do agente (esqueleto)

**O que é:** contratos da memória do agente: curta (só a conversa), longa (com
consentimento e retenção) e por projeto, sempre isolada por pessoa.

**Estado:** esqueleto (contratos e tipos). O produto em produção não depende desta pasta ainda.

| Arquivo | Contrato |
|---|---|
| `base.py` | Interface comum de memória com escopo |
| `short_term.py` | Contexto efêmero da conversa atual |
| `long_term.py` | Memória persistente com retenção e consentimento |
| `project_memory.py` | Memória separada por pessoa e projeto |
| `vector_store.py` | Busca semântica filtrada por escopo |
| `memory_policy.py` | Retenção, expiração, isolamento e limpeza |

A "Memória" que a pessoa vê em Configurações hoje é do chat (`kazer/chat/service.py`).
Desenho completo: `docs/memory-design.md`. Testes: `tests/test_memory.py`.

---
Mapa geral do repositório: [README principal](../../README.md).
