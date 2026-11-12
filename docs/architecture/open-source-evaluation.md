# Avaliação de código aberto

**Como foi verificado.** Licença e data do último *push* vêm da API do GitHub
(`search/repositories`, campo `license.spdx_id`) consultada em **2026-11-10**. Onde o
GitHub respondeu `NOASSERTION`, o arquivo `LICENSE` do repositório foi lido direto.
Versão e licença do Fabric.js também foram conferidas no registro do npm.

**O que NÃO foi possível verificar nesta sessão:** os *model cards* do Hugging Face
(a rede bloqueia `huggingface.co`). Para pesos de modelo, o que está aqui é o que o
**README do repositório oficial** declara; a licença do peso precisa ser conferida no
model card antes de qualquer uso comercial. Está marcado como **pendente** onde vale.

Legenda da decisão: **Adotado** (em uso no KAZER) · **Já em uso** (estava antes) ·
**Candidato** (bom, ainda sem necessidade medida) · **Rejeitado** (motivo ao lado).

## 1. Editor / canvas (KAZER Studio)

| Projeto | Licença (evidência) | Último push | Encaixe no KAZER | Decisão |
|---|---|---|---|---|
| [fabricjs/fabric.js](https://github.com/fabricjs/fabric.js) | MIT (SPDX + `LICENSE` + npm `fabric@7.4.0`) | 2026-11-10 | Canvas 2D com objetos, seleção, grupos, texto editável e serialização JSON. ES module único de 299 kB, sem `eval`, funciona com a CSP estrita (testado no navegador, console limpo) | **Adotado** (vendorizado em `static/assets/vendor/`, com a licença) |
| [konvajs/konva](https://github.com/konvajs/konva) | MIT (arquivo `LICENSE` lido; SPDX veio `NOASSERTION`) | 2026-11-09 | Equivalente; texto editável exige montar um `<textarea>` por conta própria | Candidato (reserva) |
| [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | MIT | 2026-11-09 | Quadro branco com traço "à mão"; depende de React e de *build* — o KAZER não tem nenhum dos dois | Rejeitado para o Studio (bom para um futuro quadro de diagramas) |
| [tldraw/tldraw](https://github.com/tldraw/tldraw) | **Licença própria** (`LICENSE.md`: uso em "Production Environment" exige licença da tldraw, Inc.) | 2026-11-10 | — | **Rejeitado**: não é código aberto para produção |
| [pixijs/pixijs](https://github.com/pixijs/pixijs) | MIT | 2026-11-10 | Renderizador WebGL; não traz edição de objetos | Rejeitado (nível baixo demais) |
| [svgdotjs/svg.js](https://github.com/svgdotjs/svg.js) | MIT (arquivo `LICENSE.txt` lido) | 2026-08-04 | SVG; exportar PNG/JPEG exigiria rasterizar | Rejeitado |
| [leaferjs/leafer-ui](https://github.com/leaferjs/leafer-ui) | MIT | 2026-11-10 | Canvas rápido, documentação majoritariamente em chinês | Candidato |

## 2. Geração de imagem (modelos e execução)

Nenhum destes roda "de graça": todos precisam de GPU. O KAZER **não embute nenhum**;
ele fala com um servidor de inferência seu por um contrato HTTP pequeno
(`kazer/images/providers.py`, `docs/images/RUNTIME.md`).

| Projeto | Licença do **código** | Licença do **peso** | Requisitos / observações | Decisão |
|---|---|---|---|---|
| [Tongyi-MAI/Z-Image](https://github.com/Tongyi-MAI/Z-Image) (Z-Image-Turbo) | Apache-2.0 (SPDX) | **Pendente**: conferir no model card `Tongyi-MAI/Z-Image-Turbo` | README: 8 passos, "cabe em 16 GB de VRAM"; integra com stable-diffusion.cpp e Diffusers | Candidato nº 1 para o servidor próprio |
| [QwenLM/Qwen-Image](https://github.com/QwenLM/Qwen-Image) | Apache-2.0 (SPDX) | README: "Qwen-Image is licensed under Apache 2.0" (confirmar no model card) | Forte em texto dentro da imagem; modelo grande (mais VRAM) | Candidato |
| [black-forest-labs/flux](https://github.com/black-forest-labs/flux) | Apache-2.0 (SPDX) | **Varia por modelo** (tabela do README): `FLUX.1 [schnell]` Apache-2.0; `FLUX.1 [dev]`, Fill, Canny, Depth, Redux e Kontext são **Non-Commercial** | — | Só `schnell` é candidato; os `dev` estão **rejeitados** para produto pago |
| [Stability-AI/generative-models](https://github.com/Stability-AI/generative-models) (SDXL) | MIT (SPDX) | Pendente (pesos SDXL têm licença própria, OpenRAIL) | Qualidade abaixo dos acima | Candidato de reserva |
| [leejet/stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) | MIT (SPDX) | — (motor) | Inferência em C++ (CUDA/Vulkan); o README do Z-Image cita suporte | Candidato (execução leve) |
| [huggingface/diffusers](https://github.com/huggingface/diffusers) | Apache-2.0 | — (biblioteca) | Forma mais simples de servir um modelo por HTTP | Candidato (execução recomendada) |
| [comfyanonymous/ComfyUI](https://github.com/comfyanonymous/ComfyUI) | **GPL-3.0** (arquivo `LICENSE` lido) | — | Roda como serviço separado; falar com ele por HTTP não contamina o KAZER, mas distribuir junto exigiria GPL | Candidato como serviço externo |
| [AUTOMATIC1111/stable-diffusion-webui](https://github.com/AUTOMATIC1111/stable-diffusion-webui) | AGPL-3.0 | — | Último push 2026-03 | Rejeitado (AGPL + manutenção lenta) |
| [invoke-ai/InvokeAI](https://github.com/invoke-ai/InvokeAI) | Apache-2.0 | — | Aplicativo completo, pesado para servir só uma API | Rejeitado |
| [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) | MIT | — | Inferência em CPU/GPU; imagem em CPU é lenta demais para uso real | Candidato (já é base da voz) |
| [imgly/background-removal-js](https://github.com/imgly/background-removal-js) | **AGPL-3.0** | — | Remover fundo no navegador | **Rejeitado** (AGPL em código servido ao usuário) |

## 3. Agente, memória e busca semântica

| Projeto | Licença | Último push | Avaliação | Decisão |
|---|---|---|---|---|
| [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) | MIT | 2026-11-10 | Orquestração por grafo. O fluxo do KAZER hoje é linear (pesquisar → montar → gerar) e cabe em ~200 linhas próprias | Rejeitado por ora (dependência grande sem ganho) |
| [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk) | MIT | 2026-11-05 | Cliente MCP oficial | Candidato (o KAZER tem cliente próprio pequeno em `chat/mcp.py`) |
| [anthropics/skills](https://github.com/anthropics/skills) | sem licença única no repositório (cada skill declara a sua) | 2026-11-06 | Referência de formato de Skill | Referência (formato seguido em `.claude/skills/`) |
| [pgvector/pgvector](https://github.com/pgvector/pgvector) | PostgreSQL License (arquivo `LICENSE` lido) | 2026-11-09 | Busca vetorial no Postgres. Memória do KAZER: no máximo 100 itens curtos por conta | **Rejeitado por ora**: ordenar 100 linhas por palavras em comum resolve; vetor só com volume medido |
| [mem0ai/mem0](https://github.com/mem0ai/mem0) | Apache-2.0 | 2026-11-06 | Memória pronta, mas extrai com LLM a cada mensagem (custo e latência) | Rejeitado (extração determinística própria) |
| [chroma-core/chroma](https://github.com/chroma-core/chroma) · [qdrant/qdrant](https://github.com/qdrant/qdrant) · [lancedb/lancedb](https://github.com/lancedb/lancedb) | Apache-2.0 (os três) | 2026-11 | Bancos vetoriais dedicados: mais um serviço para operar | Rejeitados (Postgres já existe) |

## 4. Filas, escala e observabilidade

| Projeto | Licença | Último push | Avaliação | Decisão |
|---|---|---|---|---|
| [pgmq/pgmq](https://github.com/pgmq/pgmq) | PostgreSQL | 2026-10-20 | Fila dentro do Postgres (é a base das Supabase Queues) | Candidato nº 1 quando houver trabalho longo de verdade |
| [riverqueue/river](https://github.com/riverqueue/river) | MPL-2.0 | 2026-11-09 | Fila em Postgres, mas para Go | Rejeitado |
| [taskforcesh/bullmq](https://github.com/taskforcesh/bullmq) | MIT | 2026-11-10 | Exige Redis + Node | Rejeitado (dois componentes novos) |
| [open-telemetry/opentelemetry-python](https://github.com/open-telemetry/opentelemetry-python) | Apache-2.0 | 2026-11-09 | Padrão neutro de traços/métricas | Candidato (próximo passo de observabilidade) |
| [locustio/locust](https://github.com/locustio/locust) | MIT | 2026-11-09 | Carga em Python | Candidato; hoje `scripts/load_test.py` (60 linhas úteis) basta |
| [grafana/k6](https://github.com/grafana/k6) | **AGPL-3.0** | 2026-11-10 | Ferramenta de teste, não entra no produto | Aceitável só como ferramenta externa |
| [PostHog/posthog](https://github.com/PostHog/posthog) | MIT fora de `ee/` (arquivo `LICENSE` lido) | 2026-11-10 | Análise de produto auto-hospedável; pesado | Rejeitado por ora |
| [plausible/analytics](https://github.com/plausible/analytics) | AGPL-3.0 | 2026-11-10 | Serviço separado | Rejeitado por ora (o KAZER não usa rastreador) |

## 5. Documentos, slides e dados

| Projeto | Licença | Último push | Avaliação | Decisão |
|---|---|---|---|---|
| [py-pdf/pypdf](https://github.com/py-pdf/pypdf) | BSD-3-Clause (arquivo `LICENSE` lido) | 2026-11-10 | Ler PDF | **Já em uso** (`chat/extract.py`) |
| [python-openxml/python-docx](https://github.com/python-openxml/python-docx) | MIT | 2026-08-01 | Ler/gerar Word | Candidato (hoje o KAZER lê `.docx` direto do zip, sem biblioteca) |
| [py-pdf/fpdf2](https://github.com/py-pdf/fpdf2) | **LGPL-3.0-only** (PyPI `fpdf2` 2.9.0, campo `license_expression`) | — | Gerar PDF (documentos e slides) | **Já em uso** como biblioteca instalada, sem modificação (o uso por *import* é o que a LGPL permite) |
| [scanny/python-pptx](https://github.com/scanny/python-pptx) | MIT | **2024-08-07** | Gerar PPTX no servidor; sem commits há mais de 2 anos | Candidato com ressalva (manutenção parada) |
| [gitbrent/PptxGenJS](https://github.com/gitbrent/PptxGenJS) | MIT | 2025-11-28 | Gerar PPTX no navegador | Candidato nº 1 para exportar PPTX |
| [Kozea/WeasyPrint](https://github.com/Kozea/WeasyPrint) | BSD-3-Clause | 2026-11-10 | HTML→PDF com bibliotecas de sistema (Pango); pesado para função serverless | Rejeitado (o KAZER gera PDF próprio) |
| [parallax/jsPDF](https://github.com/parallax/jsPDF) | MIT | 2026-11-01 | PDF no navegador | Rejeitado para o Studio: o PDF de uma página com JPEG tem 40 linhas próprias |
| [mozilla/pdf.js](https://github.com/mozilla/pdf.js) | Apache-2.0 | 2026-11-09 | Mostrar PDF | Candidato |
| [SheetJS/sheetjs](https://github.com/SheetJS/sheetjs) | Apache-2.0 | 2024-04-18 (o desenvolvimento saiu do GitHub) | Planilhas | Candidato com ressalva |
| [mermaid-js/mermaid](https://github.com/mermaid-js/mermaid) | MIT | 2026-11-10 | Diagramas por texto | Candidato |
| [apache/echarts](https://github.com/apache/echarts) · [chartjs/Chart.js](https://github.com/chartjs/Chart.js) | Apache-2.0 · MIT | 2026-10 · 2026-11 | Gráficos | Candidatos (Chart.js é menor) |

## 6. Voz e busca (já no produto)

| Projeto | Licença | Último push | Papel | Decisão |
|---|---|---|---|---|
| [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) | **GPL-3.0** | 2026-11-09 | Voz do KAZER (pacote `piper-tts`) | Já em uso. O KAZER é um serviço; se algum dia for **distribuído** como programa, a GPL passa a valer para o conjunto |
| [rhasspy/piper](https://github.com/rhasspy/piper) | MIT | 2025-08-26, **arquivado** | Projeto original | Substituído pelo de cima |
| [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) | MIT | 2026-11-10 | Transcrição no gateway opcional | Já em uso (opcional) |
| [hexgrad/kokoro](https://github.com/hexgrad/kokoro) | Apache-2.0 | 2025-08-06 | Voz no gateway opcional | Já em uso (opcional) |
| [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | Apache-2.0 | 2026-11-10 | Voz/transcrição em ONNX | Candidato |
| [searxng/searxng](https://github.com/searxng/searxng) | AGPL-3.0 | 2026-11-09 | Metabusca; roda como serviço separado (`KAZER_SEARXNG_URL`) | Já em uso (opcional, externo) |

## 7. Base da aplicação (já em uso)

| Projeto | Licença | Último push |
|---|---|---|
| [pydantic/pydantic](https://github.com/pydantic/pydantic) | MIT | 2026-11-09 |
| [encode/httpx](https://github.com/encode/httpx) | BSD-3-Clause | 2026-10-02 |
| [hynek/argon2-cffi](https://github.com/hynek/argon2-cffi) | MIT | 2026-11-02 |
| [supabase/supabase](https://github.com/supabase/supabase) | Apache-2.0 | 2026-11-10 |
| [Kludex/starlette](https://github.com/Kludex/starlette) | BSD-3-Clause | 2026-11-06 |
| [Kludex/uvicorn](https://github.com/Kludex/uvicorn) | BSD-3-Clause | 2026-11-01 |
| [anthropics/anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python) | Apache-2.0 | 2026-11-10 |

Modelos locais de texto ([ollama/ollama](https://github.com/ollama/ollama) MIT,
[ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) MIT,
[vllm-project/vllm](https://github.com/vllm-project/vllm) Apache-2.0) seguem como
candidatos para um futuro "KAZ" auto-hospedado: o adaptador OpenAI-compatível do KAZER
já fala com os três, mas todos pedem GPU dedicada.

## Resumo das decisões desta rodada

- **1 dependência nova**: Fabric.js 7.4.0 (MIT), só no navegador, carregada sob demanda.
- **0 serviço pago novo.** Nenhuma API de imagem, fila ou banco vetorial foi contratada.
- **Rejeitados por licença**: tldraw (produção licenciada), FLUX.1 dev/Kontext
  (não comercial), background-removal-js (AGPL no front).
- **Pendências de licença**: model cards de Z-Image-Turbo, Qwen-Image e SDXL; conjunto
  de dados da voz Piper `pt_BR-cadu` (ver `docs/voice/DEPLOY.md`).
