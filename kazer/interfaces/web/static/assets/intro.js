// Abertura: partículas reais convergem das bordas, formam KAZER e se abrem
// para revelar a autenticação. Roda ~1,9 s e para por completo ao terminar.

const CONVERGE_END = 1000;
const GLITCH_START = 990;
const GLITCH_END = 1130;
const SCAN_START = 1060;
const SCAN_END = 1330;
const DISPERSE_START = 1340;
const DISPERSE_LENGTH = 560;
const TOTAL = DISPERSE_START + DISPERSE_LENGTH;

const SHADES = ["#f5f5f5", "#d6d6d6", "#b4b4b4", "#929292"];
const SHADE_WEIGHTS = [0.52, 0.24, 0.14, 0.1];

function particleBudget(width) {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  let budget = 1500;
  if (cores <= 4 || memory <= 2) budget = 650;
  else if (cores <= 6 || memory <= 4) budget = 1000;
  if (width < 480) budget *= 0.8;
  return Math.round(budget);
}

function pickShade() {
  let r = Math.random();
  for (let i = 0; i < SHADE_WEIGHTS.length; i += 1) {
    r -= SHADE_WEIGHTS[i];
    if (r <= 0) return i;
  }
  return 0;
}

// Desenha o nome num canvas auxiliar e amostra uma grade regular de pontos.
function sampleWord(text, fontFamily, width, height, budget) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const g = canvas.getContext("2d", { willReadFrequently: true });
  const fontSize = Math.min(width * 0.21, height * 0.19, 172);
  g.font = `500 ${fontSize}px ${fontFamily}`;
  const tracking = fontSize * 0.12;
  const glyphs = [...text];
  const widths = glyphs.map((ch) => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (glyphs.length - 1);
  const metrics = g.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.72;
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.04;
  const centerY = height * 0.42;
  const baseline = centerY + (ascent - descent) / 2;
  let x = (width - total) / 2;
  g.fillStyle = "#fff";
  glyphs.forEach((ch, i) => {
    g.fillText(ch, x, baseline);
    x += widths[i] + tracking;
  });

  const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
  const inside = (px, py) => data[(py * canvas.width + px) * 4 + 3] > 140;

  let filled = 0;
  for (let py = 0; py < canvas.height; py += 2) {
    for (let px = 0; px < canvas.width; px += 2) if (inside(px, py)) filled += 4;
  }
  const gap = Math.min(7, Math.max(2.2, Math.sqrt(filled / budget)));
  const points = [];
  for (let py = gap / 2; py < canvas.height; py += gap) {
    for (let px = gap / 2; px < canvas.width; px += gap) {
      if (inside(Math.floor(px), Math.floor(py))) points.push(px, py);
    }
  }
  return {
    points,
    gap,
    font: g.font,
    glyphs,
    widths,
    tracking,
    baseline,
    left: (width - total) / 2,
    centerX: width / 2,
    centerY,
    fontSize,
    halfWidth: total / 2,
  };
}

// Brilho contido apenas atrás do nome (não se espalha pela tela).
function renderHalo(word, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const g = canvas.getContext("2d");
  const shift = canvas.width + 200;
  g.font = word.font;
  g.shadowColor = "rgba(245, 245, 245, 0.55)";
  g.shadowBlur = Math.max(18, word.gap * 9);
  g.shadowOffsetX = shift;
  g.fillStyle = "#fff";
  let x = word.left - shift;
  word.glyphs.forEach((ch, i) => {
    g.fillText(ch, x, word.baseline);
    x += word.widths[i] + word.tracking;
  });
  return canvas;
}

function startPoint(tx, ty, cx, cy, width, height) {
  // Projeta o alvo para fora, a partir do centro, até a borda (cantos incluídos).
  const angle = Math.atan2(ty - cy, tx - cx) + (Math.random() - 0.5) * 0.9;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const margin = 8 + Math.random() * 40;
  const limitX = dx > 0 ? (width + margin - cx) / dx : (-margin - cx) / dx;
  const limitY = dy > 0 ? (height + margin - cy) / dy : (-margin - cy) / dy;
  const reach = Math.min(Math.abs(limitX), Math.abs(limitY));
  return [cx + dx * reach, cy + dy * reach];
}

