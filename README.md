# KAZER

KAZER é a fundação de um agente de IA modular, auditável e extensível. Este repositório contém somente arquitetura inicial, documentação, contratos tipados e stubs: **não contém interface visual, integrações operacionais nem autonomia implementada**.

## Visão do produto

Preparar uma base segura para um agente que poderá planejar tarefas, usar ferramentas e memória sob limites verificáveis, e futuramente delegar trabalho especializado. A evolução será incremental: começar por fluxos controláveis e acrescentar autonomia apenas quando avaliações e controles justificarem a complexidade.

## Arquitetura em camadas

- **Interfaces**: pontos de entrada CLI, API e webhook (stubs).
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

## Variáveis de ambiente

Copie `.env.example` para `.env` somente em ambiente local e preencha apenas credenciais necessárias, fora do controle de versão. Neste estágio as configurações são ilustrativas; nenhuma integração consome esses valores. Leia [SECURITY.md](SECURITY.md) antes de adicionar segredos.

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

Consulte [ROADMAP.md](ROADMAP.md) para as sete fases, incluindo a maturação do núcleo antes de quaisquer interfaces visuais.

## Pesquisa de referência

As decisões iniciais refletem recomendações públicas da Anthropic: começar com a solução mais simples que funciona, compor padrões explícitos, tratar contexto como recurso finito, criar ferramentas claras e avaliá-las, além de usar permissões e sandbox. Fontes: [Building effective AI agents](https://www.anthropic.com/research/building-effective-agents), [Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents), [Writing effective tools for AI agents](https://www.anthropic.com/research/writing-tools-for-agents) e [Claude Code security](https://code.claude.com/docs/en/security). São princípios consultados, não uma alegação de que KAZER replica sistemas internos da Anthropic/Claude.
