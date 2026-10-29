// Cena digital do KAZER: pixel art monocromática, halo em ASCII, dithering e
// um monitor antigo. Sem partículas: tudo vive numa grade fixa de 192×96 pixels
// ampliada por fator inteiro, sem suavização. Puramente decorativa.

const W = 192;
const H = 96;
const LOOP = 16000;
const FRAME_MS = 1000 / 15;

const SCREEN = { x: 94, y: 15, w: 72, h: 39 };
const LIGHT = { x: 130, y: 34 };
const BG = 3;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];

// Fonte 3×5 (terminal) e 5×7 (nome no monitor), desenhadas à mão.
const FONT3 = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110",
  E: "111100110100111", F: "111100110100100", G: "011100101101011", H: "101101111101101",
  I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100",
  Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111", ".": "000000000000010", ":": "000010000010000",
  "(": "001010010010001", ")": "100010010010100", "{": "011010110010011", "}": "110010011010110",
  "=": "000111000111000", ">": "100010001010100", "-": "000000111000000", "_": "000000000000111",
  "*": "000101010101000", "/": "001001010100100", ",": "000000000010100", "+": "000010111010000",
  "#": "101111101111101", "|": "010010010010010", "█": "111111111111111",
};
const FONT5 = {
  K: "10001100101010011000101001001010001",
  A: "01110100011000111111100011000110001",
  Z: "11111000010001000100010001000011111",
  E: "11111100001000011110100001000011111",
  R: "11110100011000111110101001001010001",
};

// Pseudocódigo decorativo; não representa nenhum processo real do aplicativo.
const CODE = [
  "> KAZER --LOCAL",
  "LOAD CORE.MOD",
  "SCOPE = SESSION",
  "FN PLAN(TASK) {",
  "  CTX = MIN(TASK)",
  "  GUARD(CTX)",
  "}",
  "POLICY: DENY *",
  "MEMORY: ISOLATED",
  "RUN PIPELINE",
];
const KEYWORDS = new Set(["KAZER", "LOAD", "SCOPE", "FN", "POLICY", "MEMORY", "RUN", "GUARD"]);
const CHAR_MS = 38;
const LINE_PAUSE = 180;

const T = {
  codeEnd: 6400,
  codeOut: 7000,
  assembleEnd: 9400,
  executing: 10700,
  complete: 12100,
  fadeOut: 13700,
  blank: 14400,
};

// Gerador determinístico para que o loop seja sempre igual.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------- Pré-cálculo do cenário estático ----------

