// Conectores: o GitHub já na lista, com o botão redondo ao lado.
//
// Mesmo desenho da lista de conectores do Claude: uma linha por serviço e, à
// direita, um botão circular — "+" para ligar, visto quando está ligado. Tocar
// no botão de um serviço ligado abre o gerenciamento (usar nas conversas,
// desconectar).
//
// A tela só mostra o que o servidor diz: o estado de cada conector, o que o
// plano da conta pode fazer nele e quantas ferramentas ele trouxe. O endereço
// do serviço e a credencial nunca passam por aqui — a credencial sai do campo
// direto para o servidor e não volta.

import { h, icon } from "./dom.js";
import { request } from "./net.js";
import { confirmDialog, openSheet, toast } from "./sheets.js";

const ERRORS = {
  connector_rejected: "O serviço recusou essa credencial. Confira o token e tente de novo.",
  connector_unreachable: "Não consegui falar com o serviço agora. Tente de novo daqui a pouco.",
  connector_invalid: "O serviço respondeu fora do esperado.",
  connector_token_invalid: "Esse token tem espaço ou caractere que não vale. Cole só o token.",
  connector_unknown: "Esse conector não existe.",
  connector_limit: "Você chegou ao limite de conectores do seu plano.",
  plan_required: "Conectores entram com um plano que os inclua.",
  rate_limited: "Muitas tentativas. Espere um pouco.",
  network: "Sem conexão. Tente de novo.",
  unauthenticated: "Sua sessão expirou.",
  chat_unavailable: "Os conectores ainda não estão disponíveis neste ambiente.",
};

const message = (data) => ERRORS[data?.error] || "Não deu para concluir agora.";

/**
 * Lista de conectores. `onChange` avisa quem abriu (por exemplo, a folha do `+`)
 * que algo mudou, para refazer o resumo.
 */
