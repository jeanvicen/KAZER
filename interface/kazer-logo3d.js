/*
 * KAZER — logo 3D do alien (camadas SVG com profundidade em CSS 3D).
 * Usado no chat, no login e nos documentos. Inclinação segue o ponteiro.
 */
(() => {
  "use strict";
  if (window.kazerCreateLogo3D) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  /* ── Logo 3D ───────────────────────────────────────────────────────── */
  let logoCount = 0;
  function alienSvg(uid) {
    return `<svg viewBox="0 0 240 240" aria-hidden="true"><defs><linearGradient id="kzs${uid}" x1="0" y1="0" x2=".4" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e9ecec"/><stop offset="1" stop-color="#c3cacb"/></linearGradient><linearGradient id="kzp${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f7f7"/><stop offset="1" stop-color="#b7bfc0"/></linearGradient></defs><g stroke="#9BA8AB" stroke-opacity=".5" stroke-width="1.2"><path fill="url(#kzs${uid})" d="M120 14C166 14 197 46 197 90C197 132 162 162 120 170C78 162 43 132 43 90C43 46 74 14 120 14Z"/><path fill="url(#kzp${uid})" d="M14 150C40 151 64 157 80 168C86 178 88 190 86 201C64 196 38 192 16 190C12 176 12 162 14 150Z"/><path fill="url(#kzp${uid})" d="M226 150C200 151 176 157 160 168C154 178 152 190 154 201C176 196 202 192 224 190C228 176 228 162 226 150Z"/><path fill="url(#kzp${uid})" d="M70 196C102 212 138 212 170 196L172 214C140 232 100 232 68 214Z"/></g><path class="kz-eye" fill="#06141B" d="M60 94C80 84 106 100 111 128C90 131 64 120 60 94Z"/><path class="kz-eye" fill="#06141B" d="M180 94C160 84 134 100 129 128C150 131 176 120 180 94Z"/></svg>`;
  }

  function createLogo3D({ size, depth = 7, className = "" } = {}) {
    const uid = ++logoCount;
    const root = document.createElement("span");
    root.className = `kz-logo3d ${className}`.trim();
    if (size) root.style.setProperty("--size", typeof size === "number" ? `${size}px` : size);
    const layers = [];
    for (let index = depth; index >= 1; index -= 1) layers.push(`<span class="kz-logo3d-layer is-depth" style="--z:${-index * 1.6}">${alienSvg(`${uid}d${index}`)}</span>`);
    root.innerHTML = `<span class="kz-logo3d-glow"></span><span class="kz-logo3d-shadow"></span><span class="kz-logo3d-stage">${layers.join("")}<span class="kz-logo3d-layer" style="--z:0">${alienSvg(uid)}</span></span>`;
    return root;
  }
  window.kazerCreateLogo3D = createLogo3D;
  document.querySelectorAll("[data-kz-logo3d]").forEach((slot) => {
    slot.replaceChildren(createLogo3D({ size: slot.dataset.size ? Number(slot.dataset.size) : undefined, depth: slot.dataset.depth ? Number(slot.dataset.depth) : undefined, className: slot.dataset.class || "" }));
  });

  // Inclinação 3D seguindo o ponteiro (um único listener para todos os logos).
  if (!reduceMotion) {
    let frame = 0;
    let pointer = null;
    window.addEventListener("pointermove", (event) => {
      pointer = event;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        document.querySelectorAll(".kz-logo3d:not(.is-thinking)").forEach((logo) => {
          const rect = logo.getBoundingClientRect();
          if (!rect.width) return;
          const dx = (pointer.clientX - (rect.left + rect.width / 2)) / window.innerWidth;
          const dy = (pointer.clientY - (rect.top + rect.height / 2)) / window.innerHeight;
          logo.style.setProperty("--ry", `${Math.max(-28, Math.min(28, dx * 60))}deg`);
          logo.style.setProperty("--rx", `${Math.max(-22, Math.min(22, -dy * 50))}deg`);
        });
      });
    }, { passive: true });
  }

})();
