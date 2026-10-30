"""Onde o terminal guarda a sessão: arquivo da pessoa, só para a pessoa.

A credencial do KAZER no terminal é o mesmo cookie de sessão do site. Enquanto
não expira, ela vale tanto quanto a senha — então vale a regra:

* mora em `~/.kazer/sessao.json`, gravado com permissão `600` dentro de uma
  pasta `700`: ninguém mais na máquina lê;
* nunca entra em argumento de linha de comando (o `ps` de qualquer usuário
  mostra) nem em variável de ambiente exportada;
* nunca é impressa, nem em mensagem de erro.

`KAZER_HOME` muda a pasta (útil em teste e em máquina compartilhada).
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# O mesmo padrão do servidor quando ninguém configurou nada.
DEFAULT_SERVER = "http://localhost:8000"
HOME_ENV = "KAZER_HOME"
SERVER_ENV = "KAZER_URL"
FILE_NAME = "sessao.json"


@dataclass(frozen=True, slots=True)
class Session:
    """Sessão salva: endereço do servidor, cookie e para quem ele é."""

    server: str
    cookie_name: str
    cookie: str
    email: str

    def as_json(self) -> dict[str, Any]:
        """Formato do arquivo; a versão deixa migração futura possível."""
        return {
            "version": 1,
            "server": self.server,
            "cookie_name": self.cookie_name,
            "cookie": self.cookie,
            "email": self.email,
        }


def home() -> Path:
    """Pasta de configuração do terminal, criada com permissão restrita."""
    raw = os.environ.get(HOME_ENV, "").strip()
    path = Path(raw).expanduser() if raw else Path.home() / ".kazer"
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path


def server_from_env() -> str | None:
    """Endereço pedido pelo ambiente, quando houver."""
    raw = os.environ.get(SERVER_ENV, "").strip()
    return raw.rstrip("/") or None


def load() -> Session | None:
    """Sessão salva, ou None quando não há nenhuma (ou o arquivo está quebrado)."""
    path = home() / FILE_NAME
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    server = data.get("server")
    cookie_name = data.get("cookie_name")
    cookie = data.get("cookie")
    email = data.get("email")
    if not all(isinstance(value, str) and value for value in (server, cookie_name, cookie, email)):
        return None
    return Session(
        server=str(server),
        cookie_name=str(cookie_name),
        cookie=str(cookie),
        email=str(email),
    )


def save(session: Session) -> Path:
    """Grava a sessão com permissão `600`, sem janela em que o arquivo fica aberto.

    O arquivo nasce com `O_CREAT | O_EXCL` em nome temporário e já com o modo
    certo: nunca existe um instante em que a credencial está em disco legível
    por outra pessoa. O `replace` no fim é atômico.
    """
    directory = home()
    final = directory / FILE_NAME
    temporary = directory / f".{FILE_NAME}.{os.getpid()}"
    body = json.dumps(session.as_json(), ensure_ascii=False, indent=2) + "\n"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(body)
        os.replace(temporary, final)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return final


def forget() -> bool:
    """Apaga a sessão salva; devolve se havia alguma."""
    path = home() / FILE_NAME
    try:
        path.unlink()
    except FileNotFoundError:
        return False
    except OSError:
        return False
    return True
