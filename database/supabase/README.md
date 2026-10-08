# Supabase do KAZER

Esta pasta contém migrações incrementais. O Supabase Auth continua sendo a fonte de verdade para credenciais e sessões. Este documento descreve os arquivos versionados; **não comprova que eles foram aplicados ao projeto de produção**.

## Estado e ordem versionada

| Migração | Responsabilidade resumida |
|---|---|
| `001_auth_accounts.sql`–`004_security_hardening.sql` | Conta, preferências, retenção, políticas iniciais, grants e reforço de segurança. |
| `009_google_drive_connections.sql` | Conexões do Google Drive. |
| `010_mcp_github_tasks.sql` | Conectores, vínculo GitHub e tarefas. |
| `015_direct_conversations.sql` | Conversas diretas e políticas associadas. |
| `016_security_rls_rpc_cleanup.sql` | Limpeza/endurecimento de RLS e RPCs; contém dependências de objetos legados. |
| `017_notification_retention.sql` | Retenção de notificações. |
| `018_remove_consumption_controls.sql` | Remove componentes do sistema antigo de consumo. É corretiva/destrutiva em bases que receberam esse sistema. |
| `019_remove_memory_system.sql` | Remove componentes e dados do sistema de memória anterior. É corretiva/destrutiva em bases que receberam esse sistema. |
| `020_monthly_usage_percentage.sql` | RPC/estrutura de uso mensal atual do código. |
| `021_security_function_search_path.sql` | Endurece `search_path` de funções SQL. |
| `022_mcp_action_approvals.sql` | Armazena tickets temporários, cifrados e de uso único para confirmação explícita de ações MCP. |

Consulte o SQL de cada migração e o histórico efetivamente aplicado antes de qualquer operação. Numerações ausentes refletem a sequência versionada atual e não são um convite para recriar objetos históricos por conta própria.

## Limitação de instalação limpa e compatibilidade

A sequência versionada **não pode ser tratada como baseline autossuficiente para um banco vazio**: a migração `016_security_rls_rpc_cleanup.sql` referencia objetos legados (incluindo `plan_catalog`, `user_usage` e RPCs anteriores) que não são criados pelas migrações anteriores presentes neste repositório. As migrações corretivas posteriores e a `020` representam a evolução de uma base existente, mas não demonstram um caminho validado para instalação limpa.

O procedimento seguro é primeiro identificar, em um ambiente isolado, o histórico/schema esperado e comparar com a lista de migrações. Não invente nem aplique uma migration baseline, não pule/reordene migrações e não use a produção como ambiente de diagnóstico. Uma estratégia de bootstrap/upgrade precisa ser desenhada e testada separadamente com inventário de schemas suportados, snapshots e rollback.

## RLS, isolamento e produção

As políticas SQL revisadas indicam escopo por usuário/participante em grande parte das tabelas, mas isso **não é prova de isolamento efetivo em produção**. Não há teste automatizado de duas contas cross-tenant. Permanecem pontos a confirmar, incluindo ausência de `FORCE ROW LEVEL SECURITY` em tabelas de mensagens diretas, concessões de leitura anteriores em `profiles` e filtros explícitos por usuário em handlers que usam service role.

Antes de aprovar o estado de produção, revisar grants, policies, ownership e privilégios de funções; testar com duas contas distintas e IDs cruzados em ambiente de teste isolado; e conferir a configuração real do projeto. Nenhuma consulta/migração foi aplicada como parte desta documentação.

## Aprovação segura de ações MCP

A migração `022_mcp_action_approvals.sql` cria uma tabela isolada de tickets, sem acesso direto para `anon` ou `authenticated`; o servidor usa `service_role`. O payload é cifrado com a chave de criptografia de conectores, tem validade de cinco minutos e é apagado ao consumir a aprovação. A reivindicação é uma atualização condicional `status=pending`, de modo que apenas uma solicitação concorrente pode consumir o ticket.

A API depende dessa tabela e falha de forma segura, sem executar a ferramenta, se o armazenamento de confirmação não estiver disponível. Portanto, em um ambiente de upgrade já inventariado e com backup, aplique e verifique `022` antes de ativar o código correspondente. O teste PostgreSQL do CI verifica somente essa migração sobre um fixture mínimo; não valida o bootstrap histórico completo nem o estado de produção.

## Retenção e operações

O endpoint `/api/retention` usa `CRON_SECRET`; a exclusão permanente depende de configuração explícita. Mantenha a exclusão desativada até haver procedimento validado de backup, restauração, avisos e reversão. Não execute tarefas destrutivas em produção sem autorização específica, backup verificado e plano aprovado.
