# KAZER

KAZER é a fundação de um agente de IA modular, auditável e extensível. Este repositório contém a arquitetura inicial, documentação, contratos tipados e stubs do agente, além da **tela de entrada com autenticação própria por e-mail e senha**. Ainda **não contém a interface principal, integrações operacionais do agente nem autonomia implementada**.

## Visão do produto

Preparar uma base segura para um agente que poderá planejar tarefas, usar ferramentas e memória sob limites verificáveis, e futuramente delegar trabalho especializado. A evolução será incremental: começar por fluxos controláveis e acrescentar autonomia apenas quando avaliações e controles justificarem a complexidade.

## Arquitetura em camadas

- **Interfaces**: tela de entrada web com API de contas (`interfaces/web`); CLI, API do agente e webhook continuam stubs.
- **Auth**: contas próprias por e-mail e senha, sessões e recuperação (`kazer/auth`).
- **Core**: agente, orquestração, planejamento, roteamento, execução e estado.
- **Brain**: contratos para provedores, prompts, decisões e montagem de contexto.
- **Memory**: contratos para memória com escopo e política explícitos.
- **Tools / Integrations**: capacidades e serviços isolados atrás de contratos e permissões.
- **Security / Runtime**: fronteiras de autorização, auditoria e futuro isolamento de execução.
- **Observability / Config**: telemetria minimizada e configuração validada.

O fluxo normativo e as fronteiras estão em [ARCHITECTURE.md](ARCHITECTURE.md); riscos e controles em [SECURITY.md](SECURITY.md).

## Requisitos e execução local

Requer Python 3.11 ou superior. Na raiz do repositório:

```bash
make setup
make test
make run
```

`main.py` é apenas um ponto de composição mínimo e ainda não inicia um agente funcional. Os módulos de produto permanecem como stubs intencionais.

## Tela de entrada e autenticação

```bash
make web   # http://127.0.0.1:8000 (KAZER_HOST/KAZER_PORT alteram o endereço)
```

A tela abre quase toda preta: partículas convergem das bordas e formam o símbolo e o nome KAZER, que se abrem para revelar o início (≈1,9 s; qualquer toque ou tecla pula). O início cabe numa única tela, sem rolagem: uma cena em pixel art de um quarto à noite (janela com a cidade ao lado do computador; o programador digita, toma café e às vezes olha para quem está na tela; no monitor, o KAZER em versão "coder" programa, testa, constrói e publica), a frase "Você imagina. O KAZER executa_", os botões **Criar conta** e **Entrar** e os links para os Termos de Uso e a Política de Privacidade. A interface está em português do Brasil. Tudo é HTML, CSS e Canvas sem build nem dependências de frontend, servido pelo próprio app em `kazer/interfaces/web/static/`.

No PC e no notebook (telas a partir de 960 × 560 px) o layout muda: a cena vira um palco de cinema em plano aberto à esquerda (`scene-desktop.js`, 288 × 240 pixels) e a entrada fica num painel à direita, sem esconder a cena. Esse palco tem chuva escorrendo na janela, gato dormindo no peitoril, vela, varal de luzes, segundo monitor com logs, poeira na luz da luminária, brilho (bloom) só nas fontes de luz e uma leve inclinação 3D que segue o mouse. O módulo só é baixado em telas grandes; o celular continua com a versão leve.

O símbolo do KAZER (Fenda) e seus estados estão em [docs/brand.md](docs/brand.md). Com o manifesto (`/manifest.webmanifest`), o site pode ser adicionado à tela inicial e abre em modo app, sem barra de endereço.

O que funciona de verdade, ponta a ponta:

- criar conta (e-mail + senha, confirmação de senha), confirmar e-mail por link, entrar, manter sessão (cookie HttpOnly, 14 dias), sair;
- recuperar senha por link de uso único (30 min), que encerra todas as sessões;
- validação local e no servidor, mensagens de erro acessíveis, limites contra tentativas automatizadas;
- Termos de Uso (`/termos`) e Política de Privacidade (`/privacidade`) que descrevem o tratamento real de dados;
- sem login social, sem rastreadores, sem recursos externos.

Em desenvolvimento os e-mails são gravados em `data/outbox/*.eml`; abra o arquivo e use o link. Em produção (`KAZER_ENV=production`) o app exige HTTPS em `KAZER_PUBLIC_URL`, cookies `Secure` e SMTP configurado, e se recusa a iniciar sem eles. Dados coletados, retenção e exclusão: [docs/privacy-data-map.md](docs/privacy-data-map.md).

### Deploy na Vercel

Cada push na `main` gera um deploy de produção pela integração Git da Vercel. O `vercel.json` fixa o preset `python` e o `pyproject.toml` aponta a entrada ASGI (`kazer.interfaces.web.asgi:app`), então a configuração não depende do preset salvo no painel. Uma única função Python serve a tela, os assets e a API; arquivos do repositório não são publicados como estáticos.

