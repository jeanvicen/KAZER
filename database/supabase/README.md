# Integração de conta do Kazer

Este diretório contém a migração aditiva da conta Kazer. A aplicação usa somente a chave pública do Supabase no navegador. Chaves `service_role`, `sb_secret` e credenciais privadas nunca devem ser colocadas no repositório, no HTML ou em variáveis públicas do Vercel.

## Aplicar o banco

Abra o SQL Editor do projeto Supabase do Kazer e execute, nesta ordem, `001_auth_accounts.sql`, `002_inactivity_retention.sql` e `003_retention_notifications.sql`. A primeira migração cria `profiles`, `user_settings`, `app_notices` e `app_maintenance`; as seguintes adicionam o índice de retenção e a tabela privada `account_notifications`. As migrações são aditivas e não apagam tabelas, usuários ou dados existentes.

## Fluxo atual

O login usa `signInWithPassword`. O cadastro usa `signUp` com o nome informado em `user_metadata.display_name`. Com a confirmação de e-mail desativada no projeto Supabase, o cadastro deve retornar uma sessão imediatamente e o Kazer redireciona diretamente para `/chat`. O login de uma conta existente também redireciona para `/chat`.

A confirmação automática precisa estar habilitada no painel do Supabase em Authentication → Providers → Email, com a confirmação de e-mail desativada. Nenhum template de Gmail é usado pelo fluxo atual e não existe link de recuperação na tela de login.

## Dados da conta

O chat lê o perfil da tabela `profiles` e as preferências da tabela `user_settings`, mantendo o armazenamento local apenas como fallback. As preferências de notificações, instalação, aparência e idioma são sincronizadas para o usuário autenticado. A última atividade é atualizada pelo RPC protegido `touch_user_activity`.

## Retenção

A coluna `user_settings.last_activity_at` registra o último login ou uso registrado no Kazer. A migração `002_inactivity_retention.sql` adiciona um índice para a consulta de retenção sem alterar usuários existentes. A migração `003_retention_notifications.sql` cria `account_notifications`, com RLS para que cada usuário veja e descarte somente seus próprios avisos.

O endpoint protegido `/api/retention` procura contas com **três anos completos** sem atividade e exclui cada usuário pelo endpoint administrativo do Supabase. Como a exclusão é permanente e os e-mails de confirmação foram desativados, a rotina só executa quando `CRON_SECRET`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` estão configurados nas variáveis privadas do Vercel. Sem essas variáveis, ela falha de forma segura e não apaga nada.

O agendamento diário está em `vercel.json`, às 04:00 UTC. A rotina procura contas vencidas e, para contas que estejam na janela final, registra uma notificação única quando faltarem aproximadamente 50, 30 ou 5 dias para a exclusão. O usuário vê o aviso ao entrar no KAZER e pode selecionar “Manter conta ativa”, o que atualiza a atividade e encerra o aviso. A exclusão é limitada a 100 contas por execução e usa a data calculada no momento da execução; qualquer login ou uso registrado reinicia o prazo. Os arquivos `002_inactivity_retention.sql` e `003_retention_notifications.sql` precisam ser aplicados no SQL Editor do projeto Supabase antes do primeiro uso do novo fluxo.
