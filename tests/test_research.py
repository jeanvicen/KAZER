"""Motor de pesquisa: profundidade, planejamento, leitura, citações e números reais.

Tudo com buscas e modelo de mentira: o que importa é que cada número mostrado
na tela corresponde a uma operação que aconteceu de fato.
"""

import time
from typing import Any

from kazer.brain.model_provider import (
    CancelToken,
    GenerationRequest,
    Part,
    StreamEvent,
    ToolCall,
    Turn,
)
from kazer.chat import prefetch
from kazer.chat.generation import GenerationHub
from kazer.chat.web_tools import WebTools


class Store:
    def __init__(self) -> None:
        self.final: dict[str, Any] = {}

    def update_reply(self, reply_id: str, **fields: Any) -> None:
        self.final.update(fields)


class Planner:
    """Modelo leve devolve um plano de consultas; o principal só escreve."""

    capabilities: Any = None

    def __init__(self, plan: str = '{"consultas": ["comissão afiliados moda", "Shein afiliados oficial", "fashion affiliate commission"]}') -> None:  # noqa: E501
        self.plan = plan
        self.requests: list[GenerationRequest] = []

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Any:
        self.requests.append(request)
        if request.light:
            text = self.plan if "planeja buscas" in request.system else "SIM"
            yield StreamEvent("text", text)
            yield StreamEvent("stop", "end")
            return
        yield StreamEvent("text", "A Shein paga até 20% [1] e a Dafiti 6% [2][3].")
        yield StreamEvent("stop", "end")


def run(question: str, on_tool: Any, provider: Any = None) -> tuple[Any, Store, Any]:
    provider = provider or Planner()
    store = Store()
    hub = GenerationHub(store, provider)  # type: ignore[arg-type]
    request = GenerationRequest(
        system="s",
        turns=(Turn("user", (Part("text", question),)),),
        prefetch=prefetch.plan(question),
    )
    assert hub.try_reserve()
    live = hub.start("u", "c", "r", request, on_tool=on_tool)
    for _ in range(500):
        if live.done:
            break
        time.sleep(0.01)
    return live, store, provider


def fake_web(fail: set[str] | None = None) -> tuple[list[ToolCall], Any]:
    ran: list[ToolCall] = []
    fail = fail or set()

    def on_tool(call: ToolCall) -> tuple[Any, ...]:
        ran.append(call)
        if call.name == "buscar_web":
            q = call.arguments["consulta"]
            hits = [
                {"t": f"Shein ({q})", "u": "https://br.shein.com/afiliados", "k": "busca"},
                {"t": "Dafiti parceiros", "u": "https://www.dafiti.com.br/parceiros", "k": "busca"},
                {"t": "Blog de cupons", "u": "https://cupons.blogspot.com/x", "k": "busca"},
                {"t": "Lomadee", "u": "https://www.lomadee.com/moda", "k": "busca"},
                {"t": "Vídeo", "u": "https://youtube.com/watch?v=1", "k": "busca"},
            ]
            return ("Pesquisando", "1. Shein — até 20%", hits, f"{len(hits)} resultados")
        url = call.arguments["url"]
        if url in fail:
            return (f"Lendo {url}", "A página respondeu com erro 403.", [], "falhou")
        return (f"Lendo {url}", f"Conteúdo de {url}: comissão até 20%.",
                [{"t": url, "u": url, "k": "lido", "d": "2026-10-01"}], "300 palavras lidas")

    return ran, on_tool


def test_depth_matches_the_kind_of_question() -> None:
    assert prefetch.depth("preço do iphone 17") == prefetch.SIMPLE
    moderate = "qual a cotação do dólar hoje e por que subiu tanto?"
    assert prefetch.depth(moderate) == prefetch.MODERATE
    assert prefetch.depth("quais são as melhores lojas de roupa para afiliado?") == prefetch.DEEP
    assert prefetch.depth("compare Shein e Dafiti para afiliados") == prefetch.DEEP


def test_planner_output_is_validated_and_never_trusted_blindly() -> None:
    assert prefetch.parse_queries('{"consultas": ["a b", "c d"]}', "principal", 4) == [
        "principal", "a b", "c d"]
    assert prefetch.parse_queries("não sei", "principal", 4) == ["principal"]
    assert prefetch.parse_queries('{"consultas": ["principal", 7, "x" ]}', "principal", 4) == [
        "principal"]
    many = '{"consultas": ["a1", "b1", "c1", "d1", "e1"]}'
    assert len(prefetch.parse_queries(many, "p", 2)) == 2


