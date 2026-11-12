# Criação de imagens: como ligar

## O estado de fábrica

Sem configuração nenhuma, a tela **Criar imagem** abre e diz que a criação ainda não
está ligada. Nada é gerado e nada é cobrado. O KAZER **não** chama API paga de imagem.

Gerar imagem precisa de GPU. Código aberto não significa computação grátis: alguém
paga a placa, a energia ou o aluguel da máquina.

## Regras da cota (valem para qualquer provedor)

- Cada conta conclui **1 imagem por dia UTC** (`images_per_day` em `kazer/chat/plans.py`,
  igual em todos os planos até o dono mudar, sabendo o custo).
- O ciclo é **reservar → gerar → concluir**. Só sucesso conta. Falha, estouro de prazo
  e erro inesperado devolvem a vaga.
- Mesmo pedido repetido (mesma chave de idempotência) devolve a mesma imagem.
- Duas abas ao mesmo tempo: uma gera, a outra recebe "já existe uma imagem sendo criada".
- Reserva abandonada (função que morreu) expira em 10 minutos.
- Apagar a imagem **não** devolve a cota do dia.
- A tela mostra o que o banco diz, com a hora da volta no fuso da pessoa.
- Edição de imagem, quando existir, conta como imagem.

## Ligar sem GPU: Pollinations

`KAZER_IMAGE_PROVIDER=pollinations` liga a criação usando o serviço aberto da
[Pollinations](https://pollinations.ai). O pedido (o texto da imagem) sai do KAZER
para lá, por isso só liga quando você escolhe.

| Variável | Para quê |
|---|---|
| `KAZER_POLLINATIONS_KEY` | (segredo, opcional) chave `sk_` de enter.pollinations.ai: sem selo, sem limite por IP, tamanho cheio |
| `KAZER_POLLINATIONS_MODEL` | Modelo com chave (padrão `flux`) |

Sem chave vale a API clássica gratuita: uma imagem por vez por IP (com intervalo de
uns 45 s), no máximo ~768×768 e um selo pequeno no canto. Quando o limite bate, a
tela diz que está ocupado e a imagem do dia não é gasta.

## Ligar com um servidor seu

Variáveis na Vercel (só nomes):

| Variável | Para quê |
|---|---|
| `KAZER_IMAGE_ENDPOINT_URL` | Endereço `https://` do seu servidor de inferência |
| `KAZER_IMAGE_ENDPOINT_TOKEN` | (segredo, opcional) enviado como `Authorization: Bearer` |
| `KAZER_IMAGE_TIMEOUT` | Prazo em segundos (padrão 90; mantenha abaixo do tempo máximo da função) |
| `KAZER_IMAGE_PROVIDER` | `endpoint` (padrão quando há URL), `pollinations` ou `demo` (só fora de produção) |

Contrato que o seu servidor precisa cumprir:

```
POST <KAZER_IMAGE_ENDPOINT_URL>
Authorization: Bearer <token>
Content-Type: application/json

{"prompt": "…", "width": 1024, "height": 1024, "seed": 123456}

→ 200  com os BYTES da imagem (PNG, JPEG ou WebP, até 12 MB)
→ 429 ou 503 quando estiver ocupado (o KAZER avisa e não gasta a imagem do dia)
```

Tamanhos pedidos: 1024×1024, 1024×1280, 864×1536, 1536×864.

### Exemplo de servidor (referência, **não testado nesta sessão**)

Não havia GPU nem acesso ao Hugging Face aqui, então este trecho é um ponto de
partida a validar na sua máquina:

```python
# pip install fastapi uvicorn diffusers torch  ·  rode numa máquina com GPU
import io, os, torch
from diffusers import DiffusionPipeline
from fastapi import FastAPI, Header, HTTPException, Response

MODEL = os.environ["IMAGE_MODEL"]            # ex.: o modelo que você escolheu e licenciou
TOKEN = os.environ["IMAGE_TOKEN"]
pipe = DiffusionPipeline.from_pretrained(MODEL, torch_dtype=torch.bfloat16).to("cuda")
app = FastAPI()

@app.post("/gerar")
def gerar(body: dict, authorization: str = Header("")):
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(401)
    image = pipe(body["prompt"], width=body["width"], height=body["height"],
                 generator=torch.Generator("cuda").manual_seed(body["seed"])).images[0]
    out = io.BytesIO(); image.save(out, "PNG")
    return Response(out.getvalue(), media_type="image/png")
```

## Que modelo usar

Veja `docs/architecture/open-source-evaluation.md`, seção 2. Resumo honesto:

- **Z-Image-Turbo**: código Apache-2.0; o README fala em 8 passos e 16 GB de VRAM.
  A licença do **peso** precisa ser conferida no model card antes de uso comercial.
- **Qwen-Image**: o README declara Apache-2.0; modelo maior.
- **FLUX.1 [schnell]**: Apache-2.0. **FLUX.1 [dev] e Kontext são não comerciais.**

Nenhum foi executado aqui. Qualidade, tempo por imagem e VRAM real: meça na sua máquina.

## Opções de máquina (sem números inventados)

| Opção | Bom para | Cuidado |
|---|---|---|
| Seu próprio PC com GPU + túnel `https` | testar com amigos | fica fora do ar quando o PC desliga |
| VM com GPU alugada por hora | produção pequena | custo fixo enquanto ligada |
| GPU sob demanda (liga ao receber pedido) | pouco uso | a primeira imagem demora para "acordar"; pode estourar o prazo |

Com 1 imagem por conta por dia, o teto diário de imagens é o número de contas ativas.
Faça a conta com o preço por hora da máquina escolhida antes de abrir para todo mundo.

## Banco

Em produção (Supabase) a cota e a galeria dependem da migração
`supabase/migrations/20261110120000_kazer_images_studio_memory.sql`. Sem ela, a tela
avisa que o armazenamento não está pronto; nada quebra.

## Testar sem GPU

```bash
KAZER_IMAGE_PROVIDER=demo make web
```

O provedor `demo` devolve um degradê pequeno e a tela avisa que é demonstração. Serve
para ver a cota, a galeria e o envio para o Studio. Ele se recusa a ligar em produção.
