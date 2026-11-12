"""Imagem dentro da conversa: intenção, cota, estado real e histórico."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from kazer.chat import imagine
from kazer.images.providers import DemoProvider, Generated, ImageError
from kazer.interfaces.web.app import create_app
from tests.test_chat import ORIGIN, Env, FakeProvider, chat_requests, send

PNG = DemoProvider().generate("x", 64, 64, 1).data


class Painter:
    name = "fake"
    label = "Teste"

    def __init__(self) -> None:
        self.prompts: list[tuple[str, int, int]] = []
        self.fail: str | None = None

    def generate(self, prompt: str, width: int, height: int, seed: int) -> Generated:
        self.prompts.append((prompt, width, height))
        if self.fail:
            raise ImageError(self.fail)
        return Generated(PNG, "image/png")


class Studio:
    """Ambiente do chat com (ou sem) gerador de imagem ligado."""

    def __init__(self, tmp_path: Path, painter: Painter | None) -> None:
        self.model = FakeProvider(chunks=("resposta do modelo",))
        self.env = Env(tmp_path, self.model)
        self.painter = painter
        self.app = create_app(
            self.env.settings, self.env.auth, chat=self.env.chat, image_provider=painter
        )

    def client(self, email: str = "ana@example.com") -> TestClient:
        client = TestClient(self.app, headers={"Origin": ORIGIN})
        client.__enter__()
        return self.env.signed_in(client, email)


@pytest.fixture
def make(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Callable[..., Studio]:
    monkeypatch.delenv("KAZER_IMAGE_PROVIDER", raising=False)
    monkeypatch.delenv("KAZER_IMAGE_ENDPOINT_URL", raising=False)
    return lambda painter=None: Studio(tmp_path, painter)


def text_of(events: list[dict[str, Any]]) -> str:
    return "".join(event["text"] for event in events if event["type"] == "delta")


# ---------- Intenção ----------


@pytest.mark.parametrize(
    ("said", "subject"),
    [
        ("crie uma imagem de um gato astronauta", "um gato astronauta"),
        ("Gera uma foto realista de uma praia", "realista de uma praia"),
        ("quero uma ilustração de um robô", "um robô"),
        ("desenhe um dragão em pixel art", "um dragão em pixel art"),
        ("faz um logo minimalista para minha loja", "minimalista para minha loja"),
        ("create an image of a red fox", "a red fox"),
    ],
)
def test_detects_image_requests(said: str, subject: str) -> None:
    assert imagine.wants_image(said)
    assert imagine.describe(said) == subject


@pytest.mark.parametrize(
    "said",
    [
        "bom dia",
        "me explica o que é uma imagem vetorial",
        "crie uma imagem em svg de um foguete",
        "crie um site com uma imagem de fundo",
        "faça um diagrama do fluxo de login",
        "desenhe um diagrama de classes",
        "descreva essa imagem",
        "escreva um prompt de imagem para um gato",
        "gere um gráfico das vendas",
        "x" * 1000,
    ],
)
def test_other_requests_stay_with_the_model(said: str) -> None:
    assert not imagine.wants_image(said)


def test_format_and_style_come_from_the_request() -> None:
    assert imagine.aspect("uma foto para story") == "9:16"
    assert imagine.aspect("um wallpaper de montanhas") == "16:9"
    assert imagine.aspect("um gato") == "1:1"
    assert imagine.style("um dragão em pixel art") == "pixel"
    assert imagine.style("foto realista de um carro") == "foto"
    assert imagine.reset_phrase(1_800_057_600, "America/Sao_Paulo").endswith("(seu horário)")
    assert "UTC" in imagine.reset_phrase(1_800_057_600, None)
    assert "UTC" in imagine.reset_phrase(1_800_057_600, "Lugar/Inexistente")


# ---------- Na conversa ----------


def test_image_request_answers_with_the_image_in_the_chat(make: Callable[..., Studio]) -> None:
    studio = make(Painter())
    ana = studio.client()
    events = send(ana, "crie uma imagem de um farol ao pôr do sol, formato story")
    answer = text_of(events)

    assert events[-1]["type"] == "done" and events[-1]["reply"]["status"] == "complete"
    assert studio.painter.prompts == [("um farol ao pôr do sol, formato story", 864, 1536)]
    assert chat_requests(studio.model) == [], "o modelo de texto nem é chamado"
    link = answer.split("](", 1)[1].split(")", 1)[0]
    assert answer.startswith("![um farol ao pôr do sol") and link.startswith("/api/images/")
    picture = ana.get(link)
    assert picture.status_code == 200 and picture.content == PNG

    # A imagem fica na conversa: reabrir o histórico traz a mesma resposta.
    conversation = events[0]["conversation"]["id"]
    saved = ana.get(f"/api/messages/{events[-1]['reply']['id']}").json()
    assert saved["message"]["content"] == answer, "a resposta com a imagem fica guardada"
    # E a conversa continua normal, agora com o modelo de texto.
    follow = text_of(send(ana, "gostei, o que mais dá para fazer?", conversation_id=conversation))
    assert follow == "resposta do modelo"
    turns = chat_requests(studio.model)[-1].turns
    assert any("/api/images/" in part.text for turn in turns for part in turn.parts if part.text)


def test_second_image_on_the_same_day_says_when_it_comes_back(make: Callable[..., Studio]) -> None:
    studio = make(Painter())
    ana = studio.client()
    send(ana, "crie uma imagem de um gato")
    again = text_of(send(ana, "crie uma imagem de um cachorro", timezone="America/Sao_Paulo"))
    assert again.startswith("Você já usou sua imagem de hoje. A próxima fica disponível às ")
    assert "(seu horário)" in again and "![" not in again
    assert len(studio.painter.prompts) == 1


def test_failure_keeps_the_daily_image_and_retry_works(make: Callable[..., Studio]) -> None:
    studio = make(Painter())
    ana = studio.client()
    studio.painter.fail = "image_timeout"
    events = send(ana, "crie uma imagem de uma montanha")
    assert text_of(events) == imagine.MESSAGES["image_timeout"]
    assert ana.get("/api/images").json()["quota"]["remaining"] == 1

    studio.painter.fail = None
    assert "![" in text_of(send(ana, "crie uma imagem de uma montanha"))
    assert ana.get("/api/images").json()["quota"]["remaining"] == 0


def test_image_of_one_account_is_not_served_to_another(make: Callable[..., Studio]) -> None:
    studio = make(Painter())
    ana = studio.client("ana@example.com")
    bia = studio.client("bia@example.com")
    answer = text_of(send(ana, "crie uma imagem de um segredo"))
    link = answer.split("](", 1)[1].split(")", 1)[0]
    assert bia.get(link).status_code == 404
    assert "![" in text_of(send(bia, "crie uma imagem de outra coisa")), "cota é por conta"


def test_without_generator_the_model_is_told_the_truth(make: Callable[..., Studio]) -> None:
    studio = make(None)
    ana = studio.client()
    answer = text_of(send(ana, "crie uma imagem de um gato"))
    assert answer == "resposta do modelo", "sem gerador, quem responde é o modelo"
    system = chat_requests(studio.model)[-1].system
    assert imagine.UNAVAILABLE_NOTE in system

    send(ana, "qual a capital do Brasil?")
    assert imagine.UNAVAILABLE_NOTE not in chat_requests(studio.model)[-1].system


def test_text_work_never_triggers_generation(make: Callable[..., Studio]) -> None:
    studio = make(Painter())
    ana = studio.client()
    send(ana, "crie uma imagem em svg de um foguete")
    send(ana, "me explica como funciona uma imagem png")
    assert studio.painter.prompts == []
    assert len(chat_requests(studio.model)) == 2
