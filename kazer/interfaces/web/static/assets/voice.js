// Ditado por voz usando o reconhecimento de fala do próprio navegador.
//
// Importante para a privacidade: em alguns navegadores (Chrome, por exemplo) o
// áudio é enviado ao serviço de reconhecimento do fabricante do navegador para
// virar texto. O KAZER não grava nem guarda esse áudio em lugar nenhum: só
// recebe o texto pronto. Onde o recurso não existe (Firefox, por exemplo), o
// botão explica em vez de fingir que funciona.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// O próprio SpeechRecognition pede a permissão nativa ao começar. Não abrir
// uma segunda captura com getUserMedia evita o NotAllowedError em PWAs Android.
export const dictationSupported = Boolean(Recognition);

// Ditado como o do Claude: fica ouvindo até a pessoa parar, enviar ou cancelar.
// Enquanto fala, o texto aparece ao vivo (onLive) — só na tela, nunca enviado nem
// guardado; vai para o campo só no fim (onText). onActivity conta o que o próprio
// navegador detecta ("sound", "silence", "word") para a onda reagir à voz de
// verdade, sem fingir volume: o KAZER não abre o microfone por conta própria.
const MAX_RESTARTS = 20;

export function createDictation({ onText, onState, onError, onLive, onActivity, lang = "pt-BR" }) {
  if (!dictationSupported) return null;

  const recognition = new Recognition();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let listening = false; // o navegador está captando agora
  let wanted = false; // a pessoa quer que continue ouvindo
  let discard = false; // cancelou: nada vai para o campo
  let prefix = "";
  let earlier = ""; // texto das sessões anteriores (o navegador reinicia em pausas longas)
  let finals = "";
  let pending = "";
  let restarts = 0;

  const join = (...parts) => parts.map((part) => (part || "").trim()).filter(Boolean).join(" ");
  const heard = () => join(earlier, finals, pending);
  const live = () => onLive?.(join(prefix, heard()), Boolean(heard()));

  recognition.addEventListener("result", (event) => {
    // Remonta tudo a partir da lista inteira: alguns Androids repetem o trecho
    // anterior dentro do novo, e somar aos pedaços viraria "olá olá tudo bem".
    let done = "";
    let partial = "";
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript?.trim();
      if (!text) continue;
      if (result.isFinal) {
        done = done && text.toLowerCase().startsWith(done.toLowerCase()) ? text : join(done, text);
      } else {
        partial = join(partial, text);
      }
    }
    finals = done;
    pending = partial;
    // Quanto texto o navegador tem agora: a onda cresce com o que foi captado.
    onActivity?.("word", heard().length);
    live();
  });

  for (const [name, kind] of [["audiostart", "open"], ["soundstart", "sound"], ["speechstart", "sound"], ["speechend", "silence"], ["soundend", "silence"]]) {
    recognition.addEventListener(name, () => onActivity?.(kind));
  }

  recognition.addEventListener("start", () => {
    listening = true;
    onState?.("listening");
  });

  recognition.addEventListener("end", () => {
    listening = false;
    // O que esta sessão ouviu vale como final (a frase parcial também).
    earlier = heard();
    finals = "";
    pending = "";
    // Pausa longa: o navegador encerra sozinho. Se a pessoa não parou, continua.
    if (wanted && !discard && restarts < MAX_RESTARTS) {
      restarts += 1;
      try {
        recognition.start();
        return;
      } catch {
        /* não deu para continuar: entrega o que já tem */
      }
    }
    const deliver = !discard && Boolean(earlier);
    const text = join(prefix, earlier);
    wanted = false;
    onActivity?.("silence");
    if (deliver) onText(text);
    onState?.("idle");
  });

  recognition.addEventListener("error", async (event) => {
    let code = event.error;
    if (code === "aborted") return; // cancelamento pedido pela própria pessoa
    if (code === "no-speech") {
      // Silêncio desde o começo: para quieto. Já falou algo? O "end" continua.
      if (!heard()) wanted = false;
      return;
    }
    wanted = false;
    onState?.("idle");
    // "not-allowed" serve para dois casos: a pessoa recusou agora ou o site está
    // bloqueado nas configurações. Só a Permissions API diz qual (sem abrir o
    // microfone de novo — nada de getUserMedia).
    if (code === "not-allowed") code = (await microphoneState()) === "denied" ? "blocked" : "dismissed";
    onError?.(code);
  });

  return {
    get listening() {
      return listening || wanted;
    },
    start(initial = "") {
      if (wanted) return;
      wanted = true;
      discard = false;
      prefix = initial;
      earlier = "";
      finals = "";
      pending = "";
      restarts = 0;
      onState?.("starting");
      live();
      try {
        // O próprio start() faz o navegador pedir a permissão nativa.
        recognition.start();
      } catch (error) {
        // Já estava ouvindo (InvalidStateError): não é falha de permissão.
        if (error?.name === "InvalidStateError") return;
        wanted = false;
        listening = false;
        onState?.("idle");
        onError?.("service-not-allowed");
      }
    },
    // Termina e entrega o texto para o campo (o navegador fecha a última frase).
    stop() {
      wanted = false;
      if (listening) {
        try {
          recognition.stop();
        } catch {
          /* já parado */
        }
        return;
      }
      onState?.("idle");
    },
    // Descarta tudo o que foi falado.
    cancel() {
      discard = true;
      wanted = false;
      if (listening) {
        try {
          recognition.abort();
        } catch {
          /* já parado */
        }
        return;
      }
      onState?.("idle");
    },
    toggle(initial = "") {
      if (this.listening) this.stop();
      else void this.start(initial);
    },
  };
}

// Estado da permissão sem pedir nada: "granted", "denied", "prompt" ou "".
async function microphoneState() {
  try {
    const status = await navigator.permissions?.query({ name: "microphone" });
    return status?.state || "";
  } catch {
    return "";
  }
}

const standalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

export function dictationError(code) {
  if (code === "blocked") {
    return standalone()
      ? "O microfone está bloqueado para o KAZER. Abra as configurações do app no celular → Permissões → Microfone → Permitir, e toque no microfone de novo."
      : "O microfone está bloqueado para este site. Toque no cadeado ao lado do endereço → Permissões → Microfone → Permitir, e tente de novo.";
  }
  return DICTATION_ERRORS[code] || "O ditado parou. Toque no microfone para tentar de novo.";
}

export const DICTATION_ERRORS = {
  dismissed: "Para ditar, toque no microfone e escolha Permitir quando o navegador perguntar.",
  "not-allowed": "Permissão de microfone negada. Libere o microfone para este site e tente de novo.",
  "service-not-allowed": "O navegador bloqueou o reconhecimento de fala. Tente no Chrome ou no Edge.",
  "audio-capture": "Nenhum microfone encontrado. Confira se ele está conectado e liberado.",
  network: "O reconhecimento de fala precisa de internet. Confira a conexão e tente de novo.",
  "language-not-supported": "Este navegador não reconhece português por voz.",
};