function buildBase() {
  const base = new Uint8Array(W * H).fill(BG);
  const set = (x, y, v) => {
    if (x >= 0 && x < W && y >= 0 && y < H) base[y * W + x] = v;
  };
  const rect = (x0, y0, x1, y1, v) => {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) set(x, y, v);
  };

  // Halo em ASCII na parede: densidade de caracteres segue a luz do monitor.
  const ramp = [" ", ".", ":", "-", "=", "+"];
  for (let cy = 0; cy < 64; cy += 6) {
    for (let cx = 0; cx < W; cx += 4) {
      const d = Math.hypot((cx + 1.5 - LIGHT.x) * 0.72, (cy + 2.5 - LIGHT.y) * 1.25);
      const level = clamp(1 - d / 78, 0, 1) ** 2;
      if (level < 0.06) continue;
      const glyph = FONT3[ramp[Math.min(ramp.length - 1, Math.floor(level * ramp.length * 1.1))]];
      if (!glyph) continue;
      const v = Math.round(7 + level * 19);
      for (let i = 0; i < 15; i += 1) {
        if (glyph[i] === "1") set(cx + (i % 3), cy + Math.floor(i / 3), v);
      }
    }
  }

  // Mesa: superfície iluminada pelo monitor com dithering ordenado.
  for (let y = 64; y <= 69; y += 1) {
    for (let x = 30; x < W; x += 1) {
      const level = clamp(1 - Math.abs(x - LIGHT.x) / 86, 0, 1) * (1 - (y - 64) / 9);
      const fade = clamp((x - 30) / 18, 0, 1);
      const v = level * 30 * fade;
      const step = Math.floor(v / 6);
      const frac = v / 6 - step;
      set(x, y, 8 + step * 6 + (bayer(x, y) < frac ? 6 : 0));
    }
  }
  // Fios técnicos: borda traseira e frontal da mesa, sumindo no escuro.
  for (let x = 0; x < W; x += 1) {
    const reach = clamp(1 - Math.abs(x - LIGHT.x) / 120, 0, 1);
    set(x, 63, Math.round(BG + reach * 22));
    if (x >= 30) set(x, 70, Math.round(6 + reach * 10));
  }
  for (let y = 71; y <= 76; y += 1) for (let x = 30; x < W; x += 1) set(x, y, 5);

  // Monitor: lateral em profundidade, moldura, pé e base.
  rect(171, 14, 173, 56, 7);
  rect(90, 12, 170, 58, 15);
  rect(90, 12, 170, 12, 27);
  rect(90, 13, 90, 58, 20);
  rect(170, 13, 170, 58, 11);
  rect(SCREEN.x - 1, SCREEN.y - 1, SCREEN.x + SCREEN.w, SCREEN.y + SCREEN.h, 21);
  set(160, 56, 74);
  rect(127, 59, 133, 63, 11);
  rect(128, 59, 128, 63, 19);
  rect(116, 64, 144, 65, 13);
  rect(116, 64, 144, 64, 24);

  // Teclado à frente do monitor.
  rect(104, 66, 140, 68, 14);
  rect(104, 66, 140, 66, 30);
  for (let x = 106; x <= 138; x += 2) set(x, 67, 21);

  // Caneca: silhueta com luz vinda da esquerda.
  rect(150, 58, 155, 64, 13);
  rect(150, 58, 150, 64, 46);
  rect(150, 58, 155, 58, 34);
  rect(156, 60, 157, 62, 11);
  set(156, 59, 24);

  return base;
}

// Encosto da cadeira: primeiro plano, sobre o corpo.
function buildChair() {
  const chair = new Int16Array(W * H).fill(-1);
  for (let y = 68; y < H; y += 1) {
    for (let x = 58; x <= 100; x += 1) {
      const top = y - 68;
      const corner = Math.min(x - 58, 100 - x);
      if (top < 4 && corner < 4 - top) continue;
      chair[y * W + x] = 5;
    }
  }
  for (let x = 58; x <= 100; x += 1) {
    const edge = Math.min(x - 58, 100 - x);
    const y = 68 + Math.max(0, 4 - edge);
    if (y < H) chair[y * W + x] = Math.round(14 + clamp((x - 58) / 42, 0, 1) * 18);
  }
  for (let y = 72; y < H; y += 1) chair[y * W + 100] = 13;
  return chair;
}

// Vinheta para o ambiente desaparecer no preto nas bordas.
function buildVignette() {
  const v = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const fx = clamp(Math.min(x, W - 1 - x) / 26, 0, 1);
      const fy = clamp(Math.min(y + 30, H - 1 - y) / 16, 0, 1);
      v[y * W + x] = fx * fy;
    }
  }
  return v;
}

function buildCode() {
  const lines = [];
  let at = 120;
  for (const text of CODE) {
    const colors = [];
    const words = text.split(/([^A-Z]+)/);
    for (const part of words) {
      for (const ch of part) {
        if (ch === ">") colors.push(245);
        else if (/[A-Z]/.test(ch)) colors.push(KEYWORDS.has(part) ? 222 : 150);
        else colors.push(ch === " " ? 0 : 96);
      }
    }
    lines.push({ text, colors, start: at, end: at + text.length * CHAR_MS });
    at += text.length * CHAR_MS + LINE_PAUSE;
  }
  return lines;
}

