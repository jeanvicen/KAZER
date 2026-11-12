# kazer/images — criação de imagens

**O que é:** a regra da cota diária e a fronteira com quem gera a imagem. O KAZER
**não embute modelo**: gerar imagem precisa de GPU, e isso tem custo.

| Arquivo | Papel |
|---|---|
| `service.py` | `ImageService`: valida o pedido, **reserva → gera → conclui**, entrega o arquivo só à conta dona |
| `providers.py` | Adaptadores: `endpoint` (servidor de inferência seu, por HTTP), `demo` (degradê para testar, nunca em produção) ou nenhum (tela diz que está desligado) |

**Regras:** 1 imagem concluída por conta por dia UTC (`images_per_day` em
`kazer/chat/plans.py`); falha não gasta o dia; mesma chave = mesmo pedido; duas abas não
furam a cota; reserva abandonada expira em 10 min.

Banco: `kazer/chat/store_extras.py` (SQLite) e `kazer/chat/supabase_extras.py` +
migração `20261110120000`. Rotas: `kazer/interfaces/web/create_api.py`.
Como ligar: `docs/images/RUNTIME.md`. Testes: `tests/test_create.py`,
`supabase/tests/images_studio_memory_test.sql`, `scripts/pg_concurrency.py`.

---
Mapa geral do repositório: [README principal](../../README.md).
