// Tela "sem internet" do KAZER: o Kazinho, um personagem em pixel com a cabeça
// da Fenda (as duas metades do símbolo, com um olhinho em cada), vive a vida
// enquanto a rede não volta: varre a casa, cochila, brinca de bola, treina e
// mostra o muque. Tudo desenhado aqui, num canvas minúsculo ampliado sem
// suavização. Para quando a tela some; respeita "reduzir movimento".

import { h, icon, mark, reducedMotion } from "./dom.js";

const W = 64;
const H = 42;
const GROUND = 34;
const MID = W / 2;

const C = {
  white: "#f5f5f5",
  half: "#c4c4c4",
  eye: "#070707",
  hood: "#5d5d5d",
  hoodLight: "#767676",
  hoodDark: "#454545",
  leg: "#3b3b3b",
  shoe: "#e8e8e8",
  floor: "#151515",
  floorDot: "#1f1f1f",
  rug: "#121212",
  rugEdge: "#1c1c1c",
  shadow: "#0d0d0d",
  wood: "#a1724a",
  straw: "#d8b46a",
  strawDark: "#b8924e",
  dust: "#8c8c8c",
  ball: "#e0584c",
  ballLight: "#f39a8f",
  metal: "#a8a8a8",
  plate: "#6c6c6c",
  pillow: "#d9d9d9",
  blanket: "#3c4a66",
  blanketLight: "#4d5e80",
  spark: "#ffffff",
};

