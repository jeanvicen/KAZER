# kazer/tools — ferramentas do agente (contratos)

**O que é:** o contrato de cada ferramenta que um agente poderia usar, com
permissão declarada. A pesquisa que funciona hoje no chat está em
`kazer/chat/web_tools.py` e `kazer/chat/prefetch.py`.

**Estado:** esqueleto (contratos e tipos). O produto em produção não depende desta pasta ainda.

| Arquivo | Ferramenta |
|---|---|
| `base_tool.py` | Contrato comum |
| `registry.py` | Registro/descoberta (sem dar permissão) |
| `web_search.py`, `browser.py` | Busca e navegação (conteúdo externo = dado não confiável) |
| `api_client.py` | Chamadas só a destinos autorizados |
| `filesystem.py` | Só dentro do workspace |
| `database.py` | Limitado por escopo da pessoa |
| `code_runner.py` | Só em sandbox |
| `messaging.py` | Mensagem externa exige aprovação humana |

Declarações: `kazer/config/tools.yaml` e `permissions.yaml`. Guia: `docs/tool-development.md`.

---
Mapa geral do repositório: [README principal](../../README.md).
