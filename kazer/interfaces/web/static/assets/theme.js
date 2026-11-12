// Tema do KAZER: escuro (padrão), claro ou o do sistema.
//
// O claro vale só dentro do chat (`html.in-chat`): a tela de entrada é a cena da
// marca e fica escura sempre. A escolha fica no servidor (vale em todo aparelho)
// e uma cópia no aparelho evita o clarão de tela escura antes de a conta carregar.
//
// Cor de destaque (`data-accent`): "auto" usa dourado no escuro e turquesa no
// claro; "dourado" e "turquesa" fixam a mesma cor nos dois temas.

const dark = window.matchMedia("(prefers-color-scheme: dark)");
const COLORS = { claro: "#fcfcf9", escuro: "#141513" };
let preference = "escuro";
let accent = "auto";

function resolved() {
  if (preference === "sistema") return dark.matches ? "escuro" : "claro";
  return preference === "claro" ? "claro" : "escuro";
}

function paintAccent(theme) {
  const value = accent === "dourado" || accent === "turquesa" ? accent : theme === "claro" ? "turquesa" : "dourado";
  document.documentElement.dataset.accent = value;
}

export function applyTheme(value) {
  preference = ["escuro", "claro", "sistema"].includes(value) ? value : "escuro";
  const theme = resolved();
  document.documentElement.dataset.theme = theme === "claro" ? "light" : "dark";
  paintAccent(theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", COLORS[theme]);
  // Os canvas (quadradinhos) leem a cor do tema na hora de desenhar.
  window.dispatchEvent(new CustomEvent("kazer:theme", { detail: theme }));
}

export function applyAccent(value) {
  accent = ["auto", "dourado", "turquesa"].includes(value) ? value : "auto";
  paintAccent(resolved());
}

// "Sistema" acompanha o aparelho enquanto a aba está aberta.
dark.addEventListener("change", () => {
  if (preference === "sistema") applyTheme("sistema");
});

export const isLight = () => document.documentElement.dataset.theme === "light";