def test_deep_question_plans_queries_reads_trusted_pages_and_counts_for_real() -> None:
    ran, on_tool = fake_web()
    live, store, provider = run("quais são as melhores lojas de roupa para afiliado?", on_tool)
    searches = [c for c in ran if c.name == "buscar_web"]
    reads = [c for c in ran if c.name == "abrir_pagina"]
    assert len(searches) == 4  # a principal + 3 do plano do modelo leve (teto 4)
    read_urls = [c.arguments["url"] for c in reads]
    assert "https://youtube.com/watch?v=1" not in read_urls
    # Confiáveis/oficiais antes do blog fraco; um por domínio.
    assert read_urls.index("https://br.shein.com/afiliados") < read_urls.index(
        "https://cupons.blogspot.com/x")
    stats = live.research
    assert stats["buscas"] == 4 and stats["buscas_tentadas"] == 4
    assert stats["resultados"] == 20  # 5 por busca: resultados, não páginas lidas
    assert stats["dominios"] == 5
    assert stats["paginas_lidas"] == len(reads) and stats["paginas_falharam"] == 0
    # Fontes numeradas: lidas primeiro, e o modelo recebe a lista para citar.
    note = provider.requests[-1].turns[-1].parts[-1].text
    assert "FONTES (cite pelo número)" in note and "[1]" in note and "página lida" in note
    numbered = {s["n"]: s for s in live.sources if s.get("n")}
    assert numbered[1]["k"] == "lido" and numbered[1].get("d") == "2026-10-01"
    assert "```kazer-pesquisa" in store.final["content"]
    assert any(e["type"] == "research" for e in live.events)


def test_simple_question_stays_cheap() -> None:
    ran, on_tool = fake_web()
    live, _, provider = run("preço do iphone 17", on_tool)
    assert [c.name for c in ran].count("buscar_web") == 1
    assert [c.name for c in ran].count("abrir_pagina") == 2
    assert not any(r.light and "planeja" in r.system for r in provider.requests)


def test_failed_pages_are_reported_and_a_second_round_tries_others() -> None:
    fail = {"https://br.shein.com/afiliados", "https://www.dafiti.com.br/parceiros",
            "https://www.lomadee.com/moda"}
    ran, on_tool = fake_web(fail)
    live, _, _ = run("qual o melhor programa de afiliados de moda?", on_tool)
    stats = live.research
    assert stats["paginas_falharam"] >= 3
    assert stats["paginas_lidas"] == 1  # só o blog abriu
    # Página que falhou nunca vira "fonte lida".
    lidas = {s["u"] for s in live.sources if s.get("k") == "lido"}
    assert lidas == {"https://cupons.blogspot.com/x"}


def test_cancel_during_research_stops_without_inventing_results() -> None:
    hold = {"n": 0}

    def slow(call: ToolCall) -> tuple[Any, ...]:
        hold["n"] += 1
        time.sleep(0.3)
        return ("Pesquisando", "nada", [], "0 resultados")

    store = Store()
    hub = GenerationHub(store, Planner())  # type: ignore[arg-type]
    request = GenerationRequest(
        system="s", turns=(Turn("user", (Part("text", "pesquisa o preço do iphone"),)),),
        prefetch=prefetch.plan("pesquisa o preço do iphone"),
    )
    assert hub.try_reserve()
    live = hub.start("u", "c", "r", request, on_tool=slow)
    time.sleep(0.05)
    live.cancel.cancel()
    for _ in range(300):
        if live.done:
            break
        time.sleep(0.01)
    assert store.final["status"] == "stopped"
    assert hold["n"] == 1  # não abriu páginas depois do cancelamento


def test_reliability_prefers_official_and_primary_sources() -> None:
    q = "programa de afiliados da dafiti"
    assert prefetch.reliability("https://www.dafiti.com.br/x", q) > prefetch.reliability(
        "https://cupons.blogspot.com/x", q)
    assert prefetch.reliability("https://www.gov.br/receita", "imposto") > 0
    assert prefetch.reliability("https://pt.wikipedia.org/wiki/X", "x") > 0


def wait_for(live: Any, predicate: Any, seconds: float = 5.0) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate(live):
            return
        time.sleep(0.01)
    raise AssertionError("o evento esperado não chegou")