const ACTIVITIES = [
  ["sweep", "Enquanto isso, o KAZER dá um tapa na casa."],
  ["sleep", "Cochilando até a conexão voltar…"],
  ["ball", "Embaixadinha pra passar o tempo."],
  ["curls", "Treino de braço, que ninguém é de ferro."],
  ["flex", "Olha o muque. Internet nenhuma segura."],
];
const ACT_MS = 7200;
const POOF_MS = 420;

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function createScene(canvas, onActivity) {
  const ctx = canvas.getContext("2d");
  canvas.width = W;
  canvas.height = H;
  ctx.imageSmoothingEnabled = false;
  let raf = 0;
  let running = false;
  let start = performance.now();
  let celebrateAt = -1;
  let lastActivity = -1;
  const blinkSeed = Math.random() * 4000;

  const px = (x, y, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  };
  const rect = (x, y, w, hgt, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, hgt);
  };
  const line = (x0, y0, x1, y1, color) => {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      px(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  };

  // ---------- Partes do Kazinho ----------

  const HALF = [1, 2, 3, 4, 4, 4, 3, 2, 1]; // largura de cada linha de uma metade

  // Cabeça: metade esquerda branca, direita cinza-claro e um pixel mais baixa (como a Fenda).
  function head(cx, top, { blink = false, look = 0, closed = false, happy = false } = {}) {
    HALF.forEach((width, row) => {
      rect(cx - width, top + row, width, 1, C.white);
      rect(cx + 1, top + 1 + row, width, 1, C.half);
    });
    if (closed) {
      rect(cx - 3, top + 5, 2, 1, C.eye);
      rect(cx + 2, top + 6, 2, 1, C.eye);
      return;
    }
    if (happy) {
      // olhinhos em "^"
      px(cx - 3 + look, top + 4, C.eye);
      px(cx - 2 + look, top + 3, C.eye);
      px(cx - 1 + look, top + 4, C.eye);
      px(cx + 1 + look, top + 5, C.eye);
      px(cx + 2 + look, top + 4, C.eye);
      px(cx + 3 + look, top + 5, C.eye);
      return;
    }
    if (blink) {
      rect(cx - 3 + look, top + 4, 2, 1, C.eye);
      rect(cx + 2 + look, top + 5, 2, 1, C.eye);
      return;
    }
    rect(cx - 2 + look, top + 3, 1, 2, C.eye);
    rect(cx + 2 + look, top + 4, 1, 2, C.eye);
  }

  function body(cx, ground, { legs = 0 } = {}) {
    // pernas (passinho opcional) e tênis
    const lift = legs ? (legs > 0 ? [1, 0] : [0, 1]) : [0, 0];
    rect(cx - 3, ground - 3 - lift[0], 2, 3, C.leg);
    rect(cx + 1, ground - 3 - lift[1], 2, 3, C.leg);
    rect(cx - 4, ground - 1 - lift[0], 3, 1, C.shoe);
    rect(cx + 1, ground - 1 - lift[1], 3, 1, C.shoe);
    // moletom com luz à esquerda, sombra embaixo e a Fenda no peito
    rect(cx - 3, ground - 9, 7, 6, C.hood);
    rect(cx - 3, ground - 9, 1, 5, C.hoodLight);
    rect(cx - 3, ground - 4, 7, 1, C.hoodDark);
    px(cx - 1, ground - 7, C.white);
    px(cx + 1, ground - 6, C.half);
  }

  function arm(sx, sy, hx, hy) {
    line(sx, sy, hx, hy, C.hood);
    rect(hx - (hx < sx ? 1 : 0), hy, 2, 2, C.white);
  }

  function blinking(t) {
    return (t + blinkSeed) % 3600 < 130;
  }

  function shadow(cx, width = 11) {
    rect(cx - Math.floor(width / 2), GROUND, width, 1, C.shadow);
  }

  // ---------- Cenário ----------

  function room() {
    ctx.clearRect(0, 0, W, H);
    // chão pontilhado que some nas bordas
    for (let x = 4; x < W - 4; x += 1) {
      const edge = Math.min(x - 4, W - 5 - x);
      if (edge < 6 && x % 2) continue;
      px(x, GROUND + 1, edge < 3 ? C.floorDot : C.floor);
    }
    for (let x = 8; x < W - 8; x += 4) px(x + ((x / 4) % 2) * 2, GROUND + 5, C.floorDot);
    // tapetinho
    rect(MID - 15, GROUND + 2, 30, 2, C.rug);
    rect(MID - 15, GROUND + 2, 30, 1, C.rugEdge);
  }

  // ---------- Atividades ----------

  function sweep(t, local) {
    const travel = Math.sin((local / ACT_MS) * Math.PI * 2) * 8;
    const cx = Math.round(MID - 3 + travel);
    const stroke = Math.sin(local / 190);
    const bob = stroke > 0.6 ? 1 : 0;
    shadow(cx);
    body(cx, GROUND, { legs: Math.abs(Math.cos((local / ACT_MS) * Math.PI * 2)) > 0.3 ? Math.sign(stroke) : 0 });
    head(cx, GROUND - 19 + bob, { blink: blinking(t), look: stroke > 0 ? 1 : 0 });
    // vassoura: cabo na altura do peito, inclinado para o lado, cerdas no chão
    const bx = cx + 10 + Math.round(stroke * 3);
    const topX = cx + 5;
    const topY = GROUND - 11;
    line(topX, topY, bx, GROUND - 4, C.wood);
    rect(bx - 2, GROUND - 3, 5, 1, C.strawDark);
    rect(bx - 3, GROUND - 2, 7, 2, C.straw);
    arm(cx + 4, GROUND - 8, topX, topY);
    arm(cx + 4, GROUND - 7, Math.round((topX * 2 + bx) / 3) + 1, GROUND - 8);
    // poeirinha subindo e sumindo
    for (let i = 0; i < 4; i += 1) {
      const phase = ((local / 900 + i * 0.25) % 1);
      const alpha = 1 - phase;
      if (alpha < 0.25) continue;
      ctx.globalAlpha = alpha * 0.8;
      px(bx + 4 + i + phase * 6 * (i % 2 ? 1 : -0.4), GROUND - 2 - phase * 6, C.dust);
      ctx.globalAlpha = 1;
    }
  }

  function sleep(t, local) {
    const cx = MID - 6;
    const breath = Math.sin(local / 700) > 0 ? 1 : 0;
    // travesseiro, cabeça deitada e cobertor listrado subindo com a respiração
    rect(cx - 9, GROUND - 4, 9, 4, C.pillow);
    rect(cx - 9, GROUND - 1, 9, 1, "#b5b5b5");
    head(cx - 4, GROUND - 13, { closed: true });
    rect(cx + 1, GROUND - 6 - breath, 18, 6 + breath, C.blanket);
    for (let x = cx + 3; x < cx + 19; x += 4) rect(x, GROUND - 6 - breath, 2, 6 + breath, C.blanketLight);
    rect(cx + 18, GROUND - 2, 2, 2, C.shoe); // pezinho para fora
    // Z z z subindo
    for (let i = 0; i < 3; i += 1) {
      const phase = ((local / 1800 + i / 3) % 1);
      const size = i === 1 ? 5 : 4;
      const x = cx + 2 + phase * 12;
      const y = GROUND - 16 - phase * 14;
      ctx.globalAlpha = Math.min(1, (1 - phase) * 1.6) * (phase < 0.1 ? phase * 10 : 1);
      zed(x, y, size);
      ctx.globalAlpha = 1;
    }
  }

  function zed(x, y, size) {
    rect(x, y, size, 1, C.white);
    for (let i = 1; i < size - 1; i += 1) px(x + size - 1 - i, y + i, C.white);
    rect(x, y + size - 1, size, 1, C.white);
  }

  function ball(t, local) {
    const cx = MID - 2;
    // embaixadinha: a bola sobe e desce num arco suave; o pé acompanha
    const period = 900;
    const phase = (local % period) / period;
    const height = Math.sin(phase * Math.PI); // 0 no pé, 1 no alto
    const by = GROUND - 5 - Math.round(height * 14);
    const bx = cx + 5 + Math.round(Math.sin(local / 1400) * 1.5);
    const kicking = phase < 0.12 || phase > 0.9;
    shadow(cx);
    // corpo com uma perna que chuta
    rect(cx - 3, GROUND - 3, 2, 3, C.leg);
    rect(cx - 4, GROUND - 1, 3, 1, C.shoe);
    const footY = kicking ? GROUND - 3 : GROUND - 1;
    rect(cx + 1, footY - 2, 2, 3, C.leg);
    rect(cx + 1, footY, 4, 1, C.shoe);
    rect(cx - 3, GROUND - 9, 7, 6, C.hood);
    rect(cx - 3, GROUND - 9, 1, 5, C.hoodLight);
    rect(cx - 3, GROUND - 4, 7, 1, C.hoodDark);
    px(cx - 1, GROUND - 7, C.white);
    px(cx + 1, GROUND - 6, C.half);
    arm(cx - 3, GROUND - 8, cx - 6, GROUND - 6 - (kicking ? 2 : 0));
    arm(cx + 4, GROUND - 8, cx + 7, GROUND - 7 + (kicking ? 1 : 0));
    head(cx, GROUND - 19 + (kicking ? 1 : 0), { blink: blinking(t), look: 1 });
    // bola
    const shadowWidth = Math.max(1, 4 - Math.round(height * 3));
    rect(bx - Math.floor(shadowWidth / 2) + 1, GROUND, shadowWidth, 1, C.shadow);
    rect(bx, by, 3, 3, C.ball);
    px(bx, by, C.ballLight);
  }

  function curls(t, local) {
    const cx = MID;
    const rep = 1600;
    const phase = (local % rep) / rep;
    const lift = easeInOut(phase < 0.5 ? phase * 2 : 2 - phase * 2); // 0 embaixo, 1 em cima
    const strain = lift > 0.85;
    shadow(cx);
    body(cx, GROUND);
    head(cx, GROUND - 19 + (strain ? 1 : 0), { blink: blinking(t), happy: strain });
    const handY = Math.round(GROUND - 4 - lift * 6);
    for (const side of [-1, 1]) {
      const sx = side < 0 ? cx - 3 : cx + 3;
      const hx = sx + side * (2 - Math.round(lift));
      arm(sx + (side > 0 ? 1 : 0), GROUND - 8, hx, handY);
      // halter: barrinha com anilhas
      const dx = hx + (side > 0 ? 0 : -1);
      rect(dx - 1, handY + 1, 4, 1, C.metal);
      rect(dx - 2, handY, 1, 3, C.plate);
      rect(dx + 3, handY, 1, 3, C.plate);
    }
    // gotinha de suor e "+1" a cada repetição
    const sweat = (local % (rep * 2)) / (rep * 2);
    if (sweat > 0.4 && sweat < 0.8) px(cx + 5, GROUND - 17 + Math.round((sweat - 0.4) * 10), "#bcd3ff");
    if (phase > 0.45 && phase < 0.75) {
      ctx.globalAlpha = 1 - (phase - 0.45) / 0.3;
      plusOne(cx + 7, GROUND - 20 - Math.round((phase - 0.45) * 12));
      ctx.globalAlpha = 1;
    }
  }

  function plusOne(x, y) {
    rect(x, y + 1, 3, 1, C.white);
    rect(x + 1, y, 1, 3, C.white);
    rect(x + 4, y, 1, 3, C.white);
  }

  function flex(t, local) {
    const cx = MID;
    const pump = Math.sin(local / 420);
    const peak = pump > 0.55;
    const hop = Math.max(0, Math.sin(local / 210)) > 0.97 ? 1 : 0;
    shadow(cx, peak ? 13 : 11);
    body(cx, GROUND - hop);
    head(cx, GROUND - 19 - hop, { happy: peak, blink: !peak && blinking(t) });
    for (const side of [-1, 1]) {
      const sx = side < 0 ? cx - 3 : cx + 4;
      const elbowX = sx + side * 3;
      const elbowY = GROUND - 8 - hop;
      line(sx, GROUND - 8 - hop, elbowX, elbowY, C.hood);
      line(elbowX, elbowY, elbowX, elbowY - 4, C.hood);
      rect(elbowX - (side < 0 ? 1 : 0), elbowY - 6, 2, 2, C.white);
      // bíceps crescendo no pico
      if (peak) rect(sx + side * (side < 0 ? 2 : 1), elbowY - 2, 2, 2, C.hoodLight);
    }
    // brilhinhos em volta
    for (let i = 0; i < 4; i += 1) {
      const phase = ((local / 1300 + i / 4) % 1);
      const on = phase < 0.5;
      if (!on) continue;
      const size = phase < 0.25 ? 1 : 2;
      const x = cx + [-11, 10, -8, 12][i];
      const y = GROUND - [18, 15, 9, 22][i];
      sparkle(x, y, size);
    }
  }

  function sparkle(x, y, size) {
    px(x, y, C.spark);
    if (size > 1) {
      px(x - 1, y, "#9a9a9a");
      px(x + 1, y, "#9a9a9a");
      px(x, y - 1, "#9a9a9a");
      px(x, y + 1, "#9a9a9a");
    }
  }

  function celebrate(t, local) {
    const cx = MID;
    const jump = Math.abs(Math.sin(local / 230)) * 6;
    shadow(cx, Math.round(11 - jump));
    body(cx, GROUND - Math.round(jump));
    head(cx, GROUND - 19 - Math.round(jump), { happy: true });
    arm(cx - 3, GROUND - 8 - jump, cx - 6, GROUND - 15 - jump);
    arm(cx + 4, GROUND - 8 - jump, cx + 7, GROUND - 15 - jump);
    for (let i = 0; i < 6; i += 1) sparkle(cx + Math.cos(i + local / 300) * 14, GROUND - 14 + Math.sin(i * 2 + local / 300) * 9, (i + Math.floor(local / 200)) % 2 + 1);
  }

  function poof(local, cx, cy) {
    const p = local / POOF_MS;
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2;
      const r = 3 + p * 10;
      ctx.globalAlpha = 1 - p;
      rect(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r * 0.7, p < 0.5 ? 2 : 1, p < 0.5 ? 2 : 1, i % 2 ? C.white : C.dust);
    }
    ctx.globalAlpha = 1;
  }

  const DRAW = { sweep, sleep, ball, curls, flex };

  function frame(now) {
    if (!running) return;
    raf = window.requestAnimationFrame(frame);
    // O carimbo do quadro pode vir um pouco antes do `play()`: nunca negativo.
    const t = Math.max(0, now - start);
    room();
    if (celebrateAt >= 0) {
      celebrate(t, Math.max(0, now - celebrateAt));
      return;
    }
    const index = Math.floor(t / ACT_MS) % ACTIVITIES.length;
    const local = t % ACT_MS;
    if (index !== lastActivity) {
      lastActivity = index;
      onActivity(ACTIVITIES[index][1]);
    }
    DRAW[ACTIVITIES[index][0]](t, local);
    // troca de atividade com um "puf" de fumacinha
    if (local < POOF_MS && t > POOF_MS) poof(local, MID, GROUND - 10);
  }

  return {
    play() {
      if (running) return;
      running = true;
      celebrateAt = -1;
      start = performance.now();
      lastActivity = -1;
      if (reducedMotion()) {
        // Quadro único e calmo: o Kazinho cochilando.
        running = false;
        room();
        sleep(0, 600);
        onActivity(ACTIVITIES[1][1]);
        return;
      }
      raf = window.requestAnimationFrame(frame);
    },
    celebrate() {
      if (reducedMotion()) {
        room();
        celebrate(0, 0);
        return;
      }
      celebrateAt = performance.now();
      if (!running) {
        running = true;
        raf = window.requestAnimationFrame(frame);
      }
    },
    stop() {
      running = false;
      window.cancelAnimationFrame(raf);
    },
  };
}

