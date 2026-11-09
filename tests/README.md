# tests — testes automáticos (pytest)

**O que é:** a rede de segurança. Rodam sem internet e sem chave nenhuma
(provedores, Supabase e web são simulados). O CI roda tudo a cada push.

```bash
make test        # ou: pytest -q
pytest tests/test_control.py -q   # só um arquivo
```

| Arquivo | Cobre |
|---|---|
| `conftest.py` | Zera limites/caches entre testes e **desliga o painel real** (`KAZER_CONTROL_FILE`) |
| `test_control.py` | Painel do dono: manutenção, aviso global, validação do `controle.yaml` |
| `test_web_auth.py`, `test_auth.py`, `test_supabase_auth.py` | Contas, sessão, defesas da borda |
| `test_chat.py`, `test_chat_supabase.py`, `test_supabase_exchange_reservation.py` | Chat pela API, posse, cotas, anexos |
| `test_research.py`, `test_web_tools.py` | Pesquisa, citações, leitura de páginas |
| `test_artifacts.py`, `test_documents.py`, `test_library.py` | Artefatos, PDFs, biblioteca |
| `test_plans.py`, `test_billing.py`, `test_forja.py` | Planos, cobrança, KZ Code |
| `test_groq.py`, `test_model_provider.py` | Escolha de modelo e streaming |
| `test_projects_skills.py`, `test_skill_guard.py` | Projetos, Skills e a guarda |
| `test_voice.py` | Modo voz (tokens, rotas, gateway, voz Piper) |
| `test_appearance.py` | Tema e idioma |
| `test_terminal.py` | Cliente de terminal |
| `test_connections.py`, `test_connectors.py` | Conectores pausados |
| `test_core.py`, `test_memory.py`, `test_tools.py`, `test_security.py` | Contratos estruturais |
| `fixtures/` | Dados sintéticos |

**Regras:** nunca desligar ou pular teste para "passar". Bug corrigido ganha teste.

---
Mapa geral do repositório: [README principal](../README.md).
