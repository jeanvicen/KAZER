// Ditado por voz usando o reconhecimento de fala do próprio navegador.
//
// Importante para a privacidade: em alguns navegadores (Chrome, por exemplo) o
// áudio é enviado ao serviço de reconhecimento do fabricante do navegador para
// virar texto. O KAZER não grava nem guarda esse áudio em lugar nenhum: só
// recebe o texto pronto. Onde o recurso não existe (Firefox, por exemplo), o
// botão explica em vez de fingir que funciona.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const dictationSupported = Boolean(Recognition);

// Alguns navegadores encerram sozinhos depois de um silêncio; enquanto a pessoa
// não mandar parar, a sessão é reaberta para a fala não ser cortada no meio.
export function createDictation({ onText, onState, onError, lang = "pt-BR" }) {
  if (!Recognition) return null;

  const recognition = new Recognition();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let listening = false;
  let wanted = false;
  let settled = "";
  let restartTimer = 0;

  function emit(interim) {
    onText(settled + interim, Boolean(interim));
  }

  recognition.addEventListener("result", (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript || "";
      if (result.isFinal) settled += (settled && !/\s$/.test(settled) ? " " : "") + text.trim();
      else interim += text;
    }
    emit(interim.trim());
  });

  recognition.addEventListener("start", () => {
    listening = true;
    onState?.("listening");
  });

  recognition.addEventListener("end", () => {
    listening = false;
    if (wanted) {
      // Silêncio não encerra o ditado: reabre e segue ouvindo.
      restartTimer = window.setTimeout(() => {
        if (!wanted) return;
        try {
          recognition.start();
        } catch {
          wanted = false;
          onState?.("idle");
        }
      }, 180);
      return;
    }
    onState?.("idle");
  });

  recognition.addEventListener("error", (event) => {
    const code = event.error;
    // "no-speech" e "aborted" são rotina: não viram erro para a pessoa.
    if (code === "no-speech" || code === "aborted") return;
    wanted = false;
    onState?.("idle");
    onError?.(code);
  });

  return {
    get listening() {
      return listening || wanted;
    },
    start(initial = "") {
      if (wanted) return;
      settled = initial;
      wanted = true;
      onState?.("starting");
      try {
        recognition.start();
      } catch {
        // Já estava ativo: o evento "start" resolve.
      }
    },
    stop() {
      wanted = false;
      window.clearTimeout(restartTimer);
      try {
        recognition.stop();
      } catch {
        /* já parado */
      }
      onState?.("idle");
    },
    toggle(initial = "") {
      if (this.listening) this.stop();
      else this.start(initial);
    },
  };
}

export const DICTATION_ERRORS = {
  "not-allowed": "Permissão de microfone negada. Libere o microfone para este site e tente de novo.",
  "service-not-allowed": "O navegador bloqueou o reconhecimento de fala.",
  "audio-capture": "Nenhum microfone encontrado.",
  network: "O reconhecimento de fala precisa de internet.",
  "language-not-supported": "Este navegador não reconhece português por voz.",
};
