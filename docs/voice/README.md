# Modo voz do KAZER

| Documento | O que tem |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Auditoria do repositório, desenho, diagrama Mermaid, decisões |
| [PROTOCOL.md](PROTOCOL.md) | API e protocolo `kazer-voice/1` (web e app nativo) |
| [SECURITY.md](SECURITY.md) | Ameaças, privacidade, o que é testado, riscos restantes |
| [CAPACITY.md](CAPACITY.md) | Resultados medidos (locais), plano de capacidade 100 → 10.000+ |
| [DEPLOY.md](DEPLOY.md) | Variáveis, modelos (fonte/licença), hospedagem, custos, rollout |
| [RESEARCH.md](RESEARCH.md) | 100 repositórios verificados, stack escolhida e rejeitados |

Resumo: o botão dourado de onda (campo vazio) abre a conversa por voz. Por padrão
ela usa o reconhecimento e a síntese do próprio navegador (sem servidor novo, o
KAZER recebe só texto). Com `KAZER_VOICE_GATEWAY_URL` + `KAZER_VOICE_TOKEN_SECRET`,
passa a usar o voice gateway auto-hospedado (faster-whisper + Silero/energia +
Kokoro). Em qualquer caso a resposta vem do `/api/chat` de sempre.
