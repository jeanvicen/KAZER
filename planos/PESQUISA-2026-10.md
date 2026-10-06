# Pesquisa 6 de outubro de 2026

Fontes abertas. Nada disto altera código de `api/` ou `interface/`. Serve para decidir o que entra **ao lado**.

## Providers de inferência sem cartão

| Provider | Faixa livre (publicada) | Melhor uso no KAZER |
|---|---|---|
| Groq | Velocidade alta, Llama / Gemma / Whisper, sem cartão para a chave | Conversa e síntese (já é o Brain) |
| Hugging Face | Modelos open, Qwen Coder | Coding (já é a fila de código) |
| Google AI Studio | Gemini Flash, contexto grande, 1.500 req/dia em faixas recentes | Reserva de contexto longo |
| OpenRouter `:free` | ~50 req/dia (ou 1.000 após recarga única de US$ 10) | Fallback, não produção única |
| Cerebras / Mistral / OVH | Créditos renováveis em 2026 | Reserva, nunca obrigatório |

Conclusão: **não pagar GPU**. Empilhar Groq + HF + um Flash gratuito. BYOK para quem quiser Grok/Claude.

## O que o mercado cobra e o KAZER pode imitar barato

| Produto | Preço de entrada 2026 | Função que o usuário sente | Versão KAZER a R$ 0 de GPU |
|---|---|---|---|
| ChatGPT Plus | ~US$ 20 | Chat + arquivos + pesquisa | Já no ar |
| Perplexity Pro | ~US$ 20 | Pesquisa com citação | WebKazer já no ar |
| Canva Pro | ~US$ 12–15 | Brand kit + social | Ateliê SVG + kit |
| Recraft Basic | ~US$ 10–12 | SVG nativo | `kazer-svg` + export |
| Gamma Plus | ~US$ 9 | Deck | Proposta HTML + social 16:9 |
| ElevenLabs | a partir de ~US$ 5 | Voz | Web Speech PT/JP |
| Grok Skills | incluso no Grok | Word / slides / PDF nativos | Proposta + SVG, depois PDF no cliente |

## Designers — o gap real

91% dos designers usam IA toda semana (Designer Fund / Foundation Capital 2026). Recraft continua o único grande nome com **SVG verdadeiro**. Esse é o furo: o KAZER já pensa em `kazer-svg`. Falta só o botão de baixar e o kit de marca, sem reescrever o chat.

## Pagamento no Brasil

Abacate Pay: PIX R$ 0,80 por parcela, assinatura sem taxa extra, cadastro grátis. Mercado Pago: conta sem mensalidade. PIX é o checkout. Stripe/cartão gringo fica para depois, se um dia fizer sentido.
