/*
 * KAZER — Copyright © 2026 Jean V. / @jeanvicen · 0neajx · KLYPZA.
 * Nota informativa do console; não é um mecanismo de controle de acesso.
 */
(() => {
  if (typeof window === "undefined" || typeof window.console?.info !== "function") return;

  window.console.info(
    "%cKAZER · Achou, né? 😄",
    "color: #d6b25e; font-size: 15px; font-weight: 700;",
  );
  window.console.info(
    "Inspecionar o site é normal. Não cole códigos desconhecidos no console nem compartilhe tokens: isso pode expor sua conta. Segredos privados do servidor não devem aparecer no navegador.",
  );
})();
