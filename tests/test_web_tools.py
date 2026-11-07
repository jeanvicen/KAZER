"""Pesquisa em tempo real: busca, páginas e GitHub, sem rede de verdade.

As respostas externas vêm de um `httpx.MockTransport`; o teste prova o formato
entregue ao modelo, a marcação de conteúdo externo e a recusa de endereços
internos (inclusive escondidos atrás de redirecionamento).
"""

import base64
import json
from typing import Any

import httpx

from kazer.brain.model_provider import (
    CancelToken,
    GenerationRequest,
    Part,
    StreamEvent,
    ToolCall,
    Turn,
    _ThinkSplitter,
    task_effort,
)
from kazer.chat.generation import CONTINUE_PROMPT, GenerationHub
from kazer.chat.web_tools import EXTERNAL, WebTools, parse_duckduckgo, safe_url
from kazer.security.secrets import SecretProvider


class NoSecrets(SecretProvider):
    def get_secret(self, name: str, *, scope: str) -> str:
        raise LookupError(name)


def public(host: str) -> bool:
    return host not in {"interno.local", "127.0.0.1"}


DDG = """
<div class="result"><a rel="nofollow" class="result__a"
 href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgodotengine.org%2F&amp;rut=x">Godot <b>Engine</b></a>
<a class="result__snippet" href="#">Motor de jogos <b>livre</b>.</a></div>
<div class="result"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Anúncio</a></div>
"""


def handler(request: httpx.Request) -> httpx.Response:
    url = str(request.url)
    if url.startswith("https://html.duckduckgo.com"):
        return httpx.Response(200, text=DDG)
    if url == "https://site.example/":
        html = (
            "<html><head><title>Exemplo</title><script>roubar()</script></head>"
            "<body><h1>Olá</h1><p>Texto principal.</p><a href='/docs'>Docs</a></body></html>"
        )
        return httpx.Response(200, html=html)
    if url == "https://pula.example/":
        return httpx.Response(302, headers={"location": "http://interno.local/admin"})
    if "api.github.com/search/repositories" in url:
        items = [{
            "full_name": "godotengine/godot", "stargazers_count": 100, "language": "C++",
            "html_url": "https://github.com/godotengine/godot", "description": "Engine",
        }]
        return httpx.Response(200, json={"items": items})
    if url.endswith("/repos/a/b/contents/src/main.py"):
        content = base64.b64encode(b"print('oi')").decode()
        return httpx.Response(200, json={
            "encoding": "base64", "content": content,
            "html_url": "https://github.com/a/b/blob/main/src/main.py",
        })
    return httpx.Response(404)


def tools() -> WebTools:
    client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)
    return WebTools(NoSecrets(), client=client, resolve=public)


def test_search_without_keys_uses_duckduckgo_and_marks_external_content() -> None:
    out = tools().run("buscar_web", {"consulta": "godot"})
    assert out.startswith(EXTERNAL)
    assert "https://godotengine.org/" in out and "Godot Engine" in out
    assert "Anúncio" not in out


def test_open_page_returns_title_text_and_links_without_scripts() -> None:
    out = tools().run("abrir_pagina", {"url": "https://site.example/"})
    assert "Título: Exemplo" in out and "Texto principal." in out
    assert "https://site.example/docs" in out
    assert "roubar" not in out


def test_internal_addresses_are_refused_even_behind_a_redirect() -> None:
    w = tools()
    assert "não é público" in w.run("abrir_pagina", {"url": "http://interno.local/"})
    assert "não é público" in w.run("abrir_pagina", {"url": "https://pula.example/"})
    assert "Porta" in w.run("abrir_pagina", {"url": "http://site.example:6379/"})
    assert "http" in w.run("abrir_pagina", {"url": "file:///etc/passwd"})
    assert safe_url("https://site.example/x", public) == "https://site.example/x"


