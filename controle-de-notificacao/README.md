# Controle de notificação — o painel do dono do KAZER

Esta pasta é o **painel de controle** do KAZER. Daqui você liga e desliga duas
coisas para **todo mundo que usa o KAZER**, sem mexer em código:

| O quê | Para que serve | Onde |
|---|---|---|
| **Modo manutenção** | Bloqueia o KAZER inteiro com uma tela "Estamos em manutenção" | bloco `manutencao:` do `controle.yaml` |
| **Aviso global** | Mostra um recado no topo da tela para todas as pessoas | bloco `notificacao:` do `controle.yaml` |

Só existe **um arquivo para editar**: [`controle.yaml`](controle.yaml). Ele já
vem com tudo **desligado** e com comentários explicando cada linha.

---

## Ligar e desligar em 1 minuto (pelo celular ou pelo PC)

1. Abra `controle-de-notificacao/controle.yaml` no GitHub.
2. Toque no **lápis** (Edit this file).
3. Mude o que quiser — normalmente só `ativa: false` → `ativa: true` e os textos.
4. Toque em **Commit changes…** e confirme direto na branch **`main`**.
5. A Vercel publica sozinha em **~1–2 minutos**. Quem já estava com o KAZER
   aberto vê a mudança em até **1 minuto e meio** (o app pergunta ao servidor de
   tempos em tempos, quando a aba volta a ficar visível e quando a internet volta).

Para desligar: o mesmo caminho, voltando para `ativa: false`.

> Dica: no PC, dá para conferir o arquivo antes de salvar com
> `python scripts/controle.py` (mostra o que vai acontecer ou o erro exato).
> O CI do GitHub roda a mesma conferência a cada push.

---

## 1) Modo manutenção

```yaml
manutencao:
  ativa: true
  titulo: "Estamos em manutenção"
  mensagem: "O KAZER está passando por uma melhoria rápida. Suas conversas estão guardadas."
  previsao: "Voltamos às 18h"
  liberados: ["seu-email@exemplo.com"]
```

| Campo | O que faz | Limite |
|---|---|---|
| `ativa` | `true` bloqueia, `false` libera | `true` ou `false`, **sem aspas** |
| `titulo` | Título grande da tela | 80 caracteres |
| `mensagem` | Texto embaixo do título | 400 caracteres |
| `previsao` | Linha dourada com a volta ("Voltamos às 18h"). `""` esconde | 80 caracteres |
| `liberados` | E-mails que continuam usando o KAZER (você, para testar) | lista de e-mails |

**O que acontece com `ativa: true`:**

- Todo mundo vê uma **tela cheia escura** com o símbolo do KAZER, o selo
  "Manutenção", seus textos e um botão **Tentar de novo**. O resto da página
  fica travado (nem teclado nem toque chegam nele).
- **O servidor também bloqueia** — não é só visual. Conversar, criar conta,
  entrar, voz, biblioteca: tudo responde `503 maintenance`. Esconder a tela pelo
  inspetor do navegador não libera nada.
- Quem está em `liberados` usa o KAZER normalmente (entra, conversa, tudo).
  Maiúsculas não importam.
- Nada é apagado: conversas e contas continuam guardadas.
- Quando você volta para `ativa: false`, a tela **some sozinha** para todo mundo.

> **Atenção com `liberados`:** se o repositório for **público**, qualquer pessoa
> lê os e-mails escritos aqui. O endereço nunca aparece no site (a API pública
> não devolve a lista), mas aparece no GitHub.

---

## 2) Aviso global (notificação para todo mundo)

```yaml
notificacao:
  ativa: true
  id: "novidade-voz-2026-11"
  tipo: sucesso
  titulo: "Novidade no KAZER"
  mensagem: "Agora dá para conversar com o KAZER por voz."
  botao_texto: "Ver como funciona"
  botao_link: "/termos"
  inicio: "2026-11-10 08:00"
  fim: "2026-11-17 23:59"
  pode_fechar: true
```

| Campo | O que faz | Valores |
|---|---|---|
| `ativa` | Liga/desliga o aviso | `true` / `false` |
| `id` | Nome único do aviso. **Troque a cada aviso novo** | letras, números, `.` `-` `_` (até 64) |
| `tipo` | Cor e ícone | `info` (azul) · `sucesso` (verde) · `aviso` (amarelo) · `urgente` (vermelho) |
| `titulo` | Linha em negrito | até 80 caracteres |
| `mensagem` | Texto do recado | até 400 caracteres |
| `botao_texto` / `botao_link` | Botão dourado opcional | os dois preenchidos ou os dois `""`; link começa com `https://` ou `/` |
| `inicio` / `fim` | Janela de tempo (horário de **Brasília**) | `"AAAA-MM-DD HH:MM"` ou `""` |
| `pode_fechar` | Mostra o **X** para a pessoa fechar | `true` / `false` |

**Como se comporta:**

- Aparece como um **cartão no topo**, tanto na tela de entrada quanto dentro do chat.
- Se a pessoa fechar no X, aquele `id` fica fechado **só no navegador dela**.
  Mandou um aviso novo? Troque o `id` e todo mundo vê de novo.
