# Catálogo de capacidades (pesquisa e backlog)

Este arquivo é **backlog**, não vitrine. O que o KAZER faz de verdade hoje está no
registro tipado `kazer/capabilities/registry.py` (servido em `GET /api/capabilities`
e conferido por `tests/test_capabilities.py`). Aqui ficam as ações candidatas,
com custo e risco, para decidir o que construir depois.

**Estado:** ✅ no produto e testado · 🟡 parcial · 🔧 código pronto, falta configurar ·
🔬 pesquisado · 📋 só ideia.
**Dif.:** B baixa · M média · A alta. **Custo por uso:** — nenhum · L modelo leve ·
M modelo · P modelo premium · C CPU · G GPU · S armazenamento.
**Prior.:** P0 proteger · P1 base · P2 valor direto · P3 profundidade.

## A. Pesquisa e conhecimento

| # | Ação | Valor para a pessoa | Dif. | Depende de | Licença | Custo | Segurança | Prior. | Estado |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Pesquisa na web com citações | Resposta atual e conferível | A | `prefetch.py`, buscadores | própria | M | SSRF, conteúdo não confiável | P1 | ✅ |
| 2 | Decidir sozinho se precisa pesquisar | Não gasta tempo à toa | M | modelo leve | própria | L | — | P1 | ✅ |
| 3 | Ler página inteira de um link | Resumo fiel do que foi enviado | M | `web_tools.py` | própria | M | SSRF, limite de tamanho | P1 | ✅ |
| 4 | Fotos de referência com autor | Ilustra a resposta com crédito | M | Wikimedia, Openverse | própria | — | direitos da imagem | P2 | ✅ |
| 5 | Ler repositório público do GitHub | Explica código de terceiros | M | API pública | própria | M | conteúdo não confiável | P2 | ✅ |
| 6 | Avaliar qualidade da fonte (autoridade, data) | Menos fonte ruim | M | heurística por domínio | própria | — | — | P2 | 🟡 |
| 7 | Separar fato, inferência e incerteza | Confiança calibrada | M | prompt + verificação | própria | M | — | P2 | 🟡 |
| 8 | Comparar fontes que discordam | Mostra o conflito | A | várias leituras | própria | M | — | P3 | 📋 |
| 9 | Pesquisa longa em segundo plano | Relatório grande sem travar a tela | A | fila durável (pgmq) | PostgreSQL | M | cota, cancelamento | P3 | 🔬 |
| 10 | Alerta quando um assunto muda | Acompanhar notícia/preço | A | agendador + fila | — | M | abuso de agendamento | P3 | 📋 |
| 11 | Pesquisa acadêmica (artigos) | Fonte primária | M | APIs abertas (Crossref, arXiv) | termos de cada API | M | — | P3 | 📋 |
| 12 | Diagnóstico dos buscadores | Dono vê qual fonte caiu | B | `/api/diagnostics/search` | própria | — | só leitura | P1 | ✅ |

## B. Escrita e conteúdo

| # | Ação | Valor | Dif. | Depende de | Licença | Custo | Segurança | Prior. | Estado |
|---|---|---|---|---|---|---|---|---|---|
| 13 | Escrever e-mail, post, roteiro | Texto pronto no tom certo | B | `abilities.py` | própria | M | — | P1 | ✅ |
| 14 | Reescrever e corrigir | Texto melhor sem mudar o sentido | B | idem | própria | M | — | P1 | ✅ |
| 15 | Traduzir | Outro idioma | B | idem | própria | M | — | P1 | ✅ |
| 16 | Resumir | Menos leitura | B | idem | própria | M | — | P1 | ✅ |
| 17 | Estilo de resposta por conta | Respostas do jeito da pessoa | B | preferências | própria | — | — | P1 | ✅ |
| 18 | Skills próprias (instruções salvas) | Repetir um jeito de trabalhar | M | `skill_guard.py` | própria | — | injeção de prompt | P1 | ✅ |
| 19 | Skills da comunidade | Aproveitar o que outros fizeram | A | guarda + cópia congelada | própria | — | injeção, vazamento | P2 | ✅ |
| 20 | Kit de marca (tom, cores, palavras) | Consistência | M | preferências + Studio | própria | — | — | P2 | 📋 |
| 21 | Marcar afirmação sem fonte | Menos invenção | M | verificação pós-resposta | própria | L | — | P2 | 📋 |
| 22 | Modelos de documento reutilizáveis | Proposta/briefing em 1 toque | M | `prompts/templates/` | própria | M | — | P3 | 📋 |
| 23 | Calendário de conteúdo | Planejar postagens | M | tabela + exportação | própria | M | — | P3 | 📋 |
| 24 | Texto alternativo para imagens | Acessibilidade | B | modelo com visão | própria | M | — | P3 | 📋 |

