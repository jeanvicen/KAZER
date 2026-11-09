# kazer/security — segurança

**O que é:** as peças que protegem contas, segredos e o agente. Parte está **em
produção** (senhas, segredos, limites de taxa) e parte é contrato do agente.

| Arquivo | Papel | Estado |
|---|---|---|
| `passwords.py` | Hash de senha com Argon2id | em uso |
| `secrets.py` | **Único** lugar que lê segredos, por escopo (ex.: `voice` só vê as chaves de voz) | em uso |
| `rate_limiter.py` | Limite de tentativas por janela (login, cadastro, voz…) | em uso |
| `permissions.py` | Menor privilégio, negar por padrão | contrato |
| `tool_guard.py` | Autorização obrigatória de chamada de ferramenta | contrato |
| `input_guard.py`, `output_guard.py` | Fronteira instrução/dado e anti-vazamento | contrato |
| `audit_log.py` | Auditoria sem guardar conteúdo | contrato |

**Cuidados:** nunca criar criptografia própria; nunca ler `os.environ` para
segredo fora de `secrets.py`. Política: `SECURITY.md` e `docs/security-policy.md`.
Testes: `tests/test_security.py`.

---
Mapa geral do repositório: [README principal](../../README.md).
