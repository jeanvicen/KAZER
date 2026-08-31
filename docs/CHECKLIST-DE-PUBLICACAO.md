# KAZER — Checklist de publicação

**Uso interno do titular e de colaboradores autorizados.** Marque cada item antes de publicar uma alteração. Este checklist não substitui revisão jurídica, pentest, plano de resposta a incidentes ou backup testado.

## 1. Autoria e escopo

| Item | Feito |
|---|:---:|
| A alteração tem autor identificado e origem documentada. | [ ] |
| Não foram incluídos arquivos de terceiros sem licença compatível. | [ ] |
| O ano, titular e avisos de copyright continuam corretos. | [ ] |
| A alteração não expõe o núcleo proprietário além do que foi aprovado para o repositório público. | [ ] |
| `README.md`, `LICENSE.md`, `docs/AVISO-DE-DIREITOS-AUTORAIS.md` e termos continuam coerentes. | [ ] |
| Qualquer logo, fonte, imagem, ícone ou texto novo tem autorização ou licença registrada. | [ ] |

## 2. Segredos e dados

| Item | Feito |
|---|:---:|
| `npm run security:check` passou. | [ ] |
| Não há `.env`, token, senha, chave privada, certificado, keystore ou credencial no diff. | [ ] |
| Não há dados pessoais, dados de clientes ou exportações de produção no commit. | [ ] |
| As chaves privadas foram configuradas somente no ambiente privado da Vercel. | [ ] |
| Logs e mensagens de erro não revelam token, prompt interno, caminho privado ou resposta de provedor. | [ ] |
| Se houve exposição, a chave foi revogada, substituída e o incidente foi registrado. | [ ] |

## 3. Código e dependências

| Item | Feito |
|---|:---:|
| `npm ci --ignore-scripts` passou com o `package-lock.json` versionado. | [ ] |
| `npm run security:audit -- --audit-level=high` passou. | [ ] |
| O workflow do GitHub passou sem falhas. | [ ] |
| Mudanças de dependência foram revisadas quanto à licença, origem, manutenção e risco. | [ ] |
| Autenticação, autorização, RLS, validação, escaping, timeout e rate limit foram reavaliados. | [ ] |
| Mudanças de API têm contrato e tratamento de erro documentados. | [ ] |

## 4. Banco e retenção

| Item | Feito |
|---|:---:|
| Migrações novas são aditivas, ordenadas e revisadas em ambiente de desenvolvimento. | [ ] |
| Testes com duas contas confirmaram isolamento por `auth.uid()`. | [ ] |
| Backup e restauração foram testados antes de qualquer alteração destrutiva. | [ ] |
| `RETENTION_DELETE_ENABLED=false` permanece em desenvolvimento e produção até aprovação formal. | [ ] |
| O job `/api/retention` não será executado manualmente com credenciais reais sem autorização. | [ ] |
| Foi definido procedimento de rollback ou correção caso a migração falhe. | [ ] |

## 5. Deploy e domínio

| Item | Feito |
|---|:---:|
| Variáveis Vercel foram configuradas no ambiente correto e não estão no repositório. | [ ] |
| `PUBLIC_APP_ORIGINS` aponta para a origem HTTPS exata, sem barra final. | [ ] |
| `/`, `/login`, `/chat`, `/documentos`, `/sw.js` e `/manifest.webmanifest` funcionam. | [ ] |
| Headers CSP, HSTS, framing, MIME e cache foram conferidos no domínio de produção. | [ ] |
| Chat, WebKazer, anexos, logout e Nova conversa foram testados com conta de teste. | [ ] |
| O deploy foi associado ao commit correto e o release foi registrado. | [ ] |

## 6. Pós-publicação

| Item | Feito |
|---|:---:|
| O site abre em dispositivo móvel e desktop. | [ ] |
| Não há erro inesperado no console ou nas funções serverless. | [ ] |
| O banco apresenta uso, resets, notificações e policies esperados. | [ ] |
| Os alertas ou logs de autenticação, abuso e falhas estão sendo acompanhados. | [ ] |
| O titular arquivou commit, tag, changelog, evidências e decisão de publicação. | [ ] |
| Mudanças relevantes foram refletidas na central pública de documentos. | [ ] |
