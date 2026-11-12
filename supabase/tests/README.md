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
| `images_studio_memory_test.sql` | Cota de imagens (ciclo, repetição, dia seguinte, reserva abandonada), Studio e memória: isolamento entre contas e escrita direta negada |

Rode com `bash scripts/pg_test.sh` (Postgres local descartável) ou contra um branch do
Supabase; nunca contra produção com dados reais.

---
Mapa geral do repositório: [README principal](../../README.md).
