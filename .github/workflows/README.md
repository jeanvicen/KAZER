# .github/workflows — CI (testes automáticos)

**O que é:** os fluxos que o GitHub Actions roda a cada `push` na `main` e em todo PR.

| Arquivo | Jobs |
|---|---|
| `ci.yml` | **python**: instala (`pip install -e ".[dev]"`), `ruff check .`, confere `controle-de-notificacao/controle.yaml` (`python scripts/controle.py`) e roda `pytest -q`.<br>**web**: `node --check` em todo `.js` de `kazer/interfaces/web/static`. |

**Como usar**
- Ver resultado: aba **Actions** do repositório (ou o selo no README principal).
- Rodar o mesmo localmente: `make lint && make test` e
  `find kazer/interfaces/web/static -name '*.js' -print0 | xargs -0 -n1 node --check`.

**Cuidados**
- Permissões mínimas (`contents: read`). Não adicione segredos aqui sem necessidade.
- O deploy **não** é feito por este CI: quem publica é a integração Git da Vercel (push na `main`).

---
Mapa geral do repositório: [README principal](../../README.md).
