// Cena de desktop do KAZER: o mesmo quarto, em plano aberto e com mais vida —
// chuva escorrendo na janela, gato dormindo no peitoril, vela, varal de luzes,
// segundo monitor com logs, poeira na luz da luminária, brilho (bloom) calculado
// a cada quadro e paralaxe seguindo o mouse. Grade de 288×240 pixels ampliada por
// fator inteiro e recortada para cobrir o palco. Só é carregada em telas grandes.

import { P, rgba, painter, bayer, clamp, rng, drawMan, drawScreen } from "./scene.js";

const W = 288;
const H = 240;
const FRAME_MS = 1000 / 24;
// O programador e o monitor principal são os mesmos da cena do celular, deslocados.
const SURFACE = { w: W, h: H, ox: 116, oy: 61 };

const GLASS = { x: 16, y: 26, w: 101, h: 101 };
const PARALLAX = 4;

const X = Object.fromEntries(
  Object.entries({
    rain: "#7f8ae0", rainHi: "#c8d0ff", cloud: "#26235e", cloudHi: "#332f78",
    cat: "#d9894a", catHi: "#f2b878", catLo: "#a85f2e", catRim: "#ffe3b0", catNose: "#e58aa6",
    jar: "#5f5287", wax: "#efe6d2", flame: "#ffb04a", flameHi: "#ffe9a8", flameCore: "#fffaf0",
    wire: "#0c0a14", logDim: "#3b3a7a", tower: "#141238", star2: "#b8b5f0",
    mote: "#ffe3b0", lampLight: "#5a3d45",
  }).map(([name, hex]) => [name, rgba(hex)]),
);

const channels = (c) => [c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff];
const pack = (r, g, b) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
function mix(a, b, t) {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return pack(
    Math.round(ar + (br - ar) * t),
    Math.round(ag + (bg - ag) * t),
    Math.round(ab + (bb - ab) * t),
  );
}

