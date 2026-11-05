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

// Um toque inicia uma única fala. O texto só entra no campo depois que o
// navegador termina de reconhecer a fala, nunca enquanto a pessoa está falando.
export function createDictation({ onText, onState, onError, lang = "pt-BR" }) {
  if (!dictationSupported) return null;

  const recognition = new Recognition();
  recognition.lang = lang;
  recognition.continuous = false;
  // Parciais só ficam guardados aqui dentro (nunca vão para o campo): servem
  // para não perder a última frase quando a pessoa para antes do resultado final.
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let listening = false;
  let wanted = false;
  let prefix = "";
  let transcript = "";
  let pending = "";
  let hasFinalResult = false;

  recognition.addEventListener("result", (event) => {
    pending = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript?.trim();
      if (!text) continue;
      if (result.isFinal) {
        transcript += (transcript ? " " : "") + text;
        hasFinalResult = true;
      } else {
        pending += (pending ? " " : "") + text;
      }
    }
  });

  recognition.addEventListener("start", () => {
    listening = true;
    onState?.("listening");
  });

  recognition.addEventListener("end", () => {
    listening = false;
    // Parou antes do resultado final? A última frase ouvida vale como final.
    if (pending) {
      transcript += (transcript ? " " : "") + pending;
      pending = "";
      hasFinalResult = true;
    }
    const shouldApply = wanted && hasFinalResult;
    wanted = false;
    if (shouldApply) onText(prefix + transcript, false);
    onState?.("idle");
  });

  recognition.addEventListener("error", async (event) => {
    let code = event.error;
    // Silêncio e cancelamento manual não são falhas visíveis para a pessoa.
    if (code === "no-speech" || code === "aborted") return;
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
      prefix = initial;
      transcript = "";
      hasFinalResult = false;
      onState?.("starting");
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
    stop() {
      // Se já está ouvindo, deixa o navegador fechar e entregar o último
      // resultado final. Durante o pedido de permissão, aí sim cancela.
      if (listening) {
        try {
          recognition.stop();
        } catch {
          /* já parado */
        }
        return;
      }
      wanted = false;
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
