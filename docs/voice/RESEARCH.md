# Pesquisa: 100 repositórios open source para o modo voz do KAZER

Gerado em 2026-11-08. **Dados verificados** (colunas Licença, Último push, Arquivado e Descrição) vieram da API pública do GitHub (`search/repositories`) nesta data. **Julgamento** (pt-BR, streaming, runtime, complexidade, nota) é avaliação de engenharia a partir da documentação oficial e do conhecimento do ecossistema — não é benchmark medido.

Licença `NOASSERTION` = o GitHub não reconheceu a licença automaticamente (licença própria, dupla ou arquivo fora do padrão): precisa de revisão humana antes de qualquer uso comercial. Nada aqui é parecer jurídico.

## Como a lista foi montada

- 139 candidatos levantados; 121 confirmados na API. 18 não existiam com aquele nome (renomeados ou inexistentes) e foram descartados sem preencher dados: `NVIDIA/NeMo` (renomeado), `idiap/coqui-ai-TTS`, `FunAudioLLM/CosyVoice`, `argmaxinc/WhisperKit`, `sesame-ai/csm`, `websockets/websockets`, `encode/uvicorn`, entre outros.
- Dos 121, 21 menos relevantes para voz no KAZER saíram (datasets, arquivados redundantes, frameworks genéricos de LLM, observabilidade genérica): restaram **exatamente 100**.
- Licença dos **pesos** dos modelos escolhidos foi conferida à parte, nos READMEs oficiais (seção "Licença dos pesos").
- O Hugging Face está fora da rede liberada nesta sessão: tamanhos e checksums dos pesos ficam para conferir no deploy (veja DEPLOY.md).


## A. STT / ASR (22)

