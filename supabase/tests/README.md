# supabase/tests — testes SQL do banco

**O que é:** testes que rodam **dentro do Postgres** para provar que uma pessoa
não lê nem altera dado de outra.

| Arquivo | Testa |
|---|---|
| `rls_test.sql` | Políticas RLS gerais |
| `chat_storage_test.sql` | Conversas e mensagens |
| `library_test.sql` | Biblioteca |
| `projects_skills_test.sql` | Projetos e Skills |
| `connections_test.sql` | Conectores |

Rode contra um banco local/branch do Supabase, nunca contra produção com dados reais.

---
Mapa geral do repositório: [README principal](../../README.md).
