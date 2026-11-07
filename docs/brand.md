# Marca KAZER

Obsidiana com ouro champanhe: o preto domina, o branco escreve e o ouro aparece
pouco, sempre por um motivo. O luxo vem da precisão, não da quantidade de ouro.

## Símbolo: o Alien

Uma cabeça de alien com olhos amendoados inclinados para o centro e, embaixo,
um colar de três placas: a asa esquerda, a placa do queixo e a asa direita. A
cabeça é a inteligência; as placas são a voz, o que o KAZER entrega.

- Funciona primeiro em uma cor só. O ouro nas placas é um acabamento opcional
  (ícones do app e favicon), nunca obrigatório.
- Os olhos são furos (`fill-rule="evenodd"`): o fundo aparece por eles, então o
  símbolo serve em qualquer superfície sem desenhar o olho de outra cor.
- Lê bem a 16 px: as placas têm cantos arredondados por traço (`stroke-linejoin:
  round`) para não virarem serrilhado no favicon.

### Construção (viewBox 64 × 64)

A geometria mora em um lugar só, `MARK_PATHS` em `static/assets/dom.js`, e é
reaproveitada pelo HTML, pela intro (Path2D), pela capa de documentos e pelos
ícones.

```text
head  M32 4C43.2 4 50.6 12 50.6 21.6 … (cabeça com os dois olhos vazados)
l     M6 40.6Q15 40.6 19.6 44.9L20.2 50.6Q14.6 48.4 6.2 48.2Z    (asa esquerda)
b     M20.4 52.3Q32 58.6 43.6 52.3L43.1 58.4Q32 65.2 20.9 58.4Z  (placa do queixo)
r     M58 40.6Q49 40.6 44.4 44.9L43.8 50.6Q49.4 48.4 57.8 48.2Z  (asa direita)
```

Classes: `.mark__head` e `.mark__plate.mark__plate--l|b|r`. Área de respiro:
metade da largura da cabeça em volta. Não esticar, não girar, não contornar com
brilho, não trocar a cor da cabeça por ouro.

### Estados

| Estado | Onde | Comportamento |
| --- | --- | --- |
| Repouso | Logo, cabeçalhos, ícones | Estático |
| Gerando | Enquanto o KAZER escreve ou o servidor responde | A cabeça sobe 2 px e volta; as placas pulsam em sequência (0 s, 0,18 s, 0,36 s, via `--plate-delay`) |
| Digitando | Tela vazia do chat enquanto a pessoa escreve | A cabeça se ergue e as placas se abrem um pouco |

Para o estado "gerando", adicione `is-generating` a um elemento que contenha o
SVG. Com movimento reduzido (sistema ou Configurações → Animações), nada disso
roda.

### Arquivos

