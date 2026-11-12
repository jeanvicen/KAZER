# kazer/studio — projetos do KAZER Studio (servidor)

**O que é:** guarda os projetos de design de cada conta. O servidor não desenha nada:
valida o documento, aplica limites e garante a posse.

| Arquivo | Papel |
|---|---|
| `service.py` | `StudioService`: valida o JSON (versão 1, dimensões 64–4096, até 3 MB, miniatura só `data:image`), cria/atualiza/lista/apaga |

Documento: `{"v": 1, "w": 1080, "h": 1080, "bg": "#0b0b0b", "canvas": {…}}`.
Limite de projetos por plano: `design_limit` em `kazer/chat/plans.py` (30).

O editor em si é o front: `static/assets/studio.js` (Fabric.js, MIT). Rotas em
`interfaces/web/create_api.py`. Testes: `tests/test_create.py` e o teste SQL de isolamento.

---
Mapa geral do repositório: [README principal](../../README.md).
