# Supabase do KAZER

As migrações desta pasta são aplicadas em ordem no projeto Supabase do KAZER. O Supabase Auth continua sendo a fonte de verdade para credenciais, sessão, expiração, renovação, login, cadastro e logout. O KAZER não grava senhas ou hashes em tabelas próprias.

## Migrações

| Ordem | Arquivo | Responsabilidade |
|---:|---|---|
| 1 | `001_auth_accounts.sql` | Perfis, preferências, trigger de provisionamento de conta e funções de atividade. |
| 2 | `002_inactivity_retention.sql` | Retenção de contas inativas. |
| 3 | `003_retention_notifications.sql` | Avisos privados de retenção e policies próprias. |
| 4 | `004_security_hardening.sql` | RLS, grants mínimos, constraints e revogações. |
| 5 | `009_google_drive_connections.sql` | Conexões privadas do Google Drive. |
| 6 | `010_mcp_github_tasks.sql` | Conectores MCP, conexão GitHub e tarefas sem metadados de cobrança. |
| 7 | `011_memories.sql` | Memórias isoladas por usuário. |
| 8 | `012_memory_group_title.sql` | Títulos de grupos de memória. |
| 9 | `013_memory_retention_cleanup.sql` | Retenção técnica de memórias não fixadas. |
| 10 | `015_direct_conversations.sql` | Diretório de nomes e conversas/mensagens 1-a-1 com RLS por participante. |
| 11 | `017_notification_retention.sql` | Confirmações globais e limpeza de avisos antigos. |
| 12 | `018_remove_consumption_controls.sql` | Remove tabelas, colunas, RPCs, triggers e políticas exclusivas do antigo controle de consumo. |

As migrações de conta e autenticação devem continuar sendo executadas antes das migrações de dados de usuário. A migração `018_remove_consumption_controls.sql` é corretiva para ambientes que já receberam o sistema antigo; em uma instalação nova, as migrações removidas não devem ser executadas.

## Auth e isolamento

O trigger de novo usuário cria apenas `profiles` e `user_settings`. As preferências de notificações, instalação, aparência e idioma podem ser sincronizadas para a conta autenticada, enquanto o navegador mantém um fallback local. Toda tabela de usuário permanece limitada por `auth.uid()` ou é acessada pelo backend autenticado.

## Retenção

O endpoint `/api/retention` é protegido por `CRON_SECRET`. A exclusão administrativa somente ocorre quando `RETENTION_DELETE_ENABLED=true`; mantenha essa flag como `false` até revisar backup, restauração, avisos, suporte e reversão. O job diário da Vercel cria avisos de inatividade e remove notificações antigas.

## Validação

Após aplicar a migração de limpeza, confirme que `profiles`, `user_settings`, `kazer_tasks`, `kazer_memories`, conectores e conversas continuam disponíveis. Confirme também que o cadastro cria perfil e preferências, que login, refresh e logout continuam usando Supabase Auth e que `/api/chat` não faz chamadas de consumo ou envio de anexos.
