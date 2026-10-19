# Backend por domínio

Esta pasta concentra as implementações internas do backend do KAZER, agrupadas por responsabilidade. Ela não registra endpoints HTTP; as rotas serverless da Vercel ficam em `api/` e importam os módulos daqui.

| Pasta | Responsabilidade |
|---|---|
| `agent/` | Brain, contexto, instruções, Skills, sugestões da página inicial e executor de terminal isolado. |
| `integrations/` | GitHub, Google Drive, MCP e runtime de plugins. |
| `research/` | Orquestração de pesquisa, browser e utilitários de evidências. |
| `security/` | Segurança de requests, validação de URL/IP e proteções SSRF. |
| `storage/` | Acesso ao Supabase e às estruturas de dados compartilhadas. |
| `tasks/` | Handlers de tarefas e contexto de trabalho em segundo plano. |
| `usage/` | Regras de uso e limites. |

**Regra de organização:** novas rotas entram em `api/<rota>.js`; a lógica reutilizável entra em `server/<domínio>/`. Não duplique implementação dentro de `api/` nem mova o diretório de rotas sem revisar a configuração de deploy e os caminhos públicos.
