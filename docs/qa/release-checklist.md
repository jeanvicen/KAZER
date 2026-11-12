# Checklist de release

Use antes de levar qualquer coisa para a `main`. O que não rodou é **NÃO RODOU**, com
o motivo — nunca "passou".

## Portões automáticos

```bash
ruff check .
pytest -q
python scripts/controle.py
find kazer/interfaces/web/static -name '*.js' -print0 | xargs -0 -n1 node --check
bash scripts/pg_test.sh        # 77 = NÃO RODOU (sem Postgres local)
```

## Navegador (Playwright, Chromium já instalado)

- [ ] 390×844 e 1366×820 nas telas tocadas; olhar os prints, não só o "ok".
- [ ] `pageerror` e erros de console vazios (violação de CSP aparece ali).
- [ ] Caminho feliz **e** erro: sem rede, 429, 503, sessão vencida.
- [ ] Tema claro e escuro dentro do chat.

## Revisão do diff

- [ ] Sem segredo, `.env`, e-mail real, peso de modelo ou binário grande.
- [ ] Sem apagão acidental nem formatação em arquivo que não é do assunto.
- [ ] Código de terceiro com a licença ao lado; dependência nova na avaliação open source.
- [ ] `sw.js` com versão nova se a casca mudou; `i18n-en.js` com os textos novos.
- [ ] `CHANGELOG.md` e os `README.md` das pastas tocadas.
- [ ] Capacidade nova no registro (`kazer/capabilities/registry.py`).

## Banco e produção

- [ ] Migração nova é aditiva, tem reversão escrita e passou no `pg_test.sh`.
- [ ] O app continua de pé **sem** a migração (responde `not_migrated`, não 500).
- [ ] Migração em produção e variável de ambiente: só com o dono autorizando.
- [ ] Depois do push na `main`: conferir o CI e o deploy; se não deu para conferir, dizer.

## Última execução registrada (2026-11-12, branch de trabalho)

| Portão | Resultado |
|---|---|
| `ruff check .` | passou |
| `pytest -q` | 370 passaram, 1 pulado (`test_voice.py`: precisa do modelo de voz no disco) |
| `python scripts/controle.py` | passou |
| `node --check` (todos os `.js`) | passou |
| `bash scripts/pg_test.sh` | passou: 11 migrações, 6 arquivos de teste, corrida com 12 sessões |
| Navegador: Criar imagem, Studio, Memória (celular e PC, escuro e claro) | passou, console limpo |
| Exportação do Studio | PNG 1080×1080, JPEG válido, PDF de 1 página 810×810 pt conferidos por leitura do arquivo |
| `mypy kazer` | **não é portão**: 91 erros antigos |
| HawkScan | **NÃO RODOU**: `HAWK_API_KEY` ausente |
| Teste com modelo de imagem real | **NÃO RODOU**: sem GPU; só o provedor de demonstração e um dublê |
| Supabase de produção (migração aplicada, RLS ao vivo) | **NÃO RODOU**: migração não aplicada, aguarda o dono |
| Carga em produção | **NÃO RODOU**: só local (ver arquitetura) |
| Agrupar/desagrupar no Studio | conferido só à mão, sem teste automático |