def test_github_search_and_file() -> None:
    w = tools()
    found = w.run("github", {"acao": "buscar", "consulta": "godot"})
    assert "godotengine/godot" in found and "https://github.com/godotengine/godot" in found
    file = w.run("github", {"acao": "arquivo", "repositorio": "a/b", "caminho": "src/main.py"})
    assert "print('oi')" in file
    assert "dono/nome" in w.run("github", {"acao": "repositorio", "repositorio": "../x"})
    assert "inválido" in w.run(
        "github", {"acao": "arquivo", "repositorio": "a/b", "caminho": "../segredo"}
    )


def test_duckduckgo_parser_unwraps_redirect_links() -> None:
    hits = parse_duckduckgo(DDG)
    assert [hit.url for hit in hits] == ["https://godotengine.org/"]


# ---------- Raciocínio e respostas longas ----------


def test_think_tags_become_hidden_reasoning_even_when_split() -> None:
    splitter = _ThinkSplitter()
    out: list[tuple[str, str]] = []
    for piece in ("<thi", "nk>plano", " secreto</th", "ink>Resposta", " final"):
        out += splitter.feed(piece)
    out += splitter.flush()
    text = "".join(t for kind, t in out if kind == "text")
    thinking = "".join(t for kind, t in out if kind == "thinking")
    assert text == "Resposta final" and thinking == "plano secreto"


def test_task_effort_thinks_more_for_code() -> None:
    def ask(text: str, system: str = "s") -> str:
        turn = Turn("user", (Part("text", text),))
        return task_effort(GenerationRequest(system=system, turns=(turn,)))

    assert ask("oi") == "low"
    assert ask("implemente uma API em python com autenticação") == "high"
    assert ask("qual a capital da França e por quê?") == "medium"
    assert ask("oi", "Esta conversa está no modo KZ Code") == "high"


class CutProvider:
    """Corta por tamanho na primeira rodada e termina na segunda."""

    capabilities: Any = None

    def __init__(self) -> None:
        self.requests: list[GenerationRequest] = []

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Any:
        self.requests.append(request)
        if len(self.requests) == 1:
            yield StreamEvent("text", "começo ")
            yield StreamEvent("stop", "length")
        else:
            yield StreamEvent("text", "fim")
            yield StreamEvent("stop", "end")


class Store:
    def __init__(self) -> None:
        self.final: dict[str, Any] = {}

    def update_reply(self, reply_id: str, **fields: Any) -> None:
        self.final.update(fields)


def test_a_cut_answer_continues_where_it_stopped() -> None:
    provider, store = CutProvider(), Store()
    hub = GenerationHub(store, provider)  # type: ignore[arg-type]
    request = GenerationRequest(system="s", turns=(Turn("user", (Part("text", "x"),)),))
    assert hub.try_reserve()
    live = hub.start("u", "c", "r", request)
    for _ in range(200):
        if live.done:
            break
        import time

        time.sleep(0.01)
    assert store.final["content"] == "começo fim"
    assert store.final["status"] == "complete"
    follow = provider.requests[1].turns
    assert follow[-1].parts[0].text == CONTINUE_PROMPT
    assert follow[-2].role == "assistant"


class ThinkerProvider:
    """Na 1ª rodada só pensa até estourar o tamanho; na 2ª (pensando pouco) responde."""

    capabilities: Any = None

    def __init__(self) -> None:
        self.requests: list[GenerationRequest] = []

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Any:
        self.requests.append(request)
        if not request.brief:
            yield StreamEvent("thinking", "pensando muito " * 50)
            yield StreamEvent("stop", "length")
        else:
            yield StreamEvent("text", "R$ 7.999")
            yield StreamEvent("stop", "end")