function buildBlocks() {
  const random = rng(7);
  const blocks = [];
  [..."KAZER"].forEach((letter, gi) => {
    const bits = FONT5[letter];
    for (let i = 0; i < 35; i += 1) {
      if (bits[i] !== "1") continue;
      const gx = gi * 6 + (i % 5);
      const gy = Math.floor(i / 5);
      const arrive = T.codeOut + 300 + (gx / 29) * 650 + random() * 1100;
      blocks.push({
        gx,
        gy,
        arrive,
        appear: arrive - 800 - random() * 400,
        ox: Math.round((random() - 0.5) * 10),
        oy: Math.round((random() - 0.5) * 6),
        tone: 70 + Math.round(random() * 60),
        seed: Math.floor(random() * 3),
      });
    }
  });
  const noise = Array.from({ length: 30 }, () => ({
    x: Math.floor(random() * 34),
    y: Math.floor(random() * 18),
    at: T.codeOut + random() * 1800,
    life: 110 + random() * 160,
    tone: 40 + Math.round(random() * 60),
  }));
  return { blocks, noise };
}

// ---------- Desenho do monitor ----------

function makeScreenPainter() {
  const code = buildCode();
  const { blocks, noise } = buildBlocks();
  const scr = new Uint8Array(SCREEN.w * SCREEN.h);
  const put = (x, y, v) => {
    if (x >= 0 && x < SCREEN.w && y >= 0 && y < SCREEN.h && v > scr[y * SCREEN.w + x]) {
      scr[y * SCREEN.w + x] = v;
    }
  };
  const glyph3 = (ch, x, y, v, cut) => {
    const bits = FONT3[ch];
    if (!bits || v === 0) return;
    for (let i = 0; i < 15; i += 1) {
      const px = x + (i % 3);
      const py = y + Math.floor(i / 3);
      if (bits[i] === "1" && (cut === 0 || bayer(px, py) >= cut)) put(px, py, v);
    }
  };
  const text3 = (text, x, y, v, cut = 0) => {
    [...text].forEach((ch, i) => glyph3(ch, x + i * 4, y, v, cut));
  };

  const KX = 7;
  const KY = 5;
  const block = (gx, gy, v, cut) => {
    for (let dy = 0; dy < 2; dy += 1) {
      for (let dx = 0; dx < 2; dx += 1) {
        const px = KX + gx * 2 + dx;
        const py = KY + gy * 2 + dy;
        if (cut === 0 || bayer(px, py) >= cut) put(px, py, v);
      }
    }
  };

  function paintCode(t, cut) {
    let typing = null;
    let started = 0;
    for (const line of code) if (t >= line.start) started += 1;
    // Rolagem suave em passos de pixel quando passa de seis linhas.
    let top = 0;
    code.forEach((line, i) => {
      if (i >= 6 && t >= line.start) top += clamp((t - line.start) / 200, 0, 1);
    });
    code.forEach((line, i) => {
      if (i >= started) return;
      const y = Math.round(3 + (i - top) * 6);
      if (y < -5 || y >= SCREEN.h) return;
      const shown = Math.min(line.text.length, Math.floor((t - line.start) / CHAR_MS) + 1);
      for (let c = 0; c < shown; c += 1) glyph3(line.text[c], 3 + c * 4, y, line.colors[c], cut);
      if (t < line.end) typing = { x: 3 + shown * 4, y, index: shown };
      else if (i === started - 1 && t < T.codeEnd) typing = { x: 3 + shown * 4, y, index: -1 };
    });
    return typing;
  }

  function paint(t, frameIndex) {
    scr.fill(0);
    let typing = null;
    let lookingUp = false;

    if (t < T.codeOut) {
      const cut = t < T.codeEnd ? 0 : (t - T.codeEnd) / (T.codeOut - T.codeEnd);
      typing = paintCode(t, cut);
      if (typing && cut === 0 && (typing.index >= 0 || Math.floor(t / 530) % 2 === 0)) {
        glyph3("█", typing.x, typing.y, 214, 0);
      }
      if (t >= T.codeEnd) typing = null;
    }

    if (t >= T.codeOut - 200 && t < T.blank) {
      lookingUp = t >= T.codeOut + 200 && t < T.fadeOut;
      const cut = t < T.fadeOut ? 0 : (t - T.fadeOut) / (T.blank - T.fadeOut);
      for (const n of noise) {
        if (t >= n.at && t < n.at + n.life && frameIndex % 2 === 0) block(n.x, n.y, n.tone, cut);
      }
      for (const b of blocks) {
        if (t < b.appear) continue;
        if (t >= b.arrive) {
          block(b.gx, b.gy, t - b.arrive < 130 ? 255 : 230, cut);
        } else if (t >= b.arrive - 500) {
          const p = (t - (b.arrive - 500)) / 500;
          block(b.gx + Math.round(b.ox * (1 - p)), b.gy + Math.round(b.oy * (1 - p)), 150, cut);
        } else if ((frameIndex + b.seed) % 3 !== 0) {
          block(b.gx + b.ox, b.gy + b.oy, b.tone, cut);
        }
      }
      // Brilho de fósforo em volta das letras já formadas.
      if (t >= T.assembleEnd - 200) {
        const glow = Math.round(clamp((t - (T.assembleEnd - 200)) / 400, 0, 1) * 22);
        for (let y = KY - 1; y <= KY + 14; y += 1) {
          for (let x = KX - 1; x <= KX + 58; x += 1) {
            const i = y * SCREEN.w + x;
            if (scr[i] === 0 && (scr[i - 1] > 200 || scr[i + 1] > 200 || scr[i - SCREEN.w] > 200 || scr[i + SCREEN.w] > 200)) {
              scr[i] = Math.round(glow * (cut === 0 ? 1 : 1 - cut));
            }
          }
        }
      }

      if (t >= T.assembleEnd) {
        let label = "INITIALIZING";
        let progress = clamp((t - T.assembleEnd) / (T.executing - T.assembleEnd), 0, 1) * 0.34;
        if (t >= T.complete) {
          label = "COMPLETE";
          progress = 1;
        } else if (t >= T.executing) {
          label = "EXECUTING";
          progress = 0.34 + clamp((t - T.executing) / (T.complete - T.executing), 0, 1) * 0.58;
        }
        const blinkOff =
          (t >= T.complete + 200 && t < T.complete + 320) ||
          (t >= T.complete + 440 && t < T.complete + 560);
        const x = Math.floor((SCREEN.w - (label.length * 4 - 1)) / 2);
        if (!blinkOff) text3(label, x, 24, t >= T.complete ? 240 : 176, cut);
        if (t < T.complete && Math.floor(t / 400) % 2 === 0) {
          glyph3("█", x + label.length * 4 + 1, 24, 150, cut);
        }
        const segments = 12;
        const filled = Math.floor(progress * segments + 1e-6);
        for (let s = 0; s < segments; s += 1) {
          const sx = 12 + s * 4;
          for (let dx = 0; dx < 3; dx += 1) {
            for (let dy = 0; dy < 2; dy += 1) {
              if (cut === 0 || bayer(sx + dx, 32 + dy) >= cut) put(sx + dx, 32 + dy, s < filled ? 206 : 26);
            }
          }
        }
      }
    }

    if (t >= T.blank && Math.floor(t / 530) % 2 === 0) glyph3("█", 3, 3, 200, 0);
    return { scr, typing, lookingUp };
  }

  return paint;
}

