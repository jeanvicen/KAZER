# kazer/runtime — execução isolada (esqueleto)

**O que é:** contratos para o agente rodar tarefas com limite e isolamento
(fila, agendador, sandbox).

**Estado:** esqueleto (contratos e tipos). O produto em produção não depende desta pasta ainda.

| Arquivo | Contrato |
|---|---|
| `task_queue.py` | Fila com limites e idempotência |
| `scheduler.py` | Agendamento com limite de concorrência |
| `worker.py` | Processa uma tarefa de forma controlada |
| `process_manager.py` | Ciclo de vida de processos isolados |
| `sandbox.py` | Execução descartável com recursos limitados |

---
Mapa geral do repositório: [README principal](../../README.md).
