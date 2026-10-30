// Tela Terminal: como trazer o KAZER para o terminal deste computador.
//
// A tela existe porque o comando existe (`kazer/interfaces/terminal/`). Ela
// mostra os passos reais, com o endereço deste servidor já preenchido, e os
// comandos que funcionam hoje — nada de telemetria de aparelhos, que o
// servidor não guarda, nem de pacote publicado, que ainda não existe.

import { h, icon, mark } from "./dom.js";
import { copyText } from "./markdown.js";

const COMMANDS = [
  ["kazer", "abre uma conversa"],
  ['kazer "sua pergunta"', "responde e sai"],
  ["cat erro.log | kazer", "a pergunta vem pelo cano"],
  ["kazer conversas", "lista suas conversas"],
  ["kazer continuar 2", "volta para uma conversa"],
  ["kazer habilidades", "habilidades instaladas na conta"],
  ["kazer conectores", "conectores ligados na conta"],
  ["kazer status", "conta, plano e quanto resta da janela"],
  ["kazer sair", "encerra a sessão deste computador"],
];

const INSIDE = [
  ["/nova", "começa outra conversa"],
  ["/continuar <n>", "volta para uma da lista"],
  ["/code", "liga o KZ Code (planos pagos)"],
  ["/pensamento", "mostra o raciocínio enquanto chega"],
  ["/ajuda", "todos os comandos"],
];

export async function createTerminal({ onOpenSettings }) {
  const origin = window.location.origin;
  const steps = [
    {
      title: "Instale o comando",
      body: "Na pasta do KAZER, com Python 3.11 ou mais novo.",
      code: "pip install -e .",
      note: "Ainda não está publicado num repositório de pacotes: a instalação é a partir do projeto.",
    },
    {
      title: "Aponte para este servidor",
      body: "Guarde no seu shell para não repetir a cada vez.",
      code: `export KAZER_URL="${origin}"`,
      note: `Fora de localhost o terminal só fala https. Este servidor: ${origin}`,
    },
    {
      title: "Entre com a sua conta",
      body: "A mesma deste navegador. A senha não aparece na tela nem fica no histórico do shell.",
      code: "kazer entrar",
      note: "A sessão fica em ~/.kazer/sessao.json, legível só pelo seu usuário.",
    },
  ];

  return {
    body: h(
      "div.tm",
      {},
      h(
        "section.tm__hero",
        {},
        mark("tm__mark"),
        h("h3.tm__title", { text: "KAZER no terminal" }),
        h("p.tm__lead", {
          text:
            "A mesma conta e as mesmas conversas, sem navegador. As habilidades instaladas" +
            " entram no contexto, os conectores ligados viram ferramentas, o plano limita e a" +
            " memória lembra — porque é o mesmo servidor respondendo.",
        }),
      ),
      h(
        "section.tm__block",
        {},
        h("h4.tm__h", { text: "Conectar seu computador" }),
        h("ol.tm__steps", {}, ...steps.map(step)),
      ),
      h(
        "section.tm__block",
        {},
        h("h4.tm__h", { text: "Comandos" }),
        h("div.tm__grid", {}, ...COMMANDS.map(([cmd, about]) => row(cmd, about))),
      ),
      h(
        "section.tm__block",
        {},
        h("h4.tm__h", { text: "Dentro da conversa" }),
        h("div.tm__grid", {}, ...INSIDE.map(([cmd, about]) => row(cmd, about))),
      ),
      h(
        "section.tm__block",
        {},
        h("h4.tm__h", { text: "Bom saber" }),
        h(
          "ul.tm__notes",
          {},
          h("li", {
            text:
              "Ctrl-C interrompe a resposta no servidor, não só na tela — como o botão de" +
              " parar aqui.",
          }),
          h("li", {
            text:
              "Saída para arquivo ou cano sai limpa, sem moldura nem cor:" +
              ' kazer "pergunta" > resposta.txt grava só a resposta.',
          }),
          h("li", {
            text:
              "O KAZER não guarda uma lista de computadores. A sessão do terminal é uma" +
              " sessão da sua conta, igual à deste navegador.",
          }),
          h(
            "li",
            {},
            h("span", { text: "Para encerrar as sessões dos outros lugares: " }),
            h(
              "button.tm__link",
              { type: "button", onclick: () => onOpenSettings?.("conta") },
              h("span", { text: "Configurações › Conta" }),
            ),
            h("span", { text: "." }),
          ),
        ),
      ),
    ),
  };
}

function step({ title, body, code, note }) {
  return h(
    "li.tm__step",
    {},
    h("h5.tm__step-title", { text: title }),
    h("p.tm__step-body", { text: body }),
    command(code),
    h("p.tm__step-note", { text: note }),
  );
}

function command(code) {
  const button = h(
    "button.tm__copy",
    { type: "button", "aria-label": `Copiar: ${code}` },
    icon("copy"),
    h("span", { text: "Copiar" }),
  );
  button.addEventListener("click", async () => {
    const done = await copyText(code);
    const label = button.querySelector("span");
    if (label) label.textContent = done ? "Copiado" : "Copie à mão";
    setTimeout(() => {
      if (label) label.textContent = "Copiar";
    }, 1600);
  });
  return h("div.tm__cmd", {}, h("code.tm__code", { text: code }), button);
}

function row(cmd, about) {
  return h("div.tm__row", {}, h("code.tm__code", { text: cmd }), h("span.tm__about", { text: about }));
}
