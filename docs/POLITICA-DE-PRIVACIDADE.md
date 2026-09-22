# KAZER — Aviso de privacidade

**Versão informativa:** 1.0 · **Última atualização:** 31 de agosto de 2026  
**Titular declarado:** Jean V. / `@jeanvicen` · identidade pública `0neajx` · Klipza Studio  
**Canal para solicitações:** klipzastudio@gmail.com

> **Rascunho para revisão jurídica.** Este documento descreve o fluxo técnico observado no repositório, mas não define sozinho o controlador, o operador, a base legal, os prazos de retenção, o encarregado, as transferências internacionais ou as obrigações contratuais. Complete esses pontos com advogado e com os contratos reais dos serviços utilizados.

## 1. Objetivo

Este Aviso explica quais informações podem ser tratadas quando uma pessoa acessa o KAZER, cria uma conta, usa o chat, envia arquivos, consulta o WebKazer, instala o PWA ou entra em contato. A Lei Geral de Proteção de Dados Pessoais — LGPD — disciplina o tratamento de dados pessoais inclusive em meios digitais e tem como objetivo proteger liberdade, privacidade e o livre desenvolvimento da personalidade.[1]

O KAZER deve tratar somente o necessário para a finalidade informada, proteger a sessão e respeitar escolhas e direitos aplicáveis. Se uma funcionalidade nova alterar o fluxo, este Aviso e a interface devem ser atualizados antes da operação correspondente.

## 2. Quem participa do tratamento

| Papel | Identificação atual |
|---|---|
| Titular declarado do projeto | Jean V. / `@jeanvicen` · `0neajx` · Klipza Studio. Confirmar nome empresarial ou pessoa física legal. |
| Controlador | **A confirmar juridicamente** conforme a operação e a oferta do serviço. |
| Encarregado/canal de privacidade | **A confirmar**; canal provisório: klipzastudio@gmail.com. |
| Operadores e provedores | Supabase, Vercel, provedores de IA, busca, CDN, navegador e demais serviços efetivamente habilitados. Confirmar contratos e localidade. |

Essa identificação não deve ser publicada como definitiva enquanto os dados legais e os contratos não forem conferidos. O usuário pode solicitar esclarecimentos pelo canal indicado, sem enviar senha, token ou documento desnecessário.

## 3. Dados que podem ser tratados

O fluxo técnico atual pode envolver as categorias abaixo. A lista precisa ser comparada com logs, configurações e contratos antes de uma versão final.

| Categoria | Exemplos | Origem |
|---|---|---|
| Conta | E-mail, identificador de usuário, nome de exibição, estado de sessão e metadados de autenticação. | Cadastro, login e Supabase Auth. |
| Preferências | Tema, idioma, avisos e aviso de instalação. | Settings, armazenamento local e `user_settings`. |
| Conteúdo | Mensagens, histórico enviado na requisição, imagens e arquivos compatíveis. | Entrada voluntária no chat. |
| Uso | Créditos, contagem de anexos, plano e horários de reset. | RPCs e `user_usage`. |
| Retenção | Última atividade e notificações de inatividade. | Uso autenticado e job de retenção. |
| Técnico e segurança | IP ou identificadores derivados, origem, Fetch Metadata, método, limites e eventos de erro. | Requisições e controles server-side. |
| Contato | Conteúdo enviado voluntariamente por e-mail ou canal oficial. | Solicitação do usuário. |

O KAZER não deve exigir que o usuário envie dados sensíveis para usar o recurso básico. Não envie senhas, códigos de autenticação, chaves privadas, dados bancários completos, prontuários, documentos de terceiros ou informações confidenciais sem necessidade e autorização.

## 4. Finalidades e bases a confirmar

As finalidades típicas do fluxo são autenticar a conta, entregar o chat, processar anexos, realizar pesquisa, manter preferências, contabilizar uso, prevenir abuso, proteger a infraestrutura, responder a solicitações, cumprir obrigações legais e comunicar mudanças relevantes. Cada operação precisa ter sua base legal documentada pelo controlador real.

| Finalidade | Dados envolvidos | Base legal |
|---|---|---|
| Criar e manter conta | Cadastro, autenticação e preferências. | **A confirmar pelo controlador.** |
| Responder mensagens e analisar anexos | Mensagens, imagens, arquivos e contexto. | **A confirmar; pode envolver execução de serviço solicitado.** |
| Medir créditos e anexos | Identificador, plano e uso. | **A confirmar pelo controlador.** |
| Segurança e prevenção de abuso | Metadados técnicos e eventos de requisição. | **A confirmar pelo controlador.** |
| Retenção e avisos | Última atividade, conta e notificações. | **A confirmar e alinhar ao prazo publicado.** |
| Atendimento e direitos | Dados fornecidos no contato. | **A confirmar pelo controlador.** |
| Obrigações legais | Dados estritamente necessários. | **A confirmar conforme obrigação aplicável.** |

