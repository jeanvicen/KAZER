# Arquitetura do KAZER

## Fluxo de uma mensagem

```text
Usuário → interface/chat.html → POST /api/chat
       → autenticação, origem, limites e anexos
       → seleção de histórico/contexto relevante
       → instruções modulares do sistema
       → Brain: tarefa → provider/modelo primário → fallback
       → ferramentas autorizadas (research/MCP), quando necessárias
       → resposta limpa e limitada → interface
```

O navegador mantém a conversa visual da sessão, mas o servidor é a fonte de verdade para autenticação, limites, anexos, conectores e seleção do Brain.

## Camadas

- `interface/`: login, chat, PWA e workspace.
- `api/chat.js`: contrato HTTP, autenticação, anexos, uso, contexto e ciclo de ferramentas.
- `api/_kazer-context.js`: classificação simples da intenção e seleção do histórico necessário.
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
