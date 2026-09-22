
## Verificação adicional do deployment

O primeiro status do PR apontou falha no deployment Vercel `dpl_Dz4F9d1T7JHghLBb7ecaqhLvAd7a` porque a implantação excedia o limite de funções do plano Hobby. A consulta inicial de logs pela integração retornou `404 Deployment not found` e a página privada redirecionou para login; após o login pelo GitHub no painel Vercel, a mensagem foi confirmada e corrigida.

## Causa confirmada no painel Vercel

Após autenticação pelo GitHub, o painel do deployment mostrou: **“No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan.”** A correção foi consolidar as rotas novas em handlers de função compartilhados, mantendo os caminhos públicos por rewrites no `vercel.json`, para ficar dentro do limite do plano Hobby.

## Deployment corrigido

O commit `f1365db` passou no check da Vercel com status `success` e descrição `Deployment has completed`. O painel confirmou a branch `feat/mcp-github-task-panel`, o domínio de preview `kazer-git-feat-mcp-github-task-panel-jeanvicens-projects.vercel.app` e o domínio alternativo `kazer-jvy5m0ylm-jeanvicens-projects.vercel.app`. A consolidação reduziu as funções públicas para 9, abaixo do limite Hobby de 12. O preview exige autenticação SSO da Vercel para smoke tests externos; isso é proteção do projeto, não falha da aplicação.

## Acesso ao Supabase

O projeto `Kazer`, branch `main`/ambiente `PRODUCTION`, foi aberto com sucesso no SQL Editor após autenticação pelo GitHub. O editor utiliza um `textarea` Monaco com `aria-label="Editor content"`; a migração será inserida nesse editor e sua execução será confirmada separadamente.

## Preparação da migração

Após autenticação no Supabase, a primeira tentativa de inserir o SQL no editor Monaco excedeu o tempo e deixou uma edição não salva/possivelmente parcial. **Nenhum comando foi executado**. A consulta será substituída integralmente antes da confirmação de execução.

## Execução autorizada

O SQL Editor exibiu a confirmação de operações potencialmente destrutivas; após a confirmação expressa do usuário, a consulta íntegra de 182 linhas foi executada no projeto `Kazer`/`main`/`PRODUCTION`. O Supabase está mostrando o estado `Running`; a próxima etapa é aguardar o resultado e validar as tabelas e funções criadas.

## Resultado da migração

O Supabase exibiu **Success. No rows returned** para a migração 010 no ambiente `main`/`PRODUCTION`. Em seguida, foi preparada uma consulta read-only que verifica a existência das três tabelas, o RLS/force RLS e a RPC `consume_kazer_usage`, sem ler dados privados de usuários.

## Validação read-only concluída

A consulta de validação retornou `tables` com `kazer_github_connections`, `kazer_mcp_connectors` e `kazer_tasks`; `rls` com `enabled: true` e `forced: true` nas três tabelas; e `rpc: true` para `consume_kazer_usage`. Portanto, a estrutura necessária para MCPs, GitHub, tarefas e consumo variável de créditos está criada e protegida no banco de produção.
