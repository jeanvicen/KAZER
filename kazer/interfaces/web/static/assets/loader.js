// Carregando: o Kazinho levantando um halter.
//
// Aparece quando uma tela demora mais que um piscar de olhos e some assim que
// ela chega. Só entra depois de um atraso: carregamento rápido não pode piscar
// um boneco na cara de quem está usando.
//
// É o mesmo personagem da tela sem internet, mas desenhado aqui em separado e
// só nesta pose. O carregador aparece justamente quando a máquina está devagar:
// não pode arrastar junto o cenário inteiro da outra tela.

import { h, reducedMotion } from "./dom.js";

const W = 40;
const H = 34;
const GROUND = 28;
const MID = W / 2;
// Uma repetição completa do exercício.
const REP_MS = 1500;
// Carregamento abaixo disto nem mostra o boneco.
const DELAY_MS = 420;
// O boneco é pixel: 20 quadros por segundo bastam, e o aparelho fica com o
// resto do fôlego para carregar o que a pessoa pediu.
const FRAME_MS = 50;

const C = {
  white: "#f5f5f5",
  half: "#c4c4c4",
  eye: "#070707",
  hood: "#5d5d5d",
  hoodLight: "#767676",
  hoodDark: "#454545",
  leg: "#3b3b3b",
  shoe: "#e8e8e8",
  shadow: "#0d0d0d",
  metal: "#a8a8a8",
  plate: "#6c6c6c",
  sweat: "#bcd3ff",
};

