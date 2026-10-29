// Cena do KAZER: um quarto à noite em pixel art. Janela com a cidade ao lado do
// computador, luminária quente, e um programador que digita, toma café e às
// vezes olha para quem está na tela. No monitor, o KAZER em versão "coder"
// alterna tarefas. Grade fixa de 144×160 pixels ampliada por fator inteiro.
// Puramente decorativa: não representa nenhum processo real do aplicativo.

const W = 144;
const H = 160;
const FRAME_MS = 1000 / 12;
const MAN_LOOP = 22000;
const SCREEN_LOOP = 18000;

const rgba = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0xff000000 | ((n & 0xff) << 16) | (n & 0xff00) | ((n >> 16) & 0xff)) >>> 0;
};

const P = Object.fromEntries(
  Object.entries({
    void: "#030303",
    wall0: "#100e20", wall1: "#16132b", wall2: "#1c1836", wall3: "#231e42", wall4: "#2b2550",
    warm1: "#2e2142", warm2: "#3d2944", warm3: "#523447",
    base: "#0d0b19", floor0: "#0f0c1b", floor1: "#151127", floor2: "#1b1630",
    rug: "#2a1d3c", rugEdge: "#3b2a55", rugDot: "#4a3466",
    sky0: "#080b24", sky1: "#0d1238", sky2: "#141a4e", sky3: "#211f63", sky4: "#352a73",
    star: "#e9e7ff", starDim: "#7f7bbd", moon: "#fff1c9", moonShade: "#d9c592", moonGlow: "#26276a",
    cityFar: "#1b1950", cityNear: "#0f0d2c", win1: "#ffcc66", win2: "#ff9f5a", win3: "#ffe9a8",
    beacon: "#ff6f91",
    frame: "#3e3458", frameHi: "#5f5287", frameLo: "#2a2340", sill: "#6b5c8c",
    glass: "#2a3070",
    curtain: "#5b2e52", curtainHi: "#743b67", curtainLo: "#42203c", rod: "#2b2440",
    desk: "#7e5038", deskHi: "#b07650", deskGrain: "#6d4430", deskFront: "#4b2c22", deskDark: "#331d17",
    shelf: "#7e5038", shelfLo: "#4b2c22",
    bookRose: "#c45a6a", bookAmber: "#e0a050", bookBlue: "#5c6bc0", bookPurple: "#8e6fc4",
    bookCream: "#d9d0c0", bookDark: "#2c2840",
    posterFrame: "#2b2440", posterMat: "#d9d0c0", posterBg: "#0d0d16", ink: "#f5f5f5",
    bezel: "#23202f", bezelHi: "#3a3550", bezelLo: "#16141e", stand: "#1c1a28",
    screen: "#0b0e22", screenBar: "#1b1938", screenGrid: "#11153a",
    lav: "#9d9cff", lavDim: "#5d5cb0", pink: "#ff7aa8", amber: "#ffcc66", soft: "#e9e7ff",
    lampBody: "#2c2840", lampShade: "#f2b65a", lampShadeLo: "#b9803a", bulb: "#fff4cf",
    keyboard: "#2c2840", key: "#4a4466", keyHi: "#9d9cff", mouse: "#3a3654",
    paper: "#d9d0c0", paperLine: "#a99f90",
    mug: "#f3efe8", mugShade: "#c9bfb0", coffee: "#4a2a1e", steam: "#bdbbe0",
    hair: "#1d1626", hairHi: "#3d3052", skin: "#e8b08a", skinLo: "#b97a5a", eye: "#1d1626",
    glass2: "#c8c6ff", rim: "#8b8cf0",
    hood: "#3b3f78", hoodLo: "#2a2c5a", hoodHi: "#565ca0", string: "#e9e7ff", pants: "#22243f",
    chair: "#2b2238", chairHi: "#57466e", chairLo: "#1e1828", chairStripe: "#c45a6a",
  }).map(([name, hex]) => [name, rgba(hex)]),
);

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

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

// ---------- Primitivas ----------

function painter(buf) {
  const px = (x, y, c) => {
    if (c !== undefined && x >= 0 && x < W && y >= 0 && y < H) buf[(y | 0) * W + (x | 0)] = c;
  };
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) px(x, y, c);
  };
  const disc = (cx, cy, r, c) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) px(x, y, c);
      }
    }
  };
  const line = (x0, y0, x1, y1, r, c) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let s = 0; s <= steps; s += 1) disc(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, r, c);
  };
  const sprite = (x, y, rows, map, flip = false) => {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i += 1) {
        const ch = row[flip ? row.length - 1 - i : i];
        if (ch !== ".") px(x + i, y + j, map[ch]);
      }
    });
  };
  return { px, rect, disc, line, sprite };
}

