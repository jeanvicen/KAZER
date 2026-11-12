# static/assets — CSS, JavaScript, ícones e fontes da interface

Servido em `/assets/…`. Módulos ES nativos, carregados sob demanda quando a tela abre.

**Entrada e base**

| Arquivo | Papel |
|---|---|
| `app.js` | Boot: abertura, entrar/criar conta, decide abrir o chat; inicia o painel (`startControl`) |
| `aviso.js` + `aviso.css` | **Tela de manutenção e aviso global** (lê `/api/status`; dono controla em `controle-de-notificacao/`) |
| `net.js` | Pedidos com prazo e novas tentativas, detecção real de queda, evento `kazer:maintenance` |
| `dom.js` | Utilitários sem `innerHTML` (`h()`, ícones, `store`) |
| `i18n.js` + `i18n-en.js` | Inglês: dicionário por texto exato (chaves sem espaço sobrando e únicas) |
| `theme.js` | Tema escuro/claro/sistema |
| `intro.js`, `scene.js`, `scene-desktop.js` | Abertura em partículas e a cena em pixel art |
| `kazer.css`, `refine.css`, `legal.css` | Estilos da entrada, refinamento visual (Inter, tokens) e páginas legais |

**Chat e telas**

| Arquivo | Papel |
|---|---|
| `chat.js` + `chat.css` | Chat inteiro: gaveta, composer, mensagens, modo voz (folha) |
| `markdown.js` | Markdown seguro (monta DOM, nunca HTML de fora) |
| `deliver.js`, `docs.js`, `zip.js` | Cartões de arquivo, PDF/slides, `.zip` |
| `sheets.js` | Folhas (celular) e painéis (desktop), confirmações, toasts |
| `settings.js`, `plans.js`/`plans.css` | Configurações e planos |
| `screens.js`/`screens.css`, `forja.js`/`forja.css`, `library.js`/`library.css`, `artifacts-screen.js`, `terminal-screen.js` | Telas cheias: KZ Code, Biblioteca, Artefatos, Terminal |
| `skills.js`, `slash.js`, `palette.js`/`palette.css` | Skills, menu "/", paleta Ctrl+K |
| `voice.js` | Ditado (reconhecimento do navegador) |
| `voicemode.js`, `voiceorb.js`, `voice-worklet.js` | Conversa por voz (voz Piper do servidor, interrupção), esfera animada, motor gateway |
| `offline.js`, `loader.js`, `mascot.js`, `pixel.js`, `squares.js` | Tela sem internet, carregador, mascote Kazinho, letreiro em pixel, fundo de quadradinhos |
| `studio.js` + `studio.css` | **KAZER Studio**: editor de design (texto, formas, fotos, camadas, desfazer, salvar na conta, exportar PNG/JPEG/PDF) |
| `criar.js` | **Criar imagem**: pedido, formato, estilo, cota real do servidor e galeria (usa `studio.css`) |
| `vendor/` | Código de terceiros com licença (Fabric.js, MIT) |
| `brand/`, `fonts/` | Ícones/logo e fontes da interface |

**Cuidados para agentes**
- Arquivo novo que precise abrir offline ⇒ adicionar em `SHELL` do `sw.js` e subir a versão do cache.
- Texto novo visível ⇒ adicionar a tradução em `i18n-en.js`.
- Rodar `node --check arquivo.js` antes de commitar (o CI roda em todos).

---
Mapa geral do repositório: [README principal](../../../../../README.md).
