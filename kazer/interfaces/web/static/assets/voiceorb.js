// Esfera viva do modo voz (canvas 2D, sem bibliotecas).
//
// Cada estado tem um jeito de se mexer:
// - ouvindo: respira devagar; pulsa quando chega texto reconhecido;
// - pensando: as luzes giram em volta, mais escura;
// - falando: a borda ondula com a fala (fronteiras de palavra reais da síntese,
//   ou o volume real do áudio no motor gateway);
// - pausado/erro/conectando: quase parada e dessaturada.
// O nível vem de fora (setLevel/pulse); sem sinal, só o movimento do estado.

const PRESETS = {
  conectando: { speed: 0.35, wobble: 0.02, glow: 0.25, spin: 0.2, sat: 0.35, light: 0.75 },
  ouvindo: { speed: 0.6, wobble: 0.035, glow: 0.45, spin: 0.25, sat: 1, light: 1 },
  pensando: { speed: 1.4, wobble: 0.03, glow: 0.3, spin: 1.6, sat: 0.85, light: 0.82 },
  falando: { speed: 1.0, wobble: 0.05, glow: 0.6, spin: 0.45, sat: 1, light: 1.05 },
  pausado: { speed: 0.2, wobble: 0.015, glow: 0.18, spin: 0.1, sat: 0.3, light: 0.7 },
  erro: { speed: 0.2, wobble: 0.01, glow: 0.12, spin: 0.05, sat: 0.15, light: 0.6 },
  idle: { speed: 0.2, wobble: 0.015, glow: 0.2, spin: 0.1, sat: 0.5, light: 0.8 },
};

const lerp = (a, b, t) => a + (b - a) * t;

export function createOrb(canvas, { reduced = () => false } = {}) {
  const ctx = canvas.getContext("2d");
  let state = "idle";
  let current = { ...PRESETS.idle };
  let level = 0; // nível alvo (0..1)
  let shown = 0; // nível suavizado
  let pulses = 0;
  let frame = 0;
  let time = 0;
  let last = 0;
  let size = 0;

  function fit() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const box = canvas.getBoundingClientRect();
    const next = Math.round(Math.max(box.width, 1) * ratio);
    if (next !== size) {
      size = next;
      canvas.width = size;
      canvas.height = size;
    }
  }

  function blob(cx, cy, radius, phase, amount) {
    const points = 96;
    ctx.beginPath();
    for (let i = 0; i <= points; i += 1) {
      const angle = (i / points) * Math.PI * 2;
      const wave =
        Math.sin(angle * 3 + phase * 1.3) * 0.5 +
        Math.sin(angle * 5 - phase * 1.7) * 0.3 +
        Math.sin(angle * 2 + phase * 0.6) * 0.2;
      const r = radius * (1 + wave * amount);
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function draw(now) {
    frame = window.requestAnimationFrame(draw);
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    fit();
    const target = PRESETS[state] || PRESETS.idle;
    for (const key of Object.keys(current)) current[key] = lerp(current[key], target[key], 0.06);
    pulses *= 0.9;
    shown = lerp(shown, Math.min(1, level + pulses), 0.25);
    level *= 0.92;
    const motion = reduced() ? 0 : 1;
    time += dt * current.speed * motion;

    const s = size;
    const c = s / 2;
    const base = s * 0.34 * (1 + shown * 0.1 * motion);
    ctx.clearRect(0, 0, s, s);

    // Halo.
    const halo = ctx.createRadialGradient(c, c, base * 0.6, c, c, s * 0.5);
    halo.addColorStop(0, `rgba(226, 190, 120, ${0.18 + current.glow * 0.25 + shown * 0.2})`);
    halo.addColorStop(1, "rgba(226, 190, 120, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, s, s);

    ctx.save();
    ctx.filter = `saturate(${current.sat}) brightness(${current.light})`;
    const amount = (current.wobble + shown * 0.09) * motion;

    // Corpo: ouro champanhe.
    blob(c, c, base, time * 2, amount);
    const body = ctx.createRadialGradient(c - base * 0.35, c - base * 0.4, base * 0.1, c, c, base * 1.15);
    body.addColorStop(0, "#fff3d6");
    body.addColorStop(0.35, "#e6c27a");
    body.addColorStop(0.75, "#b8873b");
    body.addColorStop(1, "#6e4a1c");
    ctx.fillStyle = body;
    ctx.fill();

    // Luzes que giram dentro (dão profundidade, como líquido).
    ctx.save();
    blob(c, c, base, time * 2, amount);
    ctx.clip();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 3; i += 1) {
      const angle = time * current.spin * (i % 2 ? -1 : 1) + (i * Math.PI * 2) / 3;
      const x = c + Math.cos(angle) * base * 0.45;
      const y = c + Math.sin(angle) * base * 0.45;
      const light = ctx.createRadialGradient(x, y, 0, x, y, base * 0.9);
      const tones = ["255, 236, 190", "240, 200, 130", "255, 250, 235"];
      light.addColorStop(0, `rgba(${tones[i]}, ${0.35 + shown * 0.25})`);
      light.addColorStop(1, `rgba(${tones[i]}, 0)`);
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, s, s);
    }
    ctx.restore();

    // Brilho de vidro no alto.
    const shine = ctx.createRadialGradient(c - base * 0.3, c - base * 0.55, 0, c - base * 0.3, c - base * 0.55, base * 0.7);
    shine.addColorStop(0, "rgba(255, 255, 255, 0.45)");
    shine.addColorStop(1, "rgba(255, 255, 255, 0)");
    blob(c, c, base, time * 2, amount);
    ctx.fillStyle = shine;
    ctx.fill();
    ctx.restore();
  }

  return {
    start() {
      if (!frame) frame = window.requestAnimationFrame(draw);
    },
    stop() {
      window.cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    },
    setState(next) {
      state = PRESETS[next] ? next : "idle";
    },
    setLevel(value) {
      level = Math.max(level, Math.min(1, value));
    },
    pulse(amount = 0.5) {
      pulses = Math.min(1, pulses + amount);
    },
  };
}