// Fonte 3×5 para o terminal do monitor.
const FONT3 = {
  A: "010101111101101", C: "011100100100011", D: "110101101101110", E: "111100110100111",
  I: "111010010010111", K: "101101110101101", O: "010101101101010", P: "110101110100100",
  R: "110101110101101", S: "011100010001110", T: "111010010010010", U: "101101101101111",
  Z: "111001010100111", ".": "000000000000010",
};

// ---------- Cenário estático ----------

function buildRoom() {
  const buf = new Uint32Array(W * H);
  const { px, rect, disc, line, sprite } = painter(buf);
  const pick = (ramp, v, x, y) => {
    const scaled = clamp(v, 0, 0.999) * (ramp.length - 1);
    const i = Math.floor(scaled);
    return ramp[Math.min(ramp.length - 1, i + (bayer(x, y) < scaled - i ? 1 : 0))];
  };
  const coolRamp = [P.wall0, P.wall1, P.wall2, P.wall3, P.wall4];
  const warmRamp = [P.wall1, P.warm1, P.warm2, P.warm3];

  // Parede: luz fria da janela à esquerda, quente da luminária à direita.
  for (let y = 0; y < 110; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const lamp = clamp(1 - Math.hypot((x - 124) * 0.9, (y - 74) * 1.1) / 44, 0, 1);
      const moon = clamp(1 - Math.hypot((x - 33) * 0.8, (y - 50) * 0.7) / 70, 0, 1);
      const shade = clamp(1 - y / 150, 0.4, 1);
      if (lamp > 0.18) px(x, y, pick(warmRamp, lamp * 1.05, x, y));
      else px(x, y, pick(coolRamp, (0.18 + moon * 0.55) * shade, x, y));
    }
  }
  rect(0, 108, W - 1, 111, P.base);

  // Piso com tábuas e tapete.
  for (let y = 112; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const plank = (y - 112) % 7 === 0 || (x + ((y - 112) / 7 | 0) * 23) % 41 === 0;
      px(x, y, plank ? P.floor0 : bayer(x, y) < 0.18 ? P.floor2 : P.floor1);
    }
  }
  for (let y = 132; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const d = ((x - 66) / 58) ** 2 + ((y - 152) / 20) ** 2;
      if (d <= 1) px(x, y, d > 0.86 ? P.rugEdge : (x + y) % 6 === 0 && d < 0.6 ? P.rugDot : P.rug);
    }
  }

  // Janela: céu, lua, cidade (janelas acesas são dinâmicas) e moldura.
  const sky = [P.sky0, P.sky1, P.sky2, P.sky3, P.sky4];
  for (let y = 18; y <= 80; y += 1) {
    for (let x = 10; x <= 56; x += 1) px(x, y, pick(sky, (y - 18) / 66, x, y));
  }
  for (let y = 18; y <= 80; y += 1) {
    for (let x = 10; x <= 56; x += 1) {
      const d = Math.hypot(x - 43, y - 29);
      if (d > 5.5 && d < 10 && bayer(x, y) < (10 - d) / 9) px(x, y, P.moonGlow);
    }
  }
  disc(43, 29, 5, P.moon);
  disc(45.5, 27.5, 4.4, P.sky1);
  px(40, 31, P.moonShade);
  px(41, 33, P.moonShade);
  const random = rng(11);
  let bx = 10;
  while (bx <= 56) {
    const w = 4 + Math.floor(random() * 6);
    const top = 58 + Math.floor(random() * 12);
    rect(bx, top, Math.min(56, bx + w - 1), 80, P.cityFar);
    bx += w + (random() < 0.3 ? 1 : 0);
  }
  bx = 9;
  while (bx <= 56) {
    const w = 5 + Math.floor(random() * 7);
    const top = 66 + Math.floor(random() * 10);
    rect(bx, top, Math.min(56, bx + w - 1), 80, P.cityNear);
    bx += w;
  }
  rect(22, 54, 23, 66, P.cityFar);
  // Moldura, travessas e peitoril.
  rect(6, 14, 60, 17, P.frame);
  rect(6, 81, 60, 84, P.frame);
  rect(6, 14, 9, 84, P.frame);
  rect(57, 14, 60, 84, P.frame);
  rect(32, 18, 34, 80, P.frame);
  rect(10, 48, 56, 50, P.frame);
  rect(6, 14, 60, 14, P.frameHi);
  rect(6, 14, 6, 84, P.frameHi);
  rect(60, 15, 60, 84, P.frameLo);
  rect(33, 18, 33, 80, P.frameHi);
  rect(10, 48, 56, 48, P.frameHi);
  rect(3, 85, 63, 86, P.sill);
  rect(3, 87, 63, 88, P.frameLo);
  for (let i = 0; i < 6; i += 1) {
    px(13 + i, 30 - i, P.glass);
    px(16 + i, 30 - i, P.glass);
  }

  // Cortina e varão.
  rect(0, 9, 68, 10, P.rod);
  disc(68, 9.5, 1.5, P.frameHi);
  for (let y = 11; y <= 100; y += 1) {
    const sway = Math.round(Math.sin(y / 9) * 0.6);
    for (let x = 0; x <= 7 + sway; x += 1) {
      const fold = (x + Math.round(y / 30)) % 4;
      px(x, y, fold === 0 ? P.curtainLo : fold === 2 ? P.curtainHi : P.curtain);
    }
  }

  // Quadro com o símbolo do KAZER.
  rect(70, 16, 88, 42, P.posterFrame);
  rect(71, 17, 87, 41, P.posterMat);
  rect(73, 19, 85, 39, P.posterBg);
  sprite(75, 22, [
    "....#.....",
    "...##.....",
    "..###.#...",
    ".####.##..",
    "#####.###.",
    ".####.####",
    "..###.###.",
    "...##.##..",
    "....#.#...",
    "......#...",
  ], { "#": P.ink });

  // Prateleira com livros.
  rect(96, 32, 143, 33, P.shelf);
  rect(96, 34, 143, 34, P.shelfLo);
  rect(100, 35, 101, 38, P.shelfLo);
  rect(138, 35, 139, 38, P.shelfLo);
  const books = [
    [P.bookRose, 11], [P.bookAmber, 9], [P.bookBlue, 12], [P.bookCream, 10], [P.bookPurple, 13],
    [P.bookDark, 11], [P.bookRose, 9], [P.bookBlue, 10],
  ];
  let x0 = 99;
  books.forEach(([color, height], i) => {
    const w = i % 3 === 0 ? 3 : 2;
    rect(x0, 31 - height, x0 + w - 1, 31, color);
    px(x0, 31 - height, P.soft);
    x0 += w + 1;
  });
  for (let i = 0; i < 9; i += 1) rect(x0 + i, 31 - i, x0 + i + 1, 31 - i, P.bookAmber);

  // Monitor (o conteúdo da tela é dinâmico).
  rect(66, 50, 120, 90, P.bezel);
  rect(66, 50, 120, 50, P.bezelHi);
  rect(66, 50, 66, 90, P.bezelHi);
  rect(120, 51, 120, 90, P.bezelLo);
  rect(67, 90, 120, 90, P.bezelLo);
  px(116, 88, P.lav);
  rect(90, 91, 96, 94, P.stand);
  rect(84, 95, 102, 95, P.stand);

  // Mesa com veios e luz da luminária.
  for (let y = 95; y <= 99; y += 1) {
    for (let x = 12; x < W; x += 1) {
      const warm = clamp(1 - Math.abs(x - 121) / 30, 0, 1);
      let c = (x * 7 + y * 13) % 17 === 0 ? P.deskGrain : P.desk;
      if (warm > 0.3 && bayer(x, y) < warm - 0.2) c = P.deskHi;
      px(x, y, c);
    }
  }
  rect(12, 95, W - 1, 95, P.deskHi);
  rect(12, 100, W - 1, 105, P.deskFront);
  rect(12, 106, W - 1, 106, P.deskDark);
  rect(16, 107, 19, 126, P.deskDark);
  rect(136, 107, 139, 126, P.deskDark);

  // Papéis, teclado e mouse.
  rect(14, 92, 25, 94, P.paper);
  rect(15, 93, 23, 93, P.paperLine);
  rect(16, 91, 26, 91, P.paperLine);
  rect(78, 96, 108, 98, P.keyboard);
  for (let x = 79; x <= 107; x += 2) px(x, 97, P.key);
  rect(78, 96, 108, 96, P.key);
  rect(112, 97, 115, 98, P.mouse);

  // Luminária articulada com cone de luz quente.
  for (let y = 84; y <= 93; y += 1) {
    for (let x = 108; x <= 132; x += 1) {
      const spread = (y - 74) * 0.75;
      if (Math.abs(x - 121) < spread && bayer(x, y) < 0.16) px(x, y, P.warm3);
    }
  }
  line(131, 92, 135, 80, 0.7, P.lampBody);
  line(135, 80, 129, 71, 0.7, P.lampBody);
  disc(135, 80, 1, P.lampShadeLo);
  rect(126, 93, 137, 94, P.lampBody);
  rect(127, 93, 136, 93, P.bezelHi);
  sprite(114, 66, [
    "..........###.",
    "......#######.",
    "...##########.",
    ".############.",
    "#############.",
    ".bbbbbbbbbbb..",
  ], { "#": P.lampShade, b: P.bulb });
  rect(115, 70, 126, 70, P.lampShadeLo);

  // Encosto da cadeira em primeiro plano (o corpo passa por trás).
  const chair = new Uint32Array(W * H);
  const cp = painter(chair);
  for (let y = 113; y < H; y += 1) {
    for (let x = 44; x <= 84; x += 1) {
      const top = y - 113;
      const corner = Math.min(x - 44, 84 - x);
      if (top < 5 && corner < 5 - top) continue;
      cp.px(x, y, x > 77 ? P.chairHi : x < 50 ? P.chairLo : P.chair);
    }
  }
  for (let x = 49; x <= 79; x += 1) cp.px(x, 113, P.chairHi);
  cp.rect(47, 119, 47, H - 1, P.chairStripe);
  cp.rect(81, 119, 81, H - 1, P.chairStripe);
  for (let y = 124; y < H; y += 6) cp.rect(52, y, 76, y, P.chairLo);

  return { room: buf, chair };
}

