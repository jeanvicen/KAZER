# Integração Supabase do KAZER

## Estado confirmado

- Projeto Supabase identificado: `Kazer` (`mqjunopzycdezzjmlhip`), região `us-west-2`.
- O banco estava vazio antes da integração.
- As rotas de autenticação agora usam o adaptador server-side `kazer/auth/supabase_service.py`; o SQLite deixou de ser usado quando `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` estão configurados.
- A tela existente, animações e textos em português foram preservados.
- A fundação PostgreSQL foi aplicada ao Supabase pela migração `20261029131800_kazer_supabase_foundation.sql`.
- As tabelas `conversations`, `messages`, `attachments`, `usage_events`, `usage_windows` e `deletion_jobs` foram criadas com RLS ativo.
- As tabelas novas estão vazias e a estrutura anterior do projeto foi preservada.
- O cadastro, login, consulta de sessão e logout foram testados contra o projeto real; duas contas temporárias foram removidas após o teste.
- Foi corrigida a função ausente `public.kazer_provision_usage`, chamada pelo trigger existente de criação de usuário e responsável pelo erro inicial `Database error saving new user`.

## Migração aplicada

A migração usa `auth.users.id` como proprietário e inclui índices, chaves estrangeiras com `on delete cascade`, janela de uso de cinco horas, registro operacional de exclusões e políticas RLS para isolamento por usuário. Os grants para `anon` e `authenticated` foram reduzidos; operações de exclusão automática devem usar backend confiável/service role.

## O que ainda falta para o deploy de produção

O código está conectado ao Supabase Auth quando as variáveis são fornecidas. Ainda faltam os valores de ambiente e a configuração de produção:

- `SUPABASE_PUBLISHABLE_KEY` para o cliente autorizado.
- `SUPABASE_SERVICE_ROLE_KEY` apenas no backend/worker seguro.
- `SUPABASE_AUTH_REDIRECT_URL` e a URL de produção cadastrada nos Redirect URLs do Supabase.
- SMTP autorizado para `klipzastudio@gmail.com`, com credencial/app password armazenada somente no ambiente seguro.
- Decisão e acesso ao ambiente de deploy da Vercel para configurar esses segredos.

O arquivo `.env.example` contém apenas placeholders e a URL pública do projeto. Nenhuma chave real foi inventada ou gravada no Git.

## Próxima etapa segura

1. Configurar as variáveis nos ambientes local e de produção, sem enviá-las para o repositório.
2. Configurar e validar a URL de produção e os Redirect URLs no painel Supabase.
3. Completar testes de confirmação de e-mail e recuperação com entrega SMTP real.
4. Adicionar testes de sessão, recuperação e RLS; testar com dois usuários isolados.
5. Implementar o worker de inatividade em modo dry-run, depois warnings de 180/30/7 dias e, somente após validação, o job de dez anos.
6. Fazer testes reais de entrega de e-mail antes de afirmar que a operação está pronta.

A documentação oficial do Supabase confirma que email/password e redirects precisam ser habilitados/configurados no projeto, que RLS deve ser combinado com grants, e que a exclusão de usuários não remove automaticamente objetos do Storage. Esses pontos são tratados na migração e devem ser cobertos pelo adaptador e pelo worker antes do deploy final.
