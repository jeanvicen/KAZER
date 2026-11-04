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
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  let listening = false;
  let wanted = false;
  let prefix = "";
  let transcript = "";
  let hasFinalResult = false;

  recognition.addEventListener("result", (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (!result.isFinal) continue;
      const text = result[0]?.transcript?.trim();
      if (!text) continue;
      transcript += (transcript ? " " : "") + text;
      hasFinalResult = true;
    }
  });

  recognition.addEventListener("start", () => {
    listening = true;
    onState?.("listening");
  });

  recognition.addEventListener("end", () => {
    listening = false;
    const shouldApply = wanted && hasFinalResult;
    wanted = false;
    if (shouldApply) onText(prefix + transcript, false);
    onState?.("idle");
  });

  recognition.addEventListener("error", (event) => {
    const code = event.error;
    // Silêncio e cancelamento manual não são falhas visíveis para a pessoa.
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
      wanted = true;
      prefix = initial;
      transcript = "";
      hasFinalResult = false;
      onState?.("starting");
      try {
        recognition.start();
      } catch {
        wanted = false;
        listening = false;
        onState?.("idle");
        onError?.("not-allowed");
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

export const DICTATION_ERRORS = {
  "not-allowed": "Permissão de microfone negada. Libere o microfone para este site e tente de novo.",
  "service-not-allowed": "O navegador bloqueou o reconhecimento de fala.",
  "audio-capture": "Nenhum microfone encontrado.",
  network: "O reconhecimento de fala precisa de internet.",
  "language-not-supported": "Este navegador não reconhece português por voz.",
};