// Rasteriza o símbolo (Fenda) em qualquer tamanho para quadro e bonequinho.
function markRows(w, h) {
  const tri = [
    [30, 1.14, 10, 27.5, 30, 53.86],
    [34, 10.14, 54, 36.5, 34, 62.86],
  ];
  const inside = (px, py, [ax, ay, bx, by, cx, cy]) => {
    const d = (x1, y1, x2, y2) => (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
    const d1 = d(ax, ay, bx, by);
    const d2 = d(bx, by, cx, cy);
    const d3 = d(cx, cy, ax, ay);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const rows = [];
  for (let j = 0; j < h; j += 1) {
    let row = "";
    for (let i = 0; i < w; i += 1) {
      const sx = 10 + ((i + 0.5) / w) * 44;
      const sy = 1 + ((j + 0.5) / h) * 62;
      row += tri.some((t) => inside(sx, sy, t)) ? "#" : ".";
    }
    rows.push(row);
  }
  return rows;
}

// ---------- Cenário estático ----------

function buildRoom() {
  const base = new Uint32Array(W * H);
  const overlay = new Uint32Array(W * H);
  const chair = new Uint32Array(W * H);
  const { px, rect, disc, line, sprite } = painter(base, W, H);
  const pick = (ramp, v, x, y) => {
    const scaled = clamp(v, 0, 0.999) * (ramp.length - 1);
    const i = Math.floor(scaled);
    return ramp[Math.min(ramp.length - 1, i + (bayer(x, y) < scaled - i ? 1 : 0))];
  };
  const cool = [P.wall0, P.wall1, P.wall2, P.wall3, P.wall4];
  const warm = [P.wall1, P.warm1, P.warm2, P.warm3];

  // Parede: lua pela janela à esquerda, luminária quente no meio, monitores à direita.
  for (let y = 0; y < 169; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const lamp = clamp(1 - Math.hypot((x - 154) * 0.85, (y - 128) * 1.05) / 54, 0, 1);
      const moon = clamp(1 - Math.hypot((x - 66) * 0.75, (y - 76) * 0.65) / 112, 0, 1);
      const screen = clamp(1 - Math.hypot((x - 226) * 0.8, (y - 120) * 0.9) / 80, 0, 1);
      const ceiling = clamp(y / 60, 0.45, 1);
      if (lamp > 0.2) px(x, y, pick(warm, lamp * 1.05, x, y));
      else px(x, y, pick(cool, (0.14 + moon * 0.5 + screen * 0.35) * ceiling, x, y));
    }
  }
  rect(0, 169, W - 1, 172, P.base);

  // Piso e tapete.
  for (let y = 173; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const plank = (y - 173) % 8 === 0 || (x + ((y - 173) / 8 | 0) * 37) % 53 === 0;
      px(x, y, plank ? P.floor0 : bayer(x, y) < 0.16 ? P.floor2 : P.floor1);
    }
  }
  for (let y = 210; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const d = ((x - 176) / 104) ** 2 + ((y - 232) / 20) ** 2;
      if (d <= 1) px(x, y, d > 0.88 ? P.rugEdge : (x + y) % 7 === 0 && d < 0.65 ? P.rugDot : P.rug);
    }
  }

  // Peitoril, livros e o pote da vela (a chama é dinâmica).
  rect(8, 131, 124, 132, P.sill);
  rect(8, 133, 124, 136, P.frameLo);
  rect(62, 127, 78, 128, P.bookRose);
  rect(64, 125, 77, 126, P.bookBlue);
  rect(63, 129, 79, 130, P.bookCream);
  rect(62, 127, 62, 128, P.soft);
  rect(97, 124, 105, 130, X.jar);
  rect(98, 126, 104, 130, X.wax);
  rect(97, 124, 105, 124, P.frameHi);

  // Varal de luzes: só o fio é estático.
  for (let x = 134; x < W; x += 1) px(x, Math.round(9 + 7 * Math.sin((Math.PI * (x - 134)) / 153)), X.wire);

  // Quadro com o símbolo do KAZER.
  rect(140, 30, 166, 72, P.posterFrame);
  rect(141, 31, 165, 71, P.posterMat);
  rect(143, 33, 163, 69, P.posterBg);
  sprite(146, 37, markRows(15, 22), { "#": P.ink });

  // Prateleira com livros e um bonequinho do KAZER.
  rect(176, 74, W - 1, 75, P.shelf);
  rect(176, 76, W - 1, 76, P.shelfLo);
  rect(186, 77, 187, 81, P.shelfLo);
  rect(276, 77, 277, 81, P.shelfLo);
  const books = [
    [P.bookRose, 14], [P.bookAmber, 11], [P.bookBlue, 16], [P.bookCream, 12], [P.bookPurple, 15],
    [P.bookDark, 13], [P.bookRose, 10], [P.bookBlue, 14], [P.bookAmber, 12],
  ];
  let bx = 180;
  books.forEach(([color, height], i) => {
    const w = i % 3 === 0 ? 4 : 3;
    rect(bx, 73 - height, bx + w - 1, 73, color);
    px(bx, 73 - height, P.soft);
    bx += w + 1;
  });
  for (let i = 0; i < 12; i += 1) rect(bx + i, 73 - i, bx + i + 2, 73 - i, P.bookPurple);
  sprite(236, 60, markRows(9, 13), { "#": P.ink });
  px(238, 66, P.screen);
  px(243, 69, P.screen);
  rect(234, 73, 246, 73, P.lavDim);
  rect(254, 70, 272, 71, P.bookCream);
  rect(255, 72, 271, 73, P.bookRose);

  // Mesa, papéis, teclado e mouse (posições casadas com o personagem).
  for (let y = 156; y <= 160; y += 1) {
    for (let x = 110; x < W; x += 1) {
      const warmth = clamp(1 - Math.hypot((x - 160) / 30, (y - 158) / 6), 0, 1);
      let c = (x * 7 + y * 13) % 17 === 0 ? P.deskGrain : P.desk;
      if (bayer(x, y) < warmth * 0.9) c = P.deskHi;
      px(x, y, c);
    }
  }
  rect(110, 156, W - 1, 156, P.deskHi);
  rect(110, 161, W - 1, 166, P.deskFront);
  rect(110, 167, W - 1, 167, P.deskDark);
  rect(113, 168, 116, 200, P.deskDark);
  rect(281, 168, 284, 200, P.deskDark);
  rect(152, 153, 166, 155, P.paper);
  rect(153, 154, 164, 154, P.paperLine);
  rect(194, 157, 224, 159, P.keyboard);
  for (let x = 195; x <= 223; x += 2) px(x, 158, P.key);
  rect(194, 157, 224, 157, P.key);
  rect(228, 158, 231, 159, P.mouse);

  // Monitor principal (a tela é desenhada pela cena compartilhada).
  rect(182, 111, 236, 151, P.bezel);
  rect(182, 111, 236, 111, P.bezelHi);
  rect(182, 111, 182, 151, P.bezelHi);
  rect(236, 112, 236, 151, P.bezelLo);
  px(232, 149, P.lav);
  rect(206, 152, 212, 155, P.stand);
  rect(200, 156, 218, 156, P.stand);

  // Segundo monitor, na vertical, para os logs.
  rect(241, 100, 269, 151, P.bezel);
  rect(241, 100, 269, 100, P.bezelHi);
  rect(241, 100, 241, 151, P.bezelHi);
  rect(253, 152, 257, 155, P.stand);
  rect(248, 156, 262, 156, P.stand);

  // Luminária articulada com poça de luz na mesa.
  for (let y = 126; y <= 155; y += 1) {
    for (let x = 136; x <= 190; x += 1) {
      const spread = (y - 118) * 0.85;
      if (Math.abs(x - 160) < spread && bayer(x, y) < 0.12 && base[y * W + x] !== P.paper) px(x, y, X.lampLight);
    }
  }
  rect(137, 154, 150, 155, P.lampBody);
  rect(138, 154, 149, 154, P.bezelHi);
  line(143, 153, 139, 135, 0.8, P.lampBody);
  line(139, 135, 150, 121, 0.8, P.lampBody);
  disc(139, 135, 1.2, P.lampShadeLo);
  sprite(146, 116, [
    "....###.........",
    "..########......",
    ".#############..",
    "################",
    ".bbbbbbbbbbbbbb.",
  ], { "#": P.lampShade, b: P.bulb });
  rect(147, 119, 161, 119, P.lampShadeLo);

  // Janela: moldura, travessas, cortinas e varão ficam numa camada por cima do céu.
  const ov = painter(overlay, W, H);
  ov.rect(12, 22, 120, 25, P.frame);
  ov.rect(12, 127, 120, 130, P.frame);
  ov.rect(12, 22, 15, 130, P.frame);
  ov.rect(117, 22, 120, 130, P.frame);
  ov.rect(49, 26, 51, 126, P.frame);
  ov.rect(82, 26, 84, 126, P.frame);
  ov.rect(16, 74, 116, 76, P.frame);
  ov.rect(12, 22, 120, 22, P.frameHi);
  ov.rect(12, 22, 12, 130, P.frameHi);
  ov.rect(120, 23, 120, 130, P.frameLo);
  ov.rect(50, 26, 50, 126, P.frameHi);
  ov.rect(83, 26, 83, 126, P.frameHi);
  ov.rect(16, 74, 116, 74, P.frameHi);
  ov.rect(0, 15, 136, 16, P.rod);
  ov.disc(136, 15.5, 1.6, P.frameHi);
  for (const [x0, x1] of [[0, 11], [122, 134]]) {
    for (let y = 17; y <= 142; y += 1) {
      const tie = y > 92 && y < 100;
      const pinch = tie ? 3 : 0;
      for (let x = x0 + (x0 === 0 ? 0 : pinch); x <= x1 - (x0 === 0 ? pinch : 0); x += 1) {
        const fold = (x + Math.round(y / 34)) % 4;
        ov.px(x, y, tie ? P.bookAmber : fold === 0 ? P.curtainLo : fold === 2 ? P.curtainHi : P.curtain);
      }
    }
  }

  // Cadeira em primeiro plano, até o chão.
  const cp = painter(chair, W, H);
  for (let y = 174; y <= 220; y += 1) {
    for (let x = 160; x <= 200; x += 1) {
      const top = y - 174;
      const corner = Math.min(x - 160, 200 - x);
      if (top < 5 && corner < 5 - top) continue;
      cp.px(x, y, x > 193 ? P.chairHi : x < 166 ? P.chairLo : P.chair);
    }
  }
  for (let x = 165; x <= 195; x += 1) cp.px(x, 174, P.chairHi);
  cp.rect(163, 180, 163, 220, P.chairStripe);
  cp.rect(197, 180, 197, 220, P.chairStripe);
  for (let y = 186; y <= 220; y += 7) cp.rect(168, y, 192, y, P.chairLo);
  cp.rect(177, 221, 183, 228, P.chairLo);
  cp.rect(158, 229, 202, 231, P.chair);
  cp.rect(158, 229, 202, 229, P.chairHi);
  for (const wx of [158, 180, 201]) cp.rect(wx - 1, 232, wx + 1, 233, P.chairLo);

  return { base, overlay, chair };
}