def test_when_thinking_eats_the_whole_answer_it_retries_thinking_less() -> None:
    import time

    provider, store = ThinkerProvider(), Store()
    hub = GenerationHub(store, provider)  # type: ignore[arg-type]
    request = GenerationRequest(system="s", turns=(Turn("user", (Part("text", "x"),)),))
    assert hub.try_reserve()
    live = hub.start("u", "c", "r", request)
    for _ in range(200):
        if live.done:
            break
        time.sleep(0.01)
    assert store.final["status"] == "complete"
    assert store.final["content"] == "R$ 7.999"
    assert [r.brief for r in provider.requests] == [False, True]


def test_tool_labels_never_carry_html() -> None:
    label = WebTools.label("buscar_web", {"consulta": "<b>x</b>" * 40})
    assert len(label) < 100
    assert json.dumps(WebTools.label("github", {"acao": "repositorio", "repositorio": "a/b"}))
    assert ToolCall("1", "buscar_web", {}).name == "buscar_web"


def test_stripe_checkout_builds_a_subscription_session() -> None:
    from kazer.integrations.payments import CheckoutError, StripeCheckout

    seen: list[httpx.Request] = []

    def stripe(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"url": "https://checkout.stripe.com/c/pay/x"})

    client = httpx.Client(transport=httpx.MockTransport(stripe))
    checkout = StripeCheckout("sk_test_x", {"pro_mensal": "price_1"}, "https://kazer.app", client)
    url = checkout.create(user_id="u1", email="a@b.com", plan="pro", cycle="mensal")
    assert url.startswith("https://checkout.stripe.com/")
    body = seen[0].content.decode()
    assert "price_1" in body and "client_reference_id=u1" in body and "mode=subscription" in body
    assert seen[0].headers["authorization"] == "Bearer sk_test_x"
    assert "sk_test_x" not in repr(checkout)
    for plan, cycle in (("free", "mensal"), ("pro", "anual")):
        try:
            checkout.create(user_id="u1", email="a@b.com", plan=plan, cycle=cycle)
        except CheckoutError:
            pass
        else:  # pragma: no cover
            raise AssertionError("deveria recusar")


class Keys(SecretProvider):
    def get_secret(self, name: str, *, scope: str) -> str:
        if name == "TAVILY_API_KEY":
            return "tvly-test"
        raise LookupError(name)


def multi_handler(seen: list[str]) -> Any:
    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        seen.append(host)
        if host == "html.duckduckgo.com":
            return httpx.Response(200, text=DDG)
        if host == "api.marginalia.nu":
            items = [
                {"url": "https://pequeno.blog/godot", "title": "Blog Godot", "description": "x"},
                {"url": "https://godotengine.org/", "title": "Repetido", "description": ""},
            ]
            return httpx.Response(200, json={"results": items})
        if host == "pt.wikipedia.org":
            found = {"query": {"search": [{"title": "Godot (motor de jogo)", "snippet": "motor"}]}}
            return httpx.Response(200, json=found)
        if host == "api.tavily.com":
            items = [{"url": "https://tavily.example/a", "title": "Profundo", "content": "y"}]
            return httpx.Response(200, json={"results": items})
        if host == "news.google.com":
            rss = (
                "<rss><channel><item><title>Godot 5 lançado</title>"
                "<link>https://noticia.example/godot5</link><pubDate>Thu, 05 Nov 2026</pubDate>"
                "<source url='x'>Jornal</source></item></channel></rss>"
            )
            return httpx.Response(200, text=rss)
        return httpx.Response(404)

    return handler


def test_normal_search_mixes_free_sources_and_never_spends_tavily() -> None:
    seen: list[str] = []
    client = httpx.Client(transport=httpx.MockTransport(multi_handler(seen)))
    w = WebTools(Keys(), client=client, resolve=public)
    text, found, detail = w.execute("buscar_web", {"consulta": "godot engine"})
    assert "api.tavily.com" not in seen
    urls = [item["u"] for item in found]
    assert "https://godotengine.org/" in urls and "https://pequeno.blog/godot" in urls
    assert any("wikipedia.org" in url for url in urls)
    assert urls.count("https://godotengine.org/") == 1  # repetido entre fontes some
    assert "fontes" in detail and "DuckDuckGo" in text


