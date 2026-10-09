# Tarefas em segundo plano (rascunho de implementação)

Este documento descreve a fila persistente proposta para o KAZER. A migração `database/supabase/022_background_tasks.sql` é apenas um arquivo para revisão: ela **não foi aplicada** ao Supabase de produção. Não iniciar worker contra produção até a migração ser revisada/aprovada e aplicada pelo responsável.

## Arquitetura

1. `POST /api/background-tasks` autentica a sessão, reserva uso e cria uma tarefa idempotente no Supabase. `GET` lista tarefas apenas do usuário autenticado; `PATCH` oferece cancelar somente enquanto enfileirada/pausada, pausar, retomar, repetir falhas e registrar visualização.
2. Um worker Node.js continuamente ativo busca tarefas por RPC com `FOR UPDATE SKIP LOCKED`; o lease impede dois workers de reivindicarem simultaneamente a mesma tarefa. O processo do worker usa `SUPABASE_SERVICE_ROLE_KEY`, que deve existir somente no ambiente secreto do worker.
3. O worker chama os handlers existentes de chat/pesquisa em processo, anexando um contexto interno autenticado por `Symbol` (não transmitido por HTTP). O consumo mensal acontece na transação de enqueue; os handlers não debitam o mesmo pedido novamente.
4. Quando concluída, a saída é salva na fila. O payload de entrada é apagado após sucesso e a migração fornece purge de tarefas/eventos com mais de sete dias, executado pelo worker aproximadamente a cada hora.

Use host externo que suporte um container continuamente ativo e política de reinício (Docker, por exemplo). Não usar Vercel Hobby Cron como consumidor contínuo. Ainda não existe host escolhido/configurado nem credenciais de deployment.

## Tipos de tarefa

- **Adaptadores reais na proposta:** `chat_response` (chat existente), `web_search` (pesquisa existente), `document_analysis` e `file_processing` (chat existente com anexos fornecidos).
- **Ainda não implementados:** `image_generation`, `computer_agent`, `report_generation`, `upload_processing` e `other`. O worker os conclui como falha explicativa, em vez de deixá-los na fila. Um SVG/HTML renderizado na resposta não equivale à geração de uma imagem.
- MCP não é carregado no chat de fundo; tarefas com conectores externos são recusadas pelo worker. Não há ainda confirmação por ação individual; não tente contornar essa salvaguarda.

## Recuperação e idempotência

- A chave de idempotência é única por usuário e o cliente salva a chave e os IDs locais antes do enqueue. Ao retomar, sincroniza tarefas aceitas mesmo se a resposta do enqueue foi perdida; a fila do servidor permanece como fonte da verdade. Uma requisição que nunca chegou ao servidor não pode ser reconstruída com anexos após recarregar a página.
- Retries automáticos do worker são limitados a falhas transitórias enquanto o processo ainda sabe que a requisição falhou. Uma tarefa cujo lease expirou é marcada como falha e **não é reexecutada automaticamente**: o provedor pode ter concluído a chamada antes da interrupção. Um retry manual pode gerar uma nova chamada/model cost.
- Tarefas em execução não podem ser canceladas pela API porque encerrar o worker não prova que o provedor interrompeu uma chamada. Cancelamento só é aceito antes da execução; para atividade já iniciada, aguarde sincronização.
- Expo Push é um canal auxiliar, não uma garantia de entrega. Falhas com lease expirado voltam a ser tentadas; um timeout ambíguo pode gerar duplicidade. Um ticket Expo aceito não comprova entrega no dispositivo; a fila e a consulta autenticada continuam sendo a fonte da verdade.

## Configuração local/host

Requisitos: Node.js 20+ ou Docker. Para Docker, construir a imagem na raiz do repositório e iniciar com política de reinício. Configure como segredos de runtime:

- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (somente worker; nunca cliente, Vercel público ou arquivo versionado).
- As chaves de provedores usadas pelos handlers (`GROQ_API_KEY` e, se necessário, credenciais de pesquisa/modelos). Não inserir segredos em `Dockerfile` ou imagem.
- Opcionalmente `WORKER_ID`, `WORKER_POLL_INTERVAL_MS` e `KAZER_APP_HOST`.

O worker usa dependências já declaradas no `package.json` principal e não instala SDK Expo. Ele envia Expo Push apenas para tokens Expo já registrados na tabela de assinaturas. Nenhum cliente atualmente registra tokens e nenhum prompt OS é exibido: notificação móvel ainda não está disponível até integrar Expo Notifications, pedir consentimento explícito, obter um EAS project ID e configurar credenciais Android/iOS. A PWA/service worker web push também não está implementada.

## Estado da integração de interface

A branch de implementação integra enfileiramento idempotente para chat comum, pesquisa acionada pelo compositor e análise/processamento de arquivos; a exceção MCP continua usando o fluxo síncrono já existente. Os IDs de tarefa/mensagem/conversa e a chave de idempotência são gravados no histórico local antes do enqueue; ao iniciar, focar, retomar a aba ou abrir `?taskId=…`, o cliente sincroniza, retoma polling, reconcilia resultados e evita duplicar respostas por tarefa. A sincronização usa o endpoint autenticado e mantém o Supabase como fonte da verdade. Isso ainda não é uma capacidade operacional global: a migration não foi aplicada, o worker não tem host configurado e não há validação E2E em Supabase isolado.

A ponte nativa de token Expo e a PWA Web Push **não estão integradas nesta branch**. O app Expo atual não registra token nem processa toques em notificações. Push só pode ser habilitado após integração de `expo-notifications`, consentimento, EAS project ID e credenciais FCM/APNs; PWA requer um fluxo separado com service worker e VAPID. Até lá, a interface recupera resultados quando aberta/retomada e deep links podem ser consumidos se outro canal abrir a URL com `taskId`.

## Revisão/aplicação da migração

Revise o SQL e o plano de backup primeiro. Ele cria tabelas, índices e funções, ativa RLS estrita, revoga acesso direto aos papéis client-side e concede apenas os RPCs necessários. A função de enqueue chama `consume_kazer_usage(1, attachment_count)` na mesma transação da criação idempotente; erro de colisão única faz rollback da reserva duplicada. Aplicar somente após aprovação separada do SQL final.
