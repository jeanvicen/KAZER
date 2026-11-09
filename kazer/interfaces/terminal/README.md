# kazer/interfaces/terminal — KAZER no terminal

**O que é:** um cliente de linha de comando que conversa com o KAZER pela **mesma
API do site** (mesma conta, mesmas conversas).

| Arquivo | Papel |
|---|---|
| `__main__.py` | `python -m kazer.interfaces.terminal` |
| `shell.py` | Laço principal: login, conversa, comandos |
| `client.py` | Chamadas HTTP para `/api/*` |
| `credentials.py` | Onde a sessão fica salva (arquivo só da pessoa, permissão restrita) |
| `render.py` | Cores, marca e resposta ao vivo no terminal |
| `__init__.py` | Exporta `main` |

**Cuidados:** respeita o modo manutenção (o servidor responde `503 maintenance`).
Testes: `tests/test_terminal.py`.

---
Mapa geral do repositório: [README principal](../../../README.md).
