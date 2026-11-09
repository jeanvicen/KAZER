# docs — documentação do produto e da engenharia

**O que é:** explicações longas que não cabem no código. Leia antes de mudar
algo grande.

| Documento | Assunto |
|---|---|
| `NEGOCIO.md` | Planos, margem, créditos dos modelos premium, Stripe |
| `ESCALA.md` | Como o KAZER aguenta mais gente na Groq grátis |
| `brand.md` | Marca: símbolo, cores (obsidiana + ouro), tipografia, regras |
| `architecture-diagram.md` | Diagrama da arquitetura |
| `agent-lifecycle.md` | Ciclo de vida do agente (planejar → executar) |
| `memory-design.md` | Desenho da memória (curta, longa, por projeto) |
| `tool-development.md` | Como criar ferramenta nova com segurança |
| `security-policy.md` | Política de segurança |
| `privacy-data-map.md` | Que dado é coletado, onde fica, quanto tempo |
| `supabase-chat-storage.md` | Banco do chat no Supabase (esquema, migrações, reversão) |
| `supabase-integration-status.md` | O que já está ligado no Supabase |
| `android-migration-audit.md` | Auditoria para um app Android |
| `assets/` | Imagens usadas pelos documentos |
| `voice/` | Tudo do modo voz (arquitetura, protocolo, deploy, segurança) |

O painel de manutenção e aviso global tem guia próprio em
[`controle-de-notificacao/README.md`](../controle-de-notificacao/README.md).

**Cuidados:** documento desatualizado engana agente e gente. Mudou o
comportamento? Atualize o `.md` no mesmo commit.

---
Mapa geral do repositório: [README principal](../README.md).
