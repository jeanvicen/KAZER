# Mapa de dados do KAZER

Este documento descreve o que o KAZER coleta, onde guarda, quem recebe e como apagar: tela de entrada e API `/api/auth/*`, e o chat (`/api/chat`, `/api/conversations`, `/api/attachments`, `/api/settings`, `/api/memories`, `/api/account/*`). Autenticação própria remove a dependência de login social, mas as mensagens do chat **são enviadas ao provedor de modelo configurado**: a privacidade delas depende também do contrato desse provedor.

## O que é coletado

| Dado | Por quê | Onde fica | Retenção |
| --- | --- | --- | --- |
| E-mail (normalizado em minúsculas) | Identificar a conta e enviar links | SQLite `users.email` | Enquanto a conta existir |
| Hash Argon2id da senha (com salt) | Verificar a senha sem guardá-la | SQLite `users.password_hash` | Enquanto a conta existir |
| Data de criação e de confirmação do e-mail | Expirar contas não confirmadas | SQLite `users` | Enquanto a conta existir |
| Hash SHA-256 do token de sessão | Manter o login | SQLite `sessions` | 14 dias ou até sair |
| Hash SHA-256 de links de confirmação/redefinição | Uso único dos links | SQLite `email_tokens` | 24 h (confirmação) / 30 min (redefinição) |
| IP do cliente | Limite de tentativas | Somente memória do processo | Janela do limite (até 1 h); some ao reiniciar |

### Chat

Onde o chat guarda depende do ambiente: com o Supabase configurado (produção), no Postgres do projeto `Kazer` e no bucket privado `kazer-anexos`; sem ele, no SQLite e no disco locais do desenvolvimento. A coluna "Onde fica" nomeia a tabela, que é a mesma nos dois casos.

| Dado | Por quê | Onde fica | Retenção |
| --- | --- | --- | --- |
| Conversas (título, datas) | Histórico da conta | `conversations` (dono = `user_id` da sessão) | Até apagar a conversa, o histórico ou a conta; a mais antiga também sai sozinha acima de 100 conversas |
| Mensagens e respostas (texto, resumo do raciocínio, estado, opções usadas) | Mostrar o histórico e montar o contexto | `messages` | Idem |
| Anexos (bytes) | O modelo analisar o que você enviou | Bucket privado `kazer-anexos/<user_id>/<id>`, ou `KAZER_UPLOAD_DIR/<user_id>/<id>` no local (diretório 0700, arquivo 0600, nome aleatório) | Idem; anexos nunca enviados somem em 24 h |
| Metadados dos anexos (nome limpo, tipo detectado, tamanho) | Listar e servir só ao dono | `attachments` | Idem |
| Memórias | Personalizar respostas quando a memória está ligada | `memories` / `kazer_memories` | Até esquecer a memória ou excluir a conta |
| Preferências (apelido, estilo, instruções, interface) | Ajustar o assistente e a interface | `preferences` / `kazer_preferences` | Até alterar ou excluir a conta |
| Plano da conta (`free`, `pro`, `ultra`) | Saber a franquia de uso | `kazer_plans` (só leitura para o dono) | Enquanto a conta existir |
| Artefatos (páginas, componentes, SVG, diagramas e dados que o KAZER produziu) | Guardar na Biblioteca o que foi feito | `artifacts` / `kazer_artifacts` | Até apagar o artefato, a conversa ou a conta |
| Contagem de uso (unidades e horário, sem conteúdo) | Cota no servidor | `usage_events`, `usage_windows` | 2 dias |
| Fuso horário do navegador | Informar a data ao modelo | Só na requisição | Não é guardado |

O **título** de cada conversa passa a ser escrito pelo modelo: depois da primeira resposta, a pergunta e a resposta vão ao provedor configurado mais uma vez, só para resumir o assunto em poucas palavras. É o mesmo provedor que já recebeu a conversa; nenhum destino novo entra em cena.

O **microfone** usa o reconhecimento de fala do próprio navegador. Em alguns navegadores (Chrome, por exemplo) o áudio é enviado ao serviço do fabricante para virar texto — esse trecho não passa pelo KAZER, que recebe só o texto pronto e nunca grava nem guarda áudio. A interface avisa isso na primeira vez que o botão é usado.

Toda consulta do chat parte do `user_id` derivado do cookie de sessão; conversa, mensagem ou anexo de outra conta responde `404` igual a algo inexistente. No Postgres isso é defesa em profundidade: as funções conferem `auth.uid()` e o RLS vale sobre as tabelas, então nem um erro no backend vaza conversa de outra conta. O tipo dos anexos é detectado pelo conteúdo (PNG, JPEG, WebP, GIF, PDF ou texto UTF-8 com extensão permitida), nunca pelo que o navegador declara.

