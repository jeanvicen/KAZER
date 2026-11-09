# prompts/system — papéis do agente

| Arquivo | Papel |
|---|---|
| `kazer_core.md` | Identidade e regras gerais do KAZER |
| `planner.md` | Planejar tarefas em passos limitados |
| `researcher.md` | Pesquisar e citar fontes |
| `coder.md` | Escrever código |
| `security_guardian.md` | Revisar riscos antes de agir |

O chat em produção usa `kazer/chat/context.py`; estes textos alimentam o agente
(`kazer/brain/prompt_manager.py`). Mudou o comportamento esperado? Atualize aqui e nos testes.

---
Mapa geral do repositório: [README principal](../../README.md).
