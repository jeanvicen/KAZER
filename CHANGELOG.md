# Changelog

Todas as mudanças relevantes do KAZER serão registradas aqui.

## [Unreleased]

- **Modo Computer.** O seletor Chat/Computer fica no campo de mensagem. No Chat o KAZER só lê (arquivos, commits, issues e PRs do repositório selecionado, projetos e deploys da Vercel, ferramentas MCP com `readOnlyHint`). No Computer ele também cria branches, grava arquivos, abre PRs e issues, refaz deploys e usa o terminal em sandbox. A regra vale no servidor (`api/chat.js`), e escrita na branch padrão é sempre recusada.
- **Conectores de verdade.** A tela de Conectores conecta GitHub (OAuth) e escolhe o repositório, conecta a Vercel por token cifrado (`/api/vercel`) e salva conectores MCP personalizados com token opcional.
- **KAZER Pro.** Checkout PIX via Abacate Pay (`/api/billing/checkout`), webhook verificado (`/api/billing/webhook`) e migração `023_vercel_and_pro_billing.sql` com limite 10× para o Pro. Sem `ABACATEPAY_API_KEY`, o botão avisa que o pagamento abre em breve.
- **Nova interface.** Paleta aço-noite (#06141B → #CCD0CF), alien 3D em camadas no chat, login, splash e documentos, trilho lateral no desktop, painel animado do Computer, log das ações executadas e revelação das respostas por tipo de bloco.
- Documentos ganharam as seções "Computer e conectores" e "KAZER Pro e pagamentos".
- Pesquisa de 16/10/2026 em `planos/PESQUISA-2026-10-16.md`: prensa no aparelho (logo chapado em SVG com ImageTracerJS 1.2.6 Unlicense, branco transparente no canvas, duotone, DPI, molde simples de caixa, conta da vitrine com a taxa que a pessoa digita, cartaz DE/POR, monograma). README, catálogo, ateliê, caixa e índice de `planos/` apontam para ela. Nenhum arquivo de `interface/`, `api/` ou `database/` foi alterado. Pix da Abacate conferido de novo: R$ 0,80, sem mensalidade. Potrace (GPL) fica de fora, no mesmo critério do FFmpeg da nota de 9/10.
- Pesquisa de 15/10/2026 em `planos/PESQUISA-2026-10-15.md`: gaveta no aparelho (HEIC só se o navegador já abre, fotos num PDF com pdf-lib MIT, cópia sem GPS com exifr MIT só para ler, tarja de CPF, foto 3×4, cartão .vcf sem hospedar, cartaz de avaliação, obrigado do pedido). README, catálogo, ateliê, caixa e índice de `planos/` apontam para ela. Nenhum arquivo de `interface/`, `api/` ou `database/` foi alterado. Pix da Abacate conferido de novo: R$ 0,80, sem mensalidade. libheif (LGPL) fica de fora, no mesmo critério do FFmpeg da nota de 9/10.
- Pesquisa de 14/10/2026 em `planos/PESQUISA-2026-10-14.md`: mesa do designer no aparelho (assinatura de e-mail em HTML, certificado de oficina, rampa OKLCH com culori MIT, folha de gráfica com sangria, grade 3×3 sem publicar, prancha local, quanto cobrar, vale da banca). README, catálogo, ateliê, caixa e índice de `planos/` apontam para ela. Nenhum arquivo de `interface/`, `api/` ou `database/` foi alterado. Pix da Abacate conferido de novo: R$ 0,80, sem mensalidade. A página também publica saque mínimo de R$ 3,50 e TED a R$ 5,00.
- Pesquisa de 13/10/2026 em `planos/PESQUISA-2026-10-13.md`: balcão no aparelho (etiqueta JsBarcode MIT, cardápio PT · JP, assinatura no papel, marca d'água com selo, figurinha 512, story via MediaRecorder sem FFmpeg, QR de Wi-Fi, anotador de print, semana de posts no Brain que já existe). README, catálogo, ateliê, caixa e índice de `planos/` apontam para ela. Nenhum arquivo de `interface/`, `api/` ou `database/` foi alterado. Pix da Abacate recarregado: R$ 0,80, sem mensalidade; cartão parcelado conferido na página de preços.
- Pesquisa de 12/10/2026 em `planos/PESQUISA-2026-10-12.md`: estúdio miúdo no aparelho (fundo SVG, vitrine, cartaz de link, ícone Lucide, contraste, carrossel, QR e recibo da banca, briefing no Brain que já existe). README, catálogo, ateliê e índice de `planos/` apontam para ela. Nenhum arquivo de `interface/`, `api/` ou `database/` foi alterado. Pix da Abacate recarregado: R$ 0,80, sem mensalidade.
- Pesquisa de 9/10/2026 em `planos/PESQUISA-2026-10-09.md`: bancada no browser (PDF, foto, recorte de pessoa, deck, cartão, OCR), atalho do Chrome só no desktop, Pix da Abacate conferido de novo. README e índice de `planos/` apontam para ela. Nenhum arquivo de `interface/`, `api/` ou `database/` foi alterado.
- README reorganizado: produto no ar, o que entra depois, e o caminho de receita sem gastar para começar.
- Pesquisa de 7/10/2026 em `planos/PESQUISA-2026-10-07.md`: Groq aposentou Llama 3.3 em 16/08/2026; Recraft V4.1 Vector; Abacate Pay assinatura sem taxa extra.
- Catálogo, Ateliê e Caixa atualizados com WhatsApp one-pager, pack de prompts e BYOK — sempre **ao lado**, nunca no lugar.
- Pasta `planos/` preenchida com catálogo de ferramentas, Ateliê, monetização zero e roadmap. Nenhum arquivo de `interface/`, `api/` ou `database/` foi removido ou substituído.
- Índice de `docs/` aponta para os planos.
- Adicionado CI no GitHub Actions para testes, regressões e auditoria de dependências.
- Centralizados o guia detalhado e os relatórios de auditoria em `docs/`.
- Adicionados testes estruturais executáveis com o runner nativo do Node.js.
- Fixada a versão mínima de Node.js em `.nvmrc`.
- Declarado `UNLICENSED` no `package.json` para refletir o caráter proprietário do projeto.
