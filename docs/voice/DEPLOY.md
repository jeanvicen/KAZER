# Deploy do modo voz

Nada foi colocado em produção por esta mudança: nenhuma variável de produção
foi alterada e nenhuma migração rodou. Sem as variáveis abaixo, o KAZER usa só o
motor do navegador (funciona do jeito que está hoje).

## 1. Variáveis (só nomes)

**No KAZER (Vercel):**
- `KAZER_VOICE_GATEWAY_URL` — `wss://…/v1/voice` (sem segredo). `ws://` é
  ignorado em produção.
- `KAZER_VOICE_TOKEN_SECRET` — **segredo**, 32+ caracteres aleatórios, igual nos
  dois lados.

**No gateway:**
- `KAZER_VOICE_TOKEN_SECRET` (o mesmo)
- `KAZER_VOICE_ALLOWED_ORIGINS` — ex.: a origem pública do KAZER
- `KAZER_VOICE_MAX_SESSIONS`, `KAZER_VOICE_MAX_SESSIONS_PER_USER`,
  `KAZER_VOICE_MAX_SESSION_SECONDS`
- `KAZER_VOICE_STT_MODEL` (padrão `small`), `KAZER_VOICE_TTS_VOICE` (padrão `pf_dora`)
- `PORT` / `KAZER_VOICE_PORT`, `KAZER_VOICE_HOST`, `KAZER_LOG_LEVEL`

### Voz do KAZER (padrão, sem chave): Piper open source

Por padrão o próprio servidor do KAZER fala com o **Piper** (piper-tts, código
GPL-3.0), voz masculina pt-BR **`pt_BR-cadu-medium`** (`KAZER_PIPER_VOICE` troca
para `pt_BR-faber-medium`). Na primeira fala, o servidor baixa a voz (~63 MB) de
`huggingface.co/rhasspy/piper-voices` (revisão fixa v1.0.0) para `/tmp` e reaproveita
enquanto a instância estiver viva. `KAZER_PIPER_BASE_URL` aponta para um espelho
próprio; `KAZER_PIPER_DIR` muda a pasta. Medido aqui (CPU): 5,9 s de fala gerados
em 0,26 s; primeira fala 1,7 s (carrega o modelo). A voz do aparelho (Google etc.)
não é usada na conversa por voz.

Pendente: conferir a licença do conjunto de dados da voz "cadu" no model card do
Hugging Face (rede bloqueada nesta sessão) antes de uso comercial.

### Vozes pagas (opcional, só com escolha explícita)

`KAZER_TTS_PROVIDER=elevenlabs` ou `openai`, com a chave correspondente na Vercel
(segredo, só no servidor). `KAZER_TTS_PROVIDER=none` desliga a voz no servidor.
- `ELEVENLABS_API_KEY` — a voz mais natural em português (modelo
  `eleven_flash_v2_5`); `KAZER_TTS_VOICE` escolhe o voice_id.
- `OPENAI_API_KEY` — `gpt-4o-mini-tts`, a família de voz do ChatGPT, instruída a
  falar em português do Brasil; `KAZER_TTS_VOICE` escolhe a voz (padrão `coral`).

`KAZER_TTS_PROVIDER` (`elevenlabs` ou `openai`) força um dos dois. Com a chave, a
conversa por voz passa a usar `/api/voice/tts` (frase a frase, sem guardar nada)
e a esfera segue o volume real da voz. São serviços pagos por uso: confira o
preço no painel do provedor. Sem chave, fica a voz do aparelho.

## 2. Local

```bash
pip install -r requirements.txt -r requirements-voice.txt   # gateway real
sudo apt-get install -y espeak-ng                          # fonemas do Kokoro
export KAZER_VOICE_TOKEN_SECRET="$(python -c 'import secrets;print(secrets.token_urlsafe(48))')"
export KAZER_VOICE_ALLOWED_ORIGINS=http://localhost:8000
python -m kazer.voice.gateway                               # porta 8081
KAZER_VOICE_GATEWAY_URL=ws://localhost:8081/v1/voice python -m kazer.interfaces.web
```

Testes (não baixam modelo nenhum):
```bash
pytest tests/test_voice.py
KAZER_VOICE_TOKEN_SECRET=… python scripts/voice_load.py --sessions 20 --interrupt
```

## 3. Modelos (baixar no deploy, nunca na instalação/CI)

| Modelo | Fonte | Licença (conferida) | Observação |
|---|---|---|---|
| Whisper `small` convertido p/ CTranslate2 | `Systran/faster-whisper-small` no Hugging Face (baixado pelo faster-whisper no 1º uso) | código e pesos Whisper: MIT | `large-v3-turbo` em GPU para mais qualidade |
| Kokoro-82M, voz `pf_dora` (ou `pm_alex`) | `hexgrad/Kokoro-82M` no Hugging Face (baixado pelo `kokoro` no 1º uso) | pesos Apache-2.0; `lang_code='p'` = pt-BR | precisa de `espeak-ng` (GPL-3.0, programa externo) |

**Pendente de conferência:** tamanho e checksum dos arquivos. O Hugging Face
estava bloqueado na rede desta sessão. No deploy: baixar uma vez numa imagem
base, registrar `sha256sum` de cada arquivo em `docs/voice/MODELS.sha256`,
fixar a revisão (commit do repositório do modelo) e servir do disco
(`HF_HUB_OFFLINE=1`).

## 4. Hospedagem (custos e limites a confirmar no provedor)

| Opção | Bom para | Cuidados |
|---|---|---|
| **Protótipo barato:** 1 VM CPU (4–8 vCPU) com `small` int8 + Kokoro | testes com poucas pessoas | latência maior; medir antes de abrir |
| **Produção:** VM com GPU (ex.: L4/T4) sempre ligada, atrás de TLS | voz natural e rápida | custo por hora fixo; autoscaling por sessões |
| Serviço grátis que "dorme" | só demonstração | acordar leva segundos: **não serve** para voz em tempo real |
| Vercel | — | **não** hospeda o gateway (funções curtas, sem WebSocket longo) |

Requisitos de rede: TLS (wss), WebSocket com tempo de inatividade ≥ 90 s no
balanceador, `ws_max_size` ≥ 16 kB.

## 5. Rollout em etapas

1. **Agora (este branch):** botão de voz + motor do navegador, para todos. Sem
   servidor novo.
2. **Gateway em staging:** subir a VM, `KAZER_VOICE_GATEWAY_URL` só no
   ambiente de preview da Vercel, rodar `scripts/voice_load.py` no hardware real
   e preencher CAPACITY.md com números medidos.
3. **Produção limitada:** ligar as variáveis em produção com
   `KAZER_VOICE_MAX_SESSIONS` baixo; acompanhar `/metrics`
   (`rejected_total`, tempos médios) e o custo por minuto.
4. **Escalar** conforme CAPACITY.md. Desligar = apagar `KAZER_VOICE_GATEWAY_URL`
   (todo mundo volta ao motor do navegador na hora).
