"""Imagem dentro da conversa: perceber o pedido, gerar e responder no próprio chat.

Não existe tela de "criar imagem". A pessoa pede na conversa ("crie uma imagem
de…"); o servidor percebe a intenção, usa a cota diária (`kazer/images/service.py`)
e a resposta já chega com a imagem. Sem provedor de imagem ligado, nada disto
entra em cena: o modelo é avisado de que não há geração e diz isso com clareza.

A detecção é por regra (sem chamada de modelo) e conservadora de propósito:
precisa de um verbo de pedir **e** de um substantivo de imagem. Pedido de código,
SVG, diagrama ou gráfico continua indo para o modelo, que já sabe fazer isso.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from datetime import datetime
from typing import Any, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from kazer.brain.model_provider import CancelToken, Capabilities, GenerationRequest, StreamEvent

_VERB = (
    r"(?:cri[ea]r?|ger[ea]r?|fa[çc]a|faz(?:er)?|desenh[ea]r?|produz[ai]r?|mont[ea]r?|quero"
    r"|preciso de|me (?:d[aáeê]|mostr[ea]|manda)|generate|create|draw|make|paint)"
)
_NOUN = (
    r"(?:imagem|imagens|foto|fotografia|ilustra[çc][aã]o|desenho|arte|pintura|wallpaper"
    r"|papel de parede|retrato|logo(?:tipo)?|avatar|capa|p[oô]ster|image|picture|photo"
    r"|illustration|drawing|painting)"
)
_WANTS = re.compile(
    rf"\b{_VERB}\b[^.?!\n]{{0,40}}?\b(?:um|uma|a|an|o|esta|essa|minha|meu)?\s*{_NOUN}\b", re.I
)
# Coisas que parecem pedido de imagem, mas são trabalho do modelo de texto.
_NOT_IMAGE = re.compile(
    r"\b(?:svg|html|css|c[oó]digo|code|script|diagrama|fluxograma|gr[aá]fico|chart|tabela|ascii"
    r"|mermaid|plantuml|canvas|componente|site|p[aá]gina|slide|pdf|planilha|descrev[ae]|descri[çc][aã]o"
    r"|analis[ae]|explique|o que (?:tem|h[aá]) n(?:a|essa|esta)|prompt)\b",
    re.I,
)
# "Desenhe um dragão": o verbo já diz que é imagem, mesmo sem a palavra "imagem".
_DRAW = re.compile(r"^\s*(?:por favor,?\s*)?(?:desenh[ea]|pint[ea]|draw|paint)\s+\S", re.I)
_DRAW_LEAD = re.compile(r"^\s*(?:por favor,?\s*)?(?:desenh[ea]|pint[ea]|draw|paint)\s+", re.I)
_LEAD = re.compile(
    rf"^\s*(?:por favor,?\s*)?(?:kazer,?\s*)?{_VERB}\s+(?:para mim\s+|pra mim\s+|me\s+)?"
    rf"(?:um|uma|a|an|o)?\s*{_NOUN}\s*(?:de|do|da|com|que mostre|mostrando|of|with|showing)?\s*",
    re.I,
)
_ASPECTS = (
    (re.compile(r"\b(?:story|stories|vertical|9[:x]16|tela de bloqueio)\b", re.I), "9:16"),
    (re.compile(r"\b(?:paisagem|horizontal|16[:x]9|wallpaper|banner|capa)\b", re.I), "16:9"),
    (re.compile(r"\b(?:retrato|4[:x]5)\b", re.I), "4:5"),
)
_STYLES = (
    (re.compile(r"\bpixel\s*art\b|\bem pixel\b", re.I), "pixel"),
    (re.compile(r"\b3d\b|\brender\b", re.I), "3d"),
    (re.compile(r"\b(?:minimalista|minimal|logo(?:tipo)?)\b", re.I), "minimal"),
    (re.compile(r"\b(?:ilustra[çc][aã]o|desenho|cartoon|anime|aquarela)\b", re.I), "ilustracao"),
    (re.compile(r"\b(?:foto|fotografia|realista|fotorrealista|photo)\b", re.I), "foto"),
)

UNAVAILABLE_NOTE = (
    "Criação de imagem por IA (foto, ilustração, arte) NÃO está ligada neste KAZER. A pessoa"
    " pediu uma imagem: diga isso com clareza logo no começo, sem fingir que gerou e sem"
    " inventar link de imagem. Depois ofereça o que dá para fazer de verdade aqui: desenhar em"
    " SVG, montar um diagrama, buscar fotos de referência na web ou escrever um prompt pronto"
    " para ela usar em outra ferramenta."
)

MESSAGES = {
    "image_in_progress": "Já tem uma imagem sendo criada na sua conta. Espere ela terminar e"
    " peça de novo.",
    "image_busy": "O servidor de imagens está ocupado agora. Sua imagem de hoje continua guardada:"
    " é só pedir de novo em instantes.",
    "image_timeout": "A imagem demorou demais e foi cancelada. Sua imagem de hoje não foi gasta:"
    " pode pedir de novo.",
    "image_prompt_short": "Me conta um pouco mais do que você quer ver na imagem.",
    "image_prompt_long": "O pedido ficou longo demais para uma imagem. Tenta resumir em poucas"
    " linhas.",
    "image_unavailable": "A criação de imagens não está ligada neste KAZER.",
}
FAILED = (
    "Não consegui criar a imagem agora. Sua imagem de hoje não foi gasta: pode pedir de novo."
)


def wants_image(text: str) -> bool:
    """A pessoa está pedindo para o KAZER criar uma imagem?"""
    if not text or len(text) > 900:
        return False
    asked = bool(_WANTS.search(text) or _DRAW.search(text))
    return asked and not _NOT_IMAGE.search(text)


def describe(text: str) -> str:
    """O que desenhar: o pedido sem o "crie uma imagem de"."""
    flat = " ".join(text.split())
    cleaned = _LEAD.sub("", flat, count=1)
    if cleaned == flat:
        cleaned = _DRAW_LEAD.sub("", flat, count=1)
    cleaned = cleaned.strip(" .:,-")
    return cleaned if len(cleaned) >= 3 else " ".join(text.split())


def aspect(text: str) -> str:
    for pattern, value in _ASPECTS:
        if pattern.search(text):
            return value
    return "1:1"


def style(text: str) -> str:
    for pattern, value in _STYLES:
        if pattern.search(text):
            return value
    return ""


def reset_phrase(resets_at: int, timezone: str | None) -> str:
    """Quando a cota volta, no fuso da pessoa (ou em UTC, dito com todas as letras)."""
    try:
        zone = ZoneInfo(timezone) if timezone else None
    except (ZoneInfoNotFoundError, ValueError):
        zone = None
    if zone is None:
        when = datetime.fromtimestamp(resets_at, ZoneInfo("UTC"))
        return f"às {when:%H:%M} UTC de {when:%d/%m}"
    when = datetime.fromtimestamp(resets_at, zone)
    return f"às {when:%H:%M} de {when:%d/%m} (seu horário)"


class _Images(Protocol):
    def create(self, user_id: str, data: dict[str, Any]) -> tuple[Any, bool]: ...


class ImageReplyProvider:
    """Atende UMA resposta do chat gerando a imagem pedida.

    Tem a mesma cara de um provedor de modelo (`stream`), então o resto do chat
    (streaming, salvar a resposta, título, parar) funciona sem saber a diferença.
    """

    capabilities = Capabilities()

    def __init__(
        self,
        images: _Images,
        user_id: str,
        asked: str,
        key: str,
        timezone: str | None = None,
    ) -> None:
        self._images = images
        self._user_id = user_id
        self._asked = asked
        self._key = key
        self._timezone = timezone

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Iterator[StreamEvent]:
        # Import tardio: `chat.service` importa este módulo.
        from kazer.chat.service import ChatError

        yield StreamEvent("activity", "Criando a imagem")
        prompt = describe(self._asked)
        try:
            job, _ = self._images.create(
                self._user_id,
                {
                    "prompt": prompt,
                    "aspect": aspect(self._asked),
                    "style": style(self._asked),
                    "idempotency_key": self._key,
                },
            )
        except ChatError as exc:
            if exc.code == "image_quota":
                when = reset_phrase(int(exc.extra.get("resets_at") or 0), self._timezone)
                text = (
                    f"Você já usou sua imagem de hoje. A próxima fica disponível {when}.\n\n"
                    "Enquanto isso posso ajustar a descrição com você, para o pedido de amanhã"
                    " sair certeiro."
                )
            else:
                text = MESSAGES.get(exc.code, FAILED)
            yield StreamEvent("text", text)
            yield StreamEvent("stop", "end")
            return
        except Exception:  # noqa: BLE001 - a conversa nunca cai por causa da imagem
            yield StreamEvent("text", FAILED)
            yield StreamEvent("stop", "end")
            return
        alt = prompt.replace("[", "(").replace("]", ")").replace("\n", " ")[:160]
        yield StreamEvent(
            "text",
            f"![{alt}](/api/images/{job.id}/file)\n\n"
            "Aqui está. Essa foi a sua imagem de hoje (é uma por dia). Se quiser, me diz o que"
            " mudaria e eu deixo a descrição pronta para a próxima.",
        )
        yield StreamEvent("stop", "end")
