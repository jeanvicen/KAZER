# static — o front-end do KAZER

**O que é:** HTML, CSS e JavaScript **sem build** (sem npm, sem bundler). O que
está aqui é exatamente o que vai para o navegador.

| Arquivo | Papel |
|---|---|
| `index.html` | Página única: abertura, entrada/login e o chat (templates `<template>`) |
| `sw.js` | Service worker: guarda só a "casca" para a tela offline. **Suba `CACHE` (`kazer-shell-vNN`) ao mudar arquivos da casca** |
| `manifest.webmanifest` | Instalar como app (PWA) |
| `preview.html` | Moldura isolada (sandbox) para prévia de páginas/PDF/slides gerados |
| `termos.html`, `privacidade.html` | Páginas legais |
| `assets/` | CSS, JS, ícones e fontes (ver `assets/README.md`) |

**Regras**
- CSP estrita: nada de `<script>` ou `style=""` inline; estilo dinâmico só via CSSOM.
- Texto vindo de fora (pessoa, modelo, painel do dono) entra só por `textContent`.
- Sem rastreadores e sem recursos de terceiros (fontes são servidas daqui).

---
Mapa geral do repositório: [README principal](../../../../README.md).
