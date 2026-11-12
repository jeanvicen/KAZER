# kazer/capabilities — o que o KAZER faz de verdade

**O que é:** um registro tipado de capacidades. Cada entrada diz o nome, a família, o
estado (`available`, `needs_config`, `paused`), os planos, a cota, a classe de custo, o
prazo, se cancela, se pede confirmação, o provedor e — o mais importante — **as rotas,
os módulos e os testes reais** que a sustentam.

| Arquivo | Papel |
|---|---|
| `registry.py` | A lista `CAPABILITIES` e `public_catalog()` (o que vai para a tela, sem caminhos internos) |

`GET /api/capabilities` entrega o catálogo já marcado com o plano da conta.
`tests/test_capabilities.py` quebra se uma capacidade apontar para rota ou arquivo que
não existe: **não registre o que não funciona.** Ideias ficam em
`docs/roadmap/capability-catalog.md`.

---
Mapa geral do repositório: [README principal](../../README.md).
