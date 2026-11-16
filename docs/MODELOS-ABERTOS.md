# Modelos abertos no KAZER (novembro de 2026)

Resumo da pesquisa de modelos open-weight aplicada ao KAZER. Os números são das
fontes citadas na pesquisa original (Artificial Analysis, Arena, Vals AI e
fornecedores); confira preço e ID na página de cada provedor antes de mudar algo.

## O que entrou no código

| Seletor | Modelo | Rota | Cobrança do crédito (US$/1M entrada · saída) | Onde |
|---|---|---|---|---|
| Kimi K3.1 Pro | `moonshotai/kimi-k3.1-pro:floor` | OpenRouter | 2,00 · 10,00 (tabela da Moonshot, nunca o piso) | `kazer/billing/catalog.py` |
| DeepSeek V4.1 Flash | `deepseek-flash` (ou `deepseek/deepseek-v4.1-flash`) | API da DeepSeek; sem chave dela, OpenRouter | 0,30 · 1,20 (preço de pico) | idem |
| GLM-5.3 | `z-ai/glm-5.3` | OpenRouter | 1,40 · 4,40 | idem |
| KAZ 1.1 (reserva) | `qwen/qwen3.8-27b` | Groq | não gasta crédito | `GROQ_DEFAULT_TIERS` em `kazer/brain/model_provider.py` |

- Os três aparecem para Pro e Ultra, no mesmo seletor de Claude e GPT, e só ficam
  "prontos" quando a chave existe no servidor.
- Saída de até 32 768 tokens: esses modelos pensam muito antes de responder.
- Compatibilidade: um servidor que só tem `MOONSHOT_API_KEY` continua com o Kimi
  direto da Moonshot, como antes.
- Raciocínio de volta nas rodadas de pesquisa: o Kimi exige a mensagem completa do
  assistente e a DeepSeek chama ferramentas pior sem ela. O KAZER devolve o
  raciocínio da rodada (`reasoning_content` na DeepSeek, `reasoning` no OpenRouter);
  OpenAI e Groq nunca recebem esse campo.
- Tudo passa pelo servidor do KAZER. Nenhuma chave vai para o navegador, então os
  problemas de CORS citados na pesquisa (Z.ai, NVIDIA NIM) não se aplicam.

## Como ligar

```
OPENROUTER_API_KEY=...      # liga Kimi K3.1 Pro, GLM-5.3 e DeepSeek
DEEPSEEK_API_KEY=...        # opcional: DeepSeek direto, mais barato
```

Preço ou ID mudou? Sem deploy de código:

```
KAZER_MODEL_PRICES={"kimi": [2, 10], "deepseek": [0.3, 1.2], "glm": [1.4, 4.4]}
KAZER_KIMI_MODEL=moonshotai/kimi-k3.1-pro:nitro   # mais rápido em vez de mais barato
```

## O que ficou de fora, e por quê

- **NVIDIA NIM grátis**: a própria NVIDIA diz que não é para produção.
- **MiniMax M3**: licença não comercial por padrão.
- **Godot/GDScript**: não há benchmark público. O KAZER já pede Godot 4 e GDScript 2
  no prompt (`kazer/chat/context.py`); vale um teste A/B com 5 a 10 pedidos reais.