## C. Documentos e arquivos

| # | Ação | Valor | Dif. | Depende de | Licença | Custo | Segurança | Prior. | Estado |
|---|---|---|---|---|---|---|---|---|---|
| 25 | Ler PDF | Perguntar sobre o arquivo | M | pypdf | BSD-3 | M | arquivo malicioso | P1 | ✅ |
| 26 | Ler Word, Excel, PowerPoint | Idem | M | leitura do zip | própria | M | zip-bomba, tamanho | P1 | ✅ |
| 27 | Entender foto anexada | Descrever e extrair | M | modelo com visão | — | M | metadados removidos | P1 | ✅ |
| 28 | Gerar PDF A4 | Documento pronto | M | fpdf2 | LGPL-3.0 | C | — | P1 | ✅ |
| 29 | Baixar tudo em .zip | Levar os arquivos | B | `zip.js` | própria | — | — | P1 | ✅ |
| 30 | Biblioteca do que foi enviado e criado | Achar depois | M | `library` | própria | S | posse por conta | P1 | ✅ |
| 31 | Citar página/seção do documento | Conferir a origem | A | extração com posição | própria | M | — | P2 | 📋 |
| 32 | Documento muito grande em partes | Livros e contratos | A | fila + índice | PostgreSQL | M | cota | P3 | 🔬 |
| 33 | Exportar Word (.docx) | Editar fora | M | python-docx | MIT | C | — | P2 | 🔬 |
| 34 | Extrair tabela de PDF para planilha | Dados reaproveitáveis | A | pdfplumber (MIT) | MIT | C | — | P3 | 📋 |
| 35 | Ler texto em imagem (OCR) | Foto de documento | A | Tesseract (Apache-2.0) | Apache-2.0 | C | — | P3 | 📋 |
| 36 | Busca nos próprios arquivos | Achar por conteúdo | M | índice no Postgres | PostgreSQL | — | só a própria conta | P2 | 📋 |

## D. Apresentações

| # | Ação | Valor | Dif. | Depende de | Licença | Custo | Segurança | Prior. | Estado |
|---|---|---|---|---|---|---|---|---|---|
| 37 | Slides 16:9 em PDF | Apresentar na hora | M | fpdf2 | LGPL-3.0 | C | — | P1 | ✅ |
| 38 | Tipos de slide (título, comparação, linha do tempo) | Menos "só tópicos" | M | `documents.py` | própria | C | — | P2 | 🟡 |
| 39 | Exportar PPTX editável | Abrir no PowerPoint/Keynote | A | PptxGenJS | MIT | — | — | P2 | 🔬 |
| 40 | Notas do apresentador | Ensaiar | M | PPTX | MIT | M | — | P3 | 📋 |
| 41 | Temas visuais coerentes | Cara profissional | M | tokens do Studio | própria | — | — | P2 | 📋 |
| 42 | Gráfico dentro do slide | Dado visível | M | Chart.js | MIT | — | — | P3 | 🔬 |
| 43 | Editar slide no Studio | Ajuste fino | M | Studio (formato Slide) | MIT (Fabric) | S | — | P2 | 🟡 |
| 44 | Conferir estouro de texto | Slide legível | M | medição no render | própria | C | — | P2 | 📋 |

