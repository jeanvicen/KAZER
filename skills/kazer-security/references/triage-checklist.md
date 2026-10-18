# Checklist de triagem

## Autenticação e sessão

- [ ] Senhas com hash adaptativo (Argon2id / bcrypt ≥ 12 / scrypt)
- [ ] Sessão rotacionada após login e após elevação de privilégio
- [ ] Cookie: `HttpOnly`, `Secure`, `SameSite=Lax ou Strict`
- [ ] Token de reset de senha de uso único e com expiração curta
- [ ] Logout invalida o token no servidor (não só limpa o cookie)
- [ ] Rate limit em login, reset e verificação
- [ ] 2FA disponível para contas privilegiadas

## Autorização

- [ ] Toda rota com `:id` verifica **propriedade** do recurso, não só autenticação
- [ ] IDOR: `findFirst({ where: { id, tenantId } })` — nunca só por `id`
- [ ] Funções administrativas verificadas por papel no servidor
- [ ] Mass assignment bloqueado (allowlist de campos)
- [ ] Privilégio mínimo em cada serviço

## Injeção

- [ ] SQL parametrizado (nunca concatenação de string)
- [ ] Comandos de sistema sem shell (`execFile` com array, nunca `exec` com string)
- [ ] Template de servidor com escape
- [ ] Path traversal: resolver o caminho e checar prefixo do diretório permitido
- [ ] SSRF: bloquear rede privada e metadata endpoints
- [ ] Desserialização: não desserializar objeto de fonte não confiável

## Segredos

- [ ] Nenhum segredo no repositório (nem no histórico)
- [ ] Segredos no servidor, nunca no bundle do cliente
- [ ] Segredos não em log nem em mensagem de erro
- [ ] Rotação possível sem downtime

## Configuração

- [ ] CORS com origem explícita, nunca `*` com credenciais
- [ ] Headers: CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`
- [ ] Debug e stack trace desativados em produção
- [ ] TLS em trânsito; criptografia em repouso onde fizer sentido
- [ ] Erros não vazam stack trace ao cliente

## Dependências

- [ ] `npm audit` / `pip-audit` no CI
- [ ] Dependências com CVEs alcançáveis priorizadas
- [ ] Versões pinadas com lockfile

## Criptografia

- [ ] Biblioteca auditada, não implementação própria
- [ ] IV/nonce aleatório por operação
- [ ] Comparação em tempo constante para tokens
- [ ] Senha com salt individual
- [ ] Chave de criptografia em KMS, não em código

## Dados

- [ ] PII minimizada e com prazo de retenção
- [ ] Logs sem PII e sem segredo
- [ ] Exportação e exclusão a pedido do titular
- [ ] Backup testado com restauração verificada
