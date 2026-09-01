
## Verificação adicional do deployment

O status do PR aponta falha no deployment Vercel `dpl_Dz4F9d1T7JHghLBb7ecaqhLvAd7a`. A consulta de logs pela integração retornou `404 Deployment not found`, e a página privada da Vercel redirecionou para login. Portanto, o erro específico do build não pôde ser lido nesta sessão sem autenticação manual no painel. O PR permanece aberto e bloqueado por revisão/check da Vercel; os testes locais do código continuam passando.

## Causa confirmada no painel Vercel

Após autenticação pelo GitHub, o painel do deployment mostrou: **“No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan.”** A correção será consolidar as rotas novas em handlers de função compartilhados, mantendo os caminhos públicos por rewrites no `vercel.json`, para ficar dentro do limite do plano Hobby.
