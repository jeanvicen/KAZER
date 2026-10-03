# Auditoria inicial do Kazer

## Repositório e banco

O repositório localizado foi `jeanvicen/KAZER`, clonado localmente em `/home/ubuntu/kazer-inspecao`. O projeto usa HTML/CSS/JavaScript estático servido pelo Vercel, funções Node em `api/` e Supabase para autenticação e dados.

O projeto Supabase conectado é `Kazer`, referência `mqjunopzycdezzjmlhip`, em estado ACTIVE_HEALTHY. O banco real possui `profiles`, `user_settings`, `app_notices`, `app_maintenance` e `account_notifications`; não possui atualmente estrutura de créditos/anexos. O registro de migrações retornado pelo conector está vazio, apesar de o schema existir, portanto novas alterações devem ser aditivas e com nome próprio, sem depender cegamente do histórico remoto.

## Fluxos existentes

A autenticação é feita pelo Supabase Auth. A interface `interface/chat.html` obtém a sessão persistente no navegador, consulta `profiles` e `user_settings` para o usuário autenticado e envia mensagens/anexos para `POST /api/chat`. O backend valida o bearer token via `/auth/v1/user`, processa anexos em memória e chama o provedor de IA. Atualmente não há consumo persistente de créditos nem limite diário de anexos: o máximo de cinco arquivos é apenas por mensagem no cliente/backend.

O gatilho atual `handle_new_user` provisiona `profiles` e `user_settings`. A nova funcionalidade deve ser incorporada nesse mesmo gatilho, sem criar um fluxo paralelo de usuários.

## Regras consolidadas

Créditos e anexos são controles independentes, por usuário, com reset diário às 00:00 UTC. O saldo FREE inicial é 1500, o limite diário de anexos é 5, e o saldo oficial nunca pode depender de localStorage ou valores enviados pelo frontend. O contador de créditos é visível apenas como ícone + número; o contador de anexos permanece invisível enquanto houver disponibilidade. Ao atingir o limite de anexos, exibe-se apenas um aviso contextual que não bloqueia texto. Ao atingir zero de créditos, bloqueiam-se apenas operações que consomem créditos.

A operação de consumo deve fazer reset lazy no servidor, usar bloqueio de linha/transação e impedir saldo/contagem negativos. O frontend deve receber `next_credit_reset_at` e `attachment_reset_at` do backend e usar esses valores somente para apresentação de horário/contagem regressiva.

## Riscos encontrados

O Supabase Advisor apontou `set_updated_at` com search_path mutável e funções SECURITY DEFINER antigas acessíveis às roles anon/authenticated. A migração nova deve corrigir o search_path, revogar execução pública das funções internas e conceder apenas os RPCs necessários à role authenticated.

## Ponto de integração

A implementação será aditiva: nova tabela de configuração por plano, nova tabela de uso por usuário, RPCs de leitura/reset/consumo atômico, endpoints autenticados e alterações localizadas no composer/topbar e no envio. O fluxo de texto deve permanecer funcional quando anexos acabarem.
