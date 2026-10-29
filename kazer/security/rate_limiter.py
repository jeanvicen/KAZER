"""Limites de taxa por escopo com janela deslizante em memória."""

import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RateLimit:
    """No máximo `max_events` dentro de `window_seconds`."""

    max_events: int
    window_seconds: float


class RateLimiter:
    """Janela deslizante por chave, segura entre threads de um único processo.

    O estado vive só em memória e some ao reiniciar. Implantações com várias
    instâncias precisam de um armazenamento compartilhado com a mesma interface.
    """

    def __init__(
        self, clock: Callable[[], float] = time.monotonic, max_keys: int = 100_000
    ) -> None:
        """`max_keys` limita a memória usada sob abuso."""
        self._clock = clock
        self._max_keys = max_keys
        self._events: dict[str, deque[float]] = {}
        self._longest_window = 0.0
        self._lock = threading.Lock()

    def _trim(self, key: str, limit: RateLimit, now: float) -> deque[float]:
        events = self._events.setdefault(key, deque())
        while events and now - events[0] >= limit.window_seconds:
            events.popleft()
        return events

    def _retry_after(self, events: deque[float], limit: RateLimit, now: float) -> float:
        if len(events) < limit.max_events:
            return 0.0
        return max(limit.window_seconds - (now - events[0]), 0.001)

    def retry_after(self, key: str, limit: RateLimit) -> float:
        """Consulta sem registrar: 0 se liberado, senão segundos até liberar."""
        with self._lock:
            if key not in self._events:
                return 0.0
            now = self._clock()
            return self._retry_after(self._trim(key, limit, now), limit, now)

    def hit(self, key: str, limit: RateLimit) -> float:
        """Registra um evento se houver cota; retorna 0 ou segundos até liberar."""
        with self._lock:
            now = self._clock()
            events = self._trim(key, limit, now)
            wait = self._retry_after(events, limit, now)
            if wait == 0.0:
                events.append(now)
                self._longest_window = max(self._longest_window, limit.window_seconds)
                self._evict_if_needed(now)
            return wait

    def reset(self, key: str) -> None:
        """Esquece eventos de uma chave, por exemplo após login bem-sucedido."""
        with self._lock:
            self._events.pop(key, None)

    def _evict_if_needed(self, now: float) -> None:
        if len(self._events) <= self._max_keys:
            return
        window = self._longest_window
        stale = [k for k, ev in self._events.items() if not ev or now - ev[-1] >= window]
        for key in stale:
            del self._events[key]
        # Sob inundação de chaves únicas, descarta as mais antigas para manter o teto.
        overflow = len(self._events) - self._max_keys
        for key in list(self._events)[: max(overflow, 0)]:
            del self._events[key]