Funções serverless não têm disco persistente, e o SQLite local perderia contas entre execuções. Por isso, na Vercel a tela fica no ar com as contas **fechadas** (a API responde `503 auth_unavailable` e o botão aparece desativado com aviso) até existir um banco persistente e SMTP configurados. Nada de login simulado. O chat depende das contas, então também fica fechado na Vercel até lá; as variáveis do modelo podem ser cadastradas antes e passam a valer quando o banco persistente existir.

## Chat do KAZER

Login, confirmação de e-mail e sessão já válida levam **direto ao chat** (sem tela intermediária). O chat é HTML, CSS e módulos JavaScript sem build, carregado só depois do login (`chat.js`, `chat.css`):

- **Conversa vazia:** a Fenda no centro, uma saudação pelo horário local ("Bom dia. O que vamos criar?", "Ainda por aqui? Vamos nessa.", com o apelido se você definir) e um campo sutil de quadradinhos brancos e cinza (`squares.js`). Na primeira mensagem **aceita pelo servidor** o campo some, o laço para e o canvas é liberado; se o envio falhar antes, o estado vazio continua.
- **Caixa de escrita:** texto em cima; embaixo `+`, o pill **KAZ 1.1 Baixo** (modelo e esforço numa folha só), o botão de **pensamento profundo** (a Fenda) e enviar/parar. Enter envia no computador (Shift+Enter pula linha); no celular, Enter pula linha. O rascunho fica guardado na aba e volta se o envio falhar.
- **`+` → Adicionar à conversa:** Câmera (celular), Fotos e Arquivos de verdade, com prévia, progresso e remoção. Fotos grandes são reduzidas no aparelho e regravadas sem metadados de localização. Pesquisa, Busca na web, Conectores ("Nenhum conector conectado.") e Memória mostram o estado real.
- **Respostas em streaming** com Markdown seguro (sem HTML externo), código com botão copiar, tabelas, resumo do raciocínio quando o modelo devolve, parar no meio e "tentar de novo". Se a rede cair no meio, a geração continua no servidor e a interface **reata do ponto onde parou**.
- **Gaveta:** nova conversa, busca, histórico por data (Hoje, Ontem, 7 e 30 dias), renomear, apagar com confirmação, configurações e sair. No computador ela fica fixa ao lado.
- **Renderização progressiva:** 40 mensagens por vez (as anteriores carregam ao rolar), Markdown montado só quando a mensagem chega perto da tela, `content-visibility` para pular o que está fora dela e o streaming desenhado no máximo uma vez por quadro.
- **Configurações** (`settings.js`, carregado sob demanda): Conta (trocar senha, sair dos outros dispositivos), Personalização (apelido com prévia da saudação, estilo das respostas com exemplo ao vivo, instruções pessoais), Memória (ligar/desligar, adicionar, esquecer), Interface (animações, tamanho do texto, fundo animado, Enter), Dados e privacidade (exportar JSON, apagar todas as conversas e excluir a conta segurando o botão), Conectores e Sobre. Tudo salva sozinho no servidor.
- **Sem internet** (`net.js` + `offline.js`): pedidos com prazo, novas tentativas com espera crescente e uma sonda real (`/api/health`), porque o `navigator.onLine` sozinho mente. Quando a rede cai aparece a tela "Ops, parece que tamo sem internet, fi.", com o **Kazinho**, um personagem em pixel com a cabeça da Fenda, que varre a casa, cochila, brinca de bola, treina e mostra o muque. Quando a conexão volta ele comemora e a tela some. O service worker (`/sw.js`) guarda só a casca do app, nunca `/api/`, para essa tela abrir até sem rede.

Sem um modelo configurado, o chat abre, mostra o histórico e explica que o KAZ 1.1 ainda não está conectado: **nenhuma resposta é inventada**.

## Conectar um modelo (KAZ 1.1)

O navegador só conhece o nome público **KAZ 1.1**. Qual provedor e qual modelo atendem esse nome é decisão do servidor, por variáveis de ambiente. As chaves são lidas apenas por `kazer/security/secrets.py` (allowlist do escopo `model`) e nunca vão para o navegador, para logs, para respostas de erro ou para o `repr` dos objetos.

| `KAZER_MODEL_PROVIDER` | Chave (variável secreta) | Observação |
| --- | --- | --- |
| `xai` (Grok) | `XAI_API_KEY` | API compatível com OpenAI, imagens ligadas |
| `openai` | `OPENAI_API_KEY` | imagens ligadas |
| `gemini` | `GEMINI_API_KEY` | endpoint compatível com OpenAI |
| `groq`, `deepseek`, `mistral`, `together` | `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `TOGETHER_API_KEY` | só texto por padrão |
| `openrouter` | `OPENROUTER_API_KEY` | vários modelos por uma chave |
| `ollama` | (sem chave) | servidor local em `http://127.0.0.1:11434/v1` |
| `custom` | `KAZER_MODEL_API_KEY` (opcional) | qualquer API compatível com OpenAI em `KAZER_MODEL_BASE_URL` |
| `anthropic` (Claude) | `ANTHROPIC_API_KEY` | SDK oficial: `pip install "kazer[anthropic]"`; padrão `claude-opus-5-5` |

