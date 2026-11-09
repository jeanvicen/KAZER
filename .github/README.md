# .github — automação do GitHub

**O que é:** configurações que o próprio GitHub lê: testes automáticos (CI),
atualização de dependências, donos do código e modelos de issue/PR.

| Arquivo/pasta | Para que serve |
|---|---|
| `workflows/` | CI: lint + testes Python + sintaxe do JavaScript + conferência do painel de controle a cada push e PR |
| `ISSUE_TEMPLATE/` | Modelos para abrir issue (`bug.md`, `ideia.md`) |
| `pull_request_template.md` | Roteiro que aparece ao abrir um PR |
| `dependabot.yml` | Abre PRs sozinho quando sai versão nova de dependência |
| `CODEOWNERS` | Quem precisa revisar cada parte |

**Cuidados**
- **Não crie README dentro de `ISSUE_TEMPLATE/`**: o GitHub trata todo `.md` ali
  como modelo de issue (apareceria um modelo chamado "README").
- O CI precisa ficar verde antes de ir para a `main`; nunca desligue um teste
  para "passar".

---
Mapa geral do repositório: [README principal](../README.md).
