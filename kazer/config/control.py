"""Painel do dono: modo manutenção e aviso global, lidos de um arquivo YAML.

O arquivo fica em `controle-de-notificacao/controle.yaml` (na raiz do
repositório) para o dono achar e editar sem conhecer o código. Este módulo:

- lê o arquivo e guarda o resultado, relendo só quando a data de modificação
  muda (barato o bastante para rodar a cada requisição);
- valida cada campo (tipos, tamanhos, links só `https://` ou `/`, datas no
  horário de Brasília);
- **falha fechada para o aviso e aberta para o site**: arquivo ausente ou
  inválido = tudo desligado e um aviso no log. Um erro de digitação do dono
  nunca derruba o KAZER.

`KAZER_CONTROL_FILE` aponta para outro arquivo (testes e ambientes próprios).
"""

from __future__ import annotations

import logging
import os
import re
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger("kazer.control")

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FILE = ROOT / "controle-de-notificacao" / "controle.yaml"

# Brasil não tem horário de verão desde 2019: UTC-3 fixo dispensa tzdata.
BRASILIA = timezone(timedelta(hours=-3), "BRT")
NOTICE_KINDS = ("info", "sucesso", "aviso", "urgente")
TITLE_MAX = 80
MESSAGE_MAX = 400
BUTTON_MAX = 40
LINK_MAX = 500
ID_MAX = 64
_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ControlError(ValueError):
    """Campo inválido no arquivo de controle (mensagem em português para o dono)."""


@dataclass(frozen=True)
class Maintenance:
    active: bool = False
    title: str = "Estamos em manutenção"
    message: str = ""
    eta: str = ""
    allowed: frozenset[str] = field(default_factory=frozenset)

    def allows(self, email: str | None) -> bool:
        """True quando a pessoa pode usar o KAZER agora."""
        if not self.active:
            return True
        return bool(email) and email.strip().lower() in self.allowed

    def public(self) -> dict[str, Any]:
        return {
            "ativa": self.active,
            "titulo": self.title,
            "mensagem": self.message,
            "previsao": self.eta,
        }


@dataclass(frozen=True)
class Notice:
    active: bool = False
    id: str = ""
    kind: str = "info"
    title: str = ""
    message: str = ""
    button_text: str = ""
    button_link: str = ""
    start: datetime | None = None
    end: datetime | None = None
    closable: bool = True

    def visible(self, now: datetime) -> bool:
        if not self.active or not (self.title or self.message):
            return False
        if self.start is not None and now < self.start:
            return False
        return not (self.end is not None and now >= self.end)

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "tipo": self.kind,
            "titulo": self.title,
            "mensagem": self.message,
            "botao_texto": self.button_text,
            "botao_link": self.button_link,
            "pode_fechar": self.closable,
        }


@dataclass(frozen=True)
class Control:
    maintenance: Maintenance = field(default_factory=Maintenance)
    notice: Notice = field(default_factory=Notice)

    def status(self, *, now: datetime | None = None, allowed: bool = False) -> dict[str, Any]:
        """Corpo público de `/api/status` (nunca inclui a lista de e-mails)."""
        moment = now or datetime.now(BRASILIA)
        maintenance = self.maintenance.public()
        maintenance["liberado"] = bool(allowed and self.maintenance.active)
        return {
            "manutencao": maintenance,
            "aviso": self.notice.public() if self.notice.visible(moment) else None,
        }


OFF = Control()


# ---------------------------------------------------------------------------
# Leitura e validação
# ---------------------------------------------------------------------------


def _section(data: dict[str, Any], name: str) -> dict[str, Any]:
    value = data.get(name)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ControlError(f"'{name}' precisa ser um bloco com campos embaixo")
    return value


def _flag(section: dict[str, Any], name: str, where: str, default: bool) -> bool:
    value = section.get(name, default)
    if not isinstance(value, bool):
        raise ControlError(f"{where}.{name} precisa ser true ou false (sem aspas)")
    return value


def _text(section: dict[str, Any], name: str, where: str, limit: int, default: str = "") -> str:
    value = section.get(name, default)
    if value is None:
        return ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        value = str(value)
    if not isinstance(value, str):
        raise ControlError(f"{where}.{name} precisa ser um texto entre aspas")
    value = " ".join(value.split())
    if len(value) > limit:
        raise ControlError(f"{where}.{name} passou de {limit} caracteres ({len(value)})")
    return value


def _link(value: str) -> str:
    if not value:
        return ""
    if value.startswith("/") and not value.startswith("//"):
        return value
    if value.lower().startswith("https://") and " " not in value:
        return value
    raise ControlError("notificacao.botao_link precisa começar com https:// ou com /")


