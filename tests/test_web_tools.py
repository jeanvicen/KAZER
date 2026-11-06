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


def test_deep_research_adds_tavily_and_news() -> None:
    seen: list[str] = []
    client = httpx.Client(transport=httpx.MockTransport(multi_handler(seen)))
    w = WebTools(Keys(), client=client, resolve=public)
    _, found, _ = w.execute("buscar_web", {"consulta": "godot engine"}, deep=True)
    urls = [item["u"] for item in found]
    assert "https://tavily.example/a" in urls
    assert "https://noticia.example/godot5" in urls


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
