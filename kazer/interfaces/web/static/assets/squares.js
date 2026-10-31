// Fundo da conversa vazia: um campo esparso de quadradinhos brancos e cinza.
// Cada um nasce, acende devagar, deriva alguns pixels e apaga. Três camadas de
// profundidade (tamanho, brilho e velocidade) dão volume sem virar "chuva".
// O centro e a área do composer ficam calmos. Canvas único, ~30 quadros/s,
// pausa com a aba oculta e libera tudo ao sair.

const FRAME_MS = 1000 / 30;
const CELL = 18; // grade invisível (px CSS): quadrados sempre alinhados a ela

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Um canvas pode ser reaproveitado: só o dono atual mexe no tamanho dele.
const owners = new WeakMap();

export function startAmbient(canvas, { reducedMotion = false } = {}) {
  const ctx = canvas.getContext("2d");
  const owner = {};
  owners.set(canvas, owner);
  let width = 0;
  let height = 0;
  let dpr = 1;
  let tiles = [];
  let raf = 0;
  let last = 0;
  let alive = true;
  let running = false;
  let origin = performance.now();

  function makeTile(now, warm) {
    const depth = Math.random() ** 1.6; // maioria ao fundo
    const flare = Math.random() < 0.06;
    const life = 5200 + Math.random() * 7800;
    return {
      gx: Math.floor(Math.random() * (width / CELL + 1)),
      gy: Math.floor(Math.random() * (height / CELL + 1)),
      size: depth > 0.72 ? 3 : depth > 0.38 ? 2 : 1.5,
      // deriva lenta, quase sempre para cima; os da frente andam mais
      vx: (Math.random() - 0.5) * (1.2 + depth * 2.2),
      vy: -(0.6 + depth * 3.2) * (0.5 + Math.random()),
      peak: flare ? 0.55 + Math.random() * 0.3 : 0.07 + depth * 0.22 + Math.random() * 0.06,
      white: flare || Math.random() < 0.28,
      twin: Math.random() < 0.08 ? (Math.random() < 0.5 ? [1, 0] : [0, 1]) : null,
      // salto discreto de uma célula, como um bit que muda de lugar
      hop: Math.random() < 0.12 ? 0.35 + Math.random() * 0.4 : -1,
      born: warm ? now - Math.random() * life : now + Math.random() * 1400,
      life,
    };
  }

  function resize() {
    if (!alive || owners.get(canvas) !== owner) return;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(220, Math.max(28, (width * height) / 6800)));
    const now = performance.now();
    while (tiles.length < count) tiles.push(makeTile(now, tiles.length > 0 || reducedMotion));
    tiles.length = count;
    if (!running) draw(now);
  }

  // Área calma: elipse no centro (marca e saudação) e faixa do composer.
  function calm(x, y) {
    const cx = (x - width / 2) / (width * 0.34);
    const cy = (y - height * 0.42) / (height * 0.2);
    const center = smoothstep(0.7, 1.35, Math.hypot(cx, cy));
    const bottom = 1 - smoothstep(height - 210, height - 90, y) * 0.92;
    const top = smoothstep(0, 70, y);
    return center * bottom * top;
  }

  function draw(now) {
    ctx.clearRect(0, 0, width, height);
    const intro = smoothstep(0, 1600, now - origin);
    for (let i = 0; i < tiles.length; i += 1) {
      let tile = tiles[i];
      let age = now - tile.born;
      if (age > tile.life) {
        tile = tiles[i] = makeTile(now, false);
        age = now - tile.born;
      }
      if (age < 0) continue;
      const t = age / tile.life;
      // acende rápido, segura, apaga devagar
      const envelope = smoothstep(0, 0.22, t) * (1 - smoothstep(0.6, 1, t));
      const seconds = age / 1000;
      const hopped = tile.hop > 0 && t > tile.hop ? 1 : 0;
      const x = Math.round((tile.gx + hopped) * CELL + tile.vx * seconds);
      const y = Math.round(tile.gy * CELL + tile.vy * seconds);
      if (x < -4 || y < -4 || x > width + 4 || y > height + 4) continue;
      const alpha = tile.peak * envelope * calm(x, y) * intro;
      const light = document.documentElement.dataset.theme === "light";
      if (alpha < 0.01) continue;
      ctx.fillStyle = light ? (tile.white ? `rgba(20,20,20,${alpha})` : `rgba(110,110,110,${alpha})`) : tile.white ? `rgba(245,245,245,${alpha})` : `rgba(146,146,146,${alpha})`;
      const s = tile.size;
      ctx.fillRect(x, y, s, s);
      if (tile.twin) ctx.fillRect(x + tile.twin[0] * (s + 2), y + tile.twin[1] * (s + 2), s, s);
    }
  }

  function frame(now) {
    if (!running) return;
    raf = window.requestAnimationFrame(frame);
    if (now - last < FRAME_MS) return;
    last = now;
    draw(now);
  }

  function play() {
    if (!alive || running || reducedMotion || document.hidden) return;
    running = true;
    raf = window.requestAnimationFrame(frame);
  }

  function pause() {
    running = false;
    window.cancelAnimationFrame(raf);
  }

  const onVisibility = () => (document.hidden ? pause() : play());
  const observer = new ResizeObserver(() => resize());
  observer.observe(canvas);
  document.addEventListener("visibilitychange", onVisibility);
  if (reducedMotion) origin = performance.now() - 5000; // quadro estático, já assentado
  resize();
  play();

  return {
    // Sai de cena: some suavemente, para o laço e libera a memória do canvas.
    leave() {
      if (!alive) return Promise.resolve();
      canvas.classList.add("is-leaving");
      return new Promise((resolve) => {
        const finish = () => {
          this.destroy();
          resolve();
        };
        if (reducedMotion) finish();
        else window.setTimeout(finish, 720);
      });
    },
    destroy() {
      if (!alive) return;
      alive = false;
      pause();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      tiles = [];
      if (owners.get(canvas) === owner) {
        owners.delete(canvas);
        canvas.width = 0;
        canvas.height = 0;
      }
    },
  };
}
