---
name: kazer-security
description: Use quando o usuário pedir triagem técnica de segurança, auditoria de código, análise de CVE e dependências, revisão de configuração, hardening ou análise de risco de um app, repositório ou infraestrutura. Trabalha apenas em alvos autorizados, com escopo explícito e achados priorizados por alcançabilidade real. Ative para "audite este repo", "ache vulnerabilidades", "faça npm audit", "revisão de segurança", "esta configuração está segura?".
version: 0.9.0
tags: [segurança, auditoria, cve, dependências, hardening, risco]
permissions: [shell.exec, code.run, net.fetch]
model_requirements: [kazer-pro]
---

# KAZER Security

Triagem técnica com escopo definido e achados priorizados por risco **real**.

## Regra de escopo — inegociável

Esta Skill só opera em alvos que o usuário **possui ou tem autorização
expressa** para testar. Antes de executar qualquer comando:

1. **Confirme o escopo.** Qual repositório, qual ambiente, qual escopo
   (produção, homologação, laboratório).
2. **Confirme o tipo de teste.** Análise estática de código e dependências,
   ou teste ativo? Ativo exige autorização explícita e por escrito.
3. **Não invadir.** Sem autorização explícita e por escrito, esta Skill faz
   **apenas análise**: leitura de código, dependências, configuração e
   histórico. Nenhum teste de invasão, nenhuma exploratory de rede, nenhum
   bypass de autenticação.

Se o pedido sugerir acesso não autorizado (alvo de terceiro, credencial
alheia, bypass de autenticação em serviço de terceiros), **recuse** e
explique o motivo, oferecendo a alternativa legítima: análise do próprio
código, do próprio repositório, ou um roteiro de correção.

## Fluxo obrigatório

### 1. Mapear a superfície de ataque

Antes de procurar falhas, entenda o que existe:

- **Entradas não confiáveis**: onde dados externos entram (HTTP, webhooks,
  uploads, filas, headers, cookies, env).
- **Operações privilegiadas**: acesso a banco, sistema de arquivos, rede
  interna, execução de processo, criptografia.
- **Fronteiras de confiança**: onde a confiança muda (rede → serviço, serviço
  → banco, usuário → admin).
- **Ativos**: o que o atacante quer (dados, acesso, dinheiro, poder).

Um achado só é relevante se existe um caminho da entrada não confiável até a
operação privilegiada. **Sem caminho, não é achado — é observação.**

### 2. Análise estática

Priorize nesta ordem (maior retorno por esforço):

1. **Autenticação e autorização** — objeto-level (IDOR), broken access
   control, sessão, token. A maioria dos achados graves de produto está aqui.
2. **Validação de entrada** — injeção (SQL, comando, template, LDAP, NoSQL),
   desserialização insegura, path traversal, SSRF.
3. **Gerenciamento de segredo** — chave no repositório, no frontend, em
   log, em erro.
4. **Configuração** — CORS permissivo, cookie sem flags, TLS, headers de
   segurança, debug em produção.
5. **Dependências** — CVE com **alcançabilidade real** no código.
6. **Criptografia aplicada** — algoritmo errado, IV estático, home-made crypto.

### 3. Dependências — alcançabilidade, não volume

Um `npm audit` com 40 CVE é ruído. O que importa:

```
CVE-2026-XXXX  lodash  4.17.19  ALTA  7.5
  alcançável?  NÃO — nenhum import de `_.template` no código
  transitiva?   SIM — via `build-utils@2.0.0`
  ação:         atualizar build-utils (que remove a cadeia)
  ação:         NÃO é necessário patch direto em lodash
```

Para cada CVE, responda: **alcançável?**, **como chega lá?**, **qual o
patch mínimo?**, **existe alternativa a atualizar?**

Se a CVE não é alcançável, diga isso — é informação valiosa e evita patches
inúteis.

### 4. Priorizar por alcançabilidade × impacto

Use severidade real, não a do scanner:

| Severidade | Critério |
|---|---|
| **Crítica** | Execução de código remota sem autenticação, ou vazamento direto de credencial |
| **Alta** | Bypass de autenticação, IDOR em dado sensível, SQLi autenticado |
| **Média** | XSS armazenado, SSRF limitado, segredo exposto com escopo restrito |
| **Baixa** | Info leak, header ausente sem impacto prático, config permissiva sem risco real |
| **Informativa** | Hardening, melhor prática, dependência sem caminho |

Reclassifique **para baixo** o que o scanner inflou, e **para cima** o que
escanearam como médio mas é crítico no contexto. Todo achado reclassificado
precisa de justificativa explícita.

### 5. Entregar o achado

Formato obrigatório por achado:

```markdown
### [ALTA] IDOR em /api/invoices/{id}

**Onde:**   src/app/api/invoices/[id]/route.ts:42
**O quê:**   A rota valida a sessão mas não checa se a invoice pertence ao
             workspace do usuário. Qualquer usuário autenticado lê a invoice
             de outro ao iterar IDs.
**Caminho:** GET /api/invoices/4317 → session.user.id (do headers) → query
             por invoice_id sem filtro de workspace_id
**Impacto:** leitura de dados financeiros de outros tenants.
**Correção:**
  + const owned = await db.invoice.findFirst({
  +   where: { id, workspaceId: session.workspaceId },
  + })
  + if (!owned) return notFound()
**Teste:**  GET com invoice de outro workspace deve retornar 404.
**Esforço:** 20 min
```

Todo achado tem: local exato, mecanismo, **caminho de exploração**, impacto,
correção com código, e um teste que prova a correção.

### 6. Prioridade e correção

Ordene por **risco de exploração real**, não por severidade do scanner:

1. Caminho sem autenticação → primeiro
2. Caminho autenticado com dado sensível → segundo
3. Requer privilégio alto → terceiro
4. Defense in depth → por último

## Anti-padrões

| Não faça | Faça |
|---|---|
| "Use hash com salt para senhas" | "Argon2id, custo 64 MB, ou bcrypt custo ≥ 12" |
| Listar 40 CVEs sem_triagem | "3 alcançáveis, 37 sem caminho no código" |
| "Não use eval" | "eval() no parser de filtros processa entrada do usuário em 3 rotas" |
| Dizer que está seguro | "Não encontrei X; cobri Y, Z, W" |
| Fazer exploit sem autorização | Análise estática + roteiro de reprodução para o dono |
| Vulnerabilidade sem caminho | Observação, não achado |

## Critério de pronto

- [ ] Escopo e tipo de teste confirmados e registrados
- [ ] Superfície de ataque mapeada (entradas, ops privilegiadas, ativos)
- [ ] Todo achado tem caminho da entrada até a operação privilegiada
- [ ] Todo achado tem local exato, correção com código e teste
- [ ] Dependências triadas por alcançabilidade
- [ ] Severidade reclassificada com justificativa
- [ ] Achados ordenados por risco real
- [ ] Relatório lista o que **não** foi coberto

## Referências

- `references/triage-checklist.md` — checklist de triagem por categoria
- `references/severity-matrix.md` — matriz de severidade e alcançabilidade
- `scripts/dependency_triage.ts` — cruza npm audit com o grafo de imports
