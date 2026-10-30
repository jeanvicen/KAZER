// Letreiro em pixel: o nome do KZ Code, desenhado quadradinho a quadradinho.
//
// É o mesmo jeito do Kazinho e do campo de quadrados da conversa: pixel de
// verdade, sem fonte nova para baixar. Fica discreto — cor suave, tamanho do
// texto ao redor — mas não passa despercebido: de tempos em tempos um ou dois
// pixels piscam, devagar, e só quando o movimento está liberado.

const SVG = "http://www.w3.org/2000/svg";

// Cada letra é uma grade de 5 colunas por 7 linhas.
const GLYPHS = {
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  " ": ["000", "000", "000", "000", "000", "000", "000"],
};

const ROWS = 7;
const GAP = 1;

/**
 * Monta o SVG de uma palavra. `label` é o que o leitor de tela lê (o desenho
 * em si fica escondido), e `blink` diz quantos pixels piscam de vez em quando.
 */
export function pixelWord(text, { label = text, blink = 2 } = {}) {
  const letters = [...text.toUpperCase()].filter((ch) => GLYPHS[ch]);
  let x = 0;
  const cells = [];
  for (const letter of letters) {
    const grid = GLYPHS[letter];
    const width = grid[0].length;
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < width; col += 1) {
        if (grid[row][col] === "1") cells.push([x + col, row]);
      }
    }
    x += width + GAP;
  }
  const total = Math.max(x - GAP, 1);

  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${total} ${ROWS}`);
  svg.setAttribute("class", "pxword");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("focusable", "false");

  // Os pixels que piscam são escolhidos pelo texto, não por sorteio: o letreiro
  // fica igual em toda abertura, e dois letreiros iguais piscam do mesmo jeito.
  const picked = new Set();
  let seed = [...text].reduce((sum, ch) => sum + ch.charCodeAt(0), 7);
  while (picked.size < Math.min(blink, cells.length)) {
    seed = (seed * 31 + 11) % 9973;
    picked.add(seed % cells.length);
  }

  const still = document.createElementNS(SVG, "path");
  let d = "";
  cells.forEach(([cx, cy], index) => {
    if (picked.has(index)) return;
    d += `M${cx} ${cy}h1v1h-1z`;
  });
  still.setAttribute("d", d);
  still.setAttribute("class", "pxword__still");
  svg.append(still);

  let order = 0;
  for (const index of picked) {
    const [cx, cy] = cells[index];
    const rect = document.createElementNS(SVG, "rect");
    rect.setAttribute("x", String(cx));
    rect.setAttribute("y", String(cy));
    rect.setAttribute("width", "1");
    rect.setAttribute("height", "1");
    rect.setAttribute("class", "pxword__blink");
    // Atrasos espalhados: nunca piscam juntos. Vai por CSSOM (a CSP bloqueia `style`).
    rect.style.setProperty("--d", `${order * 3.1 + 1.4}s`);
    order += 1;
    svg.append(rect);
  }
  return svg;
}

// Troca `<span data-pixword="KZ CODE">KZ Code</span>` pelo letreiro, sem perder
// o texto para quem lê a página sem imagens.
export function hydratePixelWords(root = document) {
  for (const node of root.querySelectorAll("[data-pixword]")) {
    if (node.querySelector(".pxword")) continue;
    const label = node.textContent.trim() || node.dataset.pixword;
    node.replaceChildren(pixelWord(node.dataset.pixword, { label }));
  }
}
