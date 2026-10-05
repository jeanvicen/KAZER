/* KAZER — camada visual do login: emblema 3D, partículas douradas, inclinação e CTA.
   Não altera IDs, formulários nem chamadas do Supabase. */
(() => {
  "use strict";
  const doc = document;
  const root = doc.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const BADGE = "../download/assets/kazer-badge.svg?v=20261005";

  root.classList.add("kz-fx");

  /* ── Emblema 3D (moeda com espessura real em CSS 3D) ── */
  const makeCoin = (variant) => {
    const coin = doc.createElement("div");
    coin.className = "kz-coin kz-coin--" + variant;
    coin.setAttribute("aria-hidden", "true");
    const tilt = doc.createElement("div");
    tilt.className = "kz-coin-tilt";
    const spin = doc.createElement("div");
    spin.className = "kz-coin-spin";
    const LAYERS = 9;
    for (let i = 0; i < LAYERS; i += 1) {
      const edge = doc.createElement("span");
      edge.className = "kz-coin-edge";
      edge.style.setProperty("--z", (i - (LAYERS - 1) / 2).toFixed(1));
      spin.appendChild(edge);
    }
    const front = doc.createElement("span");
    front.className = "kz-coin-face kz-coin-front";
    const back = doc.createElement("span");
    back.className = "kz-coin-face kz-coin-back";
    [front, back].forEach((face) => {
      const img = doc.createElement("img");
      img.src = BADGE;
      img.alt = "";
      img.decoding = "async";
      img.draggable = false;
      face.appendChild(img);
    });
    const glare = doc.createElement("span");
    glare.className = "kz-coin-glare";
    front.appendChild(glare);
    spin.append(front, back);
    tilt.appendChild(spin);
    const shadow = doc.createElement("span");
    shadow.className = "kz-coin-shadow";
    coin.append(tilt, shadow);
    return coin;
  };

  const mountCoin = (img, variant) => {
    if (!img || img.dataset.kzCoin) return null;
    img.dataset.kzCoin = "1";
    img.classList.add("kz-coin-source");
    const coin = makeCoin(variant);
    img.insertAdjacentElement("beforebegin", coin);
    return coin;
  };

  const coins = [];
  coins.push(mountCoin(doc.querySelector(".brand-top img"), "top"));
  coins.push(mountCoin(doc.querySelector(".intro-mark"), "intro"));
  coins.push(mountCoin(doc.querySelector(".return-logo"), "return"));
  coins.push(mountCoin(doc.querySelector(".transition-core img"), "transition"));

  const panelBody = doc.querySelector(".brand-panel-body");
  if (panelBody) {
    const hero = doc.createElement("div");
    hero.className = "kz-hero";
    hero.setAttribute("aria-hidden", "true");
    ["kz-orbit kz-orbit--a", "kz-orbit kz-orbit--b", "kz-orbit kz-orbit--c"].forEach((cls) => {
      const ring = doc.createElement("span");
      ring.className = cls;
      const dot = doc.createElement("i");
      ring.appendChild(dot);
      hero.appendChild(ring);
    });
    const coin = makeCoin("hero");
    hero.appendChild(coin);
    coins.push(coin);
    panelBody.insertAdjacentElement("afterbegin", hero);
  }

  /* Toque/clique no emblema: giro completo */
  coins.filter(Boolean).forEach((coin) => {
    const spinOnce = () => {
      if (reduced) return;
      coin.classList.remove("is-flip");
      void coin.offsetWidth;
      coin.classList.add("is-flip");
    };
    coin.addEventListener("click", spinOnce);
    coin.addEventListener("animationend", (event) => {
      if (event.animationName === "kz-coin-flip") coin.classList.remove("is-flip");
    });
  });

  /* ── Inclinação por ponteiro / giroscópio ── */
  const card = doc.querySelector(".card");
  let targetX = 0, targetY = 0, curX = 0, curY = 0, rafTilt = 0;
  const applyTilt = () => {
    curX += (targetX - curX) * 0.08;
    curY += (targetY - curY) * 0.08;
    root.style.setProperty("--kz-tx", curX.toFixed(4));
    root.style.setProperty("--kz-ty", curY.toFixed(4));
    if (Math.abs(targetX - curX) > 0.001 || Math.abs(targetY - curY) > 0.001) {
      rafTilt = window.requestAnimationFrame(applyTilt);
    } else {
      rafTilt = 0;
    }
  };
  const setTarget = (x, y) => {
    targetX = Math.max(-1, Math.min(1, x));
    targetY = Math.max(-1, Math.min(1, y));
    if (!rafTilt) rafTilt = window.requestAnimationFrame(applyTilt);
  };
  if (!reduced) {
    if (!coarse) {
      window.addEventListener("pointermove", (event) => {
        setTarget((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * 2 - 1);
      }, { passive: true });
      doc.addEventListener("pointerleave", () => setTarget(0, 0));
      if (card) {
        card.addEventListener("pointermove", (event) => {
          const r = card.getBoundingClientRect();
          card.style.setProperty("--kz-mx", ((event.clientX - r.left) / r.width * 100).toFixed(1) + "%");
          card.style.setProperty("--kz-my", ((event.clientY - r.top) / r.height * 100).toFixed(1) + "%");
        }, { passive: true });
      }
    } else if ("DeviceOrientationEvent" in window && typeof DeviceOrientationEvent.requestPermission !== "function") {
      window.addEventListener("deviceorientation", (event) => {
        if (event.gamma == null || event.beta == null) return;
        setTarget(event.gamma / 30, (event.beta - 45) / 40);
      }, { passive: true });
    }
  }

  /* ── Partículas douradas ── */
  const canvas = doc.createElement("canvas");
  canvas.className = "kz-dust";
  canvas.setAttribute("aria-hidden", "true");
  doc.body.prepend(canvas);
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1, parts = [], rafDust = 0, running = false;
  const COUNT = () => (window.innerWidth < 700 ? 34 : 70);
  const resize = () => {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const n = COUNT();
    while (parts.length < n) parts.push(spawn(true));
    parts.length = n;
  };
  const spawn = (anywhere) => ({
    x: Math.random() * W,
    y: anywhere ? Math.random() * H : H + 10,
    r: Math.random() * 1.5 + 0.35,
    z: Math.random() * 0.8 + 0.2,
    vy: -(Math.random() * 0.22 + 0.06),
    vx: (Math.random() - 0.5) * 0.08,
    a: Math.random() * 0.55 + 0.15,
    p: Math.random() * Math.PI * 2,
  });
  const draw = (t) => {
    ctx.clearRect(0, 0, W, H);
    const ox = curX * 18, oy = curY * 12;
    for (const s of parts) {
      s.y += s.vy * (1 + s.z);
      s.x += s.vx + Math.sin(t / 2400 + s.p) * 0.06;
      if (s.y < -10) Object.assign(s, spawn(false));
      const tw = 0.55 + 0.45 * Math.sin(t / 900 + s.p);
      const x = s.x + ox * s.z, y = s.y + oy * s.z;
      ctx.globalAlpha = s.a * tw;
      ctx.fillStyle = s.z > 0.75 ? "#fff1c4" : "#d6b25e";
      ctx.beginPath();
      ctx.arc(x, y, s.r * (0.6 + s.z), 0, Math.PI * 2);
      ctx.fill();
      if (s.z > 0.82) {
        ctx.globalAlpha = s.a * tw * 0.18;
        ctx.beginPath();
        ctx.arc(x, y, s.r * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (running) rafDust = window.requestAnimationFrame(draw);
  };
  const start = () => { if (reduced || running) return; running = true; rafDust = window.requestAnimationFrame(draw); };
  const stop = () => { running = false; window.cancelAnimationFrame(rafDust); };
  resize();
  window.addEventListener("resize", resize, { passive: true });
  doc.addEventListener("visibilitychange", () => (doc.hidden ? stop() : start()));
  if (reduced) { draw(0); } else { start(); }

  /* ── CTA: brilho que segue o toque + onda ao clicar ── */
  doc.querySelectorAll(".submit-btn, .return-primary").forEach((btn) => {
    btn.addEventListener("pointerdown", (event) => {
      if (reduced || btn.disabled) return;
      const r = btn.getBoundingClientRect();
      const wave = doc.createElement("span");
      wave.className = "kz-wave";
      const size = Math.max(r.width, r.height) * 1.4;
      wave.style.width = wave.style.height = size + "px";
      wave.style.left = event.clientX - r.left - size / 2 + "px";
      wave.style.top = event.clientY - r.top - size / 2 + "px";
      btn.appendChild(wave);
      window.setTimeout(() => wave.remove(), 700);
    });
  });

  /* ── Entrada escalonada a cada troca de formulário ── */
  const sections = doc.querySelectorAll(".form-section");
  const replay = (section) => {
    section.classList.remove("kz-stagger");
    void section.offsetWidth;
    section.classList.add("kz-stagger");
  };
  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      const el = record.target;
      if (el.classList.contains("active") && !(record.oldValue || "").includes("active")) replay(el);
    });
  });
  sections.forEach((section) => {
    observer.observe(section, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    if (section.classList.contains("active")) replay(section);
  });

  /* Campo preenchido → selo do botão acende */
  doc.querySelectorAll("form").forEach((form) => {
    const btn = form.querySelector(".submit-btn");
    if (!btn) return;
    const check = () => {
      const inputs = [...form.querySelectorAll("input[required], input[type=email], input[type=password]")];
      const ready = inputs.length > 0 && inputs.every((input) => input.value.trim().length > 0);
      btn.classList.toggle("kz-ready", ready);
    };
    form.addEventListener("input", check);
    check();
  });
})();
