"""Governador de limites da Groq: o KAZER escolhe o modelo que AINDA tem cota.

A Groq limita cada modelo separadamente (pedidos e tokens por minuto e por dia),
por organização. Em vez de bater num modelo cheio e esperar o 429, o KAZER lê os
cabeçalhos que a própria Groq devolve em toda resposta:

    x-ratelimit-limit-tokens       tokens por minuto (TPM) do modelo
    x-ratelimit-remaining-tokens   quanto sobra neste minuto
    x-ratelimit-reset-tokens       quando o minuto renova ("7.66s", "1m2s"...)
    x-ratelimit-remaining-requests pedidos que sobram hoje
    x-ratelimit-reset-requests     quando o dia renova
    retry-after                    no 429: quanto esperar

e guarda, por modelo, quando ele volta a ter espaço. Assim cada pedido vai
direto para um modelo livre, e o tamanho máximo da resposta é ajustado para
caber no TPM daquele modelo (um pedido maior que o TPM é recusado na hora com
"Request too large" — e a resposta longa continua sozinha depois, em partes).

Ideia do "cooldown" do roteador do LiteLLM (BerriAI/litellm), feita aqui sem
dependência: a Vercel roda funções pequenas e cada instância lembra o que viu.
Nada de texto, chave ou corpo da Groq é guardado — só números.
"""

from __future__ import annotations

import re
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass

# TPM do plano grátis (ponto de partida; o cabeçalho da Groq corrige sozinho,
# inclusive para cima quando a conta muda de plano).
FREE_TPM: dict[str, int] = {
    "openai/gpt-oss-120b": 8_000,
    "openai/gpt-oss-20b": 8_000,
    "moonshotai/kimi-k2": 10_000,
    "meta-llama/llama-4-scout": 30_000,
    "meta-llama/llama-4-maverick": 6_000,
    "llama-3.3-70b": 12_000,
    "qwen/qwen3-32b": 6_000,
    "llama-3.1-8b": 6_000,
}
MIN_OUTPUT = 1_024  # menos que isso não vale a pena: melhor outro modelo
SAFETY = 300  # folga para a estimativa de tokens (que é aproximada)
CHARS_PER_TOKEN = 3.2  # português com JSON: estimativa conservadora
_DURATION = re.compile(r"(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?"
                       r"(?:(\d+(?:\.\d+)?)ms)?$")
_TOO_LARGE = re.compile(r"Limit\s+(\d+),\s*Requested\s+(\d+)", re.IGNORECASE)


def parse_duration(value: str | None) -> float:
    """'2m59.56s' → 179.56; '450ms' → 0.45; número puro → segundos. Inválido → 0."""
    if not value:
        return 0.0
    text = value.strip().lower()
    try:
        return max(float(text), 0.0)
    except ValueError:
        pass
    match = _DURATION.match(text)
    if not match or not any(match.groups()):
        return 0.0
    hours, minutes, seconds, millis = (float(group or 0) for group in match.groups())
    return hours * 3600 + minutes * 60 + seconds + millis / 1000


def too_large_numbers(body: str) -> tuple[int, int] | None:
    """(limite, pedido) de um erro "Request too large" da Groq, se houver."""
    match = _TOO_LARGE.search(body)
    return (int(match.group(1)), int(match.group(2))) if match else None


def estimate_tokens(chars: int) -> int:
    return int(chars / CHARS_PER_TOKEN) + 64


def _family(model: str, table: Mapping[str, int]) -> int | None:
    for prefix, value in table.items():
        if model.startswith(prefix):
            return value
    return None


@dataclass(slots=True)
class _State:
    tpm: int | None = None
    cool_until: float = 0.0
    minute_left: int | None = None
    minute_resets: float = 0.0


class Governor:
    """Memória de limites por modelo, segura entre threads."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._models: dict[str, _State] = {}

    def _state(self, model: str) -> _State:
        state = self._models.get(model)
        if state is None:
            state = self._models[model] = _State()
        return state

    def reset(self) -> None:
        with self._lock:
            self._models.clear()

    # --- o que a Groq disse -------------------------------------------------

    def observe(self, model: str, headers: Mapping[str, str] | None, status: int = 200) -> None:
        """Lê os cabeçalhos de limite de uma resposta (sucesso ou erro)."""
        if headers is None:
            return
        get = headers.get
        now = self._clock()
        with self._lock:
            state = self._state(model)
            limit = _int(get("x-ratelimit-limit-tokens"))
            if limit:
                state.tpm = limit
            left = _int(get("x-ratelimit-remaining-tokens"))
            if left is not None:
                state.minute_left = left
                state.minute_resets = now + parse_duration(get("x-ratelimit-reset-tokens"))
            requests_left = _int(get("x-ratelimit-remaining-requests"))
            if requests_left == 0:
                # Acabou a cota de pedidos do dia (ou do minuto) deste modelo.
                wait = parse_duration(get("x-ratelimit-reset-requests")) or 60.0
                state.cool_until = max(state.cool_until, now + wait)
            if status == 429:
                wait = parse_duration(get("retry-after")) or parse_duration(
                    get("x-ratelimit-reset-tokens")
                ) or 5.0
                state.cool_until = max(state.cool_until, now + wait)

    def too_large(self, model: str, limit: int) -> None:
        """A Groq recusou por tamanho: agora sabemos o TPM real do modelo."""
        with self._lock:
            self._state(model).tpm = limit

    # --- o que o KAZER decide ------------------------------------------------

    def tpm(self, model: str) -> int | None:
        with self._lock:
            state = self._models.get(model)
            if state and state.tpm:
                return state.tpm
        return _family(model, FREE_TPM)

    def cooling(self, model: str, need: int = 0) -> float:
        """Segundos até o modelo ter espaço (0 = pode ir agora)."""
        now = self._clock()
        with self._lock:
            state = self._models.get(model)
            if state is None:
                return 0.0
            wait = max(state.cool_until - now, 0.0)
            if (
                need
                and state.minute_left is not None
                and state.minute_left < need
                and state.minute_resets > now
            ):
                wait = max(wait, state.minute_resets - now)
            return wait

    def output_budget(self, model: str, prompt_tokens: int, ceiling: int) -> int | None:
        """Máximo de saída que cabe no TPM do modelo; None se nem o pedido cabe."""
        tpm = self.tpm(model)
        if not tpm:
            return ceiling
        room = tpm - prompt_tokens - SAFETY
        if room < MIN_OUTPUT:
            return None
        return min(ceiling, room)


def _int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


# Um por processo: todas as conversas da instância compartilham o que aprenderam.
GOVERNOR = Governor()