## E. Design (KAZER Studio)

| # | Ação | Valor | Dif. | Depende de | Licença | Custo | Segurança | Prior. | Estado |
|---|---|---|---|---|---|---|---|---|---|
| 45 | Criar projeto por formato (post, story, capa, slide, cartaz) | Tamanho certo de saída | B | `studio.js` | MIT (Fabric) | — | — | P2 | ✅ |
| 46 | Texto editável (tamanho, peso, alinhamento, fonte) | Tipografia sob controle | M | Fabric Textbox | MIT | — | — | P2 | ✅ |
| 47 | Formas (retângulo, círculo, linha) e cor | Composição | B | Fabric | MIT | — | — | P2 | ✅ |
| 48 | Foto própria, reduzida no aparelho | Usar suas imagens | M | canvas do navegador | — | S | tipo/tamanho, sem link externo | P2 | ✅ |
| 49 | Mover, redimensionar, girar | Edição direta | B | Fabric | MIT | — | — | P2 | ✅ |
| 50 | Camadas: ordem, esconder, travar | Organização | M | `studio.js` | própria | — | — | P2 | ✅ |
| 51 | Agrupar e desagrupar | Mover conjuntos | M | Fabric Group | MIT | — | — | P2 | 🟡 (código pronto, só testado à mão) |
| 52 | Desfazer e refazer | Errar sem medo | M | pilha de estados | própria | — | — | P2 | ✅ |
| 53 | Guia de centro com encaixe | Alinhamento rápido | M | `studio.js` | própria | — | — | P2 | ✅ |
| 54 | Salvar na conta e reabrir | Continuar depois | M | `/api/designs` | própria | S | posse, RLS, limite | P2 | ✅ |
| 55 | Reserva neste aparelho sem servidor | Não perder trabalho | M | localStorage | — | — | fica só no aparelho | P2 | ✅ |
| 56 | Exportar PNG, JPEG e PDF no tamanho real | Arquivo final | M | canvas + PDF próprio | própria | — | — | P2 | ✅ |
| 57 | Modelos editáveis (anúncio, citação, título) | Começar com base | B | `templateObjects` | própria | — | — | P2 | ✅ |
| 58 | Duplicar projeto | Variações | B | `/api/designs` | própria | S | — | P2 | 📋 |
| 59 | Guias entre objetos e distribuir | Alinhamento fino | M | cálculo de bordas | própria | — | — | P3 | 📋 |
| 60 | Recortar foto e máscara | Enquadrar | M | Fabric clipPath | MIT | — | — | P3 | 📋 |
| 61 | Mais fontes (com licença livre) | Variedade | M | fontes OFL servidas aqui | OFL | — | licença de cada fonte | P3 | 📋 |
| 62 | Ícones | Comunicação visual | M | conjunto com licença livre (Lucide, ISC) | ISC | — | — | P3 | 🔬 |
| 63 | Várias páginas num projeto | Carrossel, apresentação | A | documento v2 | própria | S | — | P3 | 📋 |
| 64 | KAZER monta o layout a partir do texto | Design em 1 pedido | A | modelo → documento v1 validado | própria | M | validar JSON do modelo | P3 | 📋 |
| 65 | Redimensionar para outro formato | Reaproveitar a arte | M | regras de escala | própria | — | — | P3 | 📋 |

## F. Imagens