A tabela não deve ser lida como escolha automática de base legal. O titular precisa avaliar finalidade, necessidade, transparência, direitos do titular e legislação do país de cada usuário.

## 5. Serviços externos e transferências

Para produzir uma resposta ou resumo, o conteúdo necessário pode ser transmitido aos provedores configurados para chat, visão, pesquisa ou resumo. O Supabase pode tratar autenticação e dados de conta; a Vercel pode executar hospedagem, funções e cron; outros serviços podem processar requisições conforme suas próprias políticas.

Antes de habilitar produção, mantenha um inventário com nome do fornecedor, função, categorias de dados, local de processamento, retenção, subcontratados, contrato, medidas de segurança e procedimento de incidente. Se houver transferência internacional ou processamento fora do país do titular, a hipótese e as salvaguardas devem ser verificadas pelo controlador.

Links, fontes do WebKazer e páginas de terceiros possuem políticas próprias. O usuário deve verificar o destino antes de enviar dados ou abrir arquivos. O KAZER não deve buscar no servidor uma URL arbitrária fornecida pelo usuário como se fosse um destino confiável.

## 6. Armazenamento local, sessão e cookies

A interface pode usar armazenamento local do navegador para tema, idioma, avisos, instalação e rascunho. Esses dados podem permanecer no dispositivo até serem removidos, o navegador ser redefinido ou a função **Settings → Dados e privacidade → Limpar preferências locais** ser usada. Em dispositivo compartilhado, encerre a sessão e limpe dados quando necessário.

A sessão de autenticação é gerida pelo Supabase JS no navegador, com renovação automática e sem colocar o token na URL. O projeto não deve ser anunciado como usando cookies `HttpOnly` próprios se essa arquitetura não existir. Confirme, na configuração de produção, quais cookies, armazenamento local, logs e tecnologias similares são efetivamente utilizados.

## 7. Retenção e exclusão

As informações devem ser mantidas pelo tempo necessário à finalidade, à segurança, ao atendimento de direitos ou a obrigações legais, com prazos definidos em uma tabela interna de retenção. O KAZER possui um job de inatividade que pode emitir avisos e, somente com flag administrativa explícita, encaminhar exclusões permanentes. Mantenha `RETENTION_DELETE_ENABLED=false` até concluir backup, restauração, comunicação e aprovação.

Preferências locais podem ser removidas pelo usuário no navegador. Para dados de conta, mensagens, uso ou notificações mantidos no backend, o procedimento de acesso, correção ou exclusão deve ser confirmado pelo controlador e executado com verificação de identidade adequada. Exclusão de conta não deve apagar registros cuja conservação seja exigida por lei, segurança ou defesa de direitos, desde que a retenção seja documentada.

## 8. Direitos e solicitações

Conforme a legislação aplicável e a situação concreta, o titular pode solicitar confirmação de tratamento, acesso, correção, informação, eliminação, portabilidade, revisão ou outras medidas previstas em lei. A solicitação deve ser enviada para **klipzastudio@gmail.com** com somente as informações necessárias para localizar a conta e entender o pedido.

O KAZER pode pedir informação adicional para evitar fraude e proteger a conta. Não envie senha ou código de autenticação por e-mail. O controlador deve definir prazo, identidade responsável, registro de atendimento, resposta e eventual canal perante a autoridade competente.

## 9. Segurança

O projeto aplica autenticação server-side nas APIs privadas, RLS no Supabase, limites de corpo, rate limiting best effort, timeouts, allowlist de anexos, escaping de conteúdo, headers de segurança, ausência de cache em APIs e redaction de padrões comuns de segredos. Esses controles reduzem risco, mas não garantem invulnerabilidade.

O usuário deve proteger sua sessão, usar navegador atualizado, sair de dispositivos compartilhados, não inserir segredos desnecessários e comunicar comportamentos suspeitos sem incluir credenciais. Incidentes devem ser avaliados e comunicados conforme a lei, os contratos e o plano operacional do controlador.

## 10. Crianças e adolescentes

O serviço não deve ser usado para burlar idade, consentimento ou salvaguardas aplicáveis. Se o produto for oferecido a crianças ou adolescentes, o controlador deve definir fluxo específico, transparência adequada, supervisão, minimização e requisitos legais antes da publicação.

## 11. Alterações

Este Aviso pode ser atualizado quando o produto, os fornecedores, os fluxos de dados, os prazos, a lei ou os controles mudarem. A versão publicada deve mostrar data e resumo da alteração. Mudanças relevantes devem ser comunicadas pelo canal adequado e, quando necessário, depender de nova escolha do titular.

## 12. Referências

[1]: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm "Planalto — Lei nº 13.709/2018 (LGPD)"