// ---------- Personagem ----------

const HEADS = {
  back: [
    ".....hhhhhh.....",
    "...hhhhhhhhhh...",
    "..hhhHHhhhhhhh..",
    ".hhhHhhhhhhhhhh.",
    ".hhhhhhhhhhhhhrr",
    "hhhhhhhhhhhhhhhr",
    "hhhhhhhhhhhhhhhr",
    "hhhhhhhhhhhhhhsr",
    "shhhhhhhhhhhhhsr",
    "sShhhhhhhhhhhhSr",
    ".Shhhhhhhhhhhhs.",
    "..hhhhhhhhhhhh..",
    "...hhhhhhhhhh...",
    "....SssssssS....",
    "....SssssssS....",
  ],
  half: [
    ".....hhhhhh.....",
    "...hhhhhhhhhh...",
    "..hhhHHhhhhhhh..",
    ".hhhHhhhhhhhhhh.",
    ".hhhhhhhhhhhhhrr",
    "hhhhhhhhhhhhhhhr",
    "sshhhhhhhhhhhhhr",
    "ssshhhhhhhhhhhhr",
    "sssShhhhhhhhhhsr",
    "sssShhhhhhhhhhhr",
    ".ssShhhhhhhhhhs.",
    "..sShhhhhhhhhh..",
    "...Shhhhhhhhh...",
    "....SssssssS....",
    "....SssssssS....",
  ],
  face: [
    ".....hhhhhh.....",
    "...hhhhhhhhhh...",
    "..hHHhhhhhhhhh..",
    ".hHhhhhhhhhhhhh.",
    ".hhhhhhhhhhhhhrr",
    "hhsshhhhhhhhhhhr",
    "hssssssshhhhhhhr",
    "gggggggggShhhhhr",
    "geGgsgeGgshhhhsr",
    "sgggSsgggshhhhsr",
    ".sssSssssShhhhs.",
    "..ssssssSShhhh..",
    "...sSSSSShhhh...",
    "....SssssssS....",
    "....SssssssS....",
  ],
  blink: [
    ".....hhhhhh.....",
    "...hhhhhhhhhh...",
    "..hHHhhhhhhhhh..",
    ".hHhhhhhhhhhhhh.",
    ".hhhhhhhhhhhhhrr",
    "hhsshhhhhhhhhhhr",
    "hssssssshhhhhhhr",
    "gggggggggShhhhhr",
    "gSSggsSSgshhhhsr",
    "sgggSsgggshhhhsr",
    ".sssSssssShhhhs.",
    "..ssssssSShhhh..",
    "...sSSSSShhhh...",
    "....SssssssS....",
    "....SssssssS....",
  ],
};
const HEAD_MAP = {
  h: P.hair, H: P.hairHi, s: P.skin, S: P.skinLo, e: P.eye, g: P.hair, G: P.glass2, r: P.rim,
};
const MUG = [".wwww.", "wcccc.", "wwwwwW", "wwwwWW", "wwwwW.", ".WWW.."];
const MUG_MAP = { w: P.mug, W: P.mugShade, c: P.coffee };