const easeOutQuart = (p) => 1 - (1 - p) ** 4;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function playIntro(canvas, { text, fontFamily, onReveal, onDone }) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    onReveal();
    onDone();
    return;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const word = sampleWord(text, fontFamily, width, height, particleBudget(width));
  const halo = renderHalo(word, width, height);
  const count = word.points.length / 2;

  // Estruturas em arrays tipados: sem alocação por quadro.
  const tx = new Float32Array(count);
  const ty = new Float32Array(count);
  const sx = new Float32Array(count);
  const sy = new Float32Array(count);
  const delay = new Float32Array(count);
  const span = new Float32Array(count);
  const size = new Float32Array(count);
  const curl = new Float32Array(count);
  const vx = new Float32Array(count);
  const vy = new Float32Array(count);
  const shade = new Uint8Array(count);

  const order = [];
  for (let i = 0; i < count; i += 1) {
    tx[i] = word.points[i * 2];
    ty[i] = word.points[i * 2 + 1];
    [sx[i], sy[i]] = startPoint(tx[i], ty[i], word.centerX, word.centerY, width, height);
    delay[i] = Math.random() * 300;
    span[i] = 560 + Math.random() * (CONVERGE_END - 600 - delay[i]);
    size[i] = Math.min(word.gap * 0.62, 1 + Math.random() * 0.7);
    curl[i] = (Math.random() - 0.5) * 70;
    shade[i] = pickShade();
    // Dispersão: as metades do nome se abrem para os lados, como uma passagem.
    const side = tx[i] < word.centerX ? -1 : 1;
    const fromCenter = Math.abs(tx[i] - word.centerX) / Math.max(word.halfWidth, 1);
    vx[i] = side * (60 + fromCenter * 140 + Math.random() * 120);
    vy[i] = (ty[i] - word.centerY) * 0.9 + (Math.random() - 0.5) * 60 - 20;
    order.push(i);
  }
  order.sort((a, b) => shade[a] - shade[b]);

  let start = 0;
  let frame = 0;
  let revealed = false;
  let finished = false;
  let glitchBands = [];

  const reveal = () => {
    if (revealed) return;
    revealed = true;
    onReveal();
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("pointerdown", skip);
    window.removeEventListener("keydown", skip);
    window.removeEventListener("resize", skip);
    reveal();
    canvas.classList.add("is-gone");
    window.setTimeout(() => {
      ctx.clearRect(0, 0, width, height);
      onDone();
    }, 200);
  };

  // Interação durante a abertura nunca espera a animação: revela na hora.
  function skip() {
    finish();
  }

  function glitchOffset(y) {
    for (const band of glitchBands) if (y >= band.y && y < band.y + band.h) return band.dx;
    return 0;
  }

  function draw(now) {
    if (!start) start = now;
    const t = now - start;
    ctx.clearRect(0, 0, width, height);

    if (t >= GLITCH_START && t < GLITCH_END && (glitchBands.length === 0 || Math.random() < 0.35)) {
      const top = word.centerY - word.fontSize * 0.42;
      glitchBands = Array.from({ length: 3 }, () => ({
        y: top + Math.random() * word.fontSize * 0.8,
        h: 3 + Math.random() * 10,
        dx: (Math.random() - 0.5) * 18,
      }));
    } else if (t >= GLITCH_END) {
      glitchBands = [];
    }

    // Halo discreto só enquanto o nome está formado.
    const haloIn = clamp01((t - 850) / 280);
    const haloOut = 1 - clamp01((t - DISPERSE_START) / (DISPERSE_LENGTH * 0.6));
    const haloAlpha = 0.16 * haloIn * haloOut;
    if (haloAlpha > 0.002) {
      ctx.globalAlpha = haloAlpha;
      ctx.drawImage(halo, 0, 0, width, height);
    }

    const scanX =
      t >= SCAN_START && t < SCAN_END
        ? word.centerX - word.halfWidth * 1.2 +
          ((t - SCAN_START) / (SCAN_END - SCAN_START)) * word.halfWidth * 2.4
        : -1e6;
    const dispersing = t >= DISPERSE_START;
    const dp = clamp01((t - DISPERSE_START) / DISPERSE_LENGTH);
    const travel = dp ** 1.7;
    const fade = (1 - dp) ** 1.4;

    let currentShade = -1;
    for (let k = 0; k < count; k += 1) {
      const i = order[k];
      if (shade[i] !== currentShade) {
        currentShade = shade[i];
        ctx.fillStyle = SHADES[currentShade];
      }
      let x;
      let y;
      let alpha;
      let s = size[i];
      if (!dispersing) {
        const p = clamp01((t - delay[i]) / span[i]);
        if (p <= 0) continue;
        const e = easeOutQuart(p);
        const bend = Math.sin(Math.PI * e) * curl[i];
        const dx = tx[i] - sx[i];
        const dy = ty[i] - sy[i];
        const len = Math.hypot(dx, dy) || 1;
        x = sx[i] + dx * e - (dy / len) * bend;
        y = sy[i] + dy * e + (dx / len) * bend;
        alpha = Math.min(1, p * 3.2) * (currentShade === 0 ? 1 : 0.85);
        if (p >= 1) {
          x += glitchOffset(y);
          const lit = Math.max(0, 1 - Math.abs(x - scanX) / 26);
          alpha = Math.min(1, alpha + lit * 0.6);
          s += lit * 0.5;
        }
      } else {
        x = tx[i] + vx[i] * travel;
        y = ty[i] + vy[i] * travel;
        alpha = fade * (currentShade === 0 ? 1 : 0.85);
        s *= 1 - dp * 0.4;
      }
      ctx.globalAlpha = alpha;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    if (dispersing && t >= DISPERSE_START + 40) reveal();
    if (t >= TOTAL) {
      finish();
      return;
    }
    frame = requestAnimationFrame(draw);
  }

  window.addEventListener("pointerdown", skip, { once: true });
  window.addEventListener("keydown", skip, { once: true });
  window.addEventListener("resize", skip, { once: true });
  frame = requestAnimationFrame(draw);
}