// ---------- Tela ----------

export function createOfflineScreen({ onRetry }) {
  const canvas = h("canvas.offline__scene", { "aria-hidden": "true" });
  const caption = h("p.offline__caption", { "aria-hidden": "true" });
  const title = h("h2.offline__title", { id: "offline-title", tabindex: "-1", text: "Ops, parece que tamo sem internet, fi." });
  const text = h("p.offline__text", {
    id: "offline-text",
    text: "Quando a conexão voltar, tudo continua de onde parou. O que você estava escrevendo fica guardado.",
  });
  const status = h("p.offline__status", { role: "status" });
  const retry = h("button.offline__retry", { type: "button" }, icon("retry"), h("span", { text: "Tentar agora" }));
  const minimize = h("button.offline__later", { type: "button", text: "Ver o que já carregou" });
  const root = h(
    "div.offline",
    { role: "alertdialog", "aria-modal": "true", "aria-labelledby": "offline-title", "aria-describedby": "offline-text", hidden: true },
    h("div.offline__inner", {}, h("div.offline__stage", {}, canvas), caption, title, text, status, h("div.offline__actions", {}, retry, minimize)),
  );
  const barStatus = h("span.offline-bar__text", { text: "Sem internet" });
  const bar = h(
    "div.offline-bar",
    { role: "status", hidden: true },
    mark("offline-bar__mark"),
    barStatus,
    h("button.offline-bar__open", { type: "button", text: "Detalhes", onclick: () => expand() }),
  );
  document.body.append(root, bar);

  const scene = createScene(canvas, (line) => {
    caption.classList.remove("is-in");
    void caption.offsetWidth;
    caption.textContent = line;
    caption.classList.add("is-in");
  });

  let visible = false;
  let minimized = false;
  let nextAt = 0;
  let ticker = 0;
  let hideTimer = 0;
  let previousFocus = null;

  function setInert(on) {
    for (const id of ["chat"]) {
      const el = document.getElementById(id);
      if (el) el.inert = on;
    }
    const app = document.querySelector("main.app");
    if (app) app.inert = on;
  }

  function tick() {
    const seconds = Math.ceil((nextAt - Date.now()) / 1000);
    const text = seconds > 0 ? `Tentando de novo em ${seconds} s` : "Tentando reconectar…";
    status.textContent = text;
    barStatus.textContent = seconds > 0 ? `Sem internet · nova tentativa em ${seconds} s` : "Sem internet · reconectando…";
  }

  // Ampliação inteira (2×, 3×, 4×…): pixels sempre quadrados e nítidos.
  function fit() {
    const room = Math.min(window.innerWidth * 0.82, window.innerHeight * 0.36 * (W / H), 384);
    const scale = Math.max(2, Math.floor(room / W));
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${H * scale}px`;
  }
  window.addEventListener("resize", () => {
    if (visible) fit();
  });

  function expand() {
    fit();
    minimized = false;
    bar.hidden = true;
    root.hidden = false;
    setInert(true);
    window.requestAnimationFrame(() => root.classList.add("is-open"));
    scene.play();
    title.focus({ preventScroll: true });
  }

  retry.addEventListener("click", async () => {
    retry.disabled = true;
    status.textContent = "Verificando a conexão…";
    retry.classList.add("is-spinning");
    await onRetry();
    retry.disabled = false;
    retry.classList.remove("is-spinning");
  });

  minimize.addEventListener("click", () => {
    minimized = true;
    root.classList.remove("is-open");
    setInert(false);
    scene.stop();
    window.setTimeout(() => {
      if (minimized) root.hidden = true;
    }, 260);
    bar.hidden = false;
    previousFocus?.focus?.({ preventScroll: true });
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") minimize.click();
    if (event.key === "Tab") {
      const items = [retry, minimize];
      const index = items.indexOf(document.activeElement);
      event.preventDefault();
      items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus();
    }
  });

  return {
    show(probeAt) {
      nextAt = probeAt || 0;
      window.clearTimeout(hideTimer);
      window.clearInterval(ticker);
      ticker = window.setInterval(tick, 500);
      tick();
      if (visible) return;
      visible = true;
      root.classList.remove("is-back");
      title.textContent = "Ops, parece que tamo sem internet, fi.";
      previousFocus = document.activeElement;
      if (minimized) {
        bar.hidden = false;
        return;
      }
      expand();
    },
    hide() {
      if (!visible) return;
      visible = false;
      window.clearInterval(ticker);
      if (minimized || root.hidden) {
        barStatus.textContent = "Conectado de novo";
        bar.classList.add("is-back");
        hideTimer = window.setTimeout(() => {
          bar.hidden = true;
          bar.classList.remove("is-back");
          minimized = false;
        }, 1600);
        return;
      }
      // Volta da rede: o Kazinho comemora antes de a tela sumir.
      title.textContent = "Opa, voltamos!";
      status.textContent = "Conexão restabelecida.";
      caption.textContent = "";
      root.classList.add("is-back");
      scene.celebrate();
      hideTimer = window.setTimeout(() => {
        root.classList.remove("is-open");
        setInert(false);
        window.setTimeout(() => {
          if (visible) return;
          root.hidden = true;
          scene.stop();
        }, 320);
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      }, reducedMotion() ? 600 : 1500);
    },
  };
}