Exemplo com o Grok, num `.env` local (nunca versionado):

```bash
KAZER_MODEL_PROVIDER=xai
KAZER_MODEL=grok-4            # o identificador do modelo no painel do provedor
XAI_API_KEY=...               # só no servidor
```

Na Vercel, cadastre as mesmas variáveis em *Settings → Environment Variables* (a chave como *Sensitive*). Opcionais:

- `KAZER_MODEL_DEEP`: modelo usado quando **Pensamento profundo** está ligado (por exemplo, a versão "reasoning" do provedor). Sem ele, o botão aparece indisponível. `KAZER_MODEL_REASONING=effort` envia também `reasoning_effort` (`low` no esforço Baixo, `high` no profundo) para provedores que aceitam.
- `KAZER_MODEL_VISION=true|false`: força o suporte a imagens.
- `KAZER_MODEL_WEB_SEARCH=true`: liga a busca na web do servidor da Anthropic (só nesse provedor; tem custo).
- `KAZER_MODEL_MAX_TOKENS`, `KAZER_MODEL_TIMEOUT`: limites da resposta.
- `KAZER_CHAT_HOURLY_UNITS` (60) e `KAZER_CHAT_DAILY_UNITS` (300): cota por conta, contada no servidor (mensagem = 1, pensamento profundo +2, busca +1), com o horário exato de liberação mostrado quando acaba.

Na Anthropic, o esforço **Baixo** vira `output_config.effort: "low"`, o pensamento profundo vira `"high"` com pensamento adaptativo e resumo do raciocínio, e as recusas usam o `fallbacks: "default"` do servidor nos modelos que suportam.

Mais provedores: crie um adaptador em `kazer/brain/model_provider.py` que implemente `ModelProvider.stream()` e registre a chave na allowlist de `secrets.py`.

## Variáveis de ambiente

Copie `.env.example` para `.env` somente em ambiente local e preencha apenas credenciais necessárias, fora do controle de versão; `make web` carrega o `.env` se ele existir. A autenticação usa as variáveis `KAZER_*` e `SMTP_*`; a senha SMTP só é lida por `security/secrets.py`. As chaves de provedores de modelo (seção acima) também só são lidas por `security/secrets.py`, pelo adaptador do modelo; as das demais integrações continuam ilustrativas. Leia [SECURITY.md](SECURITY.md) antes de adicionar segredos.

## Como adicionar ferramenta

1. Escreva o contrato em módulo próprio em `kazer/tools/` e derive de `BaseTool`.
2. Declare nome, descrição, schema de entrada e permissões mínimas (`read`, `write`, `network`, `shell`, `filesystem`, `admin`).
3. Defina autorização e aprovação humana para efeitos externos ou destrutivos; não execute antes de passar por `security/tool_guard.py`.
4. Não permita leitura direta de segredos: solicite capacidades limitadas a `security/secrets.py` através do guard.
5. Documente entradas/saídas e erros; acrescente testes de contrato e avaliações com resultados verificáveis.

## Como adicionar integração

Crie um adaptador específico em `kazer/integrations/`, sem misturar credenciais ou lógica de domínio com o core. Declare escopos, limites de rede e operações de leitura/escrita; conecte apenas por contratos de ferramentas autorizados. Nunca registre tokens nem conteúdo pessoal. Inclua testes com doubles locais, política de retries/limites e documentação de revogação.

## Regras de segurança

- Nenhum segredo versionado; `.env` e dados locais estão ignorados.
- Todas as entradas, saídas e invocações de ferramenta têm pontos obrigatórios de guard.
- Menor privilégio, isolamento por usuário/sessão/projeto e aprovação humana para operações destrutivas.
- Execução de código sempre projetada para sandbox, sem alegar que este stub já a implementa.
- Logs sem tokens, segredos ou dados sensíveis; revisar [SECURITY.md](SECURITY.md).

## Roadmap inicial

Consulte [ROADMAP.md](ROADMAP.md) para as sete fases. A tela de entrada e o chat principal foram antecipados a pedido (fase 7); pesquisa, conectores e voz seguem pendentes.

## Pesquisa de referência

As decisões iniciais refletem recomendações públicas da Anthropic: começar com a solução mais simples que funciona, compor padrões explícitos, tratar contexto como recurso finito, criar ferramentas claras e avaliá-las, além de usar permissões e sandbox. Fontes: [Building effective AI agents](https://www.anthropic.com/research/building-effective-agents), [Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents), [Writing effective tools for AI agents](https://www.anthropic.com/research/writing-tools-for-agents) e [Claude Code security](https://code.claude.com/docs/en/security). São princípios consultados, não uma alegação de que KAZER replica sistemas internos da Anthropic/Claude.