// Céu panorâmico um pouco mais largo que o vidro, para a paralaxe.
function buildSky() {
  const sw = GLASS.w + PARALLAX * 2;
  const sh = GLASS.h;
  const sky = new Uint32Array(sw * sh);
  const { px, rect, disc } = painter(sky, sw, sh);
  const ramp = [P.sky0, P.sky1, P.sky2, P.sky3, P.sky4];
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      const v = clamp(y / (sh + 6), 0, 0.999) * (ramp.length - 1);
      const i = Math.floor(v);
      px(x, y, ramp[Math.min(ramp.length - 1, i + (bayer(x, y) < v - i ? 1 : 0))]);
    }
  }
  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      const d = Math.hypot(x - 80, y - 18);
      if (d > 7 && d < 15 && bayer(x, y) < (15 - d) / 12) px(x, y, P.moonGlow);
    }
  }
  disc(80, 18, 6.5, P.moon);
  disc(83, 16, 5.6, P.sky0);
  px(76, 21, P.moonShade);
  px(77, 23, P.moonShade);

  const random = rng(41);
  const lights = [];
  const city = (minTop, maxTop, color, density) => {
    let x = 0;
    while (x < sw) {
      const w = 5 + Math.floor(random() * 9);
      const top = minTop + Math.floor(random() * (maxTop - minTop));
      rect(x, top, Math.min(sw - 1, x + w - 1), sh - 1, color);
      for (let wy = top + 2; wy < sh - 1; wy += 3) {
        for (let wx = x + 1; wx < x + w - 1; wx += 2) {
          if (random() < density) {
            lights.push({
              x: wx,
              y: wy,
              color: [P.win1, P.win2, P.win3][Math.floor(random() * 3)],
              blink: random() < 0.12 ? 500 + random() * 900 : 0,
              phase: Math.floor(random() * 7),
            });
          }
        }
      }
      x += w + (random() < 0.25 ? 1 : 0);
    }
  };
  city(58, 76, P.cityFar, 0.14);
  rect(30, 36, 36, sh - 1, X.tower);
  rect(32, 28, 34, 35, X.tower);
  rect(33, 22, 33, 27, X.tower);
  for (let wy = 40; wy < sh - 2; wy += 4) lights.push({ x: 33, y: wy, color: P.win3, blink: 0, phase: 0 });
  city(72, 88, P.cityNear, 0.2);

  const stars = [];
  while (stars.length < 40) {
    const x = Math.floor(random() * sw);
    const y = Math.floor(random() * 46);
    if (Math.hypot(x - 80, y - 18) < 13) continue;
    stars.push({ x, y, bright: random() < 0.3, speed: 400 + random() * 1100, phase: random() * 6 });
  }
  return { sky, sw, lights, stars };
}

