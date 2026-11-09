# scripts — utilitários de linha de comando

| Script | Para que serve | Como rodar |
|---|---|---|
| `controle.py` | **Confere o painel de controle** (`controle-de-notificacao/controle.yaml`): diz se está tudo certo e o que vai aparecer no KAZER, ou o erro exato. Também roda no CI | `python scripts/controle.py` |
| `voice_load.py` | Teste de carga do voice gateway (várias sessões, interrupções) | `KAZER_VOICE_TOKEN_SECRET=… python scripts/voice_load.py --sessions 20 --interrupt` |

Rode sempre da raiz do repositório.

---
Mapa geral do repositório: [README principal](../README.md).
