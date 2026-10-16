# Ateliê — o que o designer do KAZER vai ter

Recraft é o único grande estúdio que devolve **SVG de verdade** (não raster vetorizado depois). Canva Magic Studio ganha em velocidade de layout. Gamma ganha em deck. O KAZER não compete com GPU: compete com **arquivo no cliente**.

## Peças

1. **Selo** — iniciais + anel Obsidian & Gold, ou direção Nippon / Cerrado / Editorial / Metal.
2. **Brand kit** — paleta, serif + sans, tokens CSS baixáveis.
3. **Peça social** — 1080×1080, 1080×1920, 1920×1080.
4. **Voz** — `pt-BR` e `ja-JP` no sintetizador do aparelho.
5. **Proposta** — HTML imprimível com PIX, prazo e 50/50.

## Peças de 12 de outubro (plano, ainda não no ar)

Somam. Não substituem as cinco acima. Licença e ordem em [PESQUISA-2026-10-12.md](PESQUISA-2026-10-12.md).

6. **Oficina de fundo** — blob, onda, grão, malha, SVG baixável.
7. **Vitrine** — celular e notebook em CSS. A foto fica no aparelho.
8. **Cartaz de link** — 1200×630 para Open Graph.
9. **Capa de destaque** — círculo de story.
10. **Carrossel** — 1080×1350, várias lâminas, zip no cliente.
11. **Grade** — ícone Lucide e favicon, sem marca de terceiro.
12. **Par de cores** — contraste e daltonismo.
13. **Banca** — QR da chave Pix da pessoa, mais recibo de uma folha. Não é o caixa do Pro.
14. **Briefing** — o Brain atual devolve paleta e tom para estas peças usarem.

## Peças de 13 de outubro (plano, ainda não no ar)

Somam. Não substituem as de cima. Licença e ordem em [PESQUISA-2026-10-13.md](PESQUISA-2026-10-13.md).

15. **Etiqueta de gôndola** — preço e código de barras no aparelho. Não é nota fiscal.
16. **Cardápio** — uma folha, português ou português e japonês.
17. **Assinatura desenhada** — entra no recibo e na proposta. Não é certificado.
18. **Marca d'água em lote** — o grátis leva o selo KAZER. O Pro leva o logo da pessoa.
19. **Figurinha 512** — quadrado para status, sem marca de aplicativo de mensagem.
20. **Story em vídeo** — gravação nativa do navegador, só depois do carrossel. Sem FFmpeg.
21. **QR do Wi-Fi** — senha da loja só no celular.
22. **Anotador de print** — seta, texto e tarja na foto local.
23. **Cartão PT · JP** — duas faces, texto vertical, QR de contato.
24. **Antes / depois** — duas fotos locais, um controle CSS.
25. **Semana de posts** — sete linhas do Brain que já existe.

## Peças de 14 de outubro (plano, ainda não no ar)

Somam. Não substituem as de cima. Licença e ordem em [PESQUISA-2026-10-14.md](PESQUISA-2026-10-14.md).

26. **Assinatura de e-mail** — tabela HTML para colar no Gmail. Não hospeda foto e não é a assinatura desenhada no papel.
27. **Certificado de oficina** — nome, oficina e data. Não é diploma.
28. **Rampa de cor** — culori (MIT), hex e OKLCH. O par de contraste da peça 12 continua.
29. **Folha de gráfica** — marca de corte, sangria de 3 mm, px ↔ mm. É a margem, não o cardápio.
30. **Grade 3×3** — nove fotos locais, um PNG. Não publica e não é o carrossel.
31. **Prancha** — quadro de referência no aparelho. Não é o antes/depois.
32. **Quanto cobrar** — hora, material e margem. Não é o contador.
33. **Vale da banca** — código local impresso. Não é cupom fiscal.

## Peças de 15 de outubro (plano, ainda não no ar)

Somam. Não substituem as de cima. Licença e ordem em [PESQUISA-2026-10-15.md](PESQUISA-2026-10-15.md).

34. **HEIC → JPEG** — só se o navegador já abre. Sem libheif.
35. **Fotos num PDF** — pdf-lib (MIT). Não é juntar PDF com PDF.
36. **Cópia sem GPS** — exifr (MIT) só avisa. O canvas apaga o EXIF.
37. **Tarja de dado** — esconde CPF, conta ou telefone. Não é o anotador de print.
38. **Foto 3×4** — guia e folha 10×15. Não é documento de órgão.
39. **Cartão .vcf** — contato que o celular guarda. Não hospeda perfil.
40. **Cartaz de avaliação** — link que a loja já tem. Fica no balcão.
41. **Obrigado do pedido** — cartão pequeno para o pacote. Não é nota.

## Peças de 16 de outubro (plano, ainda não no ar)

Somam. Não substituem as de cima. Licença e ordem em [PESQUISA-2026-10-16.md](PESQUISA-2026-10-16.md).

42. **Logo chapado → SVG** — ImageTracerJS (Unlicense). Recusa foto. A linha “feito no KAZER” fica fora da marca.
43. **Branco → transparente** — canvas. Não é o recorte de pessoa.
44. **Duotone** — duas tintas na foto local. Não é a rampa OKLCH.
45. **DPI da gráfica** — pixels e centímetros. Não é a folha de sangria.
46. **Caixa simples** — um molde em milímetro. A gráfica confere. Não é 3D.
47. **Conta da vitrine** — a pessoa digita a taxa que o painel mostrou. Não é o contador.
48. **Cartaz DE/POR** — preço riscado na gôndola. Não é a etiqueta de código.
49. **Monograma** — letras em 16–512. Não é o selo da casa nem a grade Lucide.

## Direção de arte (já documentada)

O visual do Brain continua em [`docs/visual-system.md`](../docs/visual-system.md): `kazer-svg` e `kazer-html`, composição com foco, sem cartão repetido. O ateliê só **reutiliza** essa linguagem.

## O que não fazer

- Não gerar imagem raster paga para o plano livre.
- Não mover o selo para dentro de `interface/chat.html` apagando o composer.
- Não pedir cartão para baixar SVG.
- Não guardar a chave Pix do usuário no servidor.
- Não guardar senha de Wi-Fi nem o traço da assinatura no servidor.
- Não guardar lista de alunos, preço do cliente nem código de vale no servidor.
- Não hospedar a foto da assinatura de e-mail.
- Não subir HEIC, foto de documento, CPF, GPS ou .vcf para o servidor.
- Não empacotar libheif nem outro wasm de codec copyleft.
- Não chamar a foto 3×4 de documento oficial.
- Não hospedar o cartão de visita. O .vcf baixa. O perfil não mora na Vercel.
- Não subir logo, foto ou molde da prensa para o servidor.
- Não empacotar Potrace nem outro traçador GPL. O traço é ImageTracerJS (Unlicense).
- Não gravar taxa de marketplace no código. A pessoa digita a porcentagem do painel.
- Não chamar o molde de caixa de faca aprovada pela gráfica.
- Não prometer traço de foto com qualidade de estúdio pago.
- Não colocar o selo dentro dos caminhos do logo.