// ---------- Personagem (silhueta sem rosto, de costas) ----------

const TORSO = [
  [47, 11], [48, 15.5], [49, 18.5], [50, 20.5], [51, 22], [52, 23], [54, 24.2],
  [57, 24.8], [62, 25], [75, 24], [95, 22],
];

function torsoHalfWidth(y) {
  for (let i = 1; i < TORSO.length; i += 1) {
    const [y1, w1] = TORSO[i];
    const [y0, w0] = TORSO[i - 1];
    if (y <= y1) return w0 + ((w1 - w0) * (y - y0)) / (y1 - y0);
  }
  return TORSO[TORSO.length - 1][1];
}

function paintBody(mask, breath, headDx, headDy, handUp) {
  mask.fill(0);
  const set = (x, y, m) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && x < W && y >= 0 && y < H) mask[y * W + x] = m;
  };
  const disc = (cx, cy, r, m) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, m);
      }
    }
  };
  const limb = (x0, y0, x1, y1, r, m) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let s = 0; s <= steps; s += 1) disc(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, r, m);
  };

  // Braço direito ao teclado (atrás do tronco na ordem de desenho).
  limb(99, 54 + breath, 105, 62, 2.6, 4);
  limb(105, 62, 112, 65 + handUp, 1.7, 4);
  for (let x = 112; x <= 116; x += 1) {
    set(x, 64 + handUp, 5);
    set(x, 65 + handUp, 5);
  }
  // Cotovelo esquerdo sugerido na lateral.
  limb(56, 58 + breath, 54, 64, 2.2, 4);

  for (let y = 47; y < H; y += 1) {
    const half = torsoHalfWidth(y);
    const cx = 79 + (y - 47) * 0.05;
    for (let x = Math.ceil(cx - half); x <= Math.floor(cx + half); x += 1) {
      // Só o peito sobe ao respirar; a parte baixa fica e cobre a fresta.
      if (y < 70) set(x, y + breath, 1);
      if (y >= 64) set(x, y, 1);
    }
  }
  for (let y = 41; y <= 49; y += 1) for (let x = 75; x <= 83; x += 1) set(x, y + breath, 2);

  // Cabeça vista de trás: só o volume do cabelo, nenhum traço facial.
  const hx = 79 + headDx;
  const hy = 34 + breath + headDy;
  for (let y = -10; y <= 10; y += 1) {
    for (let x = -9; x <= 9; x += 1) {
      const inside = (x / 7.6) ** 2 + (y / 9.2) ** 2 <= 1 || ((x + 0.6) / 7.9) ** 2 + ((y + 1.6) / 7.8) ** 2 <= 1;
      if (inside) set(hx + x, hy + y, 3);
    }
  }
}

