# Modelo de ameaças

Complementa `SECURITY.md` e `docs/security-policy.md`. Cada linha diz o ataque, o
controle que existe **no código** e onde ele é testado. "Sem teste" é dito quando é o caso.
Isto é uma revisão interna de engenharia, não uma auditoria externa nem parecer jurídico.

## Ativos

Conta e sessão · conversas, anexos, memórias, projetos e imagens de cada pessoa ·
cota (conversa, imagem, crédito premium) · chaves do servidor (modelos, Supabase
service role, Stripe, voz, servidor de imagem) · o próprio serviço (disponibilidade).

## Fronteiras de confiança

1. Navegador ↔ servidor web (tudo o que vem do navegador é hostil).
2. Servidor web ↔ Postgres (o servidor fala **como a pessoa**, com o JWT dela).
3. Servidor ↔ internet (páginas, buscadores, GitHub, servidor de imagem).
4. Modelo de IA ↔ dados (conteúdo de terceiros nunca vira instrução).
5. Dono ↔ repositório (`controle.yaml`, variáveis da Vercel).

## Ameaças e controles

| # | Ameaça | Controle | Teste |
|---|---|---|---|
| 1 | Roubo de sessão por script | Cookie `HttpOnly`, `SameSite`, `Secure` em produção; CSP sem inline e sem origem externa de script | `tests/test_web_auth.py` |
| 2 | CSRF em rota de escrita | `Origin` conferido em toda escrita (`WebContext.check_origin`) + `Sec-Fetch-Site` | `test_web_auth.py`, `test_create.py` (origem forjada → 403) |
| 3 | Força bruta em login/cadastro | Limite por janela (`RateLimiter`) + Argon2id | `test_auth.py` |
| 4 | Enumerar contas | Respostas genéricas em cadastro e recuperação | `test_web_auth.py` |
| 5 | **Ler ou alterar dado de outra conta** | Toda função SQL deriva o dono de `auth.uid()`; RLS em toda tabela; no SQLite, `user_id` em todo `WHERE`; ids de outra conta respondem 404 | `supabase/tests/*.sql` (Postgres real), `test_chat.py`, `test_create.py`, `test_memory_auto.py` |
| 6 | Forjar o dono no corpo do pedido | Nenhuma rota aceita `user_id` do cliente | revisão de código; coberto indiretamente pelos testes de isolamento |
| 7 | **Furar a cota de imagem** (abas paralelas, repetição, chamada direta) | Reserva atômica por conta/dia (trava consultiva + `FOR UPDATE`), chave de idempotência única, conclusão exatamente uma vez, reserva abandonada expira | `scripts/pg_concurrency.py` (12 sessões), `images_studio_memory_test.sql`, `test_create.py` |
| 8 | Zerar a própria cota escrevendo na tabela | `authenticated` só tem `SELECT` nas tabelas de imagem; escrita só por função | `images_studio_memory_test.sql` |
| 9 | Chamar `kazer_image_reserve` direto com limite absurdo | A função só **reserva**; quem gera é o servidor, que usa o limite do plano. Teto de 50 na função. Resultado: a pessoa só atrapalha a própria cota | `images_studio_memory_test.sql` |
| 10 | Gastar a imagem do dia com falha | Falha, estouro de prazo e exceção inesperada liberam a vaga | `test_create.py` |
| 11 | Abuso de GPU | 1 imagem/dia + 12 tentativas/hora por conta + prazo no provedor | `test_create.py` (cota); limite por hora sem teste dedicado |
| 12 | Servidor de imagem devolver HTML/arquivo malicioso | Tipo conferido pelos primeiros bytes (PNG/JPEG/WebP), teto de 12 MB, resposta com `nosniff` e sem cache | `test_create.py::test_provider_loading_rules` |
| 13 | Endpoint de imagem em texto puro ou interno | Só `https` (http apenas em `localhost` fora de produção), sem seguir redirecionamento; o endereço vem de variável do dono, nunca da pessoa | `test_create.py` |
| 14 | SSRF pela pesquisa/leitura de página | Só endereços públicos, limite de tamanho e tempo (`web_tools.py`) | `test_web_tools.py` |
| 15 | **Injeção de prompt** por página, anexo ou Skill | Conteúdo de terceiros entra como dado delimitado; Skills passam por `skill_guard`; com Skill da comunidade os conectores ficam só leitura | `test_skill_guard.py`, `test_research.py` |
| 16 | Plantar instrução na **memória** | Só o texto que a pessoa escreveu é analisado; frases com cara de instrução são descartadas; memória entra no prompt como item de lista, rotulada como dado | `test_memory_auto.py` |
| 17 | Guardar dado sensível sem pedido | `memory.is_sensitive`: credenciais, documentos, cartão, saúde, religião, política, endereço, e-mail, sequências longas | `test_memory_auto.py::test_never_extracts` |
| 18 | Memória de uma conta em outra | Posse no banco (RLS / `user_id`) | `test_memory_auto.py`, SQL |
| 19 | XSS por texto do modelo, da pessoa ou do dono | Sem `innerHTML`; Markdown monta DOM; CSP `script-src 'self'` | revisão + console limpo nos testes de navegador |
| 20 | XSS por projeto do Studio | Documento é JSON validado (versão, tamanho, dimensões); miniatura só `data:image/...;base64`; imagens embutidas viram `blob:`; nada de link externo | `test_create.py::test_design_validation_and_limit` |
| 21 | Projeto gigante para estourar o banco | 3 MB por projeto, 30 projetos por conta, 240 gravações/hora | `test_create.py`, SQL (`check` na tabela) |
| 22 | Página gerada (prévia) roubar sessão | Moldura `sandbox` sem `allow-same-origin`, CSP própria | `test_artifacts.py` / revisão |
| 23 | Upload malicioso | Tipo pelo conteúdo, tamanho, nome limpo, armazenamento privado por conta | `test_chat.py` |
| 24 | Webhook do Stripe forjado ou repetido | Assinatura verificada; plano gravado por função de servidor | `test_billing.py` |
| 25 | Vazamento de chave | Segredos só por `security/secrets.py`, com lista por escopo; nada no front | `test_security.py` |
| 26 | Service role exposta | Usada só no servidor, para tarefas sem usuário | revisão |
| 27 | Burlar o modo manutenção pelo navegador | O bloqueio é do servidor (503) | `test_control.py` |
| 28 | Derrubar o site com `controle.yaml` inválido | Arquivo inválido = tudo desligado + log | `test_control.py` |
| 29 | Negação de serviço | Corpo limitado por rota, limites por conta, prazos em toda chamada externa | parcial (sem teste de inundação em produção) |
| 30 | Código de terceiro adulterado (cadeia de suprimentos) | Fabric.js vendorizado em versão fixa com licença; dependências Python com faixa de versão; Dependabot | sem verificação de integridade automática (backlog) |

## Riscos aceitos ou em aberto

- **Limitador de taxa em memória**: vale por instância. Abuso distribuído em várias
  instâncias passa do limite de cortesia; as cotas de verdade estão no banco.
- **JWT da pessoa**: quem tem o próprio cookie consegue chamar as funções `kazer_*`
  direto. Por isso toda função confere `auth.uid()` e nenhuma confia em parâmetro para
  decidir dono ou imagem gerada.
- **Sem varredura dinâmica nesta rodada**: HawkScan não rodou (`HAWK_API_KEY` ausente).
- **Sem verificação de vírus em anexos**: os arquivos nunca são executados nem servidos
  como página; são lidos como texto ou imagem.
- **Licenças pendentes** de pesos de imagem e da voz `cadu` (ver avaliação open source).
- **LGPD**: há exportação, exclusão de conta e mapa de dados (`docs/privacy-data-map.md`),
  mas nenhuma revisão jurídica foi feita aqui.