| # | Ação | Valor | Dif. | Depende de | Licença | Custo | Segurança | Prior. | Estado |
|---|---|---|---|---|---|---|---|---|---|
| 66 | Criar imagem por texto | Ilustração própria | A | servidor de inferência (GPU) | modelo a escolher | **G** | cota atômica, abuso | P2 | 🔧 |
| 67 | Cota de 1 imagem concluída por dia (UTC) | Custo previsível | A | Postgres / SQLite | própria | — | corrida, repetição, posse | P2 | ✅ |
| 68 | Formato e estilo prontos | Resultado mais certo | B | `images/service.py` | própria | — | — | P2 | ✅ |
| 69 | Galeria privada das imagens | Rever e baixar | M | armazenamento privado | própria | S | posse por conta | P2 | ✅ |
| 70 | Levar a imagem para o Studio | Virar arte final | B | `queueImage` | própria | — | — | P2 | ✅ |
| 71 | Editar imagem por texto | Ajustar sem refazer | A | modelo de edição (FLUX Kontext é não comercial) | **bloqueio de licença** | G | idem 66 | P3 | 🔬 |
| 72 | Remover fundo | Recorte limpo | M | modelo ONNX (rembg, MIT) | MIT + peso a conferir | C/G | — | P3 | 🔬 |
| 73 | Aumentar resolução | Imprimir maior | M | Real-ESRGAN (BSD-3) | BSD-3 | G | — | P3 | 🔬 |
| 74 | Melhorar o pedido antes de gerar | Menos tentativas | B | modelo leve | própria | L | — | P3 | 📋 |
| 75 | Fila de imagens com prioridade por plano | Espera justa | A | pgmq | PostgreSQL | — | — | P3 | 🔬 |

## G. Dados e produtividade

| # | Ação | Valor | Dif. | Depende de | Licença | Custo | Segurança | Prior. | Estado |
|---|---|---|---|---|---|---|---|---|---|
| 76 | Tabelas na resposta | Comparar | B | Markdown seguro | própria | M | — | P1 | ✅ |
| 77 | Diagramas (fluxo, mapa) como arquivo | Explicar processo | M | SVG/artefatos | própria | M | SVG sanitizado | P2 | ✅ |
| 78 | Ler CSV e explicar | Entender dados | M | leitura de texto | própria | M | tamanho | P2 | 🟡 |
| 79 | Gráfico a partir de dados | Ver tendência | M | Chart.js | MIT | — | — | P3 | 🔬 |
| 80 | Exportar planilha (.xlsx) | Trabalhar fora | M | openpyxl (MIT) | MIT | C | — | P3 | 📋 |
| 81 | Explicar fórmula | Aprender | B | modelo | própria | M | — | P3 | ✅ (via conversa) |
| 82 | Limpar dados (duplicados, formatos) | Planilha confiável | A | execução isolada | sandbox | C | execução de código | P3 | 📋 |
| 83 | Plano e checklist | Organizar tarefa | B | modelo | própria | M | — | P2 | ✅ (via conversa) |
| 84 | Projetos (conversas agrupadas) | Contexto por assunto | M | tabelas de projeto | própria | — | posse | P2 | 🟡 (banco pronto, tela recolhida) |
| 85 | Lembretes | Não esquecer | A | agendador | — | — | abuso | P3 | 📋 |

## H. Código

| # | Ação | Valor | Dif. | Depende de | Licença | Custo | Segurança | Prior. | Estado |
|---|---|---|---|---|---|---|---|---|---|
| 86 | Explicar e depurar código | Aprender e consertar | B | modelo | própria | M | — | P1 | ✅ |
| 87 | KZ Code: arquivos inteiros + prévia | Site/jogo pronto | A | `forja.js`, moldura isolada | própria | M | sandbox sem mesma origem | P1 | ✅ (planos pagos) |
| 88 | Prévia de página em moldura isolada | Ver rodando | M | `preview.html` | própria | — | CSP própria, sem cookies | P1 | ✅ |
| 89 | KAZER no terminal | Usar sem navegador | M | `interfaces/terminal` | própria | M | sessão em arquivo restrito | P2 | ✅ |
| 90 | Gerar testes | Código mais seguro | B | modelo | própria | M | — | P2 | ✅ (via conversa) |
| 91 | Conector GitHub (ler/escrever) | Abrir PR | A | MCP oficial | termos do GitHub | M | token, confirmação, só leitura no grátis | P2 | 🟡 pausado |
| 92 | Rodar código em sandbox | Conferir resultado | A | WASM (Pyodide, MPL-2.0) | MPL-2.0 | — | isolamento | P3 | 🔬 |
| 93 | Revisão de arquitetura | Decidir melhor | B | modelo | própria | M | — | P3 | ✅ (via conversa) |
| 94 | Diff revisável antes de aplicar | Controle | A | conector | — | M | confirmação | P3 | 📋 |