| Arquivo | Uso |
| --- | --- |
| `static/assets/brand/mark.svg` | Símbolo claro (#F5F5F5) para fundos escuros |
| `static/assets/brand/mark-dark.svg` | Símbolo escuro (#030303) para fundos claros |
| `static/assets/brand/favicon.svg` | Segue o tema do navegador; placas em #D5B15A (escuro) ou #A8792A (claro) |
| `static/assets/brand/icon-192.png`, `icon-512.png` | App instalável: fundo obsidiana, cabeça branca, placas em ouro metálico |
| `static/assets/brand/icon-maskable-512.png` | Android, com o símbolo em 50% para a área de segurança |
| `static/assets/brand/apple-touch-icon.png` | Tela inicial do iOS |

## Nome

KAZER em Grenze Gotisch 500 (SIL Open Font License 1.1, servida localmente),
tracking de 0,14 em. Em lockup, o símbolo fica à esquerda, com a altura da
caixa-alta.

## Cor

Os tokens ficam em `:root` no `static/assets/kazer.css`; o `chat.css` acrescenta
`--accent-text` e o mapa do tema claro. Nada de cor solta no CSS novo: use o
token.

### Base

| Token | Valor | Papel |
| --- | --- | --- |
| `--black` | #030303 | Obsidiana, fundo principal |
| `--black-2` | #080808 | Fundo elevado |
| `--surface` | #0D0D0D | Superfícies |
| `--surface-2` | #141416 | Superfície elevada, hover |
| `--text` | #F5F5F5 | Texto principal |
| `--text-2` | #929292 | Texto secundário |
| `--text-3` | #5F5F5F | Texto apagado (nunca para informação essencial) |
| `--border` | #242424 | Borda sutil |
| `--border-hover` | #333333 | Borda mais forte |

### Ouro

| Token | Valor |
| --- | --- |
| `--gold-shadow` | #6D4B19 |
| `--gold-bronze` | #A8792A |
| `--gold-metal` | #B88A3B |
| `--gold` | #D5B15A (ouro champanhe) |
| `--gold-hi` | #F1DFA5 |
| `--gradient-metallic-gold` | `linear-gradient(115deg, #6D4B19 0%, #A8792A 22%, #D5B15A 43%, #F1DFA5 52%, #B88A3B 74%, #6D4B19 100%)` |
| `--gradient-gold-button` | `linear-gradient(180deg, #EAD08D 0%, #D5B15A 46%, #BB8D3E 100%)` |

Papéis semânticos: `--color-accent`, `--color-accent-hover`,
`--color-accent-active`, `--color-accent-subtle` (fundo 10%),
`--color-accent-border` (borda 38%), `--color-accent-foreground` (#17110A, texto
sobre ouro), `--color-accent-glow`, `--color-focus-ring`.

Estados que **não** são ouro: `--color-danger` (#FF8A80, erro e ação
destrutiva), `--color-warning` (#F5A25A, aviso), `--color-success` (#7EE2A8).
Links continuam azuis (`--link`).

### Onde o ouro entra

| Forma | Onde |
| --- | --- |
| Sólido (`--gradient-gold-button`) | Só a ação principal da tela: enviar, "Entrar com e-mail", continuar/assinar, salvar nova senha. E o interruptor ligado. |
| Discreto (fundo `subtle` + borda `border` + texto `--accent-text`) | Seleção: filtros, abas, controle segmentado, avatar do perfil. |
| Traço ou ponto | Conversa ativa no histórico, ferramenta ativa, ícone do item selecionado na paleta e no menu `/`. |
| Anel de foco | Todo foco por teclado: 2 px em `--color-focus-ring`. |

Nunca: texto corrido em ouro, borda dourada em todo cartão, degradê grande
cobrindo a tela, brilho neon, ouro para erro ou aviso.

### Planos

Cada plano tem uma cor de destaque (`accent` em `kazer/chat/plans.py`):
gratuito #8A8F98 (grafite), Pro #D5B15A (champanhe), Ultra #F1DFA5 (o ouro mais
claro, o topo). O botão de continuar tira o reflexo metálico da própria cor do
plano.

### Tema claro

O champanhe some no fundo claro, então o tema claro troca o texto dourado por
bronze: `--accent-text` #8A6424 (cerca de 5:1 sobre #FAFAFA, AA), `--gold`
#A8792A, e versões próprias de `subtle`, `border`, foco e aviso (#9A5212). O
símbolo vira preto com placas cinza.

## Mascote: Kazinho

O alien do logo em corpo inteiro, em pixel art: cabeça branca com olhos
amendoados, colar dourado (as três placas), moletom cinza com um botão dourado
e tênis claros. Paleta curta, sempre em pixel (`image-rendering: pixelated`),
sem anti-aliasing.

| Onde | Arquivo |
| --- | --- |
| Tela de entrada: o KAZER na tela do computador, programando, mais o pôster e o boneco na estante | `static/assets/scene.js` (sprites `MASCOT`, `MASCOT_BLINK`, `POSTER`, `FIGURE`), `scene-desktop.js` |
| Sem internet | `static/assets/offline.js` |
| Carregando (levantando um halter) | `static/assets/loader.js` |
| Boas-vindas do KZ Code | `static/assets/mascot.js` → `pixelMascot()` |

Ele pisca e respira só quando o movimento é permitido; com movimento reduzido,
fica parado numa pose.

## Movimento

Animação explica uma mudança ou mostra trabalho real; nunca enfeita espera
inventada. Respeite `prefers-reduced-motion` e Configurações → Animações: sem
loop infinito, e as cenas em canvas desenham uma pose só.