// Linha do tempo do personagem (ms dentro do loop de 22 s).
function manPose(t) {
  if (t >= 5500 && t < 9200) {
    const k = t - 5500;
    const stage = k < 600 ? "reach" : k < 1100 ? "lift" : k < 2700 ? "sip" : k < 3200 ? "lift" : "reach";
    return { head: stage === "sip" ? "half" : "back", mug: stage, typing: false, tilt: stage === "sip" ? -1 : 0 };
  }
  if (t >= 14500 && t < 17300) {
    const k = t - 14500;
    if (k < 400 || k >= 2400) return { head: "half", mug: "desk", typing: false, tilt: 0 };
    const blink = k >= 1400 && k < 1520;
    return { head: blink ? "blink" : "face", mug: "desk", typing: false, tilt: 0 };
  }
  return { head: "back", mug: "desk", typing: true, tilt: 0 };
}

function drawMan(buf, t, frameIndex, screenGlow) {
  const { px, rect, line, sprite } = painter(buf);
  const pose = manPose(t % MAN_LOOP);
  const breath = Math.sin((t / 4200) * Math.PI * 2) > 0.6 ? -1 : 0;

  // Tronco (moletom) visto de costas.
  for (let y = 97; y < H; y += 1) {
    const yy = y - 97;
    const half = yy < 5 ? 10.5 + yy * 1.8 : Math.max(16.5, 19.5 - (yy - 5) * 0.08);
    const cx = 62;
    for (let x = Math.ceil(cx - half); x <= Math.floor(cx + half); x += 1) {
      let c = P.hood;
      if (x > cx + half - 2.5) c = P.rim;
      else if (x > cx + half - 5) c = P.hoodHi;
      else if (x < cx - half + 4) c = P.hoodLo;
      else if (yy > 8 && (x === cx - 6 || x === cx + 4) && bayer(x, y) < 0.7) c = P.hoodLo;
      px(x, y + (y < 104 ? breath : 0), c);
    }
  }
  // Capuz caído nas costas.
  rect(54, 95 + breath, 70, 99 + breath, P.hoodLo);
  rect(55, 95 + breath, 69, 95 + breath, P.hoodHi);

  // Braço direito ao teclado (luz do monitor no contorno).
  const typingNow = pose.typing && Math.floor(t / 140) % 3 !== 0;
  const hy = typingNow && frameIndex % 2 === 0 ? -1 : 0;
  line(80, 101 + breath, 86, 108, 2.4, P.hood);
  line(86, 108, 90, 99 + hy, 1.8, P.hood);
  line(82, 100 + breath, 88, 107, 0.8, P.rim);
  rect(89, 97 + hy, 92, 98 + hy, P.skin);
  px(92, 97 + hy, P.skinLo);
  if (typingNow) px(94 + ((t / 140) | 0) % 10, 97, P.keyHi);

  // Braço esquerdo: digita ou pega o café.
  const ARM = {
    desk: { elbow: [40, 110], hand: null, mug: [27, 89] },
    reach: { elbow: [37, 107], hand: [32, 93], mug: [27, 89] },
    lift: { elbow: [37, 108], hand: [37, 91], mug: [35, 86] },
    sip: { elbow: [39, 107], hand: [46, 89], mug: [45, 84] },
  }[pose.mug];
  line(45, 101 + breath, ARM.elbow[0], ARM.elbow[1], 2.6, P.hoodLo);
  if (ARM.hand) {
    line(ARM.elbow[0], ARM.elbow[1], ARM.hand[0], ARM.hand[1] + 1, 1.8, P.hoodLo);
    line(ARM.elbow[0] + 1, ARM.elbow[1] - 1, ARM.hand[0] + 1, ARM.hand[1] + 2, 0.6, P.hood);
  }
  const mugAt = { x: ARM.mug[0], y: ARM.mug[1], inHand: pose.mug !== "desk" };

  // Cabeça e pescoço.
  sprite(54, 80 + breath + pose.tilt, HEADS[pose.head], HEAD_MAP);
  if (pose.head === "face" && Math.floor(t / 260) % 5 === 0) px(57, 88 + breath, P.soft);

  // Caneca (e vapor quando está na mesa).
  sprite(mugAt.x, mugAt.y, MUG, MUG_MAP);
  if (mugAt.inHand) {
    rect(ARM.hand[0] - 1, ARM.hand[1] - 1, ARM.hand[0] + 1, ARM.hand[1] + 1, P.skin);
    px(ARM.hand[0] + 1, ARM.hand[1] + 1, P.skinLo);
  } else {
    for (let i = 0; i < 2; i += 1) {
      for (let k = 0; k < 7; k += 1) {
        const life = ((t / 90 + k * 3 + i * 9) % 21) / 21;
        const sy = mugAt.y - 1 - Math.floor(life * 10);
        const sx = mugAt.x + 2 + i + Math.round(Math.sin(t / 400 + k + i * 2) * 1.2);
        if (bayer(sx, sy) > life * 0.9) px(sx, sy, P.steam);
      }
    }
  }

  // Luz do monitor no rosto quando ele olha para a tela.
  if (pose.head !== "face" && screenGlow > 0.5) px(69, 88 + breath, P.rim);
}