def _moment(section: dict[str, Any], name: str) -> datetime | None:
    raw = section.get(name)
    if raw in (None, ""):
        return None
    if isinstance(raw, datetime):
        moment = raw
    else:
        text = str(raw).strip()
        try:
            moment = datetime.strptime(text, "%Y-%m-%d %H:%M")
        except ValueError:
            raise ControlError(
                f'notificacao.{name} precisa estar no formato "AAAA-MM-DD HH:MM" (ex.: '
                f'"2026-11-10 08:00")'
            ) from None
    return moment.replace(tzinfo=BRASILIA) if moment.tzinfo is None else moment


def parse(data: Any) -> Control:
    """Valida o conteúdo já carregado do YAML; erro claro no primeiro campo errado."""
    if data is None:
        return OFF
    if not isinstance(data, dict):
        raise ControlError("o arquivo precisa ter os blocos 'manutencao' e 'notificacao'")

    m = _section(data, "manutencao")
    allowed_raw = m.get("liberados") or []
    if not isinstance(allowed_raw, list):
        raise ControlError('manutencao.liberados precisa ser uma lista: ["a@b.com"]')
    allowed: set[str] = set()
    for item in allowed_raw:
        email = str(item).strip().lower()
        if not _EMAIL_RE.match(email):
            raise ControlError(f"manutencao.liberados tem um e-mail inválido: {item!r}")
        allowed.add(email)
    maintenance = Maintenance(
        active=_flag(m, "ativa", "manutencao", False),
        title=_text(m, "titulo", "manutencao", TITLE_MAX, Maintenance.title) or Maintenance.title,
        message=_text(m, "mensagem", "manutencao", MESSAGE_MAX),
        eta=_text(m, "previsao", "manutencao", TITLE_MAX),
        allowed=frozenset(allowed),
    )

    n = _section(data, "notificacao")
    kind = _text(n, "tipo", "notificacao", 16, "info").lower() or "info"
    if kind not in NOTICE_KINDS:
        raise ControlError(f"notificacao.tipo precisa ser um de: {', '.join(NOTICE_KINDS)}")
    notice_id = _text(n, "id", "notificacao", ID_MAX, "aviso") or "aviso"
    if not _ID_RE.match(notice_id):
        raise ControlError("notificacao.id só aceita letras, números, ponto, hífen e _")
    button_text = _text(n, "botao_texto", "notificacao", BUTTON_MAX)
    button_link = _link(_text(n, "botao_link", "notificacao", LINK_MAX))
    if bool(button_text) != bool(button_link):
        raise ControlError(
            "notificacao: preencha botao_texto E botao_link (ou deixe os dois vazios)"
        )
    start, end = _moment(n, "inicio"), _moment(n, "fim")
    if start and end and end <= start:
        raise ControlError("notificacao.fim precisa ser depois de notificacao.inicio")
    notice = Notice(
        active=_flag(n, "ativa", "notificacao", False),
        id=notice_id,
        kind=kind,
        title=_text(n, "titulo", "notificacao", TITLE_MAX),
        message=_text(n, "mensagem", "notificacao", MESSAGE_MAX),
        button_text=button_text,
        button_link=button_link,
        start=start,
        end=end,
        closable=_flag(n, "pode_fechar", "notificacao", True),
    )
    return Control(maintenance=maintenance, notice=notice)


def read(path: Path) -> Control:
    """Lê e valida um arquivo; levanta ControlError com o motivo."""
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return OFF
    except OSError as exc:
        raise ControlError(f"não consegui ler o arquivo: {exc.strerror}") from None
    try:
        data = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        where = f" (linha {mark.line + 1})" if mark is not None else ""
        raise ControlError(f"o arquivo não é um YAML válido{where}") from None
    return parse(data)


class _Cache:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._key: tuple[str, float] | None = None
        self._value: Control = OFF

    def get(self) -> Control:
        path = Path(os.environ.get("KAZER_CONTROL_FILE") or DEFAULT_FILE)
        try:
            mtime = path.stat().st_mtime
        except OSError:
            mtime = -1.0
        key = (str(path), mtime)
        with self._lock:
            if key == self._key:
                return self._value
            try:
                value = read(path)
            except ControlError as exc:
                logger.warning("controle de notificação ignorado: %s", exc)
                value = OFF
            self._key, self._value = key, value
            return value


_cache = _Cache()


def current() -> Control:
    """Estado atual do painel (relê o arquivo só quando ele muda)."""
    return _cache.get()
