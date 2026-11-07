"""Medidor: cada resposta de um modelo premium desconta do crédito da pessoa.

Embrulha o provedor e, quando o stream termina (bem, mal ou cancelado), calcula
o custo estimado: tokens de entrada (prompt inteiro, inclusive pesquisa e
histórico) + tokens de saída (texto, raciocínio e chamadas de ferramenta).

A estimativa é conservadora (fator de segurança): o raciocínio escondido dos
modelos novos também é cobrado pela empresa e nem sempre aparece no stream.
Se nada chegou (erro antes de começar), não cobra nada — a empresa também não.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Iterator
from typing import Any

from kazer.billing.catalog import PremiumModel
from kazer.brain.groq_limits import estimate_tokens
from kazer.brain.model_provider import CancelToken, GenerationRequest, StreamEvent

logger = logging.getLogger("kazer.billing")

SAFETY = 1.25  # cobre raciocínio oculto e diferença de tokenizador
IMAGE_TOKENS = 1_600  # custo típico de uma imagem na entrada


def prompt_tokens(request: GenerationRequest) -> int:
    chars = len(request.system)
    images = 0
    for turn in request.turns:
        for part in turn.parts:
            if part.kind == "image":
                images += 1
            else:
                chars += len(part.text)
        chars += sum(len(text) for _, text in turn.results)
        chars += sum(len(call.name) + len(json.dumps(call.arguments)) for call in turn.calls)
    for tool in request.tools:
        chars += len(tool.name) + len(tool.description) + len(json.dumps(tool.schema))
    return estimate_tokens(chars) + images * IMAGE_TOKENS


class MeteredProvider:
    """Mesmo contrato de um provedor; cobra ao fim de cada chamada."""

    def __init__(
        self, inner: Any, model: PremiumModel, charge: Callable[[float], None]
    ) -> None:
        self._inner = inner
        self._model = model
        self._charge = charge
        self.capabilities = inner.capabilities

    def __repr__(self) -> str:
        return f"MeteredProvider({self._model.id})"

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Iterator[StreamEvent]:
        started = False
        out_chars = 0
        try:
            for event in self._inner.stream(request, cancel):
                started = True
                out_chars += len(event.text or "")
                if event.call is not None:
                    out_chars += len(event.call.name) + len(json.dumps(event.call.arguments))
                yield event
        finally:
            if started:
                usd = self._model.cost_usd(
                    prompt_tokens(request), estimate_tokens(out_chars)
                ) * SAFETY
                try:
                    self._charge(usd)
                except Exception:  # noqa: BLE001 - a resposta já foi entregue
                    logger.exception("billing.meter_failed")
