// Tema do KAZER: escuro (padrão), claro ou o do sistema.
//
// O claro vale só dentro do chat (`html.in-chat`): a tela de entrada é a cena da
// marca e fica escura sempre. A escolha fica no servidor (vale em todo aparelho)
// e uma cópia no aparelho evita o clarão de tela escura antes de a conta carregar.

const dark = window.matchMedia("(prefers-color-scheme: dark)");
const COLORS = { claro: "#fafafa", escuro: "#030303" };
let preference = "escuro";

function resolved() {
  if (preference === "sistema") return dark.matches ? "escuro" : "claro";
  return preference === "claro" ? "claro" : "escuro";
}

export function applyTheme(value) {
  preference = ["escuro", "claro", "sistema"].includes(value) ? value : "escuro";
  const theme = resolved();
  document.documentElement.dataset.theme = theme === "claro" ? "light" : "dark";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", COLORS[theme]);
  // Os canvas (quadradinhos) leem a cor do tema na hora de desenhar.
  window.dispatchEvent(new CustomEvent("kazer:theme", { detail: theme }));
}

// "Sistema" acompanha o aparelho enquanto a aba está aberta.
dark.addEventListener("change", () => {
  if (preference === "sistema") applyTheme("sistema");
});

export const isLight = () => document.documentElement.dataset.theme === "light";
