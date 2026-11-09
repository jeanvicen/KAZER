# supabase/migrations — migrações do banco

**O que é:** cada arquivo muda o banco um passo. O nome começa com a data
(`AAAAMMDDHHMMSS_nome.sql`) e a ordem é a ordem do nome.

| Migração | O que faz |
|---|---|
| `…131800_kazer_supabase_foundation` | Base: perfis e RLS |
| `…132400_fix_auth_signup_provisioning` | Correção do cadastro |
| `…180000_kazer_chat_storage` | Tabelas do chat |
| `…181000_kazer_chat_operations` | Funções do chat |
| `…120000_kazer_library` | Biblioteca |
| `…160000_kazer_projects_skills` | Projetos e Skills |
| `…190000_kazer_connections` | Conectores |
| `…031000_kazer_harden_rpc_permissions` / `…031200_kazer_revoke_public_rpc_execute` | Endurecimento de permissões |
| `…120000_kazer_billing` (2026-11-06) | Cobrança e créditos |

**Regras**
- **Nunca edite uma migração já aplicada**: crie uma nova.
- Toda tabela nova: `enable row level security` + políticas por `auth.uid()`.
- Funções `security definer` com `search_path` fixo e `execute` revogado de `public`.

---
Mapa geral do repositório: [README principal](../../README.md).
