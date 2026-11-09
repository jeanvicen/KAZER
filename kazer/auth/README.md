# kazer/auth — contas e sessões

**O que é:** cadastro com e-mail e senha, login, sessão, confirmação de e-mail e
recuperação de senha. **Sem login social e sem rastreador.**

| Arquivo | Papel |
|---|---|
| `service.py` | Regras de conta no modo **local** (SQLite): registro, login, sessão, reset. Erros são `AuthError(code, status)` |
| `supabase_service.py` | Mesmo contrato usando o **Supabase Auth** (produção). Renova o token vencido e devolve o cookie novo |
| `store.py` | Banco SQLite local das contas (`User`) |
| `tokens.py` | Tokens opacos de sessão/e-mail (o banco guarda só o hash) |
| `validation.py` | Normaliza e valida e-mail e senha |
| `messages.py` | Textos dos e-mails (texto puro, sem imagem remota) |

**Como funciona**
- O site escolhe o serviço em `kazer/interfaces/web/app.py` (`_build_service`):
  Supabase configurado ⇒ Supabase; senão local; sem condições seguras ⇒ contas fechadas (`503 auth_unavailable`).
- A sessão vai num cookie **HttpOnly**; o JavaScript nunca vê o token.
- Toda rota autenticada passa por `WebContext.user()` (`interfaces/web/common.py`),
  que também aplica o **modo manutenção** do `controle-de-notificacao/controle.yaml`.

**Cuidados:** senha só com Argon2id (`security/passwords.py`). Nunca logar e-mail+senha.

---
Mapa geral do repositório: [README principal](../../README.md).
