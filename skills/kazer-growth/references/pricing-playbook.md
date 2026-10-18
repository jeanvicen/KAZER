# Playbook de pricing

## Âncoras

Você não pode precificar sem referência. Use três:

1. **Âncora de custo** — quanto custa entregar (tokens, infra, suporte).
   É o **piso**, não o preço.
2. **Âncora de valor** — quanto o cliente ganha. É o **teto**.
3. **Âncora de referência** — o que a alternativa custa. É o **ponto de
   comparação** que o comprador já tem na cabeça.

Se as três não convergem, o preço está errado — não o produto.

## Modelos

### Assinatura por assento
- Valor cresce com o número de pessoas
- Force: o cliente não quer dar assento a quem não usa
- Cue: o cliente subestima o uso → ele prefere usage-based

### Assinatura por uso
- Consumo previsível e mensurável
- Force: custo marginal alto (tokens, API de terceiros)
- Cue: o cliente tem medo da fatura

### Híbrido (base + uso)
- Resolve os dois medos: base previsível + excedente proporcional
- É o modelo mais defensável para produto de IA
- Cue: a unidade de uso precisa ser legível ("1.000 misses")

### Consumo puro
- Uso esporádico com valor alto por evento
- Cue: receita imprevisível, difícil de orçar internamente

## Erros comuns

| Erro | Por que falha | Em vez disso |
|---|---|---|
| Preço por custo | Ignora o valor entregue | Preço por valor, custo como piso |
| 3 planos sem diferença real | Ninguém sabe qual escolher | Diferença de **capacidade** |
| Plano grátis inútil | Ninguém sobe | Plano grátis com valor real e limite |
| Plano grátis sem limite | Ninguém paga | Limite generoso no uso, custo baixo |
| Preço com muitos decimais | "R$ 59,99" sugere precificação manual | Preço redondo |
| Mudar preço sem aviso | Perde confiança | Aviso + Freeze para quem fica |

## Preço redondo

R$ 99 e R$ 149 convertem melhor que R$ 97 e R$ 143. O centavo sugere que o
preço foi calculado, não escolhido.

## Teste do "vale a pena"

Um lead de sales deve conseguir responder "por que vale a pena pagar isso?"
em **uma frase** após ler a página de preços. Se não consegue, a tabela
comparativa está errada — e a comparação deveria ser por **capacidade**,
não por lista de features.

## O que a tabela comparativa precisa ter

1. O **nome** de cada plano
2. O **preço** e a unidade (por mês, por uso)
3. **O que** cada plano libera
4. **Quem** cada plano é para
5. O que se **perde** ao descer de plano — essa linha é a que converte
