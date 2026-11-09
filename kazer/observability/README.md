# kazer/observability — logs, métricas e rastreio

**O que é:** como o KAZER se observa **sem guardar dado pessoal**.

**Estado:** esqueleto (contratos e tipos). O produto em produção não depende desta pasta ainda.

| Arquivo | Contrato |
|---|---|
| `logger.py` | Log estruturado com remoção de dados sensíveis antes de gravar |
| `metrics.py` | Métricas agregadas, sem rótulo pessoal |
| `telemetry.py` | Política de telemetria mínima |
| `tracing.py` | Rastreio sem conteúdo da pessoa nem segredos |

Hoje o site usa o `logging` padrão (`kazer.web`, `kazer.control`…), visto nos logs da Vercel.

---
Mapa geral do repositório: [README principal](../../README.md).
