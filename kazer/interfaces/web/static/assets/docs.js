// Documentos do KAZER: PDF e slides montados a partir do Markdown do modelo.
//
// O Markdown passa pelo mesmo renderizador seguro do chat (só textContent), e o
// resultado é serializado num HTML completo com o tema. Esse HTML só abre na
// moldura isolada da prévia (ou é baixado); o PDF sai pela impressão do
// navegador, com página A4 (documentos) ou 16:9 (slides).

import { MARK_PATHS } from "./dom.js";
import { render } from "./markdown.js";

// Símbolo do KAZER na capa dos documentos (mesma geometria do logo).
const BRAND_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true"><path fill-rule="evenodd" d="${MARK_PATHS.head}"/><path class="p" d="${MARK_PATHS.l}"/><path class="p" d="${MARK_PATHS.b}"/><path class="p" d="${MARK_PATHS.r}"/></svg>`;

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const color = (value, fallback) => (/^#[0-9a-f]{3,8}$/i.test(value || "") ? value : fallback);

// Serializa o DOM seguro do renderizador (texto já escapado pelo navegador).
function markdownHtml(text, headings = null) {
  const box = document.createElement("div");
  box.append(render(text || ""));
  // Botões do chat (copiar, baixar, prévia) não fazem sentido no documento.
  for (const node of box.querySelectorAll(".code__tools, .ask, .doc-card")) node.remove();
  for (const link of box.querySelectorAll("a")) link.setAttribute("target", "_blank");
  if (headings) for (const node of box.querySelectorAll("h2")) headings.push(node.textContent.trim());
  return box.innerHTML;
}

const today = () => new Date().toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });

// O alvo da impressão: a moldura avisa quando o pai pede o PDF.
const PRINT_BRIDGE = `<script>addEventListener("message",function(e){if(e.data&&e.data.kazerPrint){setTimeout(function(){print()},60)}});</script>`;

// ---------- PDF ----------

