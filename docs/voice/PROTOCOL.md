# Protocolo do modo voz (`kazer-voice/1`)

Pensado para a web e para um app nativo: nada depende de DOM, cookie de
navegador ou evento de página. Versão no nome; mudanças incompatíveis viram `/2`.

## 1. HTTP no KAZER

### `GET /api/voice/config`
Exige sessão. Resposta:
```json
{ "protocol": "kazer-voice/1", "engines": ["gateway", "browser"], "gateway": { "url": "wss://voz.exemplo.com/v1/voice" } }
```
Sem gateway configurado: `"engines": ["browser"], "gateway": null`.

### `POST /api/voice/session`
Exige sessão e mesma origem (web). Corpo: `{"conversation_id": "<id>" | null}`.
```json
{ "protocol": "kazer-voice/1", "url": "wss://…/v1/voice", "token": "<b64url>.<b64url>",
  "expires_at": 1794170000, "audio": { "encoding": "pcm_s16le", "sample_rate": 16000, "channels": 1 } }
```
Erros: `401 unauthenticated`, `403 forbidden_origin`, `400 invalid_request`,
`429 rate_limited` (20 por 10 min por conta, com `Retry-After`),
`503 voice_unavailable` (sem gateway/segredo).

**Token:** `base64url(JSON) "." base64url(HMAC-SHA256(segredo, parte1))`, JSON
`{"v":1,"sub":<user_id>,"cid":<conversa|null>,"iat","exp":iat+60,"jti":<aleatório>,"max":600}`.
Uso único (o gateway guarda o `jti` até `exp`). Nunca vai na URL (fica no
primeiro quadro do WebSocket, fora de logs de proxy).

**App nativo:** usa o login próprio (token do Supabase Auth em `Authorization:
Bearer`, a adicionar no KAZER quando o app existir — o endpoint é o mesmo) e
pede um token de voz por conversa. Cookie de navegador **não** é estratégia
de app. Revogar sessões em `/api/account/sessions/revoke` impede novos tokens;
tokens já emitidos morrem em ≤ 60 s.

## 2. WebSocket no gateway: `wss://<host>/v1/voice`

### Handshake
1. Cliente conecta (navegador manda `Origin`; o gateway confere com
   `KAZER_VOICE_ALLOWED_ORIGINS`; app nativo não manda Origin).
2. Primeira mensagem (texto, em até 5 s):
```json
{ "type": "hello", "protocol": "kazer-voice/1", "token": "…",
  "audio": { "encoding": "pcm_s16le", "sample_rate": 16000, "channels": 1 } }
```
3. Servidor: `{"type":"ready","protocol":"kazer-voice/1","in_rate":16000,"max_seconds":600}`.

### Cliente → servidor
| Mensagem | Significado |
|---|---|
| binário | PCM16 LE mono 16 kHz, recomendado 20 ms (640 B); máx. 8192 B e tamanho par; máx. 100 quadros/s |
| `{"type":"speak","id":"r1","text":"…","queue":false}` | fala um texto (limpo de novo no servidor). `queue:true` com o mesmo `id` enfileira frases da mesma resposta |
| `{"type":"cancel"}` | para a fala na hora e esvazia a fila |
| `{"type":"end_utterance"}` | fecha a fala agora (botão), sem esperar o silêncio |
| `{"type":"ping"}` | responde `pong` |

### Servidor → cliente
| Mensagem | Significado |
|---|---|
| `{"type":"vad","speaking":true|false}` | início/fim de fala detectados |
| `{"type":"transcript","final":true,"text":"…","stt_ms":120}` | texto final de uma fala (`"empty":true` se nada) |
| `{"type":"audio_start","id":"r1","sample_rate":24000}` | começa a fala; seguem quadros binários PCM16 |
| binário | áudio PCM16 LE mono na taxa anunciada |
| `{"type":"audio_end","id":"r1"}` | fim da fala |
| `{"type":"barge_in"}` / `{"type":"audio_cancelled","id","reason"}` | fala interrompida (por voz ou cancel) |
| `{"type":"error","code":"…"}` | `malformed`, `unknown_type`, `invalid_speak`, `speak_queue_full`, `stt_failed`, `tts_failed`, … |

### Fechamentos
`4400` pedido inválido (quadro, áudio, protocolo), `4401` sem/mau token
(`hello_required`, `invalid_token`, `expired_token`, `token_reused`,
`hello_timeout`), `4403` origem, `4408` tempo (ociosa 60 s ou sessão 600 s),
`4429` limites (`too_many_sessions`, `frame_rate`), `4503` sobrecarga ou
gateway sem segredo.

## 3. Reconexão, cancelamento e idempotência

- **Reconectar:** novo `POST /api/voice/session` (token novo) e novo WebSocket.
  Não há estado de áudio a recuperar; o que importa (mensagens) está no chat.
- **Mensagens:** o envio usa o `client_id` do chat; reenviar o mesmo texto após
  queda não duplica a mensagem. A resposta em andamento é reatada pelo
  `/api/messages/{id}/stream` como no chat por texto.
- **Cancelar:** `cancel` no gateway + `POST /api/messages/{id}/stop` no KAZER.
- **Fala nova durante resposta:** o cliente chama `/stop`, espera a resposta
  encerrar (até 5 s) e envia a fala nova; se não conseguir, avisa (não descarta
  calado).
