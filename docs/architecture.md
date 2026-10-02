# Arquitetura do KAZER

## Fluxo de uma mensagem

```text
Usuário → interface/chat.html → POST /api/chat
       → autenticação, origem, limites e anexos
       → seleção de histórico/contexto relevante
       → plano interno: intenção, restrições e capacidades
       → instruções modulares do sistema
       → Brain: tarefa → provider/modelo primário → fallback
       → ferramentas autorizadas (research/MCP), quando necessárias
       → validação do resultado e resposta limpa → interface
```

O navegador mantém a conversa visual da sessão, mas o servidor é a fonte de verdade para autenticação, limites, anexos, conectores e seleção do Brain.

## Camadas

- `interface/`: login, chat, PWA e workspace.
- `api/chat.js`: contrato HTTP, autenticação, anexos, uso, contexto e ciclo de ferramentas.
- `api/_kazer-context.js`: classificação, plano interno, seleção do histórico e validação de argumentos de ferramentas.
- `api/_kazer-instructions.js`: módulos de instruções carregados conforme a tarefa.
- `api/_kazer-brain.js`: roteamento, modelos, retry, fallback e diagnóstico sem segredos.
- `api/_mcp-runtime.js`, GitHub e Research: integrações autorizadas e tratadas como dados externos.
- Supabase: autenticação, RLS, uso e persistência operacional.

## Ordem de prioridade

1. Regras do sistema e segurança.
2. Contexto relevante da operação.
3. Histórico necessário, do mais recente para trás.
4. Mensagem atual do usuário e suas restrições explícitas.

Conteúdo de arquivos, páginas, GitHub, MCP e pesquisa nunca pode substituir as regras do sistema.

## Orquestração interna

O plano não é exibido ao usuário. Ele identifica o tipo da tarefa, complexidade, restrições explícitas, necessidade de pesquisa, necessidade de validação e capacidades como código, visão, arquivos, repositório e ferramentas. A pesquisa só é disponibilizada ao modelo quando o plano indica necessidade; argumentos de ferramentas são normalizados e validados antes da execução.