def test_tavily_only_when_free_sources_come_back_empty() -> None:
    seen: list[str] = []
    base = multi_handler(seen)

    def blocked(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if host in ("api.tavily.com",):
            return base(request)
        seen.append(host)
        return httpx.Response(403)  # todas as grátis bloqueando o servidor

    client = httpx.Client(transport=httpx.MockTransport(blocked))
    w = WebTools(Keys(), client=client, resolve=public)
    _, found, _ = w.execute("buscar_web", {"consulta": "godot engine novidades"})
    assert "https://tavily.example/a" in [item["u"] for item in found]


def test_bing_feed_counts_as_a_source_and_results_are_ranked() -> None:
    from kazer.chat.web_tools import Hit, parse_rss, rank_hits

    rss = (
        "<rss><channel><item><title>Preço do iPhone 17 no Brasil</title>"
        "<link>https://loja.example/iphone17</link><description>Custa R$ 7.999</description>"
        "</item></channel></rss>"
    )
    hits = parse_rss(rss)
    assert hits[0].snippet == "Custa R$ 7.999"
    noise = [Hit("Receita de bolo", f"https://bolo{i}.example", "farinha") for i in range(4)]
    ranked = rank_hits("preço iphone 17", [*noise, *hits, *hits, *hits], 3)
    assert ranked[0].url == "https://loja.example/iphone17"


def test_news_tool_and_lite_parser() -> None:
    from kazer.chat.web_tools import parse_duckduckgo_lite

    seen: list[str] = []
    client = httpx.Client(transport=httpx.MockTransport(multi_handler(seen)))
    w = WebTools(NoSecrets(), client=client, resolve=public)
    text, found, _ = w.execute("noticias", {"assunto": "godot"})
    assert "Godot 5 lançado" in text and found
    lite = (
        "<a rel='nofollow' href=\"//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2F\" "
        "class='result-link'>Título A</a><td class='result-snippet'>Trecho A</td>"
    )
    hits = parse_duckduckgo_lite(lite)
    assert hits[0].url == "https://a.example/" and hits[0].snippet == "Trecho A"


class Searcher:
    """Pede busca sempre que pode; responde quando o KAZER manda parar."""

    capabilities: Any = None

    def __init__(self, fail_on: int = 0) -> None:
        self.requests: list[GenerationRequest] = []
        self.fail_on = fail_on

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Any:
        from kazer.brain.model_provider import ProviderError

        self.requests.append(request)
        if self.fail_on and len(self.requests) == self.fail_on:
            raise ProviderError("model_busy")
        if request.tool_choice == "none":
            yield StreamEvent("text", "Resposta final com o que achei.")
            yield StreamEvent("stop", "end")
            return
        n = len(self.requests)
        yield StreamEvent("tool", call=ToolCall(f"c{n}", "buscar_web", {"consulta": f"q{n}"}))
        yield StreamEvent("stop", "tool")


def _run(provider: Any) -> Store:
    from kazer.chat.generation import GenerationHub

    store = Store()
    hub = GenerationHub(store, provider)  # type: ignore[arg-type]
    request = GenerationRequest(
        system="s", turns=(Turn("user", (Part("text", "x"),)),),
        tools=(WebTools.definitions[0],),
    )

    def tool(call: ToolCall) -> tuple[Any, ...]:
        return ("Pesquisando", "R" * 5000, [{"t": "A", "u": "https://a.example/", "k": "busca"}],
                "1 resultado")

    assert hub.try_reserve()
    live = hub.start("u", "c", "r", request, on_tool=tool)
    import time

    for _ in range(300):
        if live.done:
            break
        time.sleep(0.01)
    return store


def test_research_has_a_budget_and_always_ends_with_an_answer() -> None:
    from kazer.chat.generation import MAX_TOOL_ROUNDS, OLD_RESULT_CHARS

    provider = Searcher()
    store = _run(provider)
    assert store.final["status"] == "complete"
    assert store.final["content"].startswith("Resposta final com o que achei.")
    assert "```kazer-fontes" in store.final["content"]
    assert "```kazer-passos" in store.final["content"]
    # Rodadas de busca + uma final sem ferramenta (e nunca além do orçamento).
    assert len(provider.requests) == MAX_TOOL_ROUNDS + 1
    assert provider.requests[-1].tool_choice == "none"
    # Resultados de rodadas antigas voltam encurtados ao modelo.
    first_results = [t for t in provider.requests[-1].turns if t.results][0].results
    assert len(first_results[0][1]) < OLD_RESULT_CHARS + 100


def test_what_was_researched_is_saved_even_if_the_answer_fails() -> None:
    store = _run(Searcher(fail_on=2))
    assert store.final["status"] == "error"
    assert "https://a.example/" in store.final["content"]


def test_long_pages_keep_only_what_answers_the_question() -> None:
    from kazer.chat.web_tools import focus_text

    filler = [f"Parágrafo {i} sobre receitas de bolo e farinha." for i in range(80)]
    page = "\n\n".join(["Começo da página.", *filler, "O preço do iPhone 17 é R$ 7.999.", *filler])
    out = focus_text(page, "pesquisa pará mim o preço do iphone", 800)
    assert "R$ 7.999" in out and len(out) < 800
    assert "Começo da página." in out
    # Página curta passa inteira; sem pistas no pedido, corta pelo começo.
    assert focus_text("curto", "x", 800) == "curto"
    assert focus_text(page, "", 300).startswith("Começo da página.")


class WriterProvider:
    """Só escreve: guarda o pedido que recebeu (e quebra se receber ferramenta)."""

    capabilities: Any = None

    def __init__(self) -> None:
        self.requests: list[GenerationRequest] = []

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Any:
        self.requests.append(request)
        yield StreamEvent("text", "O iPhone 17 custa R$ 7.999 [fonte](https://loja.example/iphone).")
        yield StreamEvent("stop", "end")


def test_search_happens_first_and_the_model_only_writes() -> None:
    import time

    from kazer.chat import prefetch

    ran: list[ToolCall] = []

    def on_tool(call: ToolCall) -> tuple[Any, ...]:
        ran.append(call)
        if call.name == "buscar_web":
            found = [
                {"t": "Loja", "u": "https://loja.example/iphone", "k": "busca"},
                {"t": "Vídeo", "u": "https://youtube.com/watch?v=1", "k": "busca"},
                {"t": "Blog", "u": "https://blog.example/precos", "k": "busca"},
            ]
            return ("Pesquisando: preço iphone 17", "1. Loja — R$ 7.999", found, "3 resultados")
        return (f"Lendo {call.arguments['url']}", "Preço oficial: R$ 7.999", [], "lido")

    provider, store = WriterProvider(), Store()
    hub = GenerationHub(store, provider)  # type: ignore[arg-type]
    question = "pesquisa pará mim o preço do iphone 17"
    request = GenerationRequest(
        system="s",
        turns=(Turn("user", (Part("text", question),)),),
        prefetch=prefetch.plan(question),
    )
    assert hub.try_reserve()
    live = hub.start("u", "c", "r", request, on_tool=on_tool)
    for _ in range(300):
        if live.done:
            break
        time.sleep(0.01)
    assert store.final["status"] == "complete"
    # Buscou, depois abriu as 2 melhores páginas (pulando o YouTube)…
    assert [c.name for c in ran] == ["buscar_web", "abrir_pagina", "abrir_pagina"]
    assert ran[0].arguments == {"consulta": "o preço do iphone 17"}
    assert {c.arguments["url"] for c in ran[1:]} == {
        "https://loja.example/iphone",
        "https://blog.example/precos",
    }
    # …e a Groq recebeu tudo pronto: uma única chamada, sem ferramentas.
    assert len(provider.requests) == 1
    sent = provider.requests[0]
    assert sent.tools == () and sent.prefetch == () and sent.brief
    note = sent.turns[-1].parts[-1].text
    assert "Pesquisa feita agora pelo KAZER" in note and "R$ 7.999" in note
    # Fontes e passos ficam salvos na conversa.
    assert "kazer-fontes" in store.final["content"]
    assert "loja.example" in store.final["content"]


def test_chit_chat_and_building_do_not_search() -> None:
    from kazer.chat.prefetch import plan

    assert plan("oi tudo bem?") == ()
    assert plan("crie um jogo de carro em html") == ()
    assert plan("explica o que é recursão") == ()
    photos = plan("me mostra fotos de um axolote")
    assert [c.name for c in photos] == ["buscar_imagens", "buscar_web"]
    assert plan("e no Brasil?", "pesquisa o preço do iphone 17")[0].arguments["consulta"] == (
        "o preço do iphone 17 e no Brasil"
    )


def test_a_failing_search_still_gets_an_answer() -> None:
    import time

    def on_tool(call: ToolCall) -> tuple[Any, ...]:
        raise RuntimeError("rede caiu")

    provider, store = WriterProvider(), Store()
    hub = GenerationHub(store, provider)  # type: ignore[arg-type]
    request = GenerationRequest(
        system="s",
        turns=(Turn("user", (Part("text", "preço do iphone hoje"),)),),
        prefetch=(ToolCall("pre-0", "buscar_web", {"consulta": "iphone"}),),
    )
    assert hub.try_reserve()
    live = hub.start("u", "c", "r", request, on_tool=on_tool)
    for _ in range(300):
        if live.done:
            break
        time.sleep(0.01)
    assert store.final["status"] == "complete"


class JudgeProvider(WriterProvider):
    """O modelo leve responde `verdict` quando perguntado se vale pesquisar."""

    def __init__(self, verdict: str) -> None:
        super().__init__()
        self.verdict = verdict

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Any:
        if request.light:
            yield StreamEvent("text", self.verdict)
            yield StreamEvent("stop", "end")
            return
        yield from super().stream(request, cancel)


def _run_with_judge(verdict: str) -> tuple[list[ToolCall], JudgeProvider]:
    import time

    from kazer.chat import prefetch

    ran: list[ToolCall] = []

    def on_tool(call: ToolCall) -> tuple[Any, ...]:
        ran.append(call)
        return ("Pesquisando", "resultado", [], "1 resultado")

    question = "qual o melhor celular custo benefício?"
    assert prefetch.uncertain(question)
    provider, store = JudgeProvider(verdict), Store()
    hub = GenerationHub(store, provider)  # type: ignore[arg-type]
    request = GenerationRequest(
        system="s",
        turns=(Turn("user", (Part("text", question),)),),
        prefetch=prefetch.plan(question),
        prefetch_check=question,
    )
    assert hub.try_reserve()
    live = hub.start("u", "c", "r", request, on_tool=on_tool)
    for _ in range(300):
        if live.done:
            break
        time.sleep(0.01)
    assert store.final["status"] == "complete"
    return ran, provider


def test_in_doubt_a_small_model_decides_whether_to_search() -> None:
    ran, _ = _run_with_judge("SIM")
    assert [c.name for c in ran] == ["buscar_web"]
    ran, provider = _run_with_judge("NAO")
    assert ran == []
    assert "Pesquisa feita agora" not in provider.requests[-1].turns[-1].parts[-1].text


def test_clear_cases_never_ask_the_small_model() -> None:
    from kazer.chat.prefetch import uncertain

    assert not uncertain("pesquisa o preço do iphone")  # já é certeza: pesquisa
    assert not uncertain("crie um site de pizzaria")
    assert not uncertain("explica o que é recursão")
    assert not uncertain("quanto é 2+2?")


def test_photos_from_commons_and_openverse_show_on_top_and_stay_saved() -> None:
    import time

    def web(request: httpx.Request) -> httpx.Response:
        if request.url.host == "commons.wikimedia.org":
            pages = {"1": {"index": 1, "title": "File:Axolote.jpg", "imageinfo": [{
                "thumburl": "https://upload.wikimedia.org/a.jpg",
                "descriptionurl": "https://commons.wikimedia.org/wiki/File:Axolote.jpg",
                "extmetadata": {"LicenseShortName": {"value": "CC BY-SA 4.0"}},
            }]}}
            return httpx.Response(200, json={"query": {"pages": pages}})
        if request.url.host == "api.openverse.org":
            return httpx.Response(200, json={"results": [{
                "thumbnail": "https://api.openverse.org/v1/images/x/thumb/",
                "title": "Axolote rosa", "foreign_landing_url": "https://flickr.com/p/1",
                "license": "by", "license_version": "2.0",
            }, {"thumbnail": "https://evil.example/x.jpg", "title": "fora da lista"}]})
        return httpx.Response(404)

    w = WebTools(NoSecrets(), client=httpx.Client(transport=httpx.MockTransport(web)),
                 resolve=public)
    text, found, _ = w.execute("buscar_imagens", {"consulta": "axolote"})
    pictures = [item["img"] for item in found if item.get("img")]
    assert pictures == [
        "https://upload.wikimedia.org/a.jpg",
        "https://api.openverse.org/v1/images/x/thumb/",
    ]
    assert "evil.example" not in text

    def on_tool(call: ToolCall) -> tuple[Any, ...]:
        return ("Buscando imagens", text, found, "")

    provider, store = WriterProvider(), Store()
    hub = GenerationHub(store, provider)  # type: ignore[arg-type]
    request = GenerationRequest(
        system="s",
        turns=(Turn("user", (Part("text", "fotos de axolote"),)),),
        prefetch=(ToolCall("pre-0", "buscar_imagens", {"consulta": "axolote"}),),
    )
    assert hub.try_reserve()
    live = hub.start("u", "c", "r", request, on_tool=on_tool)
    for _ in range(300):
        if live.done:
            break
        time.sleep(0.01)
    events = [event for event in live.events if event["type"] == "images"]
    assert events and events[-1]["items"][0]["url"] == "https://upload.wikimedia.org/a.jpg"
    assert "```kazer-imagens" in store.final["content"]
    # Foto não vira "fonte" repetida na lista de fontes.
    assert all(not item.get("img") for item in live.sources)


def test_only_searches_when_it_really_needs_to() -> None:
    """Pesquisar à toa deixa tudo lento: tutorial, criar, conceito e conversa não pesquisam."""
    from kazer.chat.prefetch import plan, uncertain

    for question in (
        "como tirar foto panorâmica passo a passo",  # "foto" não é pedido de fotos
        "cria uma imagem de um gato",
        "agora me explica o que é inflação",  # "agora" não é notícia
        "como ganhar dinheiro online",  # "online" não é pedido de pesquisa
        "algoritmo de busca binária em python",  # "busca" não é pesquisa
        "qual a melhor forma de estudar para prova?",
        "como funciona a fotossíntese",
    ):
        assert plan(question) == (), question
        assert not uncertain(question), question
    # O que muda com o tempo (ou foi pedido) continua indo para a web.
    for question in (
        "pesquisa o preço do iphone 17",
        "qual o preço do dólar hoje?",
        "quem ganhou o jogo do flamengo ontem?",
        "quais as últimas notícias sobre IA",
    ):
        assert any(c.name == "buscar_web" for c in plan(question)), question


def test_explaining_something_visual_brings_reference_photos_without_the_web() -> None:
    from kazer.chat.prefetch import plan

    calls = plan("o que é um axolote?")
    assert [c.name for c in calls] == ["buscar_imagens"]
    assert calls[0].arguments["consulta"] == "axolote"
    assert plan("explica o que é recursão") == ()  # conceito sem imagem: nada
