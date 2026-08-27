# Integração de conta do Kazer

Este diretório contém a migração aditiva da conta Kazer. A aplicação usa somente a chave pública do Supabase no navegador. Chaves `service_role`, `sb_secret` e credenciais privadas nunca devem ser colocadas no repositório, no HTML ou em variáveis públicas do Vercel.

## Aplicar o banco

Abra o SQL Editor do projeto Supabase do Kazer e execute `001_auth_accounts.sql`. A migração cria `profiles`, `user_settings`, `app_notices` e `app_maintenance`, cria os registros faltantes para usuários existentes, conecta novos cadastros ao perfil e ativa RLS. Ela não apaga tabelas, usuários ou dados existentes.

## Fluxo atual

O login usa `signInWithPassword`. O cadastro usa `signUp` com o nome informado em `user_metadata.display_name`. Com a confirmação de e-mail desativada no projeto Supabase, o cadastro deve retornar uma sessão imediatamente e o Kazer redireciona diretamente para `/chat`. O login de uma conta existente também redireciona para `/chat`.

A confirmação automática precisa estar habilitada no painel do Supabase em Authentication → Providers → Email, com a confirmação de e-mail desativada. Nenhum template de Gmail é usado pelo fluxo atual e não existe link de recuperação na tela de login.

## Dados da conta

O chat lê o perfil da tabela `profiles` e as preferências da tabela `user_settings`, mantendo o armazenamento local apenas como fallback. As preferências de notificações, instalação, aparência e idioma são sincronizadas para o usuário autenticado. A última atividade é atualizada pelo RPC protegido `touch_user_activity`.

## Retenção

A coluna `user_settings.last_activity_at` permite acompanhar a última atividade. A exclusão após dois anos deve ser executada por uma rotina agendada e protegida, com os avisos definidos pelo proprietário antes da exclusão. Não existe rotina destrutiva automática neste arquivo.