// ---------- Tela: o KAZER coder em ação ----------

const SX = 67;
const SY = 51;
const SW = 53;
const SH = 39;

function drawScreen(buf, t, frameIndex) {
  const { px, rect, sprite } = painter(buf);
  const s = t % SCREEN_LOOP;
  rect(SX, SY, SX + SW - 1, SY + SH - 1, P.screen);
  for (let y = SY + 4; y < SY + SH; y += 4) for (let x = SX; x < SX + SW; x += 4) px(x, y, P.screenGrid);
  rect(SX, SY, SX + SW - 1, SY + 6, P.screenBar);
  px(SX + 2, SY + 3, P.pink);
  px(SX + 4, SY + 3, P.amber);
  px(SX + 6, SY + 3, P.lav);
  [..."KAZER"].forEach((ch, i) => {
    const bits = FONT3[ch];
    for (let b = 0; b < 15; b += 1) {
      if (bits[b] === "1") px(SX + 17 + i * 4 + (b % 3), SY + 1 + Math.floor(b / 3), P.lavDim);
    }
  });

  const activity = Math.floor(s / 3600);
  const local = s % 3600;
  const thinking = activity === 4;

  // O personagem: o símbolo do KAZER com olhos, braços e um laptop.
  const bx = SX + 4;
  const by = SY + 18;
  const swing = thinking ? Math.round(Math.sin(local / 180) * 2) : 0;
  const bob = !thinking && Math.floor(local / 160) % 2 === 0 ? 1 : 0;
  sprite(bx, by - 2 + swing, [
    "....#",
    "...##",
    "..###",
    ".####",
    "#####",
    ".####",
    "..###",
    "...##",
    "....#",
  ], { "#": P.ink });
  sprite(bx + 6, by + 1 - swing, [
    "#....",
    "##...",
    "###..",
    "####.",
    "#####",
    "####.",
    "###..",
    "##...",
    "#....",
  ], { "#": P.ink });
  const blink = local % 1700 < 110;
  px(bx + 3, by + 2 + swing, blink ? P.ink : P.screen);
  px(bx + 7, by + 5 - swing, blink ? P.ink : P.screen);
  rect(bx + 1, by + 11, bx + 13, by + 11, P.lavDim);
  rect(bx + 3, by + 9 + bob, bx + 4, by + 9 + bob, P.lav);
  rect(bx + 9, by + 9 + (1 - bob), bx + 10, by + 9 + (1 - bob), P.lav);
  rect(bx + 2, by + 12, bx + 12, by + 12, P.lav);
  if (thinking) {
    for (let i = 0; i < 3; i += 1) {
      if (Math.floor(local / 250) % 4 > i) px(bx + 3 + i * 3, by - 6, P.soft);
    }
  }

  // Área de trabalho à direita: código, testes, construção, entrega, pensamento.
  const ax = SX + 20;
  const ay = SY + 9;
  if (activity === 0) {
    const random = rng(5);
    const lines = Math.min(7, Math.floor(local / 420) + 1);
    for (let l = 0; l < lines; l += 1) {
      let x = ax + (l % 3 === 1 ? 3 : l % 3 === 2 ? 6 : 0);
      const tokens = 2 + Math.floor(random() * 3);
      for (let k = 0; k < tokens && x < SX + SW - 3; k += 1) {
        const w = 2 + Math.floor(random() * 5);
        const c = [P.amber, P.pink, P.lav, P.soft][Math.floor(random() * 4)];
        rect(x, ay + l * 4, Math.min(SX + SW - 3, x + w - 1), ay + l * 4, c);
        x += w + 1;
      }
    }
    if (Math.floor(local / 260) % 2 === 0) rect(ax, ay + lines * 4, ax + 1, ay + lines * 4, P.soft);
  } else if (activity === 1) {
    for (let r = 0; r < 5; r += 1) {
      const y = ay + 1 + r * 5;
      const done = local > 450 + r * 420;
      const failed = r === 3 && local < 2700;
      rect(ax, y, ax + 3, y + 3, P.screenBar);
      if (done) {
        const c = failed ? P.pink : P.soft;
        if (failed) {
          px(ax, y, c); px(ax + 3, y, c); px(ax + 1, y + 1, c); px(ax + 2, y + 2, c);
          px(ax, y + 3, c); px(ax + 3, y + 3, c); px(ax + 2, y + 1, c); px(ax + 1, y + 2, c);
        } else {
          px(ax, y + 2, c); px(ax + 1, y + 3, c); px(ax + 2, y + 2, c); px(ax + 3, y + 1, c);
        }
      }
      rect(ax + 6, y + 1, ax + 6 + 8 + ((r * 7) % 12), y + 2, done ? P.lavDim : P.screenBar);
    }
  } else if (activity === 2) {
    const placed = Math.min(14, Math.floor(local / 210));
    const order = [[0, 0], [5, 0], [10, 0], [15, 0], [2, 1], [7, 1], [12, 1], [5, 2], [10, 2], [2, 3], [7, 3], [12, 3], [7, 4], [7, 5]];
    const colors = [P.amber, P.pink, P.lav, P.soft];
    for (let i = 0; i < placed; i += 1) {
      const [cx, row] = order[i];
      const y = ay + 24 - row * 4;
      rect(ax + cx, y, ax + cx + 4, y + 2, colors[i % 4]);
      px(ax + cx, y, P.soft);
    }
    if (placed < 14) {
      const [cx, row] = order[placed];
      const fall = Math.min(1, (local % 210) / 210);
      const y = Math.round(ay + (24 - row * 4) * fall);
      rect(ax + cx, y, ax + cx + 4, y + 2, colors[placed % 4]);
    }
  } else if (activity === 3) {
    const progress = clamp(local / 1800, 0, 1);
    rect(ax, ay + 2, ax + 27, ay + 4, P.screenBar);
    rect(ax, ay + 2, ax + Math.round(27 * progress), ay + 4, P.lav);
    if (local > 1800) {
      const lift = Math.floor((local - 1800) / 60);
      const ry = ay + 23 - lift;
      if (ry > ay + 5) {
        sprite(ax + 12, ry, [".#.", "###", "#P#", "###", "#.#"], { "#": P.soft, P: P.pink });
        if (frameIndex % 2 === 0) px(ax + 13, ry + 5, P.amber);
        px(ax + 13, ry + 6, P.pink);
      } else {
        const ok = "OK";
        [...ok].forEach((ch, i) => {
          const bits = FONT3[ch] || "111101101101111";
          for (let b = 0; b < 15; b += 1) {
            if (bits[b] === "1") px(ax + 10 + i * 4 + (b % 3), ay + 14 + Math.floor(b / 3), P.soft);
          }
        });
      }
    }
  } else {
    for (let i = 0; i < 9; i += 1) {
      const phase = (local / 300 + i * 0.7) % 3;
      if (phase < 1.4) px(ax + 4 + ((i * 11) % 24), ay + 6 + ((i * 7) % 20), i % 2 ? P.lav : P.amber);
    }
  }

  // Leve varredura de monitor.
  for (let y = SY + 7; y < SY + SH; y += 2) {
    for (let x = SX; x < SX + SW; x += 1) {
      const i = y * W + x;
      if (buf[i] === P.screen) buf[i] = P.screenGrid;
    }
  }
}

