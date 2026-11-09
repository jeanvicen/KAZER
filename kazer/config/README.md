# kazer/config — configuração e painel do dono

**O que é:** configuração não secreta, validada na subida, e o leitor do
**painel de manutenção e aviso global**.

| Arquivo | Papel |
|---|---|
| `settings.py` | `load_settings()`: lê variáveis `KAZER_*` e valida (ambiente, URL pública, banco, provedor…) |
| `models.py` | Base tipada (Pydantic) das configurações |
| `control.py` | **Painel do dono**: lê `controle-de-notificacao/controle.yaml` (manutenção + aviso), valida, guarda em cache e relê só quando o arquivo muda |
| `tools.yaml`, `permissions.yaml` | Declaração das ferramentas do agente e das permissões (contratos, usados nos testes) |

**Como funciona o `control.py`**
- `control.current()` → estado atual (`Control` com `.maintenance` e `.notice`).
- Arquivo ausente ou com erro ⇒ tudo desligado + aviso no log (o site nunca cai).
- `KAZER_CONTROL_FILE` aponta para outro arquivo (testes/staging).
- Quem usa: `interfaces/web/common.py` (bloqueio 503) e `interfaces/web/app.py` (`/api/status`).

Guia do dono: [`controle-de-notificacao/README.md`](../../controle-de-notificacao/README.md).

**Cuidados:** segredo **não** entra aqui — vai em `kazer/security/secrets.py`.

---
Mapa geral do repositório: [README principal](../../README.md).
