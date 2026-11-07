# Como contribuir com o KAZER

## Preparar

```bash
make setup      # instala o projeto e as ferramentas de desenvolvimento
cp .env.example .env   # preencha só o que for usar
make web        # http://127.0.0.1:8000
```

## Antes de abrir um PR

```bash
make lint       # ruff: estilo e erros comuns
make test       # pytest: a suíte inteira precisa passar
```

O CI (`.github/workflows/ci.yml`) roda os dois em todo PR e também confere a
sintaxe de todo o JavaScript da tela.

## Regras da casa

- **Ramo por mudança**: nada direto na `main`. Use um ramo e abra um PR.
- **Testes junto do código**: bug corrigido ganha um teste que falhava antes.
- **Segredos nunca no código**: chaves só em variáveis de ambiente, lidas por
  `kazer/security/secrets.py`, que só libera os nomes da lista permitida.
- **Banco**: toda mudança de esquema é uma migração nova em
  `supabase/migrations/`, com RLS. Nunca edite migração já aplicada.
- **Cobrança** (`kazer/billing/`): qualquer mudança em preço, crédito ou
  webhook precisa de teste em `tests/test_billing.py` e revisão do dono
  (CODEOWNERS).
- **Tela**: sem build e sem estilo inline (a CSP bloqueia). Ao mudar arquivos
  estáticos, suba a versão do cache em `kazer/interfaces/web/static/sw.js`.
- **Texto para quem usa**: português do Brasil, frases curtas, sem jargão.

## Mensagens de commit

Primeira linha curta dizendo o que muda para quem usa. No corpo, o porquê e o
que precisa ser configurado (variável nova, migração).
