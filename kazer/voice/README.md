# kazer/voice — modo voz

**O que é:** a conversa falada do KAZER. O navegador transcreve a fala da pessoa
(o KAZER **não grava nem guarda áudio**, só recebe o texto final), o chat responde
e o servidor gera a voz.

| Arquivo | Papel |
|---|---|
| `tts.py` | Voz do servidor. Padrão: **Piper** open source, voz masculina pt-BR `pt_BR-cadu-medium` (sem chave). ElevenLabs/OpenAI só com `KAZER_TTS_PROVIDER` explícito |
| `speech_text.py` | Deixa o texto falável (tira Markdown, código, links, citações) e quebra em frases |
| `tokens.py` | Tokens curtos e assinados para o gateway opcional |
| `gateway.py` | Voice gateway **opcional** e separado (WebSocket, Whisper + Kokoro), para hospedar fora da Vercel |
| `__init__.py` | Descrição do pacote |

Rotas: `kazer/interfaces/web/voice_api.py`. Front: `voicemode.js`, `voiceorb.js`.
Documentação completa: `docs/voice/` (arquitetura, protocolo, segurança, capacidade, deploy).
Testes: `tests/test_voice.py`.

---
Mapa geral do repositório: [README principal](../../README.md).