export function buildPdf(meta, body) {
  const accent = color(meta.cor || meta.color, "#2563eb");
  const title = meta.titulo || meta.title || "Documento";
  const subtitle = meta.subtitulo || meta.subtitle || "";
  const author = meta.autor || meta.author || "KAZER";
  const headings = [];
  const content = markdownHtml(body, headings);
  const sections = headings.filter(Boolean);
  const toc =
    sections.length >= 3
      ? `<nav class="toc"><h2 class="toc__title">Sumário</h2><ol>${sections.map((text) => `<li><span>${esc(text)}</span></li>`).join("")}</ol></nav>`
      : "";

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--a:${accent};--a-soft:color-mix(in srgb,var(--a) 9%,#fff);--a-dark:color-mix(in srgb,var(--a) 70%,#000);--ink:#0f172a;--ink-2:#475569;--line:#e2e8f0}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font:11pt/1.7 "Inter","Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;color:var(--ink);background:#e9edf3}
@page{size:A4;margin:20mm 18mm 22mm;@bottom-right{content:counter(page);font:9pt system-ui;color:#94a3b8}@bottom-left{content:"${esc(title).replace(/"/g, "")}";font:9pt system-ui;color:#94a3b8}}
@page:first{margin:0;@bottom-right{content:none}@bottom-left{content:none}}
.cover{position:relative;overflow:hidden;min-height:297mm;padding:30mm 24mm;display:flex;flex-direction:column;justify-content:space-between;color:#fff;background:radial-gradient(120% 80% at 100% 0%,color-mix(in srgb,var(--a) 70%,#fff) 0%,transparent 55%),linear-gradient(155deg,var(--a) 0%,var(--a-dark) 100%);break-after:page}
.cover::before,.cover::after{content:"";position:absolute;border-radius:50%;border:1.5px solid rgba(255,255,255,.18)}
.cover::before{width:150mm;height:150mm;right:-55mm;top:-40mm}
.cover::after{width:90mm;height:90mm;right:10mm;bottom:-30mm;background:rgba(255,255,255,.06)}
.cover__brand{display:flex;align-items:center;gap:10px;font-weight:600;letter-spacing:.24em;font-size:9pt;text-transform:uppercase;opacity:.9}
.cover__brand svg{width:22px;height:22px;fill:#fff}.cover__brand .p{stroke:#fff;stroke-width:1.6;stroke-linejoin:round}
.cover__main{position:relative;z-index:1}
.cover__kicker{display:inline-block;padding:5px 12px;border:1px solid rgba(255,255,255,.4);border-radius:99px;font-size:9pt;letter-spacing:.08em;text-transform:uppercase;margin-bottom:16mm}
.cover h1{color:#fff;font-size:38pt;line-height:1.08;margin:0 0 8mm;letter-spacing:-.02em;font-weight:800;max-width:150mm}
.cover p{font-size:14pt;opacity:.88;max-width:140mm;margin:0}
.cover__foot{display:flex;justify-content:space-between;font-size:10pt;opacity:.85;border-top:1px solid rgba(255,255,255,.3);padding-top:6mm;position:relative;z-index:1}
.sheet{background:#fff}
.toc{break-after:page;padding-top:4mm}
.toc__title{font-size:20pt;margin:0 0 8mm;color:var(--ink)}
.toc ol{list-style:none;padding:0;margin:0;counter-reset:t}
.toc li{counter-increment:t;display:flex;gap:14px;align-items:baseline;padding:10px 0;border-bottom:1px dashed var(--line);font-size:12pt}
.toc li::before{content:counter(t,decimal-leading-zero);color:var(--a);font-weight:800;font-size:11pt;min-width:26px}
h1,h2,h3,h4{break-after:avoid;color:var(--ink);line-height:1.25;letter-spacing:-.01em}
h2{font-size:19pt;margin:12mm 0 4mm;padding-bottom:3mm;border-bottom:2px solid var(--a);position:relative}
h2::before{content:"";position:absolute;left:0;bottom:-2px;width:28mm;height:4px;background:var(--a);border-radius:2px}
h3{font-size:14pt;margin:8mm 0 3mm;color:var(--a-dark)}
h4{font-size:12pt;margin:6mm 0 2mm}
p{margin:0 0 4mm;text-align:justify;hyphens:auto}
ul,ol{margin:0 0 4mm;padding-left:6mm}
li{margin:1.5mm 0}
li::marker{color:var(--a);font-weight:700}
strong{color:var(--ink);font-weight:700}
a{color:var(--a);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--a) 35%,transparent)}
blockquote{margin:5mm 0;padding:4mm 6mm;background:var(--a-soft);border-left:4px solid var(--a);border-radius:0 8px 8px 0;color:var(--ink);break-inside:avoid}
blockquote p:last-child{margin:0}
table{width:100%;border-collapse:separate;border-spacing:0;margin:5mm 0;font-size:10pt;break-inside:avoid;border:1px solid var(--line);border-radius:8px;overflow:hidden}
th{background:var(--a);color:#fff;text-align:left;font-weight:600;padding:3mm 4mm}
td{padding:2.6mm 4mm;border-top:1px solid var(--line)}
tr:nth-child(even) td{background:#f8fafc}
code{font:9.5pt ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#f1f5f9;padding:1px 5px;border-radius:4px;color:var(--a-dark)}
.code{margin:5mm 0;border-radius:10px;overflow:hidden;background:#0f172a;break-inside:avoid}
.code__bar{display:flex;gap:8px;padding:2.5mm 4mm;background:#1e293b;color:#94a3b8;font:8.5pt ui-monospace,monospace}
.code__file{display:flex;gap:6px;align-items:center}.code__file svg{display:none}
pre{margin:0;padding:4mm;white-space:pre-wrap;word-break:break-word}
pre code{background:none;color:#e2e8f0;padding:0}
hr{border:0;border-top:1px solid var(--line);margin:8mm 0}
@media screen{
  body{padding:24px 12px}
  .cover,.sheet{width:min(210mm,100%);margin:0 auto 20px;box-shadow:0 18px 50px rgba(15,23,42,.18);border-radius:6px}
  .cover{min-height:min(297mm,140vw);padding:clamp(24px,8vw,30mm) clamp(20px,6vw,24mm)}
  .cover h1{font-size:clamp(26px,7vw,38pt)}
  .sheet{padding:clamp(22px,6vw,20mm) clamp(18px,5vw,18mm)}
}
@media print{body{background:#fff}.cover,.sheet{box-shadow:none;border-radius:0;margin:0;width:auto}}
</style>${PRINT_BRIDGE}</head>
<body>
<section class="cover">
  <div class="cover__brand">${BRAND_SVG}KAZER</div>
  <div class="cover__main">
    ${meta.tipo ? `<span class="cover__kicker">${esc(meta.tipo)}</span>` : ""}
    <h1>${esc(title)}</h1>
    ${subtitle ? `<p>${esc(subtitle)}</p>` : ""}
  </div>
  <div class="cover__foot"><span>${esc(author)}</span><span>${esc(meta.data || today())}</span></div>
</section>
<main class="sheet">${toc}${content}</main>
</body></html>`;
}

// ---------- Slides ----------

function slideKind(markdown, index) {
  const lines = markdown.trim().split("\n").filter((line) => line.trim());
  if (lines.length === 1 && /^#{1,3}\s/.test(lines[0])) return "divider";
  if (lines.length <= 3 && lines.some((line) => /^\s*>/.test(line))) return "quote";
  if (lines.some((line) => /^\s*\*\*[^*]{1,24}\*\*\s*$/.test(line))) return "stat";
  return index % 5 === 3 ? "content alt" : "content";
}

export function buildSlides(meta, slides) {
  const accent = color(meta.cor || meta.color, "#d5b15a");
  const title = meta.titulo || meta.title || "Apresentação";
  const subtitle = meta.subtitulo || meta.subtitle || "";
  const author = meta.autor || meta.author || "KAZER";
  let section = 0;
  const pages = slides.map((markdown, index) => {
    const kind = slideKind(markdown, index);
    if (kind === "divider") section += 1;
    const number = kind === "divider" ? `<span class="slide__num">${String(section).padStart(2, "0")}</span>` : "";
    return `<section class="slide slide--${kind}" data-i="${index + 1}">${number}<div class="slide__body">${markdownHtml(markdown)}</div><footer class="slide__foot"><span>${esc(title)}</span><span>${index + 2}</span></footer></section>`;
  });
  const cover = `<section class="slide slide--cover" data-i="0"><div class="slide__orb"></div><div class="slide__body">${meta.tipo ? `<span class="kicker">${esc(meta.tipo)}</span>` : ""}<h1>${esc(title)}</h1>${subtitle ? `<p class="lede">${esc(subtitle)}</p>` : ""}<p class="by">${esc(author)} · ${esc(meta.data || today())}</p></div></section>`;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--a:${accent};--bg:#07070a;--ink:#f6f4ef;--ink-2:#a8a4a0;--line:rgba(255,255,255,.1)}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#000;color:var(--ink);font-family:"Inter","Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.deck{position:fixed;inset:0;display:grid;place-items:center;overflow:hidden}
.slide{position:absolute;width:1280px;height:720px;padding:84px 96px;background:radial-gradient(900px 500px at 92% -10%,color-mix(in srgb,var(--a) 22%,transparent),transparent 60%),radial-gradient(700px 420px at -10% 110%,color-mix(in srgb,var(--a) 10%,transparent),transparent 60%),var(--bg);overflow:hidden;opacity:0;visibility:hidden;transform:translateY(18px) scale(.985);transition:opacity .5s cubic-bezier(.16,1,.3,1),transform .6s cubic-bezier(.16,1,.3,1),visibility 0s .5s;transform-origin:center}
.slide.is-on{opacity:1;visibility:visible;transform:none;transition-delay:0s}
.slide::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,transparent 70%,rgba(0,0,0,.35));}
.slide__body{position:relative;z-index:1;height:100%;display:flex;flex-direction:column;justify-content:center}
.slide h1,.slide h2,.slide h3{margin:0 0 28px;letter-spacing:-.03em;line-height:1.05;font-weight:800}
.slide h1{font-size:72px}.slide h2{font-size:56px}.slide h3{font-size:44px}
.slide--content .slide__body{justify-content:flex-start;padding-top:8px}
.slide--content h2::after,.slide--content h1::after,.slide--content h3::after{content:"";display:block;width:72px;height:6px;border-radius:3px;margin-top:22px;background:var(--a)}
.slide p{font-size:28px;line-height:1.45;color:#dcd8d2;margin:0 0 18px;max-width:1000px}
.slide ul,.slide ol{margin:6px 0 0;padding:0;list-style:none;display:grid;gap:16px;max-width:1060px}
.slide li{font-size:28px;line-height:1.4;color:#e9e5df;padding:14px 22px 14px 58px;position:relative;background:rgba(255,255,255,.035);border:1px solid var(--line);border-radius:16px}
.slide li::before{content:"";position:absolute;left:22px;top:24px;width:14px;height:14px;border-radius:4px;background:var(--a);transform:rotate(45deg)}
.slide li ul{margin-top:10px}.slide li li{font-size:22px;background:none;border:0;padding:4px 0 4px 34px}.slide li li::before{left:6px;top:15px;width:9px;height:9px}
.slide.is-on li,.slide.is-on p,.slide.is-on table,.slide.is-on blockquote,.slide.is-on .code{animation:rise .7s cubic-bezier(.16,1,.3,1) both}
.slide.is-on li:nth-child(2){animation-delay:.08s}.slide.is-on li:nth-child(3){animation-delay:.16s}.slide.is-on li:nth-child(4){animation-delay:.24s}.slide.is-on li:nth-child(5){animation-delay:.32s}.slide.is-on li:nth-child(6){animation-delay:.4s}
@keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.slide strong{color:var(--a)}
.slide a{color:var(--a)}
.slide table{border-collapse:separate;border-spacing:0;font-size:24px;border:1px solid var(--line);border-radius:14px;overflow:hidden;min-width:70%}
.slide th{background:color-mix(in srgb,var(--a) 85%,#000);color:#0b0b0b;text-align:left;padding:14px 20px}
.slide td{padding:12px 20px;border-top:1px solid var(--line);color:#e2ded8}
.slide code{font:22px ui-monospace,Menlo,Consolas,monospace;background:rgba(255,255,255,.07);padding:2px 8px;border-radius:6px}
.slide .code{background:#0e0e12;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.slide .code__bar{padding:10px 18px;font:16px ui-monospace,monospace;color:var(--ink-2);border-bottom:1px solid var(--line);display:flex;gap:8px}
.slide .code__file svg{display:none}
.slide pre{margin:0;padding:20px;white-space:pre-wrap;font-size:20px}.slide pre code{background:none;padding:0;font-size:20px}
.slide--cover .slide__body{justify-content:flex-end;padding-bottom:20px}
.slide--cover h1{font-size:96px;max-width:1000px;color:#fff}
.slide--cover .lede{font-size:32px;color:#cfcac3;max-width:900px}
.slide--cover .by{font-size:20px;color:var(--ink-2);letter-spacing:.04em;margin-top:28px}
.kicker{display:inline-flex;align-self:flex-start;padding:8px 18px;border:1px solid color-mix(in srgb,var(--a) 60%,transparent);color:var(--a);border-radius:99px;font-size:18px;letter-spacing:.16em;text-transform:uppercase;margin-bottom:34px}
.slide__orb{position:absolute;left:96px;top:84px;width:56px;height:8px;border-radius:4px;background:var(--a)}

@keyframes float{50%{transform:translate(-20px,24px)}}
.slide--divider .slide__body{align-items:flex-start}
.slide--divider h1,.slide--divider h2,.slide--divider h3{font-size:92px;max-width:1000px}
.slide__num{position:absolute;right:80px;top:30px;font-size:300px;font-weight:900;line-height:1;color:transparent;-webkit-text-stroke:2px color-mix(in srgb,var(--a) 55%,transparent);opacity:.7}
.slide--quote blockquote{margin:0;padding:0 0 0 48px;border-left:8px solid var(--a);font-size:46px;line-height:1.3;font-weight:600;letter-spacing:-.01em}
.slide--quote blockquote p{font-size:46px;color:var(--ink)}
.slide--stat p strong{display:block;font-size:150px;line-height:1;letter-spacing:-.05em;color:var(--a);margin-bottom:8px}
.slide--content.alt{background:radial-gradient(800px 500px at 0% 0%,color-mix(in srgb,var(--a) 20%,transparent),transparent 60%),#0a0a0e}
.slide__foot{position:absolute;left:96px;right:96px;bottom:34px;display:flex;justify-content:space-between;font-size:16px;color:var(--ink-2);letter-spacing:.06em;z-index:2}
.slide--cover .slide__foot{display:none}
.hud{position:fixed;left:0;right:0;bottom:0;display:flex;align-items:center;gap:12px;padding:12px 16px;z-index:5;background:linear-gradient(transparent,rgba(0,0,0,.7));opacity:0;transition:opacity .3s}
body:hover .hud,.hud:focus-within,body.touch .hud{opacity:1}
.hud button{width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:18px;cursor:pointer}
.hud__bar{flex:1;height:4px;background:rgba(255,255,255,.15);border-radius:2px;overflow:hidden}
.hud__fill{height:100%;width:0;background:var(--a);transition:width .4s cubic-bezier(.16,1,.3,1)}
.hud__count{font:14px system-ui;color:#ddd;min-width:56px;text-align:right}
@media print{
  @page{size:1280px 720px;margin:0}
  html,body{height:auto;background:var(--bg)}
  .deck{position:static;display:block}
  .slide{position:relative;opacity:1;visibility:visible;transform:none!important;break-after:page;transition:none}
  .slide *{animation:none!important}
  .hud{display:none}
}
</style>${PRINT_BRIDGE}</head>
<body>
<main class="deck">${cover}${pages.join("")}</main>
<nav class="hud"><button type="button" data-go="-1" aria-label="Anterior">‹</button><div class="hud__bar"><div class="hud__fill"></div></div><span class="hud__count"></span><button type="button" data-go="1" aria-label="Próximo">›</button><button type="button" data-full aria-label="Tela cheia">⤢</button></nav>
<script>
(function(){
var slides=[].slice.call(document.querySelectorAll(".slide")),i=0,fill=document.querySelector(".hud__fill"),count=document.querySelector(".hud__count");
function fit(){var s=Math.min(innerWidth/1280,innerHeight/720);slides.forEach(function(el){el.style.scale=s})}
function show(n){i=Math.max(0,Math.min(slides.length-1,n));slides.forEach(function(el,k){el.classList.toggle("is-on",k===i)});fill.style.width=((i+1)/slides.length*100)+"%";count.textContent=(i+1)+" / "+slides.length}
addEventListener("resize",fit);fit();show(0);
addEventListener("keydown",function(e){if(["ArrowRight","PageDown"," ","Enter"].indexOf(e.key)>=0){e.preventDefault();show(i+1)}else if(["ArrowLeft","PageUp","Backspace"].indexOf(e.key)>=0){e.preventDefault();show(i-1)}else if(e.key==="Home"){show(0)}else if(e.key==="End"){show(slides.length-1)}else if(e.key==="f"){full()}});
document.querySelector(".hud").addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;e.stopPropagation();if(b.hasAttribute("data-full"))full();else show(i+Number(b.getAttribute("data-go")))});
document.querySelector(".deck").addEventListener("click",function(e){if(e.target.closest("a"))return;show(e.clientX>innerWidth/3?i+1:i-1)});
var x0=null;addEventListener("touchstart",function(e){document.body.classList.add("touch");x0=e.touches[0].clientX},{passive:true});addEventListener("touchend",function(e){if(x0===null)return;var d=e.changedTouches[0].clientX-x0;if(Math.abs(d)>40)show(d<0?i+1:i-1);x0=null});
function full(){var d=document.documentElement;if(!document.fullscreenElement&&d.requestFullscreen)d.requestFullscreen().catch(function(){});else if(document.exitFullscreen)document.exitFullscreen()}
addEventListener("beforeprint",function(){slides.forEach(function(el){el.style.scale=""})});addEventListener("afterprint",fit);
})();
</script>
</body></html>`;
}