- Com `pode_fechar: false` o aviso fica fixo enquanto estiver ativo (use para
  coisas sérias, tipo "pagamentos instáveis hoje").
- Fora da janela `inicio`/`fim`, o aviso some sozinho, sem você precisar
  voltar ao arquivo. Bom para agendar.
- `urgente` é lido em voz alta pelos leitores de tela na hora; os outros tipos
  são anunciados com educação, sem interromper.
- Durante a manutenção o aviso não aparece (a tela de manutenção tem prioridade).

---

## Receitas prontas

**Manutenção rápida agora:**
```yaml
manutencao:
  ativa: true
  previsao: "Voltamos em 30 minutos"
```

**Avisar de uma manutenção marcada (antes de ela começar):**
```yaml
notificacao:
  ativa: true
  id: "manutencao-sabado"
  tipo: aviso
  titulo: "Manutenção no sábado"
  mensagem: "Sábado, das 2h às 4h, o KAZER fica fora do ar para melhorias."
  fim: "2026-11-15 04:00"
```

**Novidade com botão:**
```yaml
notificacao:
  ativa: true
  id: "planos-novos"
  tipo: sucesso
  titulo: "Planos novos"
  mensagem: "Conheça o Pro e o Ultra, com Claude, GPT e Kimi."
  botao_texto: "Ver planos"
  botao_link: "/"
```

---

## E se eu errar a escrita?

O KAZER **não cai**. Se o arquivo tiver qualquer erro (aspas faltando, `ativa:
sim`, link `http://`, data no formato errado…), o servidor **ignora o arquivo
inteiro** — fica tudo desligado — e escreve o motivo no log da Vercel
(`controle de notificação ignorado: …`). Para ver o erro exato antes:

```bash
python scripts/controle.py
```

Erros comuns:

| Você escreveu | Certo |
|---|---|
| `ativa: "true"` ou `ativa: sim` | `ativa: true` |
| `mensagem: Texto com : dois-pontos` | `mensagem: "Texto com : dois-pontos"` |
| `botao_link: "http://site.com"` | `botao_link: "https://site.com"` |
| `inicio: "10/11/2026 08:00"` | `inicio: "2026-11-10 08:00"` |
| só `botao_texto` preenchido | preencha `botao_link` também (ou deixe os dois `""`) |

---

## Para agentes e desenvolvedores: como funciona por dentro

```
controle-de-notificacao/controle.yaml      ← o dono edita
        │  (lido a cada requisição; relido só quando o arquivo muda)
        ▼
kazer/config/control.py                    ← lê, valida, guarda em cache
        │
        ├─► kazer/interfaces/web/common.py   WebContext.user() → 503 "maintenance"
        │                                    (toda rota autenticada passa por aqui)
        ├─► kazer/interfaces/web/app.py      /api/auth/login e /register → 503 "maintenance"
        │                                    GET /api/status (público) → JSON abaixo
        ▼
kazer/interfaces/web/static/assets/aviso.js + aviso.css   ← tela e cartão no navegador
        ▲
        └── net.js dispara "kazer:maintenance" quando qualquer API responde 503 maintenance
```

**`GET /api/status`** (público, sem cache, nunca devolve a lista de e-mails):

```json
{
  "manutencao": {"ativa": true, "titulo": "…", "mensagem": "…", "previsao": "…", "liberado": false},
  "aviso": {"id": "…", "tipo": "info", "titulo": "…", "mensagem": "…",
            "botao_texto": "", "botao_link": "", "pode_fechar": true}
}
```

- `liberado` só é `true` quando a manutenção está ligada **e** o cookie de
  sessão é de um e-mail em `liberados` (a sessão só é consultada nesse caso).
- `aviso` é `null` quando está desligado ou fora da janela de tempo.

**Regras de segurança que não podem quebrar:**

- O bloqueio é do **servidor**; a tela é só a cara dele.
- Texto do dono entra no DOM só por `textContent` (CSP sem estilo/script inline).
- Links só `https://` ou caminho interno `/…` (nada de `javascript:` ou `//host`).
- Arquivo inválido ⇒ tudo desligado (o site nunca cai por erro de digitação).
- `/api/health` não é bloqueado (a sonda de rede do app continua funcionando).
- Os testes (`tests/test_control.py`) nunca leem o arquivo real: `tests/conftest.py`
  aponta `KAZER_CONTROL_FILE` para um arquivo inexistente, então ligar a
  manutenção não quebra o CI.

**Variável de ambiente:** `KAZER_CONTROL_FILE` aponta para outro arquivo
(testes, staging). Sem ela, vale `controle-de-notificacao/controle.yaml`.

| Arquivo | Papel |
|---|---|
| `controle.yaml` | O painel. Único arquivo que o dono edita |
| `README.md` | Este guia |
| `../kazer/config/control.py` | Leitura, validação e cache |
| `../kazer/interfaces/web/static/assets/aviso.js` / `aviso.css` | Tela de manutenção e cartão de aviso |
| `../scripts/controle.py` | Conferência do arquivo pelo terminal (também roda no CI) |
| `../tests/test_control.py` | Testes do painel |