def test_skip_ends_research_and_the_model_answers_with_what_it_has() -> None:
    """"Pular" (como no ChatGPT): o que terminou entra, o resto é descartado."""
    _, quick = fake_web()
    opened: list[str] = []

    def on_tool(call: ToolCall) -> tuple[Any, ...]:
        if call.name == "abrir_pagina":
            opened.append(call.arguments["url"])
            time.sleep(3)  # página lenta: é aqui que a pessoa pula
        return quick(call)

    question = "quais são as melhores lojas de roupa para afiliado?"
    assert prefetch.depth(question) != prefetch.SIMPLE
    provider = Planner()
    store = Store()
    hub = GenerationHub(store, provider)  # type: ignore[arg-type]
    request = GenerationRequest(
        system="s", turns=(Turn("user", (Part("text", question),)),),
        prefetch=prefetch.plan(question),
    )
    assert hub.try_reserve()
    # Como em produção: o rótulo do passo aparece antes de a ferramenta rodar.
    live = hub.start("u", "c", "r", request, on_tool=on_tool,
                     describe=lambda call: WebTools.label(call.name, call.arguments))
    wait_for(live, lambda lv: any(e.get("label", "").startswith("Lendo")
                                  and e.get("state") == "run" for e in lv.events))
    asked = time.monotonic()
    assert hub.skip("u", "r") is True
    assert hub.skip("outra-conta", "r") is False  # só a própria conta pula
    wait_for(live, lambda lv: lv.done)
    assert time.monotonic() - asked < 1.5  # não esperou as páginas lentas
    assert store.final["status"] == "complete"

    steps = [e for e in live.events if e["type"] == "step"]
    assert all(e.get("skippable") for e in steps if e["state"] == "run")
    skipped = [e for e in steps if e["state"] == "done" and e.get("detail") == "pulada"]
    assert skipped and all(e["label"].startswith("Lendo") for e in skipped)

    stats = live.research
    assert stats["pulou"] is True
    assert stats["buscas"] == 4  # as buscas terminaram antes e contam
    assert stats["paginas_lidas"] == 0
    assert stats["paginas_falharam"] == 0  # pulada não é página que falhou

    note = provider.requests[-1].turns[-1].parts[-1].text
    assert "Pular" in note and "não foi verificado" in note
    assert "Shein" in note  # o que já tinha voltado da busca segue para o modelo


def test_skip_while_planning_answers_without_searching() -> None:
    class SlowPlanner(Planner):
        def stream(self, request: GenerationRequest, cancel: CancelToken) -> Any:
            if request.light and "planeja buscas" in request.system:
                self.requests.append(request)
                time.sleep(3)  # o modelo leve demora para planejar
                yield StreamEvent("stop", "end")
                return
            yield from super().stream(request, cancel)

    ran, on_tool = fake_web()
    question = "quais são as melhores lojas de roupa para afiliado?"
    provider = SlowPlanner()
    store = Store()
    hub = GenerationHub(store, provider)  # type: ignore[arg-type]
    request = GenerationRequest(
        system="s", turns=(Turn("user", (Part("text", question),)),),
        prefetch=prefetch.plan(question),
    )
    assert hub.try_reserve()
    live = hub.start("u", "c", "r", request, on_tool=on_tool)
    wait_for(live, lambda lv: any(e.get("label") == "Planejando a pesquisa" for e in lv.events))
    hub.skip("u", "r")
    wait_for(live, lambda lv: lv.done)
    assert ran == []  # nenhuma busca rodou depois do "Pular"
    planned = [e for e in live.events if e["type"] == "step" and e["state"] == "done"]
    assert planned[-1]["label"] == "Planejando a pesquisa" and planned[-1]["detail"] == "pulada"
    assert live.research["pulou"] is True and live.research["buscas_tentadas"] == 0
    assert "Pular" in provider.requests[-1].turns[-1].parts[-1].text
    assert store.final["status"] == "complete"


def test_skip_is_ignored_once_the_answer_is_done() -> None:
    ran, on_tool = fake_web()
    live, store, _ = run("quais são as melhores lojas de roupa para afiliado?", on_tool)
    assert live.done and live.research["pulou"] is False
    hub = GenerationHub(Store(), Planner())  # type: ignore[arg-type]
    assert hub.skip("u", "inexistente") is False
