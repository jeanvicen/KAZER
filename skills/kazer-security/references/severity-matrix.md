# Matriz de severidade e alcançabilidade

## Duas dimensões, sempre

**Impacto** × **Alcançabilidade**. O scanner só mede impacto. O triador
julgador mede os dois.

```
             Impacto
             Baixo    Médio    Alto    Crítico
Alta   │    info     alta     crítica  crítica
canç.  │    info     média    alta     crítica
Média  │    info     baixa    média    alta
Baixa  │    info     info     baixa    média
```

## Alcançabilidade

| Nível | Definição |
|---|---|
| **Alta** | Alcançável sem autenticação, ou com credencial padrão |
| **Média** | Exige usuário autenticado comum, ou condição específica |
| **Baixa** | Exige privilégio alto, ou condição de raro |
| **Nenhuma** | Sem caminho no código — a dependência nem é importada |

## Escala de impacto

| Nível | Exemplos |
|---|---|
| **Crítico** | RCE, vazamento de credencial, bypass completo de auth |
| **Alto** | IDOR em dado sensível, SQLi autenticado, privilege escalation |
| **Médio** | XSS armazenado, SSRF limitado, segredo em escopo restrito |
| **Baixo** | Info leak, header ausente sem impacto prático |
| **Informativo** | Hardening, melhor prática |

## Reclassificação

O scanner erra nos dois sentidos. Corrija **com justificativa escrita**:

> **[MÉDIA → ALTA]** IDOR em faturas. O scanner marcou média por exigir
> autenticação, mas qualquer assinante de qualquer workspace lê a fatura de
> outro, e o dado é financeiro. Reclassificado para alta.

> **[ALTA → MÉDIA]** CVE em `lodash.template`. O scanner marcou alta, mas
> nenhum código importa `_.template` — a cadeia é removida ao atualizar
> `build-utils`. Sem caminho de exploração.

## Fatores que reduzem

- Requer privilégio administrativo para explorar
- Afeta apenas ambiente de teste
- Dado exposto é público por definição
- WAF/validação upstream já bloqueia o caminho

## Fatores que aumentam

- Afeta dado pessoal, financeiro ou de saúde
- Explorer é o próprio usuário (horizontal, não precisa de privilégio)
- Endpoint público
- Automatizável
- Sem mitigação na aplicação (depende só de atualização de dependência)

## Formato do relatório

Cada achado: severidade · localização exata · mecanismo · **caminho de
exploração passo a passo** · impacto real · correção com código · teste que
prova a correção · esforço estimado.
