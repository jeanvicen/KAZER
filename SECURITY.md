# Política de segurança inicial

Este documento descreve controles obrigatórios e lacunas desta fundação. **Stubs não são controles implementados. Não use esta base para executar ações reais antes das revisões e implementações correspondentes.**

## Modelo de ameaças

Ativos: credenciais, dados de usuário, memória, workspace, código, serviços conectados e disponibilidade. Adversários/cenários: usuário malicioso, prompt injection em página/arquivo/e-mail, ferramenta comprometida, dependência vulnerável, abuso de credenciais, falha de isolamento, saída acidental de dados, execução de código hostil, negação de serviço e erro de configuração.

## Prompt injection e entradas

Conteúdo externo deve ser identificado como dado não confiável e nunca ganhar prioridade sobre políticas. `input_guard.py` é o ponto obrigatório para entradas e conteúdo recuperado; sua implementação futura precisa cobrir normalização, proveniência e classificação sem alegar que filtros textuais isolados resolvem prompt injection. Instruções em arquivos, páginas e resultados de ferramentas não autorizam ações. A política real deve ser aplicada fora do modelo.

## Segredos e exfiltração

- Apenas `security/secrets.py` pode ler fontes de credenciais. Nenhuma ferramenta lê variáveis diretamente.
- `tool_guard.py` medeia acesso a capacidades secretas; encaminhe credencial efêmera e escopada, nunca o conjunto completo.
- Não versionar `.env`, tokens, senhas, chaves, dumps nem credenciais em fixtures.
- `output_guard.py` e logger devem impedir exfiltração; redigir por padrão e evitar registrar corpo de requisições.
- Usar rotação, revogação, escopos mínimos e armazenamento seguro gerenciado em produção.

## Permissões mínimas e ações

Toda ferramenta declara apenas permissões necessárias entre `read`, `write`, `network`, `shell`, `filesystem` e `admin`. Registro/discovery não é autorização. Negar por padrão, verificar a cada chamada, validar parâmetros e limitar escopo por usuário/sessão/projeto. Escritas externas, exclusões, pagamentos, mensagens e outras ações irreversíveis ou de impacto exigem aprovação humana explícita, informada, limitada à ação e atualizada após qualquer mudança de parâmetros.

## Execução de código e sandbox

Código não confiável nunca executa no processo principal ou no host sem isolamento. A futura sandbox deve limitar filesystem, rede de saída, CPU, memória, processos e tempo; usar ambiente descartável e identidade sem privilégios; bloquear acesso ao socket/metadata/credenciais do host; e verificar resultados antes de devolvê-los. `runtime/sandbox.py` é apenas contrato nesta fase.

## Auditoria e observabilidade

Auditar quem/qual sessão pediu uma ação, ferramenta, permissões, decisão/aprovação, horário e resultado resumido. Não registrar segredos, tokens, conteúdo pessoal, prompt completo ou outputs sensíveis. Proteger integridade, retenção e acesso dos logs; redigir antes da persistência.

## Política de memória

Isolar por usuário, sessão e projeto, com autorização em toda leitura/escrita. Definir finalidade, minimização, proveniência, retenção/expiração, exclusão e tratamento de dados sensíveis. Memória recuperada é dado não confiável; nunca contém concessão de permissão. Não compartilhar entre usuários ou workers por padrão.

## Aprovação humana

A aprovação deve explicar a ação, alvo, dados, efeito e permissões; ser vinculada a uma chamada específica, expirar, permitir recusa e não ser reutilizável para outra ação. Em dúvida, falha de policy ou indisponibilidade do sistema de aprovação, bloquear.

## Autenticação de contas

Implementado em `kazer/auth` e `kazer/interfaces/web` (somente e-mail e senha; nenhum provedor social):

- Senhas com Argon2id (`argon2-cffi`, parâmetros RFC 9106), rehash transparente; política de 10–128 caracteres com bloqueio de senhas óbvias, sem regras de composição.
- Sessões opacas de 256 bits em cookie HttpOnly, SameSite=Lax e `Secure`/`__Host-` em produção; o banco guarda apenas SHA-256 do token. Login rotaciona a sessão; sair a revoga no servidor; redefinir senha revoga todas.
- Links de confirmação (24 h) e redefinição (30 min) são de uso único, consumidos em transação, e trafegam no fragmento da URL para não aparecer em logs.
- Sem enumeração de contas: registro, recuperação e reenvio respondem igual para e-mails cadastrados ou não; login usa erro genérico e verificação Argon2id descartável para igualar o tempo.
- Limites por cliente (login, registro, envio de e-mail, uso de links) e bloqueio temporário por conta após 5 falhas em 15 min, com `Retry-After`.
- CSRF: POST só com `Content-Type: application/json`, `Origin` da própria aplicação e `Sec-Fetch-Site` same-origin; corpo limitado a 4 KB.
- Cabeçalhos: CSP sem origens externas e sem inline, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `nosniff`, COOP/CORP, `Permissions-Policy` restritiva, HSTS quando HTTPS; `Cache-Control: no-store` na API.
- Falha fechada: sem HTTPS, cookies seguros, SMTP ou armazenamento persistente (caso de funções serverless como a Vercel), a tela continua no ar mas a API de contas recusa tudo com `503 auth_unavailable`; a senha SMTP passa por `security/secrets.py`.

Lacunas conhecidas: os limites de taxa vivem na memória de um único processo (várias instâncias exigem armazenamento compartilhado); não há MFA, CAPTCHA nem verificação contra bases de senhas vazadas; a exclusão de conta pelo próprio usuário depende da futura área logada; o IP usado nos limites vem do socket ou de `X-Forwarded-For` apenas de proxies confiáveis do uvicorn (`FORWARDED_ALLOW_IPS`). Dados coletados e retenção: [docs/privacy-data-map.md](docs/privacy-data-map.md).

## Resposta a incidentes e checklist antes de produção

Revogar credenciais, isolar execução afetada, preservar logs redigidos, investigar impacto e notificar conforme obrigações aplicáveis. Antes de habilitar ferramentas reais: revisão de threat model, testes adversariais, avaliação de prompt injection, sandbox validada, testes de isolamento multiusuário, política de rede/egress, redaction verificada, dependências auditadas e plano de rollback.