const CAT = [
  "...................c.c..",
  "..................cCcCc.",
  "..........CCCCCCCCccccc.",
  "......CCCCcccLcccLccccc.",
  "....CCcccLccccLcccccnccr",
  "...CccccccccccccccccccLr",
  "..cccccLcccccLcccccccL..",
  "..LcccccccccccccccccL...",
  "...LLLLLLLLLLLLLLLLLL...",
];
const CAT_MAP = { c: X.cat, C: X.catHi, L: X.catLo, r: X.catRim, n: X.catNose };

function createDesktopRoom() {
  const { base, overlay, chair } = buildRoom();
  const { sky, sw, lights, stars } = buildSky();
  const frame = new Uint32Array(W * H);
  const { px, rect, sprite } = painter(frame, W, H);
  const random = rng(77);
  const rain = Array.from({ length: 70 }, () => ({
    x: Math.floor(random() * GLASS.w),
    y: random() * 140,
    speed: 0.05 + random() * 0.06,
    len: 2 + Math.floor(random() * 4),
  }));
  const drops = Array.from({ length: 28 }, () => ({
    x: Math.floor(random() * GLASS.w),
    y: Math.floor(random() * GLASS.h),
    slide: random() < 0.35 ? 0.004 + random() * 0.01 : 0,
  }));
  const clouds = [
    { x: 10, y: 8, w: 30, speed: 0.0016 },
    { x: 70, y: 30, w: 22, speed: 0.0011 },
    { x: 50, y: 4, w: 18, speed: 0.0021 },
  ];
  const motes = Array.from({ length: 16 }, () => ({
    x: 142 + random() * 40,
    y: 124 + random() * 28,
    phase: random() * 6.28,
    speed: 0.3 + random() * 0.6,
  }));
  const bulbs = [];
  for (let x = 138; x < W; x += 9) {
    bulbs.push({
      x,
      y: Math.round(9 + 7 * Math.sin((Math.PI * (x - 134)) / 153)) + 1,
      color: [P.amber, P.pink, P.lav, P.win3][bulbs.length % 4],
      phase: random() * 6.28,
    });
  }

  function drawWindow(t, shift) {
    const offset = PARALLAX + shift;
    for (let y = 0; y < GLASS.h; y += 1) {
      const row = (GLASS.y + y) * W + GLASS.x;
      const src = y * sw + offset;
      for (let x = 0; x < GLASS.w; x += 1) frame[row + x] = sky[src + x];
    }
    const local = (x, y, c) => {
      const gx = x - offset;
      if (gx >= 0 && gx < GLASS.w && y >= 0 && y < GLASS.h) frame[(GLASS.y + y) * W + GLASS.x + gx] = c;
    };
    for (const cloud of clouds) {
      const cx = ((cloud.x + t * cloud.speed) % (sw + cloud.w * 2)) - cloud.w;
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < cloud.w; x += 1) {
          const d = ((x - cloud.w / 2) / (cloud.w / 2)) ** 2 + ((y - 4) / 4) ** 2;
          const gx = Math.round(cx + x);
          if (d < 1 && bayer(gx, y) < 1 - d) local(gx, cloud.y + y, y < 3 ? X.cloudHi : X.cloud);
        }
      }
    }
    for (const star of stars) {
      const on = Math.sin(t / star.speed + star.phase) > -0.25;
      if (on) local(star.x, star.y, star.bright ? P.star : X.star2);
    }
    for (const light of lights) {
      const on = light.blink ? Math.floor(t / light.blink + light.phase) % 6 !== 0 : true;
      if (on) local(light.x, light.y, light.color);
    }
    if (Math.floor(t / 650) % 2 === 0) local(33, 21, P.beacon);
    const plane = (t % 13000) / 13000;
    local(Math.round(plane * (sw + 10)) - 5, 40 - Math.round(plane * 10), Math.floor(t / 300) % 2 ? P.beacon : P.star);

    // Chuva escorrendo e gotas paradas no vidro.
    for (const drop of rain) {
      const y = (drop.y + t * drop.speed) % (GLASS.h + 30) - 10;
      for (let k = 0; k < drop.len; k += 1) {
        const yy = Math.round(y) - k;
        if (yy < 0 || yy >= GLASS.h) continue;
        const i = (GLASS.y + yy) * W + GLASS.x + drop.x;
        frame[i] = mix(frame[i], k === 0 ? X.rainHi : X.rain, k === 0 ? 0.7 : 0.4);
      }
    }
    for (const drop of drops) {
      const y = Math.round(drop.y + t * drop.slide) % GLASS.h;
      const i = (GLASS.y + y) * W + GLASS.x + drop.x;
      frame[i] = mix(frame[i], X.rainHi, 0.65);
      if (y + 1 < GLASS.h) frame[i + W] = mix(frame[i + W], P.sky0, 0.5);
    }
  }

  function drawSill(t, frameIndex) {
    // Gato dormindo: respira, mexe a orelha e balança o rabo de vez em quando.
    const inhale = Math.sin(t / 900) > 0.4;
    sprite(24, 122, CAT, CAT_MAP);
    if (inhale) sprite(24, 121, CAT.slice(0, 5), CAT_MAP);
    if (Math.floor(t / 4300) % 3 === 0 && t % 4300 < 220) px(43, inhale ? 120 : 121, X.catHi);
    const sway = Math.floor(t / 1600) % 4;
    const tail = [[0, 0], [0, 1], [-1, 2], [-1, 3], [0, 4], [1, 5]];
    tail.forEach(([dx, dy], i) => {
      const bend = sway === 1 && i > 2 ? 1 : sway === 3 && i > 2 ? -1 : 0;
      px(27 + dx + bend, 131 + dy, i === tail.length - 1 ? X.catHi : i % 2 ? X.catLo : X.cat);
    });
    // Chama da vela.
    const flick = (frameIndex + Math.floor(t / 170)) % 3;
    px(101, 123, X.flameCore);
    px(101 + (flick === 1 ? -1 : 0), 122, X.flameHi);
    px(101 + (flick === 2 ? 1 : 0), 121, X.flame);
    px(101, 125, P.void);
  }

  function drawLights(t) {
    for (const bulb of bulbs) {
      const on = Math.sin(t / 700 + bulb.phase) > -0.5;
      px(bulb.x, bulb.y, on ? bulb.color : mix(bulb.color, P.wall1, 0.6));
      px(bulb.x, bulb.y + 1, mix(bulb.color, P.wall1, 0.55));
    }
  }

  function drawLogs(t) {
    rect(243, 102, 267, 149, P.screen);
    rect(243, 102, 267, 104, P.screenBar);
    px(245, 103, P.pink);
    px(247, 103, P.amber);
    px(249, 103, P.lav);
    const step = Math.floor(t / 320);
    for (let line = 0; line < 14; line += 1) {
      const n = step + line;
      const lr = rng(n * 7919);
      const y = 147 - line * 3;
      const indent = (n % 5 === 0 ? 0 : 2) + (n % 3);
      let x = 245 + indent;
      const tokens = 1 + Math.floor(lr() * 3);
      for (let k = 0; k < tokens && x < 265; k += 1) {
        const w = 2 + Math.floor(lr() * 6);
        const c = n % 11 === 0 ? P.pink : n % 7 === 0 ? P.amber : k === 0 ? P.lav : lr() < 0.5 ? X.logDim : P.soft;
        rect(x, y, Math.min(265, x + w - 1), y, c);
        x += w + 1;
      }
    }
  }

  function drawMotes(t) {
    for (const mote of motes) {
      const x = Math.round(mote.x + Math.sin(t / 1900 * mote.speed + mote.phase) * 5);
      const y = Math.round(mote.y + Math.cos(t / 2600 * mote.speed + mote.phase) * 4);
      if (Math.sin(t / 500 + mote.phase) > 0.1 && x >= 0 && x < W && y >= 0 && y < H) {
        const i = y * W + x;
        frame[i] = mix(frame[i], X.mote, 0.55);
      }
    }
  }

  return {
    render(t, frameIndex, out, shift) {
      frame.set(base);
      drawWindow(t, shift);
      for (let i = 0; i < W * H; i += 1) if (overlay[i]) frame[i] = overlay[i];
      drawSill(t, frameIndex);
      drawLights(t);
      drawLogs(t);
      drawScreen(frame, t, frameIndex, SURFACE);
      drawMan(frame, t, frameIndex, 1, SURFACE);
      for (let i = 0; i < W * H; i += 1) if (chair[i]) frame[i] = chair[i];
      drawMotes(t);
      out.set(frame);
    },
  };
}