| # | Repositório | Licença (verif.) | Último push (verif.) | Arquivado | Descrição (verif.) | pt-BR (julg.) | Tempo real (julg.) | Runtime (julg.) | Integração (julg.) | Nota |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | [openai/whisper](https://github.com/openai/whisper) | MIT | 2026-08-31 | não | Robust Speech Recognition via Large-Scale Weak Supervision | sim (multilíngue) | lote | GPU recomendada; CPU lenta | média | Referência de qualidade; lento para tempo real puro. |
| 2 | [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) | MIT | 2026-11-06 | não | Faster Whisper transcription with CTranslate2 | sim | lote/incremental com VAD | CPU int8 ou GPU (CTranslate2) | baixa | ESCOLHIDO p/ STT no gateway: 4x mais rápido que whisper, MIT, pesos Whisper MIT. |
| 3 | [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) | MIT | 2026-11-08 | não | Port of OpenAI's Whisper model in C/C++ | sim | incremental (exemplo stream) | CPU/Metal/CUDA; roda em Android | média | Melhor opção on-device no app Android futuro. |
| 4 | [m-bain/whisperX](https://github.com/m-bain/whisperX) | BSD-2-Clause | 2026-10-22 | não | WhisperX:  Automatic Speech Recognition with Word-level Timestamps (& Diarization) | sim | lote | GPU | média | Alinhamento por palavra; útil p/ legendas, não p/ conversa. |
| 5 | [alphacep/vosk-api](https://github.com/alphacep/vosk-api) | Apache-2.0 | 2026-10-15 | não | Offline speech recognition API for Android, iOS, Raspberry Pi and servers with Python, Java, C# and Node | sim (modelo pt) | streaming real | CPU leve; Android/iOS | baixa | Leve e streaming, mas qualidade pt inferior ao Whisper. |
| 6 | [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | Apache-2.0 | 2026-11-07 | não | Speech-to-text, text-to-speech, speaker diarization, speech enhancement, source separation, and VAD using next-gen Kaldi with onnxruntime wi | parcial (depende do modelo) | streaming | CPU/ONNX; Android/iOS/Web | média | ALTERNATIVA forte: STT+TTS+VAD num só runtime, ótimo p/ Android. |
| 7 | [kaldi-asr/kaldi](https://github.com/kaldi-asr/kaldi) | NOASSERTION | 2025-09-22 | não | kaldi-asr/kaldi is the official location of the Kaldi project. | com modelos de terceiros | streaming (online2) | CPU; build complexo | alta | Legado; licença Apache no arquivo, API marca NOASSERTION. |
| 8 | [huggingface/transformers](https://github.com/huggingface/transformers) | Apache-2.0 | 2026-11-08 | não | 🤗 Transformers: the model-definition framework for state-of-the-art machine learning models in text, vision, audio, and multimodal models, f | sim (via modelos) | lote | CPU/GPU | média | Base genérica; pesado p/ servir voz de baixa latência. |
| 9 | [collabora/WhisperLive](https://github.com/collabora/WhisperLive) | MIT | 2026-11-02 | não | A nearly-live implementation of OpenAI's Whisper. | sim | quase tempo real (WebSocket) | GPU recomendada | média | Bom exemplo de servidor WebSocket de STT. |
| 10 | [ufal/whisper_streaming](https://github.com/ufal/whisper_streaming) | MIT | 2025-11-12 | não | Whisper realtime streaming for long speech-to-text transcription and translation | sim | streaming (política local agreement) | GPU | média | Pesquisa sólida; atualização menos frequente. |
| 11 | [KoljaB/RealtimeSTT](https://github.com/KoljaB/RealtimeSTT) | MIT | 2026-10-30 | não | A robust, efficient, low-latency speech-to-text library with advanced voice activity detection, wake word activation and instant transcripti | sim | streaming com VAD | GPU recomendada | média | Lib de cliente/servidor pronta; acopla escolhas próprias. |
| 12 | [speechbrain/speechbrain](https://github.com/speechbrain/speechbrain) | Apache-2.0 | 2026-10-14 | não | A PyTorch-based Speech Toolkit | parcial | lote | PyTorch | alta | Toolkit de pesquisa; não é servidor pronto. |
| 13 | [wenet-e2e/wenet](https://github.com/wenet-e2e/wenet) | Apache-2.0 | 2026-10-26 | não | Production First and Production Ready End-to-End Speech Recognition Toolkit | precisa treinar/modelo | streaming | CPU/GPU | alta | Produção na China; pouco pt-BR pronto. |
| 14 | [modelscope/FunASR](https://github.com/modelscope/FunASR) | MIT | 2026-11-08 | não | Open-source speech recognition toolkit for training, inference, streaming ASR, VAD, punctuation, speaker diarization pipelines, and OpenAI-c | foco zh/en | streaming | CPU/GPU | alta | Paraformer forte em chinês; pt fraco. |
| 15 | [k2-fsa/sherpa](https://github.com/k2-fsa/sherpa) | Apache-2.0 | 2026-11-08 | não | Speech-to-text server framework with next-gen Kaldi | depende do modelo | streaming | GPU/CPU | alta | Servidor do next-gen Kaldi; sherpa-onnx é mais prático. |
| 16 | [espnet/espnet](https://github.com/espnet/espnet) | Apache-2.0 | 2026-11-08 | não | End-to-End Speech Processing Toolkit | parcial | lote/streaming | PyTorch | alta | Toolkit de pesquisa amplo. |
| 17 | [TEN-framework/ten-vad](https://github.com/TEN-framework/ten-vad) | NOASSERTION | 2026-11-04 | não | Voice Activity Detector (VAD) : low-latency, high-performance and lightweight | independe de idioma | streaming | CPU leve | baixa | VAD leve; licença própria (NOASSERTION) — revisar antes de usar. |
| 18 | [moonshine-ai/moonshine](https://github.com/moonshine-ai/moonshine) | NOASSERTION | 2026-11-08 | não | Very low latency speech to text, intent recognition, and text to speech, for building voice agents and interfaces | foco en (verificar) | baixa latência | CPU/edge | média | Muito rápido no edge; licença marcada NOASSERTION, revisar. |
| 19 | [huggingface/distil-whisper](https://github.com/huggingface/distil-whisper) | MIT | 2025-01-08 | não | Distilled variant of Whisper for speech recognition. 6x faster, 50% smaller, within 1% word error rate. | en (versões principais) | lote | CPU/GPU | baixa | Destilado é sobretudo inglês — não serve p/ pt-BR. |
| 20 | [Vaibhavs10/insanely-fast-whisper](https://github.com/Vaibhavs10/insanely-fast-whisper) | Apache-2.0 | 2025-10-25 | não |  | sim | lote | GPU | baixa | CLI de lote em GPU; não conversacional. |
| 21 | [speaches-ai/speaches](https://github.com/speaches-ai/speaches) | MIT | 2026-11-07 | não |  | sim (faster-whisper/kokoro) | streaming/HTTP | CPU/GPU, Docker | baixa | ALTERNATIVA: servidor compatível com OpenAI juntando faster-whisper+Kokoro. |
| 22 | [kyutai-labs/delayed-streams-modeling](https://github.com/kyutai-labs/delayed-streams-modeling) | Apache-2.0 | 2026-01-26 | não | Kyutai's Speech-To-Text and Text-To-Speech models based on the Delayed Streams Modeling framework. | en/fr (verificar) | streaming real | GPU | alta | STT/TTS de streaming de ponta; sem pt-BR documentado. |

## B. TTS (24)

| # | Repositório | Licença (verif.) | Último push (verif.) | Arquivado | Descrição (verif.) | pt-BR (julg.) | Tempo real (julg.) | Runtime (julg.) | Integração (julg.) | Nota |
|---|---|---|---|---|---|---|---|---|---|---|
| 23 | [rhasspy/piper](https://github.com/rhasspy/piper) | MIT | 2025-08-26 | sim | A fast, local neural text to speech system | sim (vozes pt_BR) | rápido, por frase | CPU | baixa | ARQUIVADO — sucessor é OHF-Voice/piper1-gpl. |
| 24 | [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) | GPL-3.0 | 2026-11-07 | não | Fast and local neural text-to-speech engine | sim (vozes pt_BR) | por frase, muito rápido | CPU, roda em Raspberry | baixa | ALTERNATIVA TTS leve; código GPL-3.0 e cada voz tem licença própria — revisar. |
| 25 | [hexgrad/kokoro](https://github.com/hexgrad/kokoro) | Apache-2.0 | 2025-08-06 | não | https://hf.co/hexgrad/Kokoro-82M | sim ('p' pt-br) | por frase | CPU viável, GPU melhor; 82M params | baixa | ESCOLHIDO p/ TTS: pesos Apache-2.0, voz natural, leve. |
| 26 | [remsky/Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) | Apache-2.0 | 2026-11-08 | não | Dockerized OpenAI-compatible wrapper for Kokoro-82M text-to-speech w/multiplatform CPU, AMD, NVIDIA GPU PyTorch; multi-speaker, clone-tuning | sim | streaming HTTP | CPU/GPU Docker | baixa | Servidor pronto do Kokoro; útil p/ protótipo. |
| 27 | [thewh1teagle/kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) | MIT | 2026-09-01 | não | TTS with kokoro and onnx runtime | sim | por frase | ONNX CPU | baixa | Kokoro sem PyTorch: imagem menor no gateway. |
| 28 | [coqui-ai/TTS](https://github.com/coqui-ai/TTS) | MPL-2.0 | 2024-08-16 | não | 🐸💬 - a deep learning toolkit for Text-to-Speech, battle-tested in research and production | sim (XTTS) | streaming XTTS | GPU | média | Sem manutenção desde 2024; pesos XTTS com licença não comercial (CPML). |
| 29 | [myshell-ai/OpenVoice](https://github.com/myshell-ai/OpenVoice) | MIT | 2025-04-19 | não | Instant voice cloning by MIT and MyShell. Audio foundation model. | multilíngue | lote | GPU | média | Clonagem de voz — fora do escopo (risco de imitar vozes). |
| 30 | [myshell-ai/MeloTTS](https://github.com/myshell-ai/MeloTTS) | MIT | 2024-12-24 | não | High-quality multi-lingual text-to-speech library by MyShell.ai. Support English, Spanish, French, Chinese, Japanese and Korean. | sem pt documentado | por frase | CPU ok | baixa | Leve, MIT; idiomas não incluem pt-BR. |
| 31 | [yl4579/StyleTTS2](https://github.com/yl4579/StyleTTS2) | MIT | 2024-08-10 | não | StyleTTS 2: Towards Human-Level Text-to-Speech through Style Diffusion and Adversarial Training with Large Speech Language Models | en | lote | GPU | alta | Qualidade alta em inglês; base do Kokoro. |
| 32 | [huggingface/parler-tts](https://github.com/huggingface/parler-tts) | Apache-2.0 | 2024-12-10 | não | Inference and training library for high-quality TTS models. | en (principal) | streaming | GPU | média | Controle por descrição; sem pt-BR sólido. |
| 33 | [fishaudio/fish-speech](https://github.com/fishaudio/fish-speech) | NOASSERTION | 2026-11-02 | não | SOTA Open Source TTS | multilíngue | streaming | GPU | média | Muito bom, mas licença dos pesos é restritiva (revisar) — NOASSERTION. |
| 34 | [SWivid/F5-TTS](https://github.com/SWivid/F5-TTS) | MIT | 2026-11-03 | não | Official code for "F5-TTS: A Fairytaler that Fakes Fluent and Faithful Speech with Flow Matching" | modelos da comunidade | lote | GPU | média | Código MIT, pesos base CC-BY-NC (não comercial). |
| 35 | [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox) | MIT | 2026-11-04 | não | SoTA open-source TTS | multilíngue (verificar pt) | lote/stream | GPU | média | Natural, MIT; inclui marca d'água; mais pesado que Kokoro. |
| 36 | [suno-ai/bark](https://github.com/suno-ai/bark) | MIT | 2024-08-19 | não | 🔊 Text-Prompted Generative Audio Model | multilíngue | lote | GPU | média | Lento e pouco controlável p/ conversa. |
| 37 | [2noise/ChatTTS](https://github.com/2noise/ChatTTS) | AGPL-3.0 | 2026-04-10 | não | A generative speech model for daily dialogue. | zh/en | lote | GPU | média | AGPL + foco chinês. |
| 38 | [espeak-ng/espeak-ng](https://github.com/espeak-ng/espeak-ng) | GPL-3.0 | 2026-11-08 | não | eSpeak NG is an open source speech synthesizer that supports more than hundred languages and accents. | sim | imediato | CPU mínima | baixa | Robótico; útil como fonemizador (GPL-3.0). |
| 39 | [neonbjb/tortoise-tts](https://github.com/neonbjb/tortoise-tts) | Apache-2.0 | 2024-11-19 | não | A multi-voice TTS system trained with an emphasis on quality | en | muito lento | GPU | alta | Lento demais p/ tempo real. |
| 40 | [jasonppy/VoiceCraft](https://github.com/jasonppy/VoiceCraft) | NOASSERTION | 2026-05-30 | não | Zero-Shot Speech Editing and Text-to-Speech in the Wild | en | lote | GPU | alta | Edição/clonagem; licença dos pesos restritiva. |
| 41 | [RVC-Boss/GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) | MIT | 2026-10-31 | não | 1 min voice data can also be used to train a good TTS model! (few shot voice cloning) | zh/en/ja/ko | lote | GPU | alta | Focado em clonagem com poucos dados. |
| 42 | [Zyphra/Zonos](https://github.com/Zyphra/Zonos) | Apache-2.0 | 2025-03-05 | não | Zonos-v0.1 is a leading open-weight text-to-speech model trained on more than 200k hours of varied multilingual speech, delivering expressiv | multilíngue (verificar pt) | lote | GPU | média | Apache-2.0; exige GPU. |
| 43 | [canopyai/Orpheus-TTS](https://github.com/canopyai/Orpheus-TTS) | Apache-2.0 | 2025-12-05 | não | Towards Human-Sounding Speech | en (+ multilíngue beta) | streaming | GPU (LLM 3B) | alta | Muito natural, mas caro de servir. |
| 44 | [nari-labs/dia](https://github.com/nari-labs/dia) | Apache-2.0 | 2025-11-19 | não | A TTS model capable of generating ultra-realistic dialogue in one pass. | en | lote | GPU | média | Diálogos em inglês. |
| 45 | [KoljaB/RealtimeTTS](https://github.com/KoljaB/RealtimeTTS) | MIT | 2026-11-07 | não | Converts text to speech in realtime | depende do motor | streaming | variável | baixa | Orquestra motores TTS por frase; ideia reaproveitada. |
| 46 | [MycroftAI/mimic3](https://github.com/MycroftAI/mimic3) | AGPL-3.0 | 2025-03-25 | não | A fast local neural text to speech engine for Mycroft | sim | por frase | CPU | baixa | AGPL e projeto parado. |

## C. Voz conversacional / fala-a-fala (11)

| # | Repositório | Licença (verif.) | Último push (verif.) | Arquivado | Descrição (verif.) | pt-BR (julg.) | Tempo real (julg.) | Runtime (julg.) | Integração (julg.) | Nota |
|---|---|---|---|---|---|---|---|---|---|---|
| 47 | [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) | BSD-2-Clause | 2026-11-08 | não | Open Source framework for voice agents, multimodal apps, and realtime AI. Maintained by Daily and the community. | via provedores | tempo real | Python; WebRTC/WebSocket | média | ALTERNATIVA de orquestração; traz muita abstração. |
| 48 | [livekit/agents](https://github.com/livekit/agents) | Apache-2.0 | 2026-11-08 | não | A framework for building realtime voice AI agents 🤖🎙️📹  | via plugins | tempo real | precisa servidor LiveKit | alta | Excelente com WebRTC; exige infraestrutura LiveKit. |
| 49 | [kyutai-labs/moshi](https://github.com/kyutai-labs/moshi) | Apache-2.0 | 2026-09-09 | não | Moshi is a speech-text foundation model and full-duplex spoken dialogue framework. It uses Mimi, a state-of-the-art streaming neural audio c | en/fr | full-duplex | GPU forte | alta | Modelo próprio de fala — seria um 2º cérebro (proibido). |
| 50 | [fixie-ai/ultravox](https://github.com/fixie-ai/ultravox) | MIT | 2025-12-12 | não | A fast multimodal LLM for real-time voice | multilíngue | tempo real | GPU | alta | LLM de voz próprio — conflita com 'um cérebro só'. |
| 51 | [huggingface/speech-to-speech](https://github.com/huggingface/speech-to-speech) | Apache-2.0 | 2026-11-07 | não | Build voice agents with open-source models | depende dos modelos | pipeline | GPU | média | Referência VAD→STT→LLM→TTS modular. |
| 52 | [TEN-framework/ten-framework](https://github.com/TEN-framework/ten-framework) | NOASSERTION | 2026-11-08 | não |  Open-source framework for conversational voice AI agents | via extensões | tempo real | C++/Go/Python | alta | Framework grande; licença própria. |
| 53 | [vocodedev/vocode-core](https://github.com/vocodedev/vocode-core) | MIT | 2024-11-15 | não | 🤖 Build voice-based LLM agents. Modular + open source. | via provedores | tempo real | Python | média | Pouca atividade desde 2024. |
| 54 | [bolna-ai/bolna](https://github.com/bolna-ai/bolna) | MIT | 2026-11-06 | não | Conversational voice AI agents | via provedores | tempo real | Python | média | Focado em telefonia. |
| 55 | [KoljaB/RealtimeVoiceChat](https://github.com/KoljaB/RealtimeVoiceChat) | NONE | 2026-11-07 | não | Have a natural, spoken conversation with AI! | depende | tempo real | GPU | média | SEM licença declarada — não usar código. |
| 56 | [openai/openai-realtime-console](https://github.com/openai/openai-realtime-console) | MIT | 2025-08-28 | não | React app for inspecting, building and debugging with the Realtime API | n/a | tempo real | React | baixa | Só cliente de API paga. |
| 57 | [modal-labs/quillman](https://github.com/modal-labs/quillman) | MIT | 2026-10-30 | não | A voice chat app  | depende | tempo real | Modal (pago) | média | Exemplo preso a provedor pago. |

## D. VAD, fim de turno, diarização (6)

| # | Repositório | Licença (verif.) | Último push (verif.) | Arquivado | Descrição (verif.) | pt-BR (julg.) | Tempo real (julg.) | Runtime (julg.) | Integração (julg.) | Nota |
|---|---|---|---|---|---|---|---|---|---|---|
| 58 | [snakers4/silero-vad](https://github.com/snakers4/silero-vad) | MIT | 2026-10-22 | não | Silero VAD: pre-trained enterprise-grade Voice Activity Detector | independe de idioma | streaming (<1 ms/chunk) | CPU, ONNX | baixa | ESCOLHIDO p/ VAD no gateway (MIT). |
| 59 | [wiseman/py-webrtcvad](https://github.com/wiseman/py-webrtcvad) | NOASSERTION | 2024-07-04 | não | Python interface to the WebRTC Voice Activity Detector  | independe | streaming | CPU mínima | baixa | Fallback leve; menos preciso com ruído. |
| 60 | [pyannote/pyannote-audio](https://github.com/pyannote/pyannote-audio) | MIT | 2026-11-07 | não | Neural building blocks for speaker diarization: speech activity detection, speaker change detection, overlapped speech detection, speaker em | independe | lote | GPU | média | Diarização — não necessária (e evita biometria). |
| 61 | [pipecat-ai/smart-turn](https://github.com/pipecat-ai/smart-turn) | BSD-2-Clause | 2026-01-29 | não |  | multilíngue (verificar pt) | streaming | CPU/GPU | média | Detecção de fim de turno; candidato fase 2. |
| 62 | [NVIDIA/NeMo-text-processing](https://github.com/NVIDIA/NeMo-text-processing) | Apache-2.0 | 2026-11-05 | não | NeMo text processing for ASR and TTS | parcial | n/a | CPU | média | Normalização de números p/ TTS; pt limitado. |
| 63 | [FluidInference/FluidAudio](https://github.com/FluidInference/FluidAudio) | Apache-2.0 | 2026-11-08 | não | Frontier CoreML audio models in your apps — text-to-speech, speech-to-text, voice activity detection, and speaker diarization. In Swift, pow | depende | tempo real | Apple CoreML | média | Só Apple — não serve p/ Android. |

## E. Transporte, codecs, WebRTC/WebSocket (11)

| # | Repositório | Licença (verif.) | Último push (verif.) | Arquivado | Descrição (verif.) | pt-BR (julg.) | Tempo real (julg.) | Runtime (julg.) | Integração (julg.) | Nota |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 | [livekit/livekit](https://github.com/livekit/livekit) | Apache-2.0 | 2026-11-08 | não | End-to-end realtime stack for connecting humans and AI | n/a | WebRTC SFU | Go; servidor dedicado | alta | Transporte WebRTC de produção, p/ quando WebSocket não bastar. |
| 65 | [versatica/mediasoup](https://github.com/versatica/mediasoup) | ISC | 2026-11-06 | não | Cutting Edge WebRTC Video Conferencing | n/a | WebRTC SFU | Node/C++ | alta | SFU de baixo nível. |
| 66 | [meetecho/janus-gateway](https://github.com/meetecho/janus-gateway) | GPL-3.0 | 2026-11-07 | não | Janus WebRTC Server | n/a | WebRTC | C | alta | GPL-3.0. |
| 67 | [aiortc/aiortc](https://github.com/aiortc/aiortc) | BSD-3-Clause | 2026-11-07 | não | WebRTC and ORTC implementation for Python using asyncio | n/a | WebRTC em Python | Python asyncio | média | Opção WebRTC dentro do gateway Python (fase 2). |
| 68 | [pion/webrtc](https://github.com/pion/webrtc) | MIT | 2026-11-07 | não | Pure Go implementation of the WebRTC API | n/a | WebRTC em Go | Go | média | Se o gateway virar Go. |
| 69 | [FFmpeg/FFmpeg](https://github.com/FFmpeg/FFmpeg) | NOASSERTION | 2026-11-08 | não | Mirror of https://git.ffmpeg.org/ffmpeg.git | n/a | transcodificação | CPU | baixa | Decodificar Opus/WebM se o cliente não mandar PCM. |
| 70 | [GStreamer/gstreamer](https://github.com/GStreamer/gstreamer) | NOASSERTION | 2026-11-08 | não | GStreamer open-source multimedia framework | n/a | pipelines de mídia | CPU | alta | Poderoso, complexo. |
| 71 | [xiph/opus](https://github.com/xiph/opus) | NOASSERTION | 2026-11-06 | não | Modern audio compression for the internet. | n/a | codec | CPU | baixa | Codec padrão p/ reduzir banda na fase 2. |
| 72 | [coturn/coturn](https://github.com/coturn/coturn) | NOASSERTION | 2026-11-08 | não | coturn TURN server project | n/a | TURN | servidor | média | Necessário só com WebRTC atrás de NAT. |
| 73 | [Kludex/starlette](https://github.com/Kludex/starlette) | BSD-3-Clause | 2026-11-06 | não | The little ASGI framework that shines. 🌟 | n/a | WebSocket ASGI | Python | baixa | ESCOLHIDO: já é o framework do KAZER; WebSocket nativo. |
| 74 | [bluenviron/mediamtx](https://github.com/bluenviron/mediamtx) | MIT | 2026-11-08 | não | Ready-to-use Media-over-QUIC / SRT / WebRTC / RTSP / RTMP / LL-HLS / MPEG-TS / RTP live media server and media proxy that allows to read, pu | n/a | WebRTC/RTSP | Go | média | Servidor de mídia genérico. |

## F. Ruído e eco (6)

| # | Repositório | Licença (verif.) | Último push (verif.) | Arquivado | Descrição (verif.) | pt-BR (julg.) | Tempo real (julg.) | Runtime (julg.) | Integração (julg.) | Nota |
|---|---|---|---|---|---|---|---|---|---|---|
| 75 | [xiph/rnnoise](https://github.com/xiph/rnnoise) | BSD-3-Clause | 2025-02-22 | não | Recurrent neural network for audio noise reduction | n/a | tempo real | CPU mínima | baixa | Supressão de ruído leve (BSD) — candidato fase 2. |
| 76 | [Rikorose/DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) | NOASSERTION | 2026-11-06 | não | Noise supression using deep filtering | n/a | tempo real | CPU | média | Melhor qualidade; licença dupla (verificar). |
| 77 | [resemble-ai/resemble-enhance](https://github.com/resemble-ai/resemble-enhance) | MIT | 2024-12-03 | não | AI powered speech denoising and enhancement | n/a | lote | GPU | média | Melhoria offline, não tempo real. |
| 78 | [werman/noise-suppression-for-voice](https://github.com/werman/noise-suppression-for-voice) | GPL-3.0 | 2026-10-25 | não | Noise suppression plugin based on Xiph's RNNoise | n/a | tempo real | plugin | baixa | Plugin desktop (GPL). |
| 79 | [facebookresearch/denoiser](https://github.com/facebookresearch/denoiser) | NOASSERTION | 2023-03-14 | sim | Real Time Speech Enhancement in the Waveform Domain (Interspeech 2020)We provide a PyTorch implementation of the paper Real Time Speech Enha | n/a | tempo real | PyTorch | média | Arquivado. |
| 80 | [xiph/speexdsp](https://github.com/xiph/speexdsp) | NOASSERTION | 2026-10-08 | não | Speex audio processing library - THIS IS A MIRROR, DEVELOPMENT HAPPENS AT https://gitlab.xiph.org/xiph/speexdsp | n/a | tempo real | CPU | média | Cancelamento de eco (AEC) clássico; o navegador já faz AEC. |

## G. Serving e inferência (9)

| # | Repositório | Licença (verif.) | Último push (verif.) | Arquivado | Descrição (verif.) | pt-BR (julg.) | Tempo real (julg.) | Runtime (julg.) | Integração (julg.) | Nota |
|---|---|---|---|---|---|---|---|---|---|---|
| 81 | [vllm-project/vllm](https://github.com/vllm-project/vllm) | Apache-2.0 | 2026-11-08 | não | A high-throughput and memory-efficient inference and serving engine for LLMs | n/a | serving LLM | GPU | alta | Para quando o cérebro for auto-hospedado (não agora). |
| 82 | [sgl-project/sglang](https://github.com/sgl-project/sglang) | Apache-2.0 | 2026-11-08 | não | SGLang is a high-performance serving framework for large language models and multimodal models. | n/a | serving LLM | GPU | alta | Alternativa ao vLLM. |
| 83 | [triton-inference-server/server](https://github.com/triton-inference-server/server) | BSD-3-Clause | 2026-11-05 | não | The Triton Inference Server provides an optimized cloud and edge inferencing solution.  | n/a | serving | GPU | alta | Batching de STT/TTS em escala grande. |
| 84 | [ray-project/ray](https://github.com/ray-project/ray) | Apache-2.0 | 2026-11-08 | não | Ray is an AI compute engine. Ray consists of a core distributed runtime and a set of AI Libraries for accelerating ML workloads. | n/a | serving distribuído | cluster | alta | Excesso p/ a fase atual. |
| 85 | [bentoml/BentoML](https://github.com/bentoml/BentoML) | Apache-2.0 | 2026-11-02 | não | The easiest way to serve AI apps and models - Build Model Inference APIs, Job queues, LLM apps, Multi-model pipelines, and more! | n/a | serving | Docker | média | Empacotar workers de STT/TTS. |
| 86 | [OpenNMT/CTranslate2](https://github.com/OpenNMT/CTranslate2) | MIT | 2026-11-08 | não | Fast inference engine for Transformer models | n/a | inferência | CPU/GPU | baixa | Motor por trás do faster-whisper. |
| 87 | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) | MIT | 2026-11-08 | não | ONNX Runtime: cross-platform, high performance ML inferencing and training accelerator | n/a | inferência | CPU/GPU/mobile | baixa | Roda Silero e Kokoro-ONNX; também no Android. |
| 88 | [huggingface/text-generation-inference](https://github.com/huggingface/text-generation-inference) | Apache-2.0 | 2026-03-21 | sim | Large Language Model Text Generation Inference | n/a | serving LLM | GPU | alta | Arquivado em 2026. |
| 89 | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) | MIT | 2026-11-08 | não | LLM inference in C/C++ | n/a | inferência LLM | CPU/GPU | média | Cérebro local futuro (não agora). |

## H. Orquestração de LLM/ferramentas (2)

| # | Repositório | Licença (verif.) | Último push (verif.) | Arquivado | Descrição (verif.) | pt-BR (julg.) | Tempo real (julg.) | Runtime (julg.) | Integração (julg.) | Nota |
|---|---|---|---|---|---|---|---|---|---|---|
| 90 | [BerriAI/litellm](https://github.com/BerriAI/litellm) | NOASSERTION | 2026-11-08 | não | The fastest, litest AI Gateway. Rust core with Python SDK. Call 100+ LLM APIs in OpenAI (or native) format with cost tracking, guardrails, l | n/a | gateway LLM | Python | média | Abstração de provedores; KAZER já tem a sua. |
| 91 | [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk) | MIT | 2026-11-05 | não | The official Python SDK for Model Context Protocol servers and clients | n/a | ferramentas | Python | média | Ferramentas do agente; não muda a voz. |

## I. Filas, cache, observabilidade, carga (9)

| # | Repositório | Licença (verif.) | Último push (verif.) | Arquivado | Descrição (verif.) | pt-BR (julg.) | Tempo real (julg.) | Runtime (julg.) | Integração (julg.) | Nota |
|---|---|---|---|---|---|---|---|---|---|---|
| 92 | [redis/redis](https://github.com/redis/redis) | NOASSERTION | 2026-11-08 | não | For developers, who are building real-time data-driven applications, Redis is the preferred, fastest, and most feature-rich cache, data stru | n/a | cache/limites | servidor | baixa | Licença atual dupla (RSAL/SSPL/AGPL) — preferir Valkey. |
| 93 | [nats-io/nats-server](https://github.com/nats-io/nats-server) | Apache-2.0 | 2026-11-06 | não | High-Performance server for NATS.io, the cloud and edge native messaging system. | n/a | mensageria | servidor | média | Se surgir fila entre gateway e workers GPU. |
| 94 | [rabbitmq/rabbitmq-server](https://github.com/rabbitmq/rabbitmq-server) | NOASSERTION | 2026-11-07 | não | Open source RabbitMQ: core server and tier 1 (built-in) plugins | n/a | fila | servidor | média | Fila robusta; mais pesada que NATS. |
| 95 | [celery/celery](https://github.com/celery/celery) | NOASSERTION | 2026-11-08 | não | Distributed Task Queue (development branch) | n/a | tarefas | Python | média | Não serve p/ fluxo de áudio em tempo real. |
| 96 | [open-telemetry/opentelemetry-python](https://github.com/open-telemetry/opentelemetry-python) | Apache-2.0 | 2026-11-08 | não | OpenTelemetry Python API and SDK  | n/a | tracing | Python | baixa | Métricas/traces do gateway (fase 2). |
| 97 | [prometheus/prometheus](https://github.com/prometheus/prometheus) | Apache-2.0 | 2026-11-08 | não | The Prometheus monitoring system and time series database. | n/a | métricas | servidor | baixa | Coletar /metrics do gateway. |
| 98 | [grafana/k6](https://github.com/grafana/k6) | AGPL-3.0 | 2026-11-06 | não | A modern load testing tool, using Go and JavaScript | n/a | carga | Go | baixa | Carga em WebSocket (AGPL, só uso interno). |
| 99 | [locustio/locust](https://github.com/locustio/locust) | MIT | 2026-11-06 | não | Write scalable load tests in plain Python 🚗💨 | n/a | carga | Python | baixa | Alternativa; usamos harness asyncio próprio. |
| 100 | [valkey-io/valkey](https://github.com/valkey-io/valkey) | BSD-3-Clause | 2026-11-08 | não | A flexible distributed key-value database that is optimized for caching and other realtime workloads. | n/a | cache/limites | servidor | baixa | BSD: limite de taxa e nonces compartilhados quando houver >1 instância. |

## Licença dos pesos (conferida à parte do código)

| Componente | Código | Pesos / dados | Fonte conferida |
|---|---|---|---|
| Whisper (usado pelo faster-whisper) | MIT | MIT ("Whisper's code and model weights are released under the MIT License") | README de openai/whisper |
| Kokoro-82M | Apache-2.0 | Apache-2.0 ("Apache-licensed weights"); idioma `'p'` = pt-BR | README de hexgrad/kokoro |
| Silero VAD | MIT | MIT ("Published under permissive license (MIT)") | README de snakers4/silero-vad |
| Piper (alternativa) | GPL-3.0 (piper1-gpl) | cada voz tem licença própria (piper-voices) — revisar voz a voz | README de OHF-Voice/piper1-gpl |

Rejeitados por licença dos pesos: XTTS (Coqui, CPML não comercial), F5-TTS base (CC-BY-NC), fish-speech (licença própria restritiva — revisar), VoiceCraft.

## Lista curta

- **STT:** faster-whisper (servidor), whisper.cpp / sherpa-onnx (on-device, app Android futuro), Vosk (leve).
- **TTS:** Kokoro-82M (natural, Apache), Piper (rapidíssimo em CPU, mas GPL/vozes variadas), Chatterbox (natural, mais pesado).
- **VAD / fim de turno:** Silero VAD; smart-turn como fase 2.
- **Transporte:** WebSocket do Starlette (fase 1); aiortc/LiveKit quando WebRTC se justificar.
- **Serving:** CTranslate2 + ONNX Runtime; Triton/BentoML só em escala alta.

## Stack recomendada (mínima)

1. **Cliente web (hoje, sem servidor novo):** reconhecimento de fala e síntese do próprio navegador (Web Speech API). Funciona já, custo zero, mantém a regra "o KAZER recebe só o texto" e nenhuma segunda captura de microfone.
2. **Voice gateway (opcional, auto-hospedado):** Starlette WebSocket + Silero VAD + faster-whisper `small` int8 (CPU) ou `large-v3-turbo` (GPU) + Kokoro-82M (voz pt-BR `pf_dora`/`pm_alex`). Ligado só quando `KAZER_VOICE_GATEWAY_URL` existir.
3. **Cérebro:** sempre o `/api/chat` existente (o gateway nunca fala com o modelo).

**Alternativa viável:** speaches (servidor pronto faster-whisper + Kokoro com API compatível OpenAI) atrás do mesmo protocolo; ou sherpa-onnx (STT+TTS+VAD num runtime, o mesmo que roda no Android).

**Por quê:** qualidade pt-BR (Whisper é o melhor aberto em pt), latência (faster-whisper int8 em CPU; Kokoro com 82M parâmetros sintetiza por frase), licenças permissivas de código **e** pesos, e operação simples (um processo Python, sem Kubernetes, sem fila).

## Rejeitados (principais) e por quê

- **Moshi, Ultravox, mini-omni:** são modelos de fala com cérebro próprio — criariam um segundo "KAZER" (proibido pelo brief).
- **Coqui TTS / XTTS:** sem manutenção e pesos não comerciais.
- **OpenVoice, GPT-SoVITS, VoiceCraft:** clonagem de voz — risco de imitar vozes reais; fora do escopo.
- **distil-whisper:** variantes principais só em inglês.
- **LiveKit (agora):** ótimo, mas exige servidor SFU + TURN; WebSocket basta na fase 1.
- **Redis:** licença atual dupla; Valkey (BSD) cobre o mesmo uso.
- **KoljaB/RealtimeVoiceChat:** sem licença declarada.
- **Kaldi, WeNet, FunASR, ESPnet:** pesados para operar e com pouco pt-BR pronto.

## Adendo: Kokoro rodando no navegador (avaliado e adiado)

Verificado em 2026-11-08 lendo os pacotes do npm (sem executar):
- `kokoro-js@1.2.1` (Apache-2.0) traz os arquivos das vozes pt-BR (`pf_dora`,
  `pm_alex`, `pm_santa`), mas a lista de vozes aceitas tem só inglês e o
  fonemizador é fixo em `en-us`/`en`.
- `phonemizer@1.2.1` (espeak-ng em WASM, Apache-2.0) tem a definição de voz
  `roa/pt-BR`, mas **só embute o dicionário `en_dict`**: sem o `pt_dict`, a
  pronúncia em português sairia errada.
- Além disso, o modelo q8 tem ~90 MB por aparelho e roda devagar em celular sem
  WebGPU.

Conclusão: voz Kokoro realista em pt-BR fica no **voice gateway** (servidor com
espeak-ng completo). No navegador, o KAZER usa a voz mais humana do próprio
aparelho (neural/online primeiro) e deixa a pessoa escolher.
