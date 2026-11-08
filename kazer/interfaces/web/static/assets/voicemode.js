// Modo voz do KAZER: conversa falada usando o MESMO chat (/api/chat).
//
// Estados: "ouvindo" → "pensando" → "falando" → volta a ouvir. Tocar no centro
// interrompe a fala (para o áudio, cancela as frases na fila e a geração).
//
// Dois motores, escolhidos pelo servidor (/api/voice/config):
// - "browser" (padrão, sem servidor novo): reconhecimento e síntese de fala do
//   próprio navegador. O KAZER recebe só o texto, nada de captura extra de
//   microfone (getUserMedia) e nenhum áudio guardado.
// - "gateway" (opcional, auto-hospedado): WebSocket kazer-voice/1 com token curto;
//   o microfone é aberto aqui (com cancelamento de eco), PCM 16 kHz vai ao
//   gateway (faster-whisper + Silero VAD) e volta a voz do Kokoro em PCM 24 kHz.
//   A barra de nível usa o volume real do microfone (AnalyserNode).
//
// O texto falado passa por speakable(): sem markdown, código, links ou citações.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const synth = window.speechSynthesis;

export const voiceModeSupported = () => Boolean((Recognition && synth) || window.WebSocket);

// ---------- Texto falável (espelho de kazer/voice/speech_text.py) ----------

function questionText(body) {
  try {
    const data = JSON.parse(body.replace(/[“”]/g, '"'));
    const question = String(data.pergunta || data.question || "");
    const options = (data.opcoes || data["opções"] || data.options || [])
      .map((item) => (item && typeof item === "object" ? item.texto || item.text || "" : String(item || "")))
      .filter(Boolean);
    if (!question) return "";
    return ` ${question} ${options.length ? `Opções: ${options.join(", ")}. ` : ""}`;
  } catch {
    return "";
  }
}