const MATERIAL = [0, 9, 12, 11, 10, 18];

// ---------- Ciclo de animação ----------

export function startScene(canvas, { reducedMotion = false } = {}) {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return { pause() {}, resume() {}, destroy() {} };
  canvas.width = W;
  canvas.height = H;

  const base = buildBase();
  const chair = buildChair();
  const vignette = buildVignette();
  const paintScreen = makeScreenPainter();
  const mask = new Uint8Array(W * H);
  const frame = new Uint8Array(W * H);
  const image = ctx.createImageData(W, H);
  const pixels = new Uint32Array(image.data.buffer);

  const isScreen = (x, y) =>
    x >= SCREEN.x && x < SCREEN.x + SCREEN.w && y >= SCREEN.y && y < SCREEN.y + SCREEN.h;

  function render(t, frameIndex, grain) {
    const { scr, typing, lookingUp } = paintScreen(t, frameIndex);
    frame.set(base);

    // Monitor: varredura, vinheta interna, reflexo no vidro e falhas raras.
    let luma = 0;
    const tear =
      (t >= 3120 && t < 3200) || (t >= 8600 && t < 8680) || (t >= 12960 && t < 13040)
        ? { y0: 6 + (Math.floor(t / 80) % 3) * 9, y1: 13 + (Math.floor(t / 80) % 3) * 9, dx: t < 9000 ? 2 : -2 }
        : null;
    for (let sy = 0; sy < SCREEN.h; sy += 1) {
      const shift = tear && sy >= tear.y0 && sy < tear.y1 ? tear.dx : 0;
      for (let sx = 0; sx < SCREEN.w; sx += 1) {
        const srcX = sx - shift;
        let v = srcX >= 0 && srcX < SCREEN.w ? scr[sy * SCREEN.w + srcX] : 0;
        luma += v;
        const ex = Math.min(sx, SCREEN.w - 1 - sx);
        const ey = Math.min(sy, SCREEN.h - 1 - sy);
        const edge = Math.min(ex / 6, ey / 4, 1);
        v = 6 + v * (0.86 + 0.14 * edge);
        if (sy & 1) v *= 0.8;
        if (sy < 16 && sx - sy * 0.8 > 3 && sx - sy * 0.8 < 9) v += 5;
        frame[(SCREEN.y + sy) * W + SCREEN.x + sx] = clamp(Math.round(v), 0, 255);
      }
    }
    luma /= SCREEN.w * SCREEN.h;
    const flicker = 1 + Math.sin(t * 0.031) * 0.02;
    const gain = clamp(0.72 + luma / 34, 0.7, 1.4) * flicker;

    // Personagem com luz de recorte vinda do monitor.
    const breath = Math.sin((t / 4300) * Math.PI * 2) > 0.55 ? -1 : 0;
    const handUp = typing && typing.index >= 0 && typing.index % 2 === 0 ? -1 : 0;
    paintBody(mask, breath, 0, lookingUp ? -1 : 0, handUp);
    for (let y = 20; y < H; y += 1) {
      for (let x = 40; x < 122; x += 1) {
        const i = y * W + x;
        const m = mask[i];
        if (!m) continue;
        const lx = x < LIGHT.x ? 1 : -1;
        const ly = y > LIGHT.y + 2 ? -1 : 0;
        const outside = (dx, dy) => !mask[(y + dy) * W + x + dx];
        let v = MATERIAL[m] + (m === 1 && bayer(x, y) < 0.12 ? 3 : 0);
        const dist = Math.hypot(LIGHT.x - x, LIGHT.y - y);
        const strength = (95 / (1 + dist / 55)) * gain;
        if (outside(lx, 0) || (ly && outside(0, ly)) || (ly && outside(lx, ly))) v += strength;
        else if (outside(lx * 2, 0) || (ly && outside(0, ly * 2))) v += strength * 0.32;
        frame[i] = clamp(Math.round(v), 0, 255);
      }
    }
    if (typing && typing.index >= 0) {
      const key = 106 + ((typing.index * 7) % 16) * 2;
      frame[67 * W + key] = 64;
    }

    for (let i = 0; i < W * H; i += 1) if (chair[i] >= 0) frame[i] = chair[i];

    // Vinheta, grão contido e conversão para RGBA.
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = y * W + x;
        let v = frame[i];
        if (!isScreen(x, y)) {
          v = BG + (v - BG) * vignette[i];
          if (grain && v < 40 && Math.random() < 0.018) v += 3 + Math.random() * 6;
        }
        const g = clamp(Math.round(v), 0, 255);
        pixels[i] = 0xff000000 | (g << 16) | (g << 8) | g;
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  // Escala inteira em pixels de dispositivo para manter os pixels nítidos.
  const container = canvas.parentElement;
  function fit() {
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const scale = Math.max(1, Math.floor(Math.min((rect.width * dpr) / W, (rect.height * dpr) / H)));
    canvas.style.width = `${(W * scale) / dpr}px`;
    canvas.style.height = `${(H * scale) / dpr}px`;
  }
  fit();
  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(container);

  if (reducedMotion) {
    render(T.complete + 900, 0, false);
    return {
      pause() {},
      resume() {},
      destroy() {
        resizeObserver.disconnect();
      },
    };
  }

  const holds = new Set();
  let elapsed = 0;
  let last = 0;
  let lastDraw = -Infinity;
  let frameIndex = 0;
  let raf = 0;

  function tick(now) {
    raf = 0;
    if (holds.size) return;
    if (last) elapsed += Math.min(now - last, 100);
    last = now;
    if (now - lastDraw >= FRAME_MS) {
      lastDraw = now;
      frameIndex += 1;
      render(elapsed % LOOP, frameIndex, true);
    }
    raf = requestAnimationFrame(tick);
  }

  const pause = (reason) => {
    holds.add(reason);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  };
  const resume = (reason) => {
    holds.delete(reason);
    if (!holds.size && !raf) raf = requestAnimationFrame(tick);
  };

  // Para quando a aba some ou a cena sai da tela.
  const onVisibility = () => (document.hidden ? pause("hidden") : resume("hidden"));
  document.addEventListener("visibilitychange", onVisibility);
  const io = new IntersectionObserver(([entry]) =>
    entry.isIntersecting ? resume("offscreen") : pause("offscreen"),
  );
  io.observe(canvas);
  render(0, 0, false);
  raf = requestAnimationFrame(tick);

  return {
    pause,
    resume,
    destroy() {
      pause("destroyed");
      io.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
