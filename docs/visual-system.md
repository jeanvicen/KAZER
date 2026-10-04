# Sistema visual do KAZER

O KAZER trata visuais gerados como pequenas peças de direção de arte, não como uma sequência automática de cartões. O modelo deve escolher uma linguagem coerente com o assunto e construir hierarquia, foco, profundidade e espaço negativo.

## Direção de arte

Antes de compor, o Brain escolhe uma direção adequada ao pedido: editorial, surreal, orgânica, arquitetônica, futurista, cinematográfica, minimalista, científica ou outra que faça sentido. Uma composição forte normalmente contém um fundo, uma camada de atmosfera e um elemento focal. Formas, textura, iluminação e contraste devem apoiar o foco; quadrados e cartões são reservados para interfaces, painéis e informações que realmente pedem essa estrutura.

Para evitar resultados repetitivos, o prompt visual orienta variação de silhueta, assimetria controlada, curvas, profundidade, gradientes, sombras e detalhes sutis. O visual deve parecer uma peça final e responsiva, não um wireframe.

## Formatos

- `kazer-svg`: ilustrações, diagramas conceituais, formas orgânicas, cenas abstratas e composições vetoriais. Deve usar `viewBox`, `preserveAspectRatio`, `defs`, grupos e estilos autocontidos.
- `kazer-html`: cenas, cards editoriais, mockups visuais e composições com CSS. Deve ser autocontido, responsivo e sem recursos externos.
- `html`, `css`, `javascript` e outras linguagens comuns: são sempre tratados como **código-fonte copiável**, não como visual renderizado.

A distinção evita que um pedido de `index.html` seja transformado em uma prévia visual. A prévia precisa ser solicitada ou produzida pelo formato visual explícito.

## Qualidade técnica

SVGs devem usar um sistema de coordenadas consistente. O atributo `viewBox` define a posição e as dimensões do viewport em unidades do usuário e, junto com `preserveAspectRatio`, permite que a composição se adapte ao espaço disponível ([MDN — viewBox](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/viewBox)). Gradientes lineares, radiais, cônicos, repetidos e camadas múltiplas podem criar profundidade sem imagens externas ([web.dev — Gradients](https://web.dev/learn/css/gradients)).

O renderizador mantém estilos SVG sanitizados para preservar gradientes, filtros leves e animações locais, enquanto remove scripts, recursos externos, formulários e elementos que ampliariam a superfície de ataque. O HTML visual é isolado em `iframe` com `sandbox` e CSP sem rede; `srcdoc` é tratado como uma superfície de injeção e não recebe conteúdo externo ([MDN — srcdoc e segurança](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/srcdoc)).

## Critérios de aceitação

Um visual é considerado pronto quando tem uma ideia focal legível, composição responsiva, contraste suficiente, detalhes que não dependem de recursos externos, ausência de quadrados decorativos repetidos e renderização sem erro. Se a tarefa for de código, o critério muda: o resultado deve ser um bloco de código completo, copiável e com a linguagem correta.
