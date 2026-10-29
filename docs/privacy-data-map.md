# Mapa de dados da autenticação

Este documento descreve o que a autenticação própria do KAZER coleta, onde guarda, quem recebe e como apagar. Ele cobre **somente** a tela de entrada e a API `/api/auth/*`. Não cobre conversas, memória ou provedores de modelo, que ainda não existem neste repositório — autenticação própria remove a dependência de login social, mas não torna, por si só, os dados de IA privados.

## O que é coletado

| Dado | Por quê | Onde fica | Retenção |
| --- | --- | --- | --- |
| E-mail (normalizado em minúsculas) | Identificar a conta e enviar links | SQLite `users.email` | Enquanto a conta existir |
| Hash Argon2id da senha (com salt) | Verificar a senha sem guardá-la | SQLite `users.password_hash` | Enquanto a conta existir |
| Data de criação e de confirmação do e-mail | Expirar contas não confirmadas | SQLite `users` | Enquanto a conta existir |
| Hash SHA-256 do token de sessão | Manter o login | SQLite `sessions` | 14 dias ou até sair |
| Hash SHA-256 de links de confirmação/redefinição | Uso único dos links | SQLite `email_tokens` | 24 h (confirmação) / 30 min (redefinição) |
| IP do cliente | Limite de tentativas | Somente memória do processo | Janela do limite (até 1 h); some ao reiniciar |

Não são coletados: nome, telefone, data de nascimento, user agent, localização, identificadores de dispositivo ou dados de terceiros. A senha em claro existe apenas durante a requisição e nunca é registrada nem gravada. Tokens em claro existem só no cookie HttpOnly (sessão) ou no e-mail enviado (links).

Contas que nunca confirmam o e-mail são apagadas automaticamente após 7 dias. Sessões e links vencidos são removidos na inicialização e a cada login.

## Navegador

- Cookie `__Host-kazer_session` (produção) / `kazer_session` (desenvolvimento local): HttpOnly, SameSite=Lax, Secure em produção. Inacessível a JavaScript.
- Nada em `localStorage`, `sessionStorage` ou IndexedDB.
- Links de e-mail carregam o token no fragmento (`#verify=…`, `#reset=…`). Navegadores não enviam fragmentos ao servidor, então tokens não aparecem em logs de acesso nem em `Referer`. A página remove o fragmento da barra de endereço assim que o lê.
- Nenhum script, fonte, imagem ou folha de estilo externa. A fonte do logotipo (Grenze Gotisch, OFL) é servida localmente. A CSP bloqueia qualquer origem de terceiros.
- Sem analytics, pixels de rastreamento ou SDKs de login social.

## Serviços externos

| Serviço | Recebe | Quando |
| --- | --- | --- |
| Servidor SMTP configurado (`SMTP_HOST`) | Endereço de e-mail do destinatário e o texto da mensagem (que inclui o link com token) | Registro, reenvio de confirmação e redefinição de senha |

Nenhum outro serviço recebe dados. Os e-mails são texto puro, sem HTML, imagens remotas ou links rastreados. A escolha do provedor SMTP determina a política de retenção dele; documente-a ao configurar produção.

Em desenvolvimento, o backend `file` grava as mensagens em `data/outbox/` (ignorado pelo git, permissão 0600) em vez de enviá-las. Produção recusa esse backend.

## Logs

O servidor web roda sem log de acesso por padrão (sem IPs nem caminhos). Os eventos de autenticação registram apenas o tipo (`auth.login.failed`, `auth.rate_limited` com o escopo), nunca e-mail, IP, senha ou token.

## Exclusão de conta

O esquema já suporta exclusão completa: `AuthStore.delete_user()` remove a linha de `users` e, em cascata, todas as sessões e links. Não há outro lugar com dados da conta. **Ainda falta** a interface autenticada para o próprio usuário pedir a exclusão (com reautenticação), que depende da área logada do KAZER. Até lá, a exclusão é um procedimento administrativo sobre o banco.

## Pendências jurídicas

O repositório não possui Política de Privacidade nem Termos de Uso; por isso a tela não exibe links legais. Esses documentos precisam ser redigidos e revisados antes de abrir cadastro ao público, refletindo este mapa de dados e o provedor SMTP escolhido.