export function speakable(text) {
  return String(text || "")
    .replace(/```([\w-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g, (_, lang, body) =>
      lang === "kazer-pergunta" ? questionText(body) : " (o código está na tela) ",
    )
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\[(?:\d+|foto \d+)\](?:\[\d+\])*/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_`#>|~]+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// Frases completas a partir de `from` (o resto fica para quando chegar mais texto).
function takeSentences(clean, from, final) {
  const rest = clean.slice(from);
  const out = [];
  // Começa a falar antes: no início da resposta, a primeira vírgula depois de
  // ~40 letras já vale como pedaço (menos espera até a primeira palavra).
  if (from === 0 && !final) {
    const comma = rest.slice(40, 140).search(/[,—–] /);
    const stop = rest.search(/[.!?…\n]/);
    if (comma >= 0 && (stop < 0 || stop > comma + 40)) {
      const cut = 40 + comma + 1;
      return { sentences: [rest.slice(0, cut).trim()], next: cut };
    }
  }
  // Frase termina em . ! ? … ou quebra de linha (":" de lista não corta a frase).
  const pattern = /[^.!?…\n]+(?:[.!?…]+|\n)/g;
  let used = 0;
  let match;
  while ((match = pattern.exec(rest))) {
    const piece = match[0].trim();
    used = pattern.lastIndex;
    if (!piece) continue;
    // Frases curtíssimas juntam com a próxima: soa menos picado.
    if (out.length && out[out.length - 1].length < 24) out[out.length - 1] += ` ${piece}`;
    else out.push(piece);
  }
  if (final && rest.slice(used).trim()) {
    out.push(rest.slice(used).trim());
    used = rest.length;
  }
  return { sentences: out, next: from + used };
}

// ---------- Motor do navegador ----------

// Vozes do aparelho, da mais humana para a mais robótica. As neurais/online
// (Google no Android, "Natural" no Edge, "Premium/Enhanced" na Apple) soam bem
// mais naturais que as locais antigas (eSpeak e afins).
const HUMAN = /natural|neural|online|premium|enhanced|wavenet|google|francisca|thalita|antonio|luciana|felipe/i;
const ROBOTIC = /espeak|compact|eloquence|robot/i;

function voiceScore(voice) {
  let score = 0;
  if (HUMAN.test(voice.name)) score += 10;
  if (/natural|neural|premium|enhanced/i.test(voice.name)) score += 6;
  if (!voice.localService) score += 2; // vozes da nuvem do sistema costumam ser neurais
  if (ROBOTIC.test(voice.name)) score -= 20;
  return score;
}

export function listVoices(lang) {
  const voices = synth?.getVoices?.() || [];
  const base = lang.toLowerCase();
  const same = voices.filter((voice) => voice.lang?.toLowerCase().replace("_", "-") === base);
  const near = same.length ? same : voices.filter((voice) => voice.lang?.toLowerCase().startsWith(base.slice(0, 2)));
  return near.slice().sort((a, b) => voiceScore(b) - voiceScore(a));
}

const VOICE_KEY = "kazer:voice-name";

export function chosenVoice() {
  try {
    return localStorage.getItem(VOICE_KEY) || "";
  } catch {
    return "";
  }
}

export function chooseVoice(name) {
  try {
    if (name) localStorage.setItem(VOICE_KEY, name);
    else localStorage.removeItem(VOICE_KEY);
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
}

// Voz estranha não pode deixar o KAZER mudo: cai para a voz padrão do idioma.
function setVoice(utterance, voice) {
  if (!voice) return;
  try {
    utterance.voice = voice;
  } catch {
    /* fica a voz padrão */
  }
}

function pickVoice(lang) {
  const voices = listVoices(lang);
  const saved = chosenVoice();
  return voices.find((voice) => voice.name === saved) || voices[0] || null;
}

// Fala um exemplo com a voz escolhida (para a pessoa comparar).
export function previewVoice(lang, text = "Oi! Eu sou o KAZER. É assim que eu falo.") {
  if (!synth) return;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  const voice = pickVoice(lang);
  setVoice(utterance, voice);
  synth.speak(utterance);
}

function browserEngine({ lang, onLive, onFinal, onIdle, onError, onSpeechState, onBoundary }) {
  let recognition = null;
  let listening = false;
  let queue = 0;
  let cancelled = false;

  function listen() {
    if (!Recognition || listening) return;
    recognition = new Recognition();
    recognition.lang = lang;
    // Uma fala por vez: o próprio navegador decide quando a pessoa terminou.
    recognition.continuous = false;
    recognition.interimResults = true;
    let finalText = "";
    let partial = "";
    recognition.onresult = (event) => {
      finalText = "";
      partial = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const text = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalText += text;
        else partial += text;
      }
      onLive((finalText + " " + partial).trim());
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      onError(event.error);
    };
    recognition.onend = () => {
      listening = false;
      const text = (finalText || partial).trim();
      if (text) onFinal(text);
      else onIdle();
    };
    try {
      recognition.start();
      listening = true;
    } catch (error) {
      if (error?.name !== "InvalidStateError") onError("service-not-allowed");
    }
  }

  function stopListening(deliver = true) {
    if (!recognition) return;
    try {
      if (deliver) recognition.stop();
      else recognition.abort();
    } catch {
      /* já parado */
    }
  }

  function speak(sentence) {
    if (!synth) return;
    cancelled = false;
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.lang = lang;
    const voice = pickVoice(lang);
    setVoice(utterance, voice);
    utterance.rate = 1.0;
    queue += 1;
    onSpeechState(true);
    utterance.onboundary = () => onBoundary();
    const done = () => {
      queue = Math.max(0, queue - 1);
      if (!queue && !cancelled) onSpeechState(false);
    };
    utterance.onend = done;
    utterance.onerror = done;
    synth.speak(utterance);
  }

  function cancelSpeech() {
    cancelled = true;
    queue = 0;
    synth?.cancel();
  }

  return {
    kind: "browser",
    listen,
    stopListening,
    speak,
    cancelSpeech,
    get speaking() {
      return queue > 0;
    },
    level: () => 0,
    close() {
      stopListening(false);
      cancelSpeech();
    },
  };
}

// ---------- Motor do gateway (kazer-voice/1) ----------

async function gatewayEngine({ session, onLive, onFinal, onError, onSpeechState, onVad, onClosed }) {
  const ws = new WebSocket(session.url);
  ws.binaryType = "arraybuffer";
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("connect"));
  });
  ws.send(JSON.stringify({ type: "hello", protocol: session.protocol, token: session.token, audio: session.audio }));
  await new Promise((resolve, reject) => {
    ws.onmessage = (event) => {
      const data = typeof event.data === "string" ? JSON.parse(event.data) : null;
      if (data?.type === "ready") resolve();
      else if (data?.type === "error") reject(new Error(data.code));
    };
    ws.onclose = () => reject(new Error("closed"));
  });

  // Microfone com cancelamento de eco: a voz do KAZER não volta como fala.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const context = new AudioContext();
  await context.audioWorklet.addModule("/assets/voice-worklet.js");
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  const worklet = new AudioWorkletNode(context, "kazer-pcm16", { processorOptions: { targetRate: 16000 } });
  // Saída passa por um analisador: a esfera segue o volume real da voz do KAZER.
  const outAnalyser = context.createAnalyser();
  outAnalyser.fftSize = 512;
  outAnalyser.connect(context.destination);
  source.connect(analyser);
  source.connect(worklet);
  let muted = false;
  worklet.port.onmessage = (event) => {
    if (!muted && ws.readyState === WebSocket.OPEN) ws.send(event.data);
  };

  // Fala recebida: agenda os pedaços em sequência, sem buracos.
  let playAt = 0;
  let outRate = 24000;
  const playing = new Set();
  let speakId = "";
  let ended = true;
  const finishIfDone = () => {
    if (ended && !playing.size) onSpeechState(false);
  };

  ws.onmessage = (event) => {
    if (typeof event.data !== "string") {
      const pcm = new Int16Array(event.data);
      if (!pcm.length) return;
      const buffer = context.createBuffer(1, pcm.length, outRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < pcm.length; i += 1) channel[i] = pcm[i] / 32768;
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(outAnalyser);
      playAt = Math.max(playAt, context.currentTime + 0.03);
      node.start(playAt);
      playAt += buffer.duration;
      playing.add(node);
      node.onended = () => {
        playing.delete(node);
        finishIfDone();
      };
      return;
    }
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data.type === "transcript" && data.final) {
      if (data.text) onFinal(data.text);
    } else if (data.type === "vad") {
      onVad(Boolean(data.speaking));
      if (data.speaking) onLive("…");
    } else if (data.type === "audio_start") {
      outRate = data.sample_rate || 24000;
      ended = false;
      onSpeechState(true);
    } else if (data.type === "audio_end") {
      ended = true;
      finishIfDone();
    } else if (data.type === "barge_in" || data.type === "audio_cancelled") {
      stopPlayback();
    } else if (data.type === "error") {
      onError(data.code);
    }
  };
  ws.onclose = () => onClosed();

  function stopPlayback() {
    for (const node of playing) {
      try {
        node.stop();
      } catch {
        /* já acabou */
      }
    }
    playing.clear();
    playAt = 0;
    ended = true;
    onSpeechState(false);
  }

  const levels = new Uint8Array(analyser.fftSize);
  return {
    kind: "gateway",
    listen() {
      muted = false;
    },
    stopListening(deliver = true) {
      if (deliver && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "end_utterance" }));
    },
    mute(on) {
      muted = on;
    },
    speak(sentence, id, queue) {
      if (ws.readyState !== WebSocket.OPEN) return;
      speakId = id;
      ws.send(JSON.stringify({ type: "speak", id, text: sentence, queue }));
    },
    cancelSpeech() {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "cancel", id: speakId }));
      stopPlayback();
    },
    get speaking() {
      return !ended || playing.size > 0;
    },
    // Nível real do microfone (0..1) para o indicador.
    level() {
      (playing.size ? outAnalyser : analyser).getByteTimeDomainData(levels);
      let sum = 0;
      for (const value of levels) sum += ((value - 128) / 128) ** 2;
      return Math.min(1, Math.sqrt(sum / levels.length) * 4);
    },
    close() {
      stopPlayback();
      for (const track of stream.getTracks()) track.stop();
      worklet.port.onmessage = null;
      context.close().catch(() => {});
      if (ws.readyState <= WebSocket.OPEN) ws.close(1000);
    },
  };
}

