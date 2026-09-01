
## Verificação adicional do deployment

O primeiro status do PR apontou falha no deployment Vercel `dpl_Dz4F9d1T7JHghLBb7ecaqhLvAd7a` porque a implantação excedia o limite de funções do plano Hobby. A consulta inicial de logs pela integração retornou `404 Deployment not found` e a página privada redirecionou para login; após o login pelo GitHub no painel Vercel, a mensagem foi confirmada e corrigida.

## Causa confirmada no painel Vercel

Após autenticação pelo GitHub, o painel do deployment mostrou: **“No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan.”** A correção foi consolidar as rotas novas em handlers de função compartilhados, mantendo os caminhos públicos por rewrites no `vercel.json`, para ficar dentro do limite do plano Hobby.

## Deployment corrigido

O commit `f1365db` passou no check da Vercel com status `success` e descrição `Deployment has completed`. O painel confirmou a branch `feat/mcp-github-task-panel`, o domínio de preview `kazer-git-feat-mcp-github-task-panel-jeanvicens-projects.vercel.app` e o domínio alternativo `kazer-jvy5m0ylm-jeanvicens-projects.vercel.app`. A consolidação reduziu as funções públicas para 9, abaixo do limite Hobby de 12. O preview exige autenticação SSO da Vercel para smoke tests externos; isso é proteção do projeto, não falha da aplicação.
