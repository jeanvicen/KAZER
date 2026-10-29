# Marca KAZER

## Símbolo: Fenda

Um losango (o núcleo, o cristal) partido por uma fenda vertical, com as metades deslocadas em sentidos opostos. A fenda é um cursor de texto (`|`) atravessando o cristal: a marca literalmente escrevendo. O deslocamento herda a falha digital monocromática da abertura e dá direção ao símbolo.

Decisões tomadas a partir de pesquisa sobre marcas de assistentes de IA:

- Evita os lugares-comuns da categoria: estrela de quatro pontas, asterisco/explosão radial, nó entrelaçado e anel com corte diagonal.
- Simetria espelhada, nunca rotacional de quatro braços (formas assim já foram lidas como cruz quebrada em marcas do setor).
- Geometria simples que se mantém a 16 px: a fenda tem 4/64 da largura, ou seja, 1 px no favicon.
- Funciona primeiro em preto e branco; não depende de cor.
- Os cortes diagonais conversam com a pena larga da Grenze Gotisch usada no nome.

### Construção (viewBox 64 × 64)

```svg
<polygon points="30,1.14 10,27.5 30,53.86"/>   <!-- metade esquerda, 4,5 acima -->
<polygon points="34,10.14 54,36.5 34,62.86"/>  <!-- metade direita, 4,5 abaixo -->
```

Losango de 44 × 58, fenda de 4 unidades, deslocamento de ±4,5.

### Estados

| Estado | Uso | Comportamento |
| --- | --- | --- |
| Repouso | Logo, ícones, cabeçalhos | Metades deslocadas, estático |
| Gerando | Enquanto o KAZER escreve uma resposta ou processa um envio | As metades deslizam em sentidos opostos (1,6 s, em loop), alinham-se num losango completo com o cursor no meio e se cruzam |

Para usar o estado "gerando", adicione a classe `is-generating` a um elemento que contenha o SVG com `.mark__l` e `.mark__r` (CSS em `static/assets/kazer.css`). O botão de envio da tela de conta já usa esse estado enquanto aguarda o servidor. Com movimento reduzido ativado no sistema, a animação não roda.

### Arquivos

| Arquivo | Uso |
| --- | --- |
| `static/assets/brand/mark.svg` | Símbolo claro (#F5F5F5) para fundos escuros |
| `static/assets/brand/mark-dark.svg` | Símbolo escuro (#030303) para fundos claros |
| `static/assets/brand/favicon.svg` | Favicon que segue o tema claro/escuro do navegador |
| `static/assets/brand/icon-192.png`, `icon-512.png` | Ícones do app instalável |
| `static/assets/brand/icon-maskable-512.png` | Ícone com área de segurança para Android |
| `static/assets/brand/apple-touch-icon.png` | Ícone de tela inicial no iOS |

## Nome

KAZER em Grenze Gotisch 500 (SIL Open Font License 1.1, servida localmente), tracking de 0,14 em. Em lockup, o símbolo fica à esquerda, com a altura da caixa-alta.

## Cor

A interface é monocromática: #030303, #080808, #0D0D0D, #F5F5F5, #929292 e #242424. A cor fica restrita à cena em pixel art (noite índigo, âmbar da luminária, lavanda do monitor, rosa e creme nos detalhes), sem verde neon.
