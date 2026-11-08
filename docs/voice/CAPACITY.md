# Capacidade do modo voz

"Milhões de contas" não é "milhões de vozes ao mesmo tempo". O que custa é
**sessão de voz ativa simultânea** e, acima de tudo, **o cérebro** (Groq).

## 1. O que foi medido (e onde)

Ambiente: contêiner de desenvolvimento, 4 vCPU, **sem GPU**, gateway com
**motores falsos** (STT devolve texto fixo, TTS devolve 0,4 s de silêncio) e
cliente no mesmo host. Ou seja: mede **transporte + orquestração** (handshake,
token, VAD por energia, filas, cancelamento), **não** o custo de
faster-whisper/Kokoro. Comando: `scripts/voice_load.py`, áudio em tempo real
(20 ms por quadro), 2 falas por sessão, com interrupção.

| Sessões simultâneas | Sucesso | Fim da fala → transcrição (p50 / p95) | Pedido de fala → 1º áudio (p50 / p95) | Cancelamento (p50 / p95) |
|---|---|---|---|---|
| 10 | 10/10 | 5 / 14 ms | 4 / 5 ms | 1 / 2 ms |
| 50 | 50/50 | 0 / 0 ms* | 15 / 19 ms | 1 / 2 ms |
| 150 | 150/150 | 0 / 73 ms* | 37 / 59 ms | 1 / 3 ms |
| 260 com limite 200 | 200 aceitas, **60 recusadas com 4503** | — | — | — |

\* "0 ms": a transcrição chegou antes do envio do último quadro terminar (o
VAD fecha a fala no 35º quadro de silêncio).

O que esses testes provaram:
- Rajada acima da capacidade é **recusada com código claro**, sem derrubar as
  sessões aceitas. (O teste achou e corrigiu um bug: antes, numa rajada, todas
  passavam pela checagem antes de qualquer uma virar ativa.)
- Cliente mandando áudio mais rápido que o tempo real é cortado (4429
  `frame_rate`).
- Um processo Python aguentou 150 sessões de transporte com p95 < 75 ms.

**Não medido** (precisa do hardware real com os modelos): latência de
faster-whisper e Kokoro, uso de CPU/GPU/RAM por sessão, custo por minuto.

## 2. Orçamento proposto (validar com teste no hardware real)

| Métrica | Alvo proposto |
|---|---|
| Fim da fala → transcrição (p95) | ≤ 800 ms |
| Transcrição → 1ª palavra do KAZER (p95) | ≤ 1,5 s (inclui o modelo de linguagem) |
| Interrupção → silêncio | ≤ 150 ms |
| Erros de sessão | < 1% |

## 3. Como estimar por sessão (fazer no hardware escolhido)

1. Subir o gateway real (`requirements-voice.txt`), `KAZER_VOICE_STT_MODEL=small`.
2. Rodar `scripts/voice_load.py` com 1, 5, 10, 20 sessões e ler `/metrics`
   (`kazer_voice_stt_ms_total / utterances`, `tts_first_audio_ms_total / tts_requests`).
3. Anotar CPU/GPU/RAM no pico → sessões por máquina com p95 dentro do alvo.
4. Custo por minuto = preço da máquina por hora ÷ (sessões por máquina × 60).

Banda (medida pelo formato, não estimada): entrada PCM16 16 kHz = 32 kB/s por
sessão falando; saída PCM16 24 kHz = 48 kB/s enquanto o KAZER fala. Opus
reduziria ~10×, se a banda pesar.

## 4. O que muda em cada degrau

| Sessões simultâneas | Mudanças |
|---|---|
| **até ~100** | 1 VM do gateway (GPU pequena ou CPU forte com `small` int8), nonces/limites em memória, Prometheus lendo `/metrics`. Motor browser continua como reserva. |
| **~1.000** | Várias instâncias atrás de balanceador com WebSocket "sticky" por conexão; **Valkey** para nonces (`SET NX EX`) e limites por conta; pools separados de STT e TTS (perfis diferentes); autoscaling por sessões ativas e p95; `KAZER_VOICE_MAX_SESSIONS` como freio por instância. |
| **~10.000** | Workers de inferência separados do gateway (Triton ou serviços BentoML) com batching de STT; fila curta e limitada entre gateway e workers (NATS) com recusa explícita quando cheia; Opus no transporte; regiões perto dos usuários; WebRTC (LiveKit) se a rede móvel pedir. |
| **além** | Capacidade negociada do cérebro (abaixo), escalonamento por região, testes de carga contínuos, orçamento por minuto por plano. |

## 5. O limite que nenhum código remove: o cérebro

O KAZ 1.1 roda na Groq. O próprio repositório documenta (docs/ESCALA.md) que o
plano grátis aguenta "centenas a poucos milhares de pessoas por dia" e que
**milhões de pessoas não cabem no plano grátis**. Criar várias contas para somar
limites viola os termos e não deve ser feito. Voz não muda isso: cada fala é uma
chamada ao `/api/chat` e passa pelo mesmo governador de limites e pelas mesmas
cotas por plano. Para crescer: capacidade paga na Groq (ou outro provedor via a
abstração `ModelProvider`), sem mudar o cliente.

Quando a cota acaba, o chat responde com os erros que já existem
(`usage_limit`, "muita demanda") e a voz fala/mostra isso; o gateway lotado
recusa com 4503 e o cliente usa o motor do navegador. O chat por texto não
depende do gateway.
