# kazer/core — núcleo do agente (esqueleto)

**O que é:** os contratos do agente autônomo do KAZER: planejar, rotear, executar
com aprovação. **Ainda não está ligado ao site** — o chat de produção mora em
`kazer/chat/`. Isto é a base para a evolução "agente que executa tarefas".

| Arquivo | Contrato |
|---|---|
| `agent.py` | Fachada do agente e composição de dependências |
| `orchestrator.py` | Coordena planejamento, memória, ferramentas e execução |
| `planner.py` | Objetivo → plano estruturado e limitado |
| `router.py` | Escolhe fluxo, agente especializado ou ferramenta |
| `executor.py` | Executa **só** ação autorizada e aprovada |
| `events.py` | Eventos internos mínimos e auditáveis |
| `state.py` | Estado isolado por sessão/tarefa |

**Para agentes:** antes de implementar, leia `ARCHITECTURE.md` e
`docs/agent-lifecycle.md`. Testes estruturais: `tests/test_core.py`.

---
Mapa geral do repositório: [README principal](../../README.md).
