# Integração de autenticação do Kazer

Este diretório contém a migração aditiva e os templates usados pelo Kazer. A aplicação usa somente a chave pública do Supabase no navegador. Chaves `service_role`, `sb_secret` e credenciais SMTP nunca devem ser colocadas neste repositório, no HTML ou em variáveis públicas do Vercel.

## Aplicar o banco

Abra o SQL Editor do projeto Supabase do Kazer e execute `001_auth_accounts.sql`. A migração cria `profiles`, `user_settings`, `app_notices` e `app_maintenance`, cria os registros faltantes para usuários existentes, conecta novos cadastros ao perfil e ativa RLS. Ela não apaga tabelas, usuários ou dados existentes.

## Configurar autenticação

No painel de Authentication, mantenha o provedor de e-mail habilitado e adicione `https://kazer.vercel.app/chat` e `https://kazer.vercel.app/recuperar` à lista de URLs de redirecionamento permitidas. O cadastro usa o nome informado em `user_metadata.display_name`; o login usa `signInWithPassword`.

## Templates de e-mail

Copie `email-templates/confirmation.html` para o template de confirmação de cadastro e `email-templates/recovery.html` para o template de recuperação de senha. O template de recuperação usa `{{ .Token }}`, que é o código de 6 dígitos, e `{{ .Email }}` no botão **Recuperar conta**. O usuário digita o código na página `/recuperar`, o Kazer chama `verifyOtp` com `type: 'recovery'`, atualiza a senha e entra no `/chat`.

Para que a mensagem apareça como **Klipza Studio**, configure o nome de remetente no painel e um SMTP próprio verificado. O template não exibe o nome do provedor de autenticação. A entrega real depende dessa configuração externa e não pode ser ativada usando apenas a chave pública.

## Retenção de contas

A coluna `user_settings.last_activity_at` é atualizada no login do chat pelo RPC protegido `touch_user_activity`. A exclusão após dois anos deve ser executada por uma rotina agendada e protegida, com avisos de 50 e 10 dias antes. Não existe rotina destrutiva automática neste arquivo: antes de ativá-la é necessário definir o provedor de e-mail transacional, o agendamento e a política final de retenção, mantendo a chave de servidor fora do repositório.
