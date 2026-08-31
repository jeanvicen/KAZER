# Integração Supabase do KAZER

Este diretório contém as migrações incrementais do banco usado pelo KAZER. O navegador usa apenas a chave pública `anon`/publishable; chaves `service_role`, `sb_secret`, credenciais de IA e `CRON_SECRET` devem existir somente em variáveis privadas do servidor.

> **Importante:** as migrações devem ser aplicadas no SQL Editor de um ambiente controlado, na ordem numérica. Faça backup, confirme o projeto de destino e teste com contas não produtivas antes de aplicar mudanças em produção.

## Ordem de aplicação

| Ordem | Arquivo | Conteúdo |
|---:|---|---|
| 1 | `001_auth_accounts.sql` | Perfis, preferências, avisos públicos, trigger de novo usuário, atividade e RLS inicial. |
| 2 | `002_inactivity_retention.sql` | Índice e apoio à consulta de contas inativas. |
| 3 | `003_retention_notifications.sql` | Notificações privadas de retenção e policies próprias. |
| 4 | `004_security_hardening.sql` | `FORCE RLS`, grants mínimos, constraints e revogações. |
| 5 | `005_usage_limits.sql` | Catálogo de planos, tabela de uso, resets e RPCs iniciais. |
| 6 | `006_usage_rpc_fix.sql` | Correções das RPCs de consumo e grants autenticados. |
| 7 | `007_credits_150_messages_5h.sql` | Créditos Free, janela de cinco horas e consumo do chat. |
| 8 | `008_attachment_limit_10_items.sql` | Dez itens de anexo por janela no plano Free e consumo atômico por item. |

As migrações posteriores dependem de objetos criados pelas anteriores. Não pule arquivos, não os execute fora de ordem e não edite uma migração já aplicada sem registrar uma nova migração corretiva.

## Configuração do Auth

O login usa `signInWithPassword`. O cadastro usa `signUp` com `user_metadata.display_name`. O fluxo atual espera que a configuração de confirmação de e-mail no provedor Supabase esteja alinhada ao produto; confirme isso em **Authentication → Providers → Email** antes de testar o redirecionamento automático para `/chat`.

O KAZER não grava senhas ou hashes em tabelas próprias. O Supabase Auth administra sessão, expiração, renovação, login, cadastro e logout. A chave pública não é uma autorização para ignorar RLS: toda tabela de usuário deve continuar limitada por `auth.uid()`.

## Dados e uso

O trigger de novo usuário provisiona `profiles` e `user_settings`. As preferências de notificações, instalação, aparência e idioma podem ser sincronizadas para a conta autenticada, enquanto o navegador mantém um fallback local.

As migrações de uso criam o catálogo e o estado por usuário. O consumo do chat é atômico, aplica reset lazy com bloqueio de linha e impede saldo ou contagem negativa. A migração `008` substitui a assinatura antiga da RPC por `p_attachment_count`, contabilizando cada foto/arquivo individualmente e permitindo no máximo dez itens por janela conforme o plano Free.

## Retenção

A coluna de atividade apoia a busca de contas inativas. O endpoint `/api/retention` é protegido por `CRON_SECRET`, cria avisos nas janelas previstas e só pode excluir contas quando `RETENTION_DELETE_ENABLED=true`. Mantenha essa flag como `false` até revisar backup, restauração, avisos, suporte e reversão.

O agendamento diário está em `vercel.json`, às 04:00 UTC. A exclusão administrativa, quando habilitada, é permanente, limitada por execução e depende de `SUPABASE_SERVICE_ROLE_KEY`. Nunca coloque a service role no navegador, no repositório, em issues, em logs ou em parâmetros de URL.

## Validação pós-migração

Use duas contas de teste e confirme que cada uma consegue ler somente o próprio perfil, preferências, uso e notificações. Tente também acessar sem sessão, com bearer inválido, com sessão revogada e com identificador de outra conta. Verifique o saldo inicial, o reset, a contagem individual de anexos, o bloqueio de limite e a chamada das RPCs por uma role não autorizada.

Registre a data, o projeto, os arquivos aplicados, o resultado, o responsável e o plano de rollback. A aplicação das migrações não deve ser considerada concluída apenas porque o SQL foi aceito pelo editor; o comportamento e as policies precisam ser testados.
