# Auditoria de migração para Android nativo — KAZER

Data: 04/11/2026. Repositório inspecionado: `jeanvicen/KAZER`, branch pública `main`.

> Esta auditoria descreve o código acessível durante a inspeção. Não significa que Android esteja implementado, compilado ou pronto para publicação. Nenhum dado ou ambiente de produção foi acessado ou alterado.

## Estado e arquitetura verificados

- A página do repositório exibiu a branch `main` e 575 commits durante a inspeção. O ambiente não permitiu confirmar o hash exato nem obter status/diff Git remoto.
- O checkout local disponível é uma cópia antiga e desconectada do estado público atual; não foi usado como fonte de verdade nem editado.
- O código público consultado contém aplicação Python/ASGI em `kazer/interfaces/web/`, interface web estática/PWA em `kazer/interfaces/web/static/`, autenticação, serviço de chat e provedores no backend, armazenamento Supabase opcional, migrações e testes Python/SQL.
- A configuração aponta a aplicação ASGI para a Vercel. O README do projeto declara que cada push na `main` dispara deploy de produção; portanto, desenvolvimento de Android deve ocorrer em branch separada, com integração revisada.

## Autenticação e sessão

A aplicação existente oferece conta por e-mail/senha, confirmação, recuperação e logout. A sessão do cliente web é carregada por cookie `HttpOnly`/`SameSite`; quando Supabase Auth é usado, os tokens de acesso/renovação são encapsulados no cookie e resolvidos pelo servidor. Não existe, nesta inspeção, contrato documentado de token móvel bearer. Não copiar cookies do navegador para o app nem expor `SUPABASE_SERVICE_ROLE_KEY`.

## Chat, APIs e streaming

O servidor Starlette mantém rotas de autenticação e chat. Entre as rotas existentes estão `/api/chat/config`, `/api/chat`, `/api/messages/{id}`, `/api/messages/{id}/stream`, `/api/messages/{id}/stop`, `/api/messages/{id}/retry`, `/api/conversations`, mensagens por conversa, anexos, configurações, planos, conexões, skills, biblioteca, memórias e operações de conta. A interface web consome streaming NDJSON e pode retomar acompanhamento; a geração e as ações de parada/repetição pertencem aos serviços atuais.

O contrato orientado ao navegador não deve ser presumido compatível com cliente nativo: autenticação, CSRF/Origin, retomada, cancelamento, autorização, paginação, limites e submissões repetidas exigem desenho e testes específicos. O chat usa `SupabaseChatStore`/Storage quando configurado e SQLite local fora de serverless; funções serverless não têm disco persistente.

## Provedores e modelo local

O modelo remoto é resolvido pelo backend (`ModelProvider`); credenciais de provedores devem continuar no servidor. A marca “KAZ 1.1” não comprova a existência de pesos para download. Não foi verificado artefato local, versão, licença, checksum, origem, tamanho, compatibilidade, benchmark ou desempenho em aparelho. A opção local deve permanecer indisponível até esses elementos e uma geração real serem validados.

## Supabase e preservação

O repositório contém migrações para Auth/fundação, chat, anexos, biblioteca, projetos/skills, conexões e permissões RPC. A documentação declara RLS e Postgres/Auth. Nenhum schema ou dado remoto foi consultado/modificado nesta tarefa. Não fazer migrações de produção como parte da fundação Android sem revisão, autorização e testes não produtivos.

Preservar na Web rotas, sessões, cadastro/login/confirmação/recuperação, chat, streaming/reconexão/parada/repetição, anexos, persistência, settings, planos, conexões, skills, biblioteca, memórias, exportação/exclusão e controles de segurança. Android deve ser outro cliente nativo, não WebView substituta.

## Plano de integração e riscos

1. Definir autenticação móvel segura que preserve a identidade existente e tenha acesso curto, renovação e revogação; cookies web não são credenciais móveis.
2. Criar API versionada só para capacidades necessárias e reaproveitar serviços existentes. Verificar proprietário/tenant em toda leitura e escrita.
3. Especificar streaming nativo, retomada, desconexão, cancelamento e idempotência sem quebrar a Web.
4. Criar app Kotlin nativo com separação UI/dados, armazenamento seguro, lifecycle e testes; não mostrar controles sem backend funcional.
5. Não baixar pesos de URL ou checksum ilustrativos. Exigir manifesto verificável, licença e compatibilidade documentadas, estado de download real e teste de runtime.
6. Respeitar seleção explícita local-only; não enviar à nuvem silenciosamente. A troca em modo automático deve ser claramente indicada.
7. Definir estratégia de assinatura/canais antes de distribuir APK e AAB; não criar chaves ou credenciais fictícias.
8. Não publicar nem fazer deploy nesta etapa: commits na `main` acionam deploy Vercel segundo a documentação do repositório.

## Limitações da auditoria

Este ambiente não possui Java/JDK, Android SDK, Gradle ou `adb`; o Git não está funcional. Não foi possível obter hash/status de um checkout atual, criar branch verificável, compilar APK/AAB, rodar testes Android ou backend, instalar em aparelho ou medir inferência. O teste local Python também não foi executado: o interpretador não tinha `pytest`; a tentativa de preparar dependências foi interrompida por limite de armazenamento e os temporários criados foram removidos.

## Referências técnicas consultadas

- [Recomendações oficiais de arquitetura Android](https://developer.android.com/topic/architecture/recommendations): camadas, repositórios, UDF, ViewModels, Flow/Coroutines e Compose.
- [LiteRT-LM Android](https://developers.google.com/edge/litert-lm/android): API Kotlin, runtime e modelo `.litertlm`; dependências/API devem ser fixadas a uma versão real antes da implementação.
- O prompt de migração fornecido pelo proprietário é a especificação de requisitos; seus itens de distribuição, Play Console, credenciais e políticas precisam de verificação na hora de executar.
