"""KAZER no terminal, contra um servidor de verdade.

Nada de dublê de HTTP: o teste sobe o app real numa porta local e aponta o
terminal para lá. Então o que passa aqui passa por rota, sessão, cookie,
fluxo NDJSON e limite de plano — o mesmo caminho da pessoa.
"""

from __future__ import annotations

import contextlib
import json
import stat
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import uvicorn

from kazer.interfaces.terminal import credentials, render
from kazer.interfaces.terminal.client import ApiClient, valid_server
from kazer.interfaces.terminal.credentials import Session
from kazer.interfaces.terminal.render import Screen
from kazer.interfaces.terminal.shell import Shell, enter, main, show_server
from tests.test_chat import PASSWORD, Env, FakeProvider

EMAIL = "ana@example.com"


class Live:
    """Servidor de verdade numa porta efêmera, com a conta já criada."""

    def __init__(self, env: Env, url: str) -> None:
        self.env = env
        self.url = url

    def web(self) -> httpx.Client:
        """Cliente no papel de navegador: serve para preparar estado."""
        return httpx.Client(base_url=self.url, headers={"Origin": self.url}, timeout=10)

    @contextlib.contextmanager
    def signed_in_browser(self) -> Iterator[httpx.Client]:
        """Navegador já autenticado na mesma conta do terminal."""
        client = self.web()
        try:
            client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
            yield client
        finally:
            client.close()

    def terminal(self) -> ApiClient:
        """Cliente do terminal com a sessão salva em disco."""
        saved = credentials.load()
        assert saved is not None
        return ApiClient(saved.server, saved.cookie_name, saved.cookie)

    def shell(self, screen: Screen | None = None) -> Shell:
        """Shell pronto, como `main` monta."""
        saved = credentials.load()
        assert saved is not None
        return Shell(screen or Screen(color=False, unicode=False), self.terminal(), saved)


def boot(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, provider: FakeProvider
) -> Iterator[Live]:
    """App no ar, conta criada, terminal apontado para ele."""
    env = Env(tmp_path, provider)
    config = uvicorn.Config(env.app, host="127.0.0.1", port=0, log_level="critical")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 20
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.02)
    assert server.started, "o servidor de teste não subiu"
    port = server.servers[0].sockets[0].getsockname()[1]
    url = f"http://127.0.0.1:{port}"

    monkeypatch.setenv(credentials.HOME_ENV, str(tmp_path / "casa"))
    monkeypatch.setenv(credentials.SERVER_ENV, url)
    bound = Live(env, url)
    with bound.web() as client:
        client.post("/api/auth/register", json={"email": EMAIL, "password": PASSWORD})
        done = client.post("/api/auth/verify-email", json={"token": env.outbox.token()})
        assert done.json()["authenticated"] is True
    try:
        yield bound
    finally:
        server.should_exit = True
        thread.join(timeout=10)


@pytest.fixture
def live(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Live]:
    """O caso comum: o dublê responde e termina."""
    yield from boot(tmp_path, monkeypatch, FakeProvider())


@pytest.fixture
def live_holding(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Live]:
    """O dublê responde e fica pendurado: dá tempo de interromper de verdade."""
    hold = threading.Event()
    try:
        yield from boot(tmp_path, monkeypatch, FakeProvider(hold=hold))
    finally:
        hold.set()


def sign_in(live: Live, monkeypatch: pytest.MonkeyPatch) -> int:
    """Faz `kazer entrar` respondendo às perguntas da tela."""
    monkeypatch.setattr("builtins.input", lambda *_: EMAIL)
    monkeypatch.setattr("getpass.getpass", lambda *_: PASSWORD)
    return enter(Screen(color=False, unicode=False))


# ---------- A credencial ----------