Não são coletados: nome, telefone, data de nascimento, user agent, localização, identificadores de dispositivo ou dados de terceiros. A senha em claro existe apenas durante a requisição e nunca é registrada nem gravada. Tokens em claro existem só no cookie HttpOnly (sessão) ou no e-mail enviado (links).

Contas que nunca confirmam o e-mail são apagadas automaticamente após 7 dias. Sessões e links vencidos são removidos na inicialização e a cada login.

## Navegador

- Cookie `__Host-kazer_session` (produção) / `kazer_session` (desenvolvimento local): HttpOnly, SameSite=Lax, Secure em produção. Inacessível a JavaScript.
- `localStorage`: só preferências visuais (`kazer:ui` com animações, tamanho do texto e fundo animado; `kazer:drawer` com a gaveta aberta ou fechada). Nenhum dado pessoal.
- `sessionStorage`: rascunho da mensagem por conversa (`kazer:draft:*`), apagado ao sair da conta, e marcadores de navegação (`kazer:after`, `kazer:return`).
- Cache do service worker (`kazer-shell-v2`): só HTML, CSS, JS, fonte e ícones do app. Nada de `/api/` (conversas, anexos, sessão) entra no cache.
- Prévia local de anexos escolhidos via `blob:` URL, revogada depois do envio.
- Links de e-mail carregam o token no fragmento (`#verify=…`, `#reset=…`). Navegadores não enviam fragmentos ao servidor, então tokens não aparecem em logs de acesso nem em `Referer`. A página remove o fragmento da barra de endereço assim que o lê.
- Nenhum script, fonte, imagem ou folha de estilo externa. A fonte do logotipo (Grenze Gotisch, OFL) é servida localmente. A CSP bloqueia qualquer origem de terceiros.
- Sem analytics, pixels de rastreamento ou SDKs de login social.

## Serviços externos

| Serviço | Recebe | Quando |
| --- | --- | --- |
| Servidor SMTP configurado (`SMTP_HOST`) | Endereço de e-mail do destinatário e o texto da mensagem (que inclui o link com token) | Registro, reenvio de confirmação e redefinição de senha |
| Provedor de modelo (`KAZER_MODEL_PROVIDER`) | A mensagem, anexos recentes da conversa, o histórico recente, preferências de estilo, instruções pessoais e, se ligadas, as memórias. Nunca e-mail, senha ou tokens | Cada resposta pedida no chat |
| Hospedagem (Vercel, no deploy de produção) | Dados técnicos de cada requisição, como IP e horário, processados pela plataforma | Toda visita ao site |

Nenhum outro serviço recebe dados da aplicação. O provedor de modelo é escolhido por configuração; retenção e eventual uso para treinamento dependem do contrato dele e precisam ser publicados na Política antes de abrir o chat ao público. Os e-mails são texto puro, sem HTML, imagens remotas ou links rastreados. A escolha do provedor SMTP determina a política de retenção dele; documente-a ao configurar produção.

Em desenvolvimento, o backend `file` grava as mensagens em `data/outbox/` (ignorado pelo git, permissão 0600) em vez de enviá-las. Produção recusa esse backend.

## Logs

O servidor web roda sem log de acesso por padrão (sem IPs nem caminhos). Os eventos de autenticação registram apenas o tipo (`auth.login.failed`, `auth.rate_limited` com o escopo), nunca e-mail, IP, senha ou token. O chat registra só eventos (`chat.message_accepted` com as unidades, `chat.generation_finished` com o estado e o código de erro) e falhas do provedor com o status HTTP: nunca conteúdo de mensagens, anexos, chaves ou URLs com credenciais.

## Exclusão de conta e portabilidade

Em *Configurações › Dados e privacidade*, a própria pessoa:

- baixa um JSON com conta, conversas (sem os bytes dos anexos, só nome, tipo e tamanho), memórias e preferências (`GET /api/account/export`);
- apaga todas as conversas e seus anexos (`POST /api/conversations/clear`);
- exclui a conta confirmando a senha (`POST /api/account/delete`): o banco apaga em cascata sessões, links, conversas, mensagens, anexos, memórias, preferências e contagem de uso, e o diretório de anexos da conta é removido do disco.

## Documentos legais

Os Termos de Uso (`/termos`) e a Política de Privacidade (`/privacidade`) refletem este mapa. Pendências antes de abrir cadastros ao público:

- identificar o controlador (nome ou razão social, documento) e o canal do encarregado na seção 2 da Política;
- nomear o provedor SMTP escolhido na seção 5;
- nomear o provedor de modelo de IA, o país de processamento e as condições de retenção e treinamento na seção 5;
- revisão jurídica, incluindo a aplicabilidade da guarda de registros de acesso do art. 15 do Marco Civil da Internet (Lei nº 12.965/2014), que hoje não é feita.
