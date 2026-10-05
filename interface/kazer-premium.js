/*
 * KAZER — Obsidian & Gold: microinterações aditivas.
 * Copyright © 2026 Jean V. / @jeanvicen · KLYPZA. Código proprietário.
 *
 * Apenas adiciona atalhos visuais ao estado vazio. Não envia mensagens,
 * não chama APIs e não altera o Supabase: só preenche o campo existente.
 */
(() => {
  "use strict";
  const dock = document.querySelector(".composer-dock");
  const input = document.getElementById("messageInput");
  if (!dock || !input || dock.querySelector(".kz-suggestions")) return;

  const icon = (path) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + "</svg>";
  const suggestions = [
    { label: "Planejar meu dia", prompt: "Me ajude a organizar meu dia com prioridades claras.", icon: icon('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>') },
    { label: "Escrever um texto", prompt: "Escreva um texto curto e profissional sobre ", icon: icon('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>') },
    { label: "Explicar um tema", prompt: "Explique de forma simples, com exemplos: ", icon: icon('<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8h.01"/>') },
    { label: "Criar código", prompt: "Crie um código limpo e comentado para ", icon: icon('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>') },
  ];

  const wrap = document.createElement("div");
  wrap.className = "kz-suggestions";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Sugestões para começar");
  suggestions.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kz-suggestion";
    button.innerHTML = item.icon + "<span></span>";
    button.querySelector("span").textContent = item.label;
    button.addEventListener("click", () => {
      input.value = item.prompt;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
    });
    wrap.appendChild(button);
  });
  dock.appendChild(wrap);
  dock.style.flexDirection = "column";
  dock.style.alignItems = "center";
})();
