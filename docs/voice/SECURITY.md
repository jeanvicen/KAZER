# Segurança e privacidade do modo voz

## Ameaças e defesas

| Ameaça | Defesa | Testado em `tests/test_voice.py` |
|---|---|---|
| Usar a voz sem conta | `/api/voice/*` exige sessão | `test_voice_routes_require_login` |
| CSRF para gerar token | `check_origin` (Origin + Sec-Fetch-Site) | `test_voice_session_checks_origin_and_input` |
| Token forjado/adulterado | HMAC-SHA256, `compare_digest`, versão, segredo ≥ 32 | `test_token_tampering_and_wrong_secret_are_rejected`, `test_short_secret_is_refused`, `test_gateway_rejects_bad_handshakes` |
| Token vencido | `exp` = 60 s | `test_token_round_trip_and_expiry`, handshake |
| Replay de token | `jti` de uso único | `test_nonce_store_blocks_replay`, `test_gateway_blocks_token_replay` |
| Site estranho abrindo o WebSocket | allowlist de Origin no gateway | `test_gateway_rejects_foreign_origin` |
| Quadro gigante / malformado | ≤ 8192 B, tamanho par, JSON validado, ≤ 16 kB texto | `test_gateway_rejects_oversized_frame`, `…transcribes…` (malformed/unknown) |
| Formato de áudio inesperado | só PCM16 mono 16 kHz | handshake (`unsupported_audio`) |
| Esgotar CPU/GPU | sessões por conta (2), total por instância, 100 quadros/s, 600 s por sessão, 60 s ociosa, semáforos de STT/TTS, fila de fala ≤ 64 | `test_gateway_limits_sessions_per_user`, `test_capacity_counts_handshakes_in_progress`, carga em CAPACITY.md |
| Abuso de tokens | 20 tokens/10 min por conta | `test_voice_session_rate_limit` |
| Vazar segredo ao cliente | segredo só no servidor (`secrets` scope `voice`); respostas conferidas | `test_voice_session_issues_short_single_use_token` |
| Ampliar CSP demais | `connect-src` ganha **só** a origem do gateway; `ws://` ignorado em produção | `test_csp_allows_only_the_gateway_origin`, `test_insecure_gateway_url_is_ignored_in_production` |
| Câmera | segue bloqueada (`camera=()`) | `test_csp_allows_only_the_gateway_origin` |

## Privacidade

- Microfone só depois de toque explícito no botão; selo visível "Microfone
  ativo / em pausa" na tela de voz; fechar a tela para todas as trilhas
  (`track.stop()`) e encerra o reconhecimento.
- Nada roda em segundo plano: ao fechar a tela, o loop de nível para e o
  WebSocket é fechado.
- **Áudio não é guardado.** No gateway, o áudio de uma fala fica num buffer em
  memória até a transcrição e é descartado; nada vai para disco, banco ou log.
- **Motor browser:** em navegadores como o Chrome, o áudio é transcrito pelo
  serviço do fabricante do navegador (aviso já mostrado no ditado). O KAZER só
  recebe texto.
- Transcrições viram mensagens comuns: mesma exclusão de conversa, limpeza e
  exportação de conta (`/api/account/export`, `/api/account/delete`).
- Logs: só eventos e contadores (`voice.session_issued`, `voice.stt_failed`),
  nunca token, áudio ou texto falado.
- Sem identificação de quem fala (nada de biometria/diarização).

## Riscos restantes

1. **Nonce e limites por instância:** com mais de uma instância do gateway, use
   Valkey (`SET jti NX EX 60`) — antes disso, um token poderia ser usado uma vez
   em cada instância dentro dos 60 s.
2. **Eco no motor gateway:** depende do cancelamento de eco do navegador/SO para
   áudio tocado por WebAudio. Funciona no Chrome desktop/Android na maioria dos
   aparelhos; com alto-falante alto pode gerar falsa interrupção. Mitigação
   futura: RNNoise/SpeexDSP no gateway ou pausar a VAD durante a fala.
3. **Licenças:** Kokoro (pesos Apache-2.0) e Whisper (MIT) conferidos nos
   READMEs oficiais; o `espeak-ng` usado pelo Kokoro é GPL-3.0 (programa
   externo) — revisar com jurídico antes de distribuir imagem do gateway.
4. **App nativo:** precisa de autenticação por `Authorization: Bearer` no KAZER
   antes de usar `/api/voice/session` (hoje a web usa cookie).
5. HawkScan (DAST) não rodou: falta `HAWK_API_KEY` neste ambiente.