// Larguras das linhas de cada metade da Fenda, de cima para baixo.
const HALF = [1, 2, 3, 4, 3, 2, 1];
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function draw(canvas) {
  const ctx = canvas.getContext("2d");
  canvas.width = W;
  canvas.height = H;
  ctx.imageSmoothingEnabled = false;
  let raf = 0;

  const rect = (x, y, w, hh, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, hh);
  };
  const px = (x, y, color) => rect(x, y, 1, 1, color);

  const line = (x0, y0, x1, y1, color) => {
    // Bresenham: braço em pixel, sem suavização.
    let [x, y] = [Math.round(x0), Math.round(y0)];
    const [tx, ty] = [Math.round(x1), Math.round(y1)];
    const dx = Math.abs(tx - x);
    const dy = -Math.abs(ty - y);
    const sx = x < tx ? 1 : -1;
    const sy = y < ty ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 64; guard += 1) {
      px(x, y, color);
      if (x === tx && y === ty) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  };

  function head(cx, top, { strain = false } = {}) {
    HALF.forEach((width, row) => {
      rect(cx - width, top + row, width, 1, C.white);
      rect(cx + 1, top + 1 + row, width, 1, C.half);
    });
    if (strain) {
      // Olhinhos apertados no esforço.
      rect(cx - 3, top + 4, 2, 1, C.eye);
      rect(cx + 2, top + 5, 2, 1, C.eye);
      return;
    }
    px(cx - 3, top + 4, C.eye);
    px(cx + 2, top + 5, C.eye);
  }

  function body(cx, { neck = 0 } = {}) {
    // Pescocinho: aqui o boneco aparece bem maior que na tela sem internet, e
    // sem ele a cabeça parece solta quando os braços estão embaixo.
    rect(cx - 1, GROUND - 10, 2, 1 + neck, C.hoodDark);
    rect(cx - 3, GROUND - 3, 2, 3, C.leg);
    rect(cx + 1, GROUND - 3, 2, 3, C.leg);
    rect(cx - 4, GROUND - 1, 3, 1, C.shoe);
    rect(cx + 1, GROUND - 1, 3, 1, C.shoe);
    rect(cx - 3, GROUND - 9, 7, 6, C.hood);
    rect(cx - 3, GROUND - 9, 1, 5, C.hoodLight);
    rect(cx - 3, GROUND - 4, 7, 1, C.hoodDark);
    px(cx - 1, GROUND - 7, C.white);
    px(cx + 1, GROUND - 6, C.half);
  }

  function arm(sx, sy, hx, hy) {
    line(sx, sy, hx, hy, C.hood);
    rect(hx - (hx < sx ? 1 : 0), hy, 2, 2, C.white);
  }

  let last = -FRAME_MS;

  function frame(now) {
    raf = window.requestAnimationFrame(frame);
    // Aba escondida não desenha, e o desenho é limitado a FRAME_MS.
    if (document.hidden || now - last < FRAME_MS) return;
    last = now;
    ctx.clearRect(0, 0, W, H);
    const phase = (now % REP_MS) / REP_MS;
    // Sobe na primeira metade, desce na segunda.
    const lift = easeInOut(phase < 0.5 ? phase * 2 : 2 - phase * 2);
    const strain = lift > 0.85;

    rect(MID - 5, GROUND, 11, 1, C.shadow);
    body(MID, { neck: strain ? 0 : 1 });
    head(MID, GROUND - 19 + (strain ? 1 : 0), { strain });

    const handY = Math.round(GROUND - 4 - lift * 6);
    for (const side of [-1, 1]) {
      const sx = side < 0 ? MID - 3 : MID + 3;
      const hx = sx + side * (2 - Math.round(lift));
      arm(sx + (side > 0 ? 1 : 0), GROUND - 8, hx, handY);
      const dx = hx + (side > 0 ? 0 : -1);
      rect(dx - 1, handY + 1, 4, 1, C.metal);
      rect(dx - 2, handY, 1, 3, C.plate);
      rect(dx + 3, handY, 1, 3, C.plate);
    }

    // Uma gotinha de suor a cada duas repetições.
    const sweat = (now % (REP_MS * 2)) / (REP_MS * 2);
    if (sweat > 0.4 && sweat < 0.8) {
      px(MID + 5, GROUND - 17 + Math.round((sweat - 0.4) * 10), C.sweat);
    }
  }

  // Sem movimento: uma pose só, com o halter no alto.
  if (reducedMotion()) {
    ctx.clearRect(0, 0, W, H);
    rect(MID - 5, GROUND, 11, 1, C.shadow);
    body(MID);
    head(MID, GROUND - 18, { strain: true });
    for (const side of [-1, 1]) {
      const sx = side < 0 ? MID - 3 : MID + 3;
      const hx = sx + side;
      arm(sx + (side > 0 ? 1 : 0), GROUND - 8, hx, GROUND - 10);
      const dx = hx + (side > 0 ? 0 : -1);
      rect(dx - 1, GROUND - 9, 4, 1, C.metal);
      rect(dx - 2, GROUND - 10, 1, 3, C.plate);
      rect(dx + 3, GROUND - 10, 1, 3, C.plate);
    }
    return () => {};
  }

  raf = window.requestAnimationFrame(frame);
  return () => window.cancelAnimationFrame(raf);
}

// Carregador para um pedaço da tela. `mount` é onde ele aparece.
export function createLoader(mount, { label = "Carregando…", full = false } = {}) {
  let node = null;
  let stop = null;
  let timer = 0;

  const show = () => {
    if (node) return;
    const canvas = h("canvas.loader__canvas", { "aria-hidden": "true" });
    node = h(
      `div.loader${full ? ".loader--full" : ""}`,
      { role: "status", "aria-live": "polite" },
      canvas,
      h("p.loader__text", { text: label }),
    );
    mount.append(node);
    stop = draw(canvas);
  };

  return {
    // Só aparece se a espera passar do limite: carregamento rápido não pisca.
    start() {
      if (timer || node) return;
      timer = window.setTimeout(() => {
        timer = 0;
        show();
      }, DELAY_MS);
    },
    stop() {
      window.clearTimeout(timer);
      timer = 0;
      stop?.();
      stop = null;
      node?.remove();
      node = null;
    },
  };
}