export function createConnectors({ onChange } = {}) {
  const list = h("div.cn__list", { role: "list" });
  const status = h("p.cn__status", { "aria-live": "polite" });
  const root = h("div.cn", {}, status, list);
  let items = [];

  async function load() {
    const result = await request("/api/connectors");
    if (!result.ok) {
      status.textContent = message(result.data);
      list.replaceChildren();
      return;
    }
    items = result.data.items || [];
    status.textContent = "";
    list.replaceChildren(...items.map(row));
    onChange?.(items);
  }

  function row(item) {
    const on = item.connected && item.enabled;
    const button = h(
      "button.cn__round",
      {
        type: "button",
        "aria-label": item.connected ? `Gerenciar ${item.name}` : `Conectar ${item.name}`,
        title: item.connected ? "Gerenciar" : "Conectar",
        onclick: () => (item.connected ? manage(item) : connect(item)),
      },
      icon(item.connected ? "check" : "plus"),
    );
    // Classes de estado por classList: a propriedade `class` trocaria a classe base.
    button.classList.toggle("is-on", on);
    button.classList.toggle("is-off", item.connected && !on);
    return h(
      "div.cn__row",
      { role: "listitem" },
      h("span.cn__tile", { "aria-hidden": "true" }, icon("branch")),
      h(
        "span.cn__text",
        {},
        h("span.cn__name", { text: item.name }),
        h("span.cn__desc", { text: describe(item) }),
      ),
      button,
    );
  }

  function describe(item) {
    if (!item.connected) return item.description;
    const count = Array.isArray(item.tools) ? item.tools.length : 0;
    const mode = item.can_write ? "leitura e escrita" : "somente leitura";
    const state = item.enabled ? "" : " · desligado";
    return `${count} ferramenta${count === 1 ? "" : "s"} · ${mode}${state}`;
  }

  // ---------- Ligar ----------

  function connect(item) {
    openSheet({
      title: `Conectar o ${item.name}`,
      content: (handle) => {
        const field = h("input.set-field__input", {
          type: "password",
          autocomplete: "off",
          spellcheck: "false",
          autocapitalize: "off",
          maxlength: "4000",
          placeholder: "Cole o token aqui",
          "aria-label": item.token_label,
        });
        const error = h("p.cn__error", { role: "alert", hidden: true });
        const submit = h("button.pill-button.pill-button--primary", { type: "submit", text: "Conectar" });
        const form = h(
          "form.cn__form",
          { autocomplete: "off" },
          h("p.cn__lead", {
            text: item.can_write
              ? "O KAZER vai poder ler e também escrever no GitHub em seu nome."
              : "No seu plano o KAZER só lê: ver repositórios, arquivos, issues e pull requests. Escrever (abrir PR, enviar commit) entra com o Pro.",
          }),
          h("label.set-field", {}, h("span.set-field__label", { text: item.token_label }), field),
          h("p.cn__help", { text: item.token_help }),
          h(
            "a.cn__link",
            { href: item.token_url, target: "_blank", rel: "noopener noreferrer" },
            "Criar o token no GitHub",
          ),
          error,
          h("div.cn__actions", {}, submit),
          h("p.cn__safe", {
            text: "O token vai direto para o servidor do KAZER, que o guarda só para falar com o GitHub por você. Ele não volta para esta tela.",
          }),
        );
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const token = field.value.trim();
          if (!token) {
            error.hidden = false;
            error.textContent = "Cole o token primeiro.";
            field.focus();
            return;
          }
          submit.disabled = true;
          submit.textContent = "Conferindo…";
          error.hidden = true;
          const result = await request("/api/connections", {
            method: "POST",
            body: { connector_id: item.id, token },
          });
          // O campo não guarda a credencial além do necessário.
          field.value = "";
          if (!result.ok) {
            submit.disabled = false;
            submit.textContent = "Conectar";
            error.hidden = false;
            error.textContent = message(result.data);
            field.focus();
            return;
          }
          handle.close();
          toast(`${item.name} conectado.`);
          load();
        });
        window.setTimeout(() => field.focus(), 120);
        return form;
      },
    });
  }

  // ---------- Gerenciar ----------

  function manage(item) {
    openSheet({
      title: item.name,
      content: (handle) => {
        const toggle = h("input.switch__input", {
          type: "checkbox",
          role: "switch",
          id: `cn-on-${item.id}`,
          checked: item.enabled,
          "aria-label": `Usar ${item.name} nas conversas`,
        });
        toggle.addEventListener("change", async () => {
          const result = await request(`/api/connections/${item.connection_id}`, {
            method: "POST",
            body: { enabled: toggle.checked },
          });
          if (!result.ok) {
            toggle.checked = !toggle.checked;
            toast(message(result.data));
            return;
          }
          load();
        });
        const tools = Array.isArray(item.tools) ? item.tools : [];
        const shown = item.can_write ? tools : tools.filter((tool) => tool.read_only === true);
        const remove = h(
          "button.pill-button.cn__remove",
          {
            type: "button",
            onclick: async () => {
              const ok = await confirmDialog({
                title: `Desconectar o ${item.name}?`,
                body: "O KAZER apaga o token guardado e para de usar o serviço. Você pode conectar de novo quando quiser.",
                confirm: "Desconectar",
                danger: true,
              });
              if (!ok) return;
              const result = await request(`/api/connections/${item.connection_id}`, { method: "DELETE" });
              if (!result.ok) {
                toast(message(result.data));
                return;
              }
              handle.close();
              toast(`${item.name} desconectado.`);
              load();
            },
          },
          "Desconectar",
        );
        return h(
          "div.cn__manage",
          {},
          h(
            "label.pick-group.pick-row.pick-row--switch",
            { for: `cn-on-${item.id}` },
            h(
              "span.pick-row__text",
              {},
              h("span.pick-row__title", { text: "Usar nas conversas" }),
              h("span.pick-row__desc", { text: "Desligado, as ferramentas deste serviço não vão ao modelo." }),
            ),
            h("span.switch", {}, toggle, h("span.switch__track", { "aria-hidden": "true" }, h("span.switch__thumb"))),
          ),
          h("p.cn__lead", {
            text: item.can_write
              ? "Leitura e escrita liberadas pelo seu plano."
              : "Somente leitura: o KAZER vê, mas não altera nada no GitHub. Escrever entra com o Pro.",
          }),
          shown.length
            ? h(
                "ul.cn__tools",
                {},
                shown.map((tool) => h("li", {}, h("strong", { text: tool.name }), tool.description ? h("span", { text: ` — ${tool.description}` }) : null)),
              )
            : null,
          h("div.cn__actions", {}, remove),
        );
      },
    });
  }

  load();
  return { root, reload: load };
}
