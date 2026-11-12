# scripts — utilitários de linha de comando

| Script | Para que serve | Como rodar |
|---|---|---|
| `controle.py` | **Confere o painel de controle** (`controle-de-notificacao/controle.yaml`): diz se está tudo certo e o que vai aparecer no KAZER, ou o erro exato. Também roda no CI | `python scripts/controle.py` |
| `pg_test.sh` | Sobe um **Postgres local descartável**, aplica todas as migrações e roda `supabase/tests/` + a corrida da cota de imagens. Sai 77 se não houver Postgres (NÃO RODOU) | `bash scripts/pg_test.sh` |
| `pg_concurrency.py` | Corrida real: 12 sessões pedindo imagem ao mesmo tempo (chamado pelo `pg_test.sh`) | — |
| `load_test.py` | Teste de carga HTTP com contas sintéticas (saúde, painel, conversas, cota, salvar projeto). Só em ambiente local/de teste | `python scripts/load_test.py --base http://127.0.0.1:8000` |
| `voice_load.py` | Teste de carga do voice gateway (várias sessões, interrupções) | `KAZER_VOICE_TOKEN_SECRET=… python scripts/voice_load.py --sessions 20 --interrupt` |

Rode sempre da raiz do repositório.

---
Mapa geral do repositório: [README principal](../README.md).
