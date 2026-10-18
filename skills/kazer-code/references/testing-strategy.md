# Estratégia de testes

## A ordem que funciona

1. **Linha de base.** Rode a suíte **antes** de mudar. Registre o estado.
2. **Teste de caracterização.** Trave o comportamento atual (inclusive o bug),
   para saber exatamente o que mudou.
3. **Teste unitário** para a regra extraída.
4. **Teste de integração** para a fronteira (repo, API, fila).
5. **Smoke test** para o caminho crítico em produção.
6. **Só então** remova o teste antigo.

Pular o passo 1 é como refatorar sem saber se quebrou algo.

## O que testar

| Alvo | Como |
|---|---|
| Regra de negócio | Teste unitário com tabela de casos (entrada → saída) |
| Transformação de dados | Property-based: 100 entradas aleatórias |
| Integração com API | Contract test contra o schema real |
| Bug | Teste de regressão nomeado pelo bug |
| Performance | Benchmark com baseline; compare antes/depois |
| UI | Teste do comportamento, não do snapshot |

## Teste de regressão

Nomeie pelo **bug**, não pela função:

```ts
// BUG-1423: desconto de 15% aplicado duas vezes em pedido com cupom
it('aplica desconto de 15% uma única vez quando há cupom', () => {
  const order = buildOrder({ coupon: 'SAVE15', items: [...] });
  const total = applyDiscount(order);
  expect(total.discount).toBe(order.subtotal * 0.15);
});
```

O nome explica **por que** o teste existe. Seis meses depois, alguém que não
conhece a história entende o que pode quebrar.

## O que NÃO testar

- **Getters e setters triviais** — o compilador já garante
- **Detalhe de implementação** — testar `private` cria atrito sem proteção
- **A biblioteca de terceiros** — ela tem os testes dela
- **Mensagem de log exata** — a menos que exista um contrato sobre ela

## Cobertura como sinal, não meta

100% de cobertura é uma meta que produz testes sem assertions e código
inalcançável. Use cobertura para **encontrar** código não testado, não para
comprovar qualidade.

Ordem útil:
1. Cobertura **de caminho** (quais branches são exercitados) — mais reveladora
2. Cobertura de **mutação** (o teste falha se eu mudo o código?) — a que importa
3. Cobertura de **linha** — a mais fácil, a menos informativa

## Teste de contrato de API

O contrato é o schema. Teste contra o schema, não contra a implementação:

```ts
it('todo artifact tem versão e tamanho', () => {
  const response = await client.get('/artifacts');
  for (const artifact of response.body) {
    expect(artifact).toMatchSchema(artifactSchema);
  }
});
```

Este teste sobrevive a refatoração interna e quebra quando o contrato muda —
exatamente o que você quer.

## Flaky tests

Teste flaky é **bug no teste**, não teste ruim. Trate com a mesma seriedade:

- Identifique a causa (ordem, hora, rede, estado global)
- Isole o teste (o teste passa sozinho?)
- Marque como `quarantine` com **tarefa e prazo**, nunca em silêncio
- Nunca use `sleep` para consertar — use sincronização real
