# kazer/integrations — serviços externos

**O que é:** adaptadores isolados para falar com serviços de fora. Cada um fica
num arquivo para trocar de fornecedor sem mexer no resto.

| Arquivo | Estado |
|---|---|
| `email.py` | **Em uso**: e-mail transacional só texto (SMTP ou arquivo `.eml` em dev) |
| `payments.py` | **Em uso**: checkout das assinaturas (Stripe) |
| `github.py`, `google_drive.py`, `telegram.py`, `whatsapp.py` | Esqueleto para integração futura (não fazem chamadas) |

**Cuidados:** chave de API só pelo `kazer/security/secrets.py`; nenhum adaptador
manda dado da pessoa sem necessidade.

---
Mapa geral do repositório: [README principal](../../README.md).