// ---------- Céu vivo ----------

function drawSky(buf, t, stars, lights) {
  const { px } = painter(buf);
  for (const star of stars) {
    const on = Math.sin(t / star.speed + star.phase) > -0.2;
    px(star.x, star.y, on ? (star.bright ? P.star : P.starDim) : P.sky1);
  }
  for (const light of lights) {
    const on = light.blink ? Math.floor(t / light.blink + light.phase) % 5 !== 0 : true;
    if (on) px(light.x, light.y, light.color);
  }
  // Avião cruzando o céu a cada 11 s.
  const plane = (t % 11000) / 11000;
  const ax = Math.round(10 + plane * 46);
  if (plane < 1 && ax <= 56 && ax !== 33 && ax !== 34 && ax !== 32) {
    const ay = 40 - Math.round(plane * 8);
    if (ay !== 48 && ay !== 49 && ay !== 50) px(ax, ay, Math.floor(t / 300) % 2 ? P.beacon : P.star);
  }
  // Farol vermelho da torre.
  if (Math.floor(t / 700) % 2 === 0) px(22, 53, P.beacon);
}

function buildSky() {
  const random = rng(29);
  const stars = [];
  while (stars.length < 22) {
    const x = 10 + Math.floor(random() * 47);
    const y = 19 + Math.floor(random() * 32);
    const nearMoon = Math.hypot(x - 43, y - 29) < 9;
    const onFrame = (x >= 32 && x <= 34) || (y >= 48 && y <= 50);
    if (nearMoon || onFrame) continue;
    stars.push({ x, y, bright: random() < 0.35, speed: 400 + random() * 900, phase: random() * 6 });
  }
  const lights = [];
  for (let i = 0; i < 26; i += 1) {
    const x = 11 + Math.floor(random() * 45);
    const y = 62 + Math.floor(random() * 17);
    if (x >= 32 && x <= 34) continue;
    lights.push({
      x,
      y,
      color: [P.win1, P.win2, P.win3][Math.floor(random() * 3)],
      blink: random() < 0.3 ? 300 + random() * 500 : 0,
      phase: Math.floor(random() * 5),
    });
  }
  return { stars, lights };
}