// ---------- Palco: cobre a área, brilho e paralaxe ----------

// Só fontes de luz de verdade brilham: vidro da janela, telas, luminária, vela e varal.
function buildEmissiveMask() {
  const mask = new Uint8Array(W * H);
  const area = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) mask[y * W + x] = 1;
  };
  area(GLASS.x, GLASS.y, GLASS.x + GLASS.w - 1, 118);
  area(52, 119, GLASS.x + GLASS.w - 1, GLASS.y + GLASS.h - 1); // o gato dorme no canto esquerdo
  area(183, 112, 235, 150);
  area(243, 102, 267, 149);
  area(146, 116, 162, 121);
  area(99, 119, 103, 124);
  area(134, 6, W - 1, 20);
  return mask;
}

export function startDesktopScene(canvas, { reducedMotion = false, stage } = {}) {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return { pause() {}, resume() {}, destroy() {} };
  const room = createDesktopRoom();
  const emissive = buildEmissiveMask();

  const low = document.createElement("canvas");
  low.width = W;
  low.height = H;
  const lctx = low.getContext("2d");
  const image = lctx.createImageData(W, H);
  const pixels = new Uint32Array(image.data.buffer);

  // Bloom: só os pixels claros, reduzidos e ampliados com suavização.
  const glow = document.createElement("canvas");
  glow.width = W;
  glow.height = H;
  const gctx = glow.getContext("2d");
  const glowImage = gctx.createImageData(W, H);
  const glowPixels = new Uint32Array(glowImage.data.buffer);
  const hazeNear = document.createElement("canvas");
  hazeNear.width = 96;
  hazeNear.height = 80;
  const nctx = hazeNear.getContext("2d");
  const hazeFar = document.createElement("canvas");
  hazeFar.width = 36;
  hazeFar.height = 30;
  const fctx = hazeFar.getContext("2d");

  let width = 0;
  let height = 0;
  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = stage.getBoundingClientRect();
    const scale = Math.max((rect.width * dpr) / W, (rect.height * dpr) / H);
    width = Math.round(W * scale);
    height = Math.round(H * scale);
    canvas.width = width;
    canvas.height = height;
    const cssWidth = width / dpr;
    const cssHeight = height / dpr;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.style.left = `${-(cssWidth - rect.width) * 0.6}px`;
    canvas.style.top = `${-(cssHeight - rect.height) * 0.5}px`;
  }

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPointer = (event) => {
    pointer.tx = event.clientX / window.innerWidth - 0.5;
    pointer.ty = event.clientY / window.innerHeight - 0.5;
  };

  function draw(t, frameIndex) {
    pointer.x += (pointer.tx - pointer.x) * 0.08;
    pointer.y += (pointer.ty - pointer.y) * 0.08;
    stage.style.setProperty("--tilt-x", pointer.x.toFixed(4));
    stage.style.setProperty("--tilt-y", pointer.y.toFixed(4));

    room.render(t, frameIndex, pixels, Math.round(-pointer.x * PARALLAX * 2));
    lctx.putImageData(image, 0, 0);
    for (let i = 0; i < W * H; i += 1) {
      const v = pixels[i];
      const luma = (v & 0xff) * 0.3 + ((v >> 8) & 0xff) * 0.55 + ((v >> 16) & 0xff) * 0.15;
      glowPixels[i] = emissive[i] && luma > 115 ? v : 0;
    }
    gctx.putImageData(glowImage, 0, 0);
    nctx.clearRect(0, 0, 96, 80);
    nctx.drawImage(glow, 0, 0, 96, 80);
    fctx.clearRect(0, 0, 36, 30);
    fctx.drawImage(hazeNear, 0, 0, 36, 30);

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(low, 0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.42;
    ctx.drawImage(hazeNear, 0, 0, width, height);
    ctx.globalAlpha = 0.3;
    ctx.drawImage(hazeFar, 0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  fit();
  const resizeObserver = new ResizeObserver(() => {
    fit();
    draw(lastT, frameIndex);
  });
  resizeObserver.observe(stage);

  let lastT = 2600;
  let frameIndex = 0;
  if (reducedMotion) {
    draw(lastT, 0);
    return {
      pause() {},
      resume() {},
      destroy() {
        resizeObserver.disconnect();
      },
    };
  }

  window.addEventListener("pointermove", onPointer, { passive: true });
  const holds = new Set();
  let elapsed = 0;
  let last = 0;
  let lastDraw = -Infinity;
  let raf = 0;

  function tick(now) {
    raf = 0;
    if (holds.size) return;
    if (last) elapsed += Math.min(now - last, 100);
    last = now;
    if (now - lastDraw >= FRAME_MS) {
      lastDraw = now;
      frameIndex += 1;
      lastT = elapsed;
      draw(elapsed, frameIndex);
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
  const onVisibility = () => (document.hidden ? pause("hidden") : resume("hidden"));
  document.addEventListener("visibilitychange", onVisibility);
  draw(0, 0);
  raf = requestAnimationFrame(tick);

  return {
    pause,
    resume,
    destroy() {
      pause("destroyed");
      resizeObserver.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

// Usado pela página de revisão local para renderizar instantes específicos.
export { createDesktopRoom, W as DESKTOP_W, H as DESKTOP_H };
