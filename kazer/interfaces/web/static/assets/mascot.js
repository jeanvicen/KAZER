// O mascote do KAZER em pixel: o alien do logo de corpo inteiro (moletom,
// colar dourado, tênis). É o mesmo Kazinho da tela sem internet, parado e de
// frente, para as telas de boas-vindas — como os mascotes das ferramentas de
// código que cumprimentam quem chega.
//
// Desenhado como SVG de retângulos (nítido em qualquer tamanho, sem imagem
// para baixar). Pisca de vez em quando e balança um pixel; com "reduzir
// movimento" fica parado.

const SVG = "http://www.w3.org/2000/svg";

const ROWS = [
  "...wwwww...",
  ".wwwwwwwwh.",
  "wwwwwwwwwwh",
  "wwwwwwwwwwh",
  "weewwwwweeh",
  "wweewwweewh",
  ".wwwwwwwwh.",
  "..wwwwwwh..",
  "O...wwh...o",
  "oo.ooooo.oo",
  "..Lgggggg..",
  ".gLggbgggg.",
  ".gLgggggggg",
  ".wLggggggw.",
  "..DDDDDDD..",
  "..ll...ll..",
  "..ll...ll..",
  ".sss...sss.",
];

// Linhas dos olhos fechados (piscada): troca as duas linhas dos olhos.
const BLINK = { 4: "wwwwwwwwwwh", 5: "weeewwweeeh" };

const COLORS = {
  w: "#f5f5f5", h: "#c4c4c4", e: "#070707",
  o: "#d5b15a", O: "#f1dfa5",
  g: "#5d5d5d", L: "#767676", D: "#454545", b: "#d5b15a",
  l: "#3b3b3b", s: "#e8e8e8",
};

function runs(rows, group) {
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end += 1;
      if (ch !== "." && COLORS[ch]) {
        const r = document.createElementNS(SVG, "rect");
        r.setAttribute("x", String(x));
        r.setAttribute("y", String(y));
        r.setAttribute("width", String(end - x));
        r.setAttribute("height", "1");
        r.setAttribute("fill", COLORS[ch]);
        group.append(r);
      }
      x = end;
    }
  });
}

export function pixelMascot({ label = "Mascote do KAZER" } = {}) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${ROWS[0].length} ${ROWS.length}`);
  svg.setAttribute("class", "mascot");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("focusable", "false");
  const body = document.createElementNS(SVG, "g");
  body.setAttribute("class", "mascot__body");
  runs(ROWS, body);
  // Olhos fechados por cima, invisíveis até a piscada.
  const lids = document.createElementNS(SVG, "g");
  lids.setAttribute("class", "mascot__blink");
  runs(ROWS.map((row, y) => BLINK[y] || ".".repeat(row.length)), lids);
  body.append(lids);
  svg.append(body);
  return svg;
}