// Vinheta pontilhada: o quarto se dissolve no preto da página.
function buildVignette() {
  const edges = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const side = Math.min(x, W - 1 - x) / 9;
      const top = y / 7;
      const bottom = (H - 1 - y) / 16;
      const keep = clamp(Math.min(side, top, bottom), 0, 1);
      if (keep < 1) edges.push(y * W + x, Math.round(keep ** 1.4 * 256));
    }
  }
  return Int32Array.from(edges);
}

export function createRoom() {
  const { room, chair } = buildRoom();
  const { stars, lights } = buildSky();
  const vignette = buildVignette();
  const frame = new Uint32Array(W * H);
  return {
    width: W,
    height: H,
    render(t, frameIndex, out) {
      frame.set(room);
      drawSky(frame, t, stars, lights);
      drawScreen(frame, t, frameIndex);
      drawMan(frame, t, frameIndex, 1);
      for (let i = 0; i < W * H; i += 1) if (chair[i]) frame[i] = chair[i];
      for (let k = 0; k < vignette.length; k += 2) {
        const i = vignette[k];
        const f = vignette[k + 1];
        const v = frame[i];
        const r = 3 + ((((v & 0xff) - 3) * f) >> 8);
        const g = 3 + (((((v >> 8) & 0xff) - 3) * f) >> 8);
        const b = 3 + (((((v >> 16) & 0xff) - 3) * f) >> 8);
        frame[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
      }
      out.set(frame);
    },
  };
}

// ---------- Ciclo de animação ----------

export function startScene(canvas, { reducedMotion = false } = {}) {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return { pause() {}, resume() {}, destroy() {} };
  canvas.width = W;
  canvas.height = H;
  const room = createRoom();
  const image = ctx.createImageData(W, H);
  const pixels = new Uint32Array(image.data.buffer);
  const draw = (t, frameIndex) => {
    room.render(t, frameIndex, pixels);
    ctx.putImageData(image, 0, 0);
  };

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
    draw(3000, 0);
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

  // Para quando a aba some, a cena sai da tela ou a tela de conta está aberta.
  const onVisibility = () => (document.hidden ? pause("hidden") : resume("hidden"));
  document.addEventListener("visibilitychange", onVisibility);
  const io = new IntersectionObserver(([entry]) =>
    entry.isIntersecting ? resume("offscreen") : pause("offscreen"),
  );
  io.observe(canvas);
  draw(0, 0);
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
