/* Computer Kazer UI shell. Intentionally presentation-only: no API or external actions. */
(() => {
  "use strict";
  const trigger = document.getElementById("historyComputerAction");
  const screen = document.getElementById("computerKazerScreen");
  const app = document.getElementById("app");
  if (!trigger || !screen || !app) return;

  const welcome = document.getElementById("computerWelcomeView");
  const operational = document.getElementById("computerOperationalView");
  const introTitle = document.getElementById("computerWelcomeTitle");
  let firstUseKey = "kazer.computerKazer.introSeen.v1:guest";
  const menu = document.getElementById("computerMenu");
  const menuButton = document.getElementById("computerMenuButton");
  const confirmation = document.getElementById("computerConfirmation");
  const toast = document.getElementById("computerToast");
  let toastTimer = 0;
  let isPaused = false;
  let wasOpened = false;

  const hasSeenIntro = () => {
    try { return window.localStorage.getItem(firstUseKey) === "true"; }
    catch (_) { return wasOpened; }
  };
  const markIntroSeen = () => {
    wasOpened = true;
    try { window.localStorage.setItem(firstUseKey, "true"); } catch (_) { /* Keep this session usable if storage is blocked. */ }
  };
  const focusFirst = (scope) => window.requestAnimationFrame(() => {
    const first = scope?.querySelector('button:not([disabled]), input:not([disabled])');
    first?.focus();
  });
  const closeMenu = () => {
    menu.hidden = true;
    menuButton?.setAttribute("aria-expanded", "false");
  };
  const openMode = () => {
    const showIntro = !hasSeenIntro();
    welcome.hidden = !showIntro;
    operational.hidden = showIntro;
    screen.hidden = false;
    screen.setAttribute("aria-labelledby", showIntro ? introTitle.id : "computerOperationalTitle");
    app.setAttribute("aria-hidden", "true");
    app.inert = true;
    document.body.classList.add("computer-mode-open");
    closeMenu();
    if (showIntro) focusFirst(welcome);
    else focusFirst(operational);
  };
  const closeMode = () => {
    confirmation.hidden = true;
    closeMenu();
    screen.hidden = true;
    app.removeAttribute("aria-hidden");
    app.inert = false;
    document.body.classList.remove("computer-mode-open");
    trigger.focus();
  };
  const showToast = (message) => {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3600);
  };
  const showConfirmationPreview = () => {
    closeMenu();
    confirmation.hidden = false;
    focusFirst(confirmation);
  };
  const closeConfirmation = (announce = false) => {
    confirmation.hidden = true;
    focusFirst(operational);
    if (announce) showToast("Prévia visual: nenhum formulário foi enviado.");
  };
  const togglePause = () => {
    isPaused = !isPaused;
    const state = isPaused ? "Demonstração pausada" : "Executando tarefa · demonstração";
    const copy = isPaused ? "Demonstração pausada" : "Comparando configurações e preços...";
    document.getElementById("computerHeaderState").textContent = state;
    document.getElementById("computerStatusText").textContent = copy;
    document.getElementById("computerStatusStep").textContent = isPaused ? "Prévia pausada · nenhum agente em execução" : "Etapa 3 de 4 · demonstração";
    document.getElementById("computerPauseWide").querySelector("span").textContent = isPaused ? "Retomar demonstração" : "Pausar demonstração";
    const icon = isPaused
      ? '<path d="m9 6 9 6-9 6V6Z" fill="currentColor" stroke="none"/>'
      : '<rect x="7" y="6" width="3.6" height="12" rx="1"/><rect x="13.4" y="6" width="3.6" height="12" rx="1"/>';
    document.getElementById("computerPauseRound").innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${icon}</svg>`;
    document.getElementById("computerPauseRound").setAttribute("aria-label", isPaused ? "Retomar demonstração" : "Pausar demonstração");
  };

  trigger.classList.add("computer-shortcut");
  trigger.setAttribute("aria-label", "Modo Computer Kazer");
  trigger.querySelector("strong")?.replaceChildren(document.createTextNode("Modo Computer"));
  document.addEventListener("kazer:computer-open", (event) => {
    firstUseKey = `kazer.computerKazer.introSeen.v1:${event.detail?.userId || "guest"}`;
    wasOpened = false;
    openMode();
  });
  document.getElementById("computerWelcomeBack").addEventListener("click", closeMode);
  document.getElementById("computerNotNow").addEventListener("click", closeMode);
  document.getElementById("computerOperationalBack").addEventListener("click", closeMode);
  document.getElementById("computerCloseMenu").addEventListener("click", closeMode);
  document.getElementById("computerStartButton").addEventListener("click", () => {
    markIntroSeen();
    welcome.hidden = true;
    operational.hidden = false;
    screen.setAttribute("aria-labelledby", "computerOperationalTitle");
    focusFirst(operational);
  });
  menuButton.addEventListener("click", () => {
    const isOpen = menu.hidden;
    menu.hidden = !isOpen;
    menuButton.setAttribute("aria-expanded", String(isOpen));
  });
  document.getElementById("computerShowConfirmation").addEventListener("click", showConfirmationPreview);
  document.getElementById("computerPauseRound").addEventListener("click", togglePause);
  document.getElementById("computerPauseWide").addEventListener("click", togglePause);
  document.getElementById("computerDetailsButton").addEventListener("click", (event) => {
    const details = document.getElementById("computerDetails");
    details.hidden = !details.hidden;
    event.currentTarget.setAttribute("aria-expanded", String(!details.hidden));
  });
  document.getElementById("computerInstructionForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("computerInstructionInput");
    if (input.value.trim()) {
      showToast("Prévia visual: a instrução não foi enviada nem executada.");
      input.value = "";
    } else {
      input.focus();
    }
  });
  document.getElementById("computerReviewButton").addEventListener("click", () => closeConfirmation());
  document.getElementById("computerConfirmButton").addEventListener("click", () => closeConfirmation(true));
  confirmation.addEventListener("click", (event) => {
    if (event.target === confirmation) closeConfirmation();
  });
  screen.addEventListener("click", (event) => {
    if (!menu.hidden && event.target !== menuButton && !menu.contains(event.target)) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (screen.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (!confirmation.hidden) closeConfirmation();
      else if (!menu.hidden) closeMenu();
      else closeMode();
      return;
    }
    if (event.key !== "Tab") return;
    const scope = !confirmation.hidden ? confirmation : (!welcome.hidden ? welcome : operational);
    const nodes = [...scope.querySelectorAll('button:not([disabled]), input:not([disabled])')].filter((node) => !node.closest("[hidden]"));
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  const clock = document.getElementById("computerClock");
  const updateClock = () => {
    try { clock.textContent = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()); }
    catch (_) { /* Keep the discreet visual fallback. */ }
  };
  updateClock();
  window.setInterval(updateClock, 60000);
})();