## I. Voz e multimodal

| # | Ação | Valor | Dif. | Depende de | Licença | Custo | Segurança | Prior. | Estado |
|---|---|---|---|---|---|---|---|---|---|
| 95 | Conversa por voz com interrupção | Falar como com uma pessoa | A | Piper + reconhecimento do navegador | GPL-3.0 (serviço) | C | áudio não é guardado | P1 | ✅ |
| 96 | Ditado | Escrever falando | M | navegador | — | — | aviso de privacidade | P1 | ✅ |
| 97 | Voz paga opcional (ElevenLabs/OpenAI) | Voz mais natural | M | chave do dono | serviço pago, **só se ligado** | pago | segredo no servidor | P3 | 🔧 |
| 98 | Voice gateway próprio (Whisper + Kokoro) | Voz sem depender do navegador | A | VM com GPU/CPU | MIT / Apache-2.0 | C/G | tokens curtos, origem | P3 | 🔧 |
| 99 | Transcrever áudio enviado | Ata de reunião | A | faster-whisper | MIT | C/G | arquivo grande, retenção | P3 | 🔬 |
| 100 | Controle do aparelho em segundo plano | Assistente do sistema | — | não existe na web | — | — | — | — | ❌ indisponível na plataforma (não será simulado) |

## J. Memória, conta e operação

| # | Ação | Valor | Dif. | Depende de | Licença | Custo | Segurança | Prior. | Estado |
|---|---|---|---|---|---|---|---|---|---|
| 101 | Memória manual | Dizer o que lembrar | B | `/api/memories` | própria | — | posse | P1 | ✅ |
| 102 | Memória automática do que a pessoa conta de si | Não repetir contexto | M | `chat/memory.py` (regras, sem modelo) | própria | — | filtro de dado sensível, injeção | P2 | ✅ |
| 103 | Editar, apagar, limpar e desligar memória | Controle total | B | idem | própria | — | apaga de verdade | P2 | ✅ |
| 104 | Memória só quando relevante | Menos contexto à toa | M | `memory.relevant` | própria | — | — | P2 | ✅ |
| 105 | Exportar dados e excluir conta | Direito da pessoa | M | `/api/account/*` | própria | — | confirmação | P0 | ✅ |
| 106 | Planos e créditos premium | Pagar pelo que usa | A | Stripe | serviço do dono | — | webhook assinado | P1 | ✅ |
| 107 | Modo manutenção e aviso global | Dono controla o serviço | M | `controle.yaml` | própria | — | bloqueio no servidor | P0 | ✅ |
| 108 | Catálogo de capacidades na API | Tela mostra só o que existe | M | `capabilities/registry.py` | própria | — | sem caminhos internos | P1 | ✅ |
| 109 | Tela "O que o KAZER faz" | Descoberta | B | `/api/capabilities` | própria | — | — | P2 | 📋 |
| 110 | Métricas de produto sem rastreador | Decidir com dado | M | contadores agregados no Postgres | própria | — | sem dado pessoal | P3 | 📋 |
| 111 | Traços com OpenTelemetry | Achar lentidão | M | opentelemetry-python | Apache-2.0 | — | sem conteúdo da pessoa | P3 | 🔬 |
| 112 | Equipes (contas compartilhadas) | Trabalho em grupo | A | modelo de permissão novo | própria | — | isolamento por equipe | P3 | 📋 |

**Contagem:** 112 ações · ✅ 56 no produto · 🟡 8 parciais · 🔧 3 dependem de
configuração do dono · 🔬 14 pesquisadas · 📋 30 ideias · 1 indisponível na plataforma.