// ---------- Controlador ----------

export function createVoiceMode({ lang = "pt-BR", sendText, stopReply, fetchJson, onState, onLive, onLevel, onError }) {
  let engine = null;
  let state = "idle";
  let open = false;
  let replyId = "";
  let spokenUpTo = 0;
  let speakSeq = 0;
  let replyDone = false;
  let idleTries = 0;
  let levelFrame = 0;

  const set = (next, detail = "") => {
    state = next;
    onState(next, detail);
  };

  function afterSpeech() {
    if (!open) return;
    if (replyDone && !engine?.speaking) {
      replyId = "";
      listen();
    }
  }

  function listen() {
    if (!open || !engine) return;
    set("ouvindo");
    onLive("");
    engine.listen();
  }

  const handlers = {
    lang,
    onLive: (text) => onLive(text),
    onFinal: (text) => {
      idleTries = 0;
      if (!open) return;
      set("pensando");
      onLive(text);
      replyId = "";
      spokenUpTo = 0;
      replyDone = false;
      sendText(text);
    },
    onIdle: () => {
      // Silêncio: tenta ouvir de novo algumas vezes antes de parar e esperar um toque.
      if (!open || state !== "ouvindo") return;
      idleTries += 1;
      if (idleTries < 3) listen();
      else set("pausado");
    },
    onError: (code) => {
      onError(code);
      if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") set("erro", code);
    },
    onSpeechState: (speaking) => {
      if (speaking) set("falando");
      else afterSpeech();
    },
    onBoundary: () => onLevel(0.6),
    onVad: (speaking) => onLevel(speaking ? 0.5 : 0),
    onClosed: () => {
      if (open) set("erro", "network");
    },
  };

  function tickLevel() {
    if (!open) return;
    const value = engine?.level?.() || 0;
    if (engine?.kind === "gateway") onLevel(value);
    levelFrame = window.requestAnimationFrame(tickLevel);
  }

  return {
    get state() {
      return state;
    },
    get engineKind() {
      return engine?.kind || "";
    },
    async start({ conversationId } = {}) {
      open = true;
      set("conectando");
      let config = { engines: ["browser"] };
      try {
        config = (await fetchJson("/api/voice/config")) || config;
      } catch {
        /* sem config: navegador */
      }
      if (config.engines?.[0] === "gateway") {
        try {
          const session = await fetchJson("/api/voice/session", { method: "POST", body: { conversation_id: conversationId || null } });
          engine = await gatewayEngine({ session, ...handlers });
        } catch {
          engine = null; // gateway fora do ar: cai para o navegador, sem derrubar nada
        }
      }
      if (!engine) {
        if (!Recognition || !synth) {
          set("erro", "unsupported");
          return;
        }
        engine = browserEngine(handlers);
        // Algumas vozes carregam depois: pede a lista cedo.
        synth.getVoices();
      }
      if (!open) {
        engine.close();
        return;
      }
      tickLevel();
      listen();
    },
    // Texto da resposta chegando (mesmo stream do chat).
    reply(id, content, done) {
      if (!open || !engine) return;
      if (!replyId) {
        replyId = id;
        spokenUpTo = 0;
        speakSeq += 1;
      }
      if (id !== replyId) return;
      const clean = speakable(content);
      const { sentences, next } = takeSentences(clean, spokenUpTo, done);
      spokenUpTo = next;
      for (const sentence of sentences) {
        engine.speak(sentence, `r${speakSeq}`, engine.speaking || state === "falando");
      }
      if (done) {
        replyDone = true;
        if (!engine.speaking && !sentences.length) afterSpeech();
      }
    },
    // Tocar no centro: interrompe a fala e volta a ouvir; ouvindo, fecha a fala.
    tap() {
      if (!engine) return;
      if (state === "falando" || state === "pensando") {
        engine.cancelSpeech();
        stopReply();
        replyDone = true;
        replyId = "";
        listen();
      } else if (state === "ouvindo") {
        engine.stopListening(true);
      } else if (state === "pausado" || state === "erro") {
        idleTries = 0;
        listen();
      }
    },
    close() {
      open = false;
      window.cancelAnimationFrame(levelFrame);
      engine?.close();
      engine = null;
      set("idle");
    },
  };
}
