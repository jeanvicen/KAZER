# kazer/interfaces/web — o site e a API

**O que é:** a aplicação Starlette que a Vercel roda. Serve as páginas, os
arquivos estáticos e todas as rotas `/api/*`.

| Arquivo | Papel |
|---|---|
| `asgi.py` | Entrada para hospedagem: `kazer.interfaces.web.asgi:app` |
| `__main__.py` | Rodar local: `python -m kazer.interfaces.web` (ou `make web`) |
| `app.py` | `create_app()`: cabeçalhos de segurança (CSP, etc.), páginas, rotas de conta, `/api/health`, **`/api/status`** (manutenção + aviso) |
| `common.py` | `WebContext`: CSRF por `Origin`, leitura de JSON com limite, sessão (`user()`), **bloqueio de manutenção**, `endpoint` (erros em JSON) |
| `chat_api.py` | Rotas do chat, anexos, memória, preferências, biblioteca, conta |
| `create_api.py` | Rotas de criação: `/api/images` (cota diária), `/api/designs` (Studio) e `/api/capabilities` |
| `voice_api.py` | Rotas do modo voz (`/api/voice/config`, `/session`, `/tts`) |
| `static/` | Todo o front-end (HTML, CSS, JS sem build) |

**Rotas principais**

| Rota | Quem acessa |
|---|---|
| `GET /api/health` | Público (sonda de rede) |
| `GET /api/status` | Público (painel: manutenção + aviso global) |
| `/api/auth/*` | Login, cadastro, sessão, reset |
| `/api/chat`, `/api/conversations`… | Só logado |
| `/api/voice/*` | Só logado |

**Segurança que não pode quebrar:** CSP sem inline, checagem de `Origin` em
toda escrita, cookie HttpOnly/SameSite, corpo limitado, erro sempre como código
estável, câmera bloqueada e microfone só para o próprio site.

---
Mapa geral do repositório: [README principal](../../../README.md).
