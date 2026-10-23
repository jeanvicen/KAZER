/*
 * KAZER Nova — movimento extra do login: constelação que reage ao ponteiro,
 * aurora, anéis orbitais em 3D com chips, título com verbos que se alternam
 * e seletor Entrar/Criar conta deslizante. Não toca em IDs nem no Supabase.
 */
(() => {
  "use strict";
  const doc = document;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Aurora + constelação */
  const aurora = doc.createElement("div");
  aurora.className = "kz-aurora";
  aurora.setAttribute("aria-hidden", "true");
  aurora.innerHTML = "<i></i><i></i><i></i>";
  doc.body.prepend(aurora);

  const canvas = doc.createElement("canvas");
  canvas.className = "kz-constellation";
  canvas.setAttribute("aria-hidden", "true");
  doc.body.prepend(canvas);
  const ctx = canvas.getContext("2d");
  let points = [];
  const pointer = { x: -9999, y: -9999 };
  const resize = () => {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = innerWidth * ratio;
    canvas.height = innerHeight * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.round(Math.min(110, (innerWidth * innerHeight) / 16000));
    points = Array.from({ length: count }, () => ({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, vx: (Math.random() - .5) * .25, vy: (Math.random() - .5) * .25, r: Math.random() * 1.4 + .4 }));
  };
  resize();
  addEventListener("resize", resize);
  addEventListener("pointermove", (event) => { pointer.x = event.clientX; pointer.y = event.clientY; }, { passive: true });
  const draw = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of points) {
      if (!reduced) { p.x += p.vx; p.y += p.vy; }
      if (p.x < 0 || p.x > innerWidth) p.vx *= -1;
      if (p.y < 0 || p.y > innerHeight) p.vy *= -1;
      const dx = pointer.x - p.x;
      const dy = pointer.y - p.y;
      const near = Math.hypot(dx, dy);
      if (near < 140 && !reduced) { p.x -= dx * .004; p.y -= dy * .004; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(204,208,207,${near < 160 ? .9 : .45})`;
      ctx.fill();
    }
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i];
        const b = points[j];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance < 120) {
          const lit = Math.hypot(pointer.x - a.x, pointer.y - a.y) < 180;
          ctx.strokeStyle = `rgba(155,168,171,${(1 - distance / 120) * (lit ? .45 : .14)})`;
          ctx.lineWidth = lit ? .9 : .6;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    if (!reduced) requestAnimationFrame(draw);
  };
  draw();

  /* Anéis orbitais com chips em volta do alien */
  const mountOrbit = () => {
    const hero = doc.querySelector(".brand-panel .kz-hero");
    if (!hero || hero.querySelector(".kz-orbit3d")) return false;
    const orbit = doc.createElement("div");
    orbit.className = "kz-orbit3d";
    orbit.setAttribute("aria-hidden", "true");
    orbit.innerHTML = `<span class="kz-ring kz-ring--a"></span><span class="kz-ring kz-ring--b"></span>
      <span class="kz-chip3d" style="--i:0">Pesquisa a fundo</span>
      <span class="kz-chip3d" style="--i:1">Computer</span>
      <span class="kz-chip3d" style="--i:2">Engine</span>
      <span class="kz-chip3d" style="--i:3">Flame API</span>`;
    hero.append(orbit);
    return true;
  };
  if (!mountOrbit()) window.setTimeout(mountOrbit, 300);

  /* Título com verbos alternando */
  const title = doc.querySelector(".brand-panel-title");
  if (title) {
    const verbs = ["Pergunte.", "Pesquise.", "Execute.", "Crie."];
    title.innerHTML = `<span class="kz-verb" aria-live="off">${verbs[0]}</span><br /><em>O KAZER faz.</em>`;
    title.setAttribute("aria-label", "Pergunte, pesquise, execute, crie. O KAZER faz.");
    const verb = title.querySelector(".kz-verb");
    let index = 0;
    if (!reduced) window.setInterval(() => {
      index = (index + 1) % verbs.length;
      verb.classList.add("is-out");
      window.setTimeout(() => { verb.textContent = verbs[index]; verb.classList.remove("is-out"); verb.classList.add("is-in"); window.setTimeout(() => verb.classList.remove("is-in"), 600); }, 320);
    }, 2600);
  }

  /* Seletor Entrar / Criar conta */
  const card = doc.getElementById("authContainer");
  const goLogin = doc.getElementById("goToLogin");
  const goSignup = doc.getElementById("goToSignup");
  if (card && goLogin && goSignup) {
    const tabs = doc.createElement("div");
    tabs.className = "kz-auth-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.innerHTML = `<span class="kz-auth-pill" aria-hidden="true"></span><button type="button" role="tab" data-auth="login">Entrar</button><button type="button" role="tab" data-auth="signup">Criar conta</button>`;
    card.prepend(tabs);
    const sync = () => {
      const signup = !doc.getElementById("signupForm")?.classList.contains("hidden");
      const recovery = !doc.getElementById("recoveryForm")?.classList.contains("hidden") || !doc.getElementById("newPasswordForm")?.classList.contains("hidden");
      tabs.hidden = recovery;
      tabs.dataset.active = signup ? "signup" : "login";
      tabs.querySelectorAll("[data-auth]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.auth === tabs.dataset.active)));
    };
    tabs.addEventListener("click", (event) => {
      const target = event.target.closest("[data-auth]");
      if (!target || target.dataset.auth === tabs.dataset.active) return;
      (target.dataset.auth === "signup" ? goSignup : goLogin).click();
    });
    new MutationObserver(sync).observe(card, { subtree: true, attributes: true, attributeFilter: ["class"] });
    sync();
  }

  /* Botão principal: brilho segue o ponteiro */
  doc.querySelectorAll(".submit-btn").forEach((button) => {
    button.addEventListener("pointermove", (event) => {
      const rect = button.getBoundingClientRect();
      button.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      button.style.setProperty("--my", `${event.clientY - rect.top}px`);
    });
  });
})();
