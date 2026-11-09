# kazer/brain — modelos de IA

**O que é:** como o KAZER fala com os modelos. O nome público é **"KAZ 1.1"**;
por trás, o servidor escolhe o provedor configurado (Groq por padrão).

| Arquivo | Papel |
|---|---|
| `model_provider.py` | Adaptadores (Groq, OpenAI-compatível, Anthropic…). Streaming de texto, raciocínio, ferramentas e imagens |
| `groq_limits.py` | Governador de cota da Groq: escolhe um modelo que ainda tem limite |
| `context_builder.py` | Contrato para montar contexto mínimo e confiável |
| `prompt_manager.py` | Carrega prompts versionados |
| `decision.py`, `reasoning.py` | Contratos do agente (decisão proposta, autocorreção) |

**Cuidados:** a escolha de modelo é do servidor (a pessoa escolhe só o esforço).
Testes: `tests/test_groq.py`, `tests/test_model_provider.py`.

---
Mapa geral do repositório: [README principal](../../README.md).
