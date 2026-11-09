# prompts — textos de instrução para modelos

**O que é:** prompts versionados em Markdown, separados do código.

| Pasta | Conteúdo |
|---|---|
| `system/` | Papéis do agente (núcleo, programador, planejador, pesquisador, guardião) |
| `templates/` | Reservado para templates tipados |
| `tools/` | Reservado para orientações por ferramenta |

**Atenção:** o prompt que o chat em produção usa hoje é montado em
`kazer/chat/context.py`. Estes arquivos são a base do agente (`kazer/brain/prompt_manager.py`).
Nunca coloque segredo em prompt.

---
Mapa geral do repositório: [README principal](../README.md).