def test_the_session_is_saved_only_for_its_owner(
    live: Live, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert sign_in(live, monkeypatch) == 0
    path = credentials.home() / credentials.FILE_NAME
    mode = stat.S_IMODE(path.stat().st_mode)
    assert mode == 0o600, "a credencial não pode ser legível por outra pessoa"
    assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700

    saved = credentials.load()
    assert saved is not None and saved.email == EMAIL and saved.server == live.url
    assert saved.cookie


def test_the_password_never_touches_the_disk(live: Live, monkeypatch: pytest.MonkeyPatch) -> None:
    sign_in(live, monkeypatch)
    body = (credentials.home() / credentials.FILE_NAME).read_text("utf-8")
    assert PASSWORD not in body
    # O arquivo é JSON legível: a pessoa pode conferir o que está guardado.
    assert set(json.loads(body)) >= {"server", "cookie", "email"}


def test_a_bad_password_saves_nothing(live: Live, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("builtins.input", lambda *_: EMAIL)
    monkeypatch.setattr("getpass.getpass", lambda *_: "senha errada mesmo")
    assert enter(Screen(color=False, unicode=False)) == 1
    assert credentials.load() is None


def test_only_https_outside_localhost(capsys: pytest.CaptureFixture[str]) -> None:
    assert valid_server("https://kazer.exemplo.com")
    assert valid_server("http://localhost:8000")
    assert valid_server("http://127.0.0.1:8000")
    # Fora de localhost, http mandaria o cookie em claro.
    assert not valid_server("http://kazer.exemplo.com")
    assert not valid_server("ftp://kazer.exemplo.com")
    assert show_server(Screen(color=False, unicode=False), "http://kazer.exemplo.com") == 2
    assert "inválido" in capsys.readouterr().err


# ---------- Conversar ----------


def test_asking_streams_the_answer_and_keeps_the_conversation(
    live: Live, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    sign_in(live, monkeypatch)
    capsys.readouterr()

    assert main(["o que é o KAZER?"]) == 0
    written = capsys.readouterr().out
    assert "Olá, tudo certo?" in written, written

    # A conversa existe no servidor: é a mesma conta do site.
    with live.signed_in_browser() as browser:
        items = browser.get("/api/conversations").json()["items"]
    assert len(items) == 1


def test_the_terminal_continues_the_same_conversation(
    live: Live, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    sign_in(live, monkeypatch)
    shell = live.shell()
    assert shell.ask("primeira") is True
    first = shell.conversation
    assert shell.ask("segunda") is True
    assert shell.conversation == first, "a segunda pergunta ficou na mesma conversa"

    messages = shell.api.messages(str(first))["items"]
    assert [item["role"] for item in messages] == ["user", "assistant", "user", "assistant"]
    shell.api.close()


def test_a_conversation_started_on_the_site_opens_in_the_terminal(
    live: Live, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    sign_in(live, monkeypatch)
    with live.signed_in_browser() as browser:
        stream = browser.post(
            "/api/chat", json={"client_id": "pelo-navegador-1", "content": "oi do site"}
        )
        assert stream.status_code == 200
        start = json.loads(stream.text.splitlines()[0])
        conversation = start["conversation"]["id"]

    shell = live.shell()
    rows = shell.conversations()
    assert [item["id"] for item in rows] == [conversation]

    shell.resume("1")
    assert shell.conversation == conversation
    assert "oi do site" in capsys.readouterr().out
    shell.api.close()


def test_skills_and_connectors_of_the_account_reach_the_terminal(
    live: Live, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    sign_in(live, monkeypatch)
    with live.signed_in_browser() as browser:
        made = browser.post(
            "/api/skills",
            json={
                "name": "Resumir reunião",
                "description": "Resume atas de reunião",
                "instructions": "Seja breve e liste as decisões.",
            },
        )
        assert made.status_code == 201, made.text

    shell = live.shell()
    shell.skills()
    shown = capsys.readouterr().out
    assert "Resumir reunião" in shown and "Resume atas de reunião" in shown

    shell.connectors()
    assert "Nenhum conector ligado" in capsys.readouterr().out
    shell.api.close()


def test_the_plan_gate_holds_in_the_terminal(
    live: Live, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    sign_in(live, monkeypatch)
    shell = live.shell()
    shell.command("/forja")
    assert shell.forja is True
    # O gate é do servidor: o terminal não tem como contornar.
    assert shell.ask("faz um jogo") is False
    assert "planos pagos" in capsys.readouterr().err
    shell.api.close()


def test_ctrl_c_stops_the_answer_on_the_server(
    live_holding: Live, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    sign_in(live_holding, monkeypatch)
    shell = live_holding.shell()
    reply: list[str] = []

    def hit_ctrl_c(events: Iterator[dict[str, Any]]) -> Iterator[dict[str, Any]]:
        """Deixa o começo da resposta chegar e então aperta Ctrl-C."""
        for event in events:
            yield event
            if event.get("type") == "start":
                reply.append(str(event["reply"]["id"]))
            if event.get("type") == "delta":
                raise KeyboardInterrupt

    body = {"client_id": "interrompido-aqui", "content": "escreve bastante"}
    assert shell._paint(hit_ctrl_c(shell.api.send(body))) is False
    assert "interrompido" in capsys.readouterr().out

    # O servidor parou de verdade: a resposta fica gravada como interrompida.
    for _ in range(100):
        state = shell.api.get(f"/api/messages/{reply[0]}")["message"]["status"]
        if state != "streaming":
            break
        time.sleep(0.05)
    assert state == "stopped", state
    shell.api.close()


def test_status_only_shows_what_the_server_says(
    live: Live, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    sign_in(live, monkeypatch)
    capsys.readouterr()
    assert main(["status"]) == 0
    shown = capsys.readouterr().out
    assert EMAIL in shown and live.url in shown and "Plano" in shown


# ---------- Sessão ----------


def test_without_a_session_the_terminal_says_what_to_do(
    live: Live, capsys: pytest.CaptureFixture[str]
) -> None:
    assert credentials.load() is None
    assert main([]) == 1
    assert "kazer entrar" in capsys.readouterr().out


def test_an_expired_session_is_forgotten(live: Live, capsys: pytest.CaptureFixture[str]) -> None:
    credentials.save(
        Session(server=live.url, cookie_name="kazer_session", cookie="nada-disso", email=EMAIL)
    )
    assert main(["status"]) == 1
    assert "expirou" in capsys.readouterr().out
    assert credentials.load() is None, "sessão inválida não fica no disco"


def test_leaving_clears_the_session(live: Live, monkeypatch: pytest.MonkeyPatch) -> None:
    sign_in(live, monkeypatch)
    assert main(["sair"]) == 0
    assert credentials.load() is None
    # E o cookie também morreu no servidor.
    assert main(["status"]) == 1


# ---------- Como aparece ----------


def test_the_mark_is_the_slit() -> None:
    rows = render.mark()
    assert len(rows) == 8, "sete linhas de losango mais a linha do deslocamento"
    assert all("│" in row for row in rows)
    left = [row.split("│")[0].strip() for row in rows]
    right = [row.split("│")[1].strip() for row in rows]
    # Metade esquerda cresce e decresce; a direita é a mesma, uma linha abaixo.
    assert [len(part) for part in left] == [1, 2, 3, 4, 3, 2, 1, 0]
    assert [len(part) for part in right] == [0, 1, 2, 3, 4, 3, 2, 1]


def test_no_colour_outside_a_terminal(monkeypatch: pytest.MonkeyPatch) -> None:
    plain = Screen(color=False, unicode=False)
    assert plain.paint("KAZER", render.BOLD) == "KAZER"
    monkeypatch.setenv("NO_COLOR", "1")
    assert render.colors_on() is False
