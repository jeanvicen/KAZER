"""KAZER no terminal: a mesma conta, a mesma conversa, sem navegador.

`kazer` abre uma conversa. `kazer "pergunta"` responde e sai — serve em
script, em pipe, em atalho de editor. As conversas são as mesmas do site: o
que você começa aqui aparece lá, e o contrário também, porque é o mesmo
servidor e a mesma conta.

O que vale aqui vale porque vale no servidor: habilidades instaladas entram no
contexto, conectores ligados viram ferramentas, o plano limita, a memória
lembra. O terminal não tem regra própria — e por isso não tem como divergir.
"""

from __future__ import annotations

import getpass
import secrets
import sys
from collections.abc import Iterator, Sequence
from typing import Any

from kazer.interfaces.terminal import credentials
from kazer.interfaces.terminal.client import ApiClient, TerminalError, valid_server
from kazer.interfaces.terminal.credentials import Session
from kazer.interfaces.terminal.render import ACCENT, BOLD, DIM, Screen

VERSION = "1.1"
# Teto do texto que entra pelo cano; o servidor aceita 32 mil por mensagem.
MAX_PIPED_CHARS = 30_000

# O vocabulário de erro do site, em português, para a pessoa ler o mesmo texto
# nos dois lugares.
ERRORS = {
    "sem_conexao": "Sem conexão com o servidor do KAZER.",
    "sessao_nao_veio": "O servidor entrou mas não mandou sessão.",
    "resposta_invalida": "O servidor respondeu em formato inesperado.",
    "unauthenticated": "Sua sessão expirou. Rode: kazer entrar",
    "invalid_credentials": "E-mail ou senha incorretos.",
    "email_not_verified": "Confirme seu e-mail antes de entrar.",
    "auth_unavailable": "As contas estão fechadas neste ambiente.",
    "chat_unavailable": "O chat ainda não está disponível neste ambiente.",
    "model_unavailable": "O KAZ 1.1 ainda não está conectado neste ambiente.",
    "rate_limited": "Muitas mensagens seguidas. Espere um instante.",
    "capacity": "O KAZER está cheio agora. Tente em alguns segundos.",
    "busy": "Espere a resposta atual terminar.",
    "not_found": "Esta conversa não existe mais.",
    "message_too_long": "Mensagem longa demais: o máximo é de 32 mil caracteres.",
    "empty_message": "Escreva algo.",
    "usage_limit": "Você usou toda a franquia desta janela.",
    "plan_required": "Esse recurso entra com os planos pagos.",
    "forbidden_origin": "O servidor recusou a origem do pedido.",
    "invalid_request": "O servidor não entendeu o pedido.",
}

REPLY_ERRORS = {
    "model_timeout": "A resposta demorou demais e foi interrompida.",
    "model_refused": "O KAZER não pode ajudar com esse pedido.",
    "model_empty": "O modelo não devolveu nenhuma resposta.",
    "model_error": "Algo deu errado ao gerar a resposta.",
    "model_rejected": "O modelo não aceitou este pedido.",
    "interrupted": "A resposta foi interrompida.",
}

HELP = """
  kazer                       abre uma conversa nova
  kazer "sua pergunta"        responde e sai
  cat erro.log | kazer        a pergunta (ou o contexto) vem pelo cano
  kazer entrar                entra com a conta do site
  kazer sair                  encerra a sessão deste computador
  kazer conversas [busca]     lista suas conversas
  kazer continuar [n]         volta para uma conversa
  kazer habilidades           habilidades instaladas na conta
  kazer conectores            conectores ligados na conta
  kazer projetos              seus projetos
  kazer biblioteca            o que já passou pelas conversas
  kazer status                conta, plano e uso
  kazer servidor [endereço]   mostra ou troca o servidor
  kazer versao                versão do terminal

  Na conversa: /nova  /conversas  /continuar <n>  /habilidades  /conectores
               /projetos  /biblioteca  /status  /forja  /pensamento  /sair
"""


def message_for(error: TerminalError) -> str:
    """Erro do servidor virando frase, sempre com código quando é desconhecido."""
    text = ERRORS.get(error.code)
    if text is None:
        return f"Não foi possível concluir ({error.code})."
    if error.code == "rate_limited" and error.retry_after:
        return f"{text} ({error.retry_after}s)"
    return text


def client_id() -> str:
    """Identificador do envio: deixa reenvio depois de queda de rede ser barato."""
    return secrets.token_urlsafe(18)


class Shell:
    """Os comandos do terminal, cada um em cima de uma chamada da API."""

    def __init__(self, screen: Screen, api: ApiClient, session: Session) -> None:
        """`session` é a sessão já carregada do disco (ou recém-criada)."""
        self.screen = screen
        self.api = api
        self.session = session
        self.conversation: str | None = None
        self.forja = False
        self.thinking = False
        # Estamos no começo de uma linha? Decide o recuo do texto que chega.
        self._fresh = True

    # ---------- Listas ----------

    def conversations(self, query: str = "") -> list[dict[str, Any]]:
        """Conversas da conta, impressas e devolvidas (o número serve ao `/continuar`)."""
        page = self.api.conversations(query)
        items = page.get("items")
        rows = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
        if not rows:
            self.screen.note("  Nenhuma conversa ainda." if not query else "  Nada encontrado.")
            return []
        self.screen.write()
        for number, item in enumerate(rows, start=1):
            title = str(item.get("title") or "Conversa sem título")
            mark = " ←" if item.get("id") == self.conversation else ""
            index = self.screen.paint(f"{number:>3}.", DIM)
            self.screen.write(f"  {index} {title}{self.screen.paint(mark, ACCENT)}")
        self.screen.write()
        return rows

    def skills(self) -> None:
        """Habilidades instaladas: as mesmas que entram no contexto da resposta."""
        items = self.api.skills().get("items")
        rows = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
        if not rows:
            self.screen.note("  Nenhuma habilidade instalada.")
            self.screen.note("  Instale ou crie habilidades no site; aqui elas valem na hora.")
            return
        self.screen.write()
        for item in rows:
            name = str(item.get("name") or "sem nome")
            state = "" if item.get("enabled", True) else " (desligada)"
            about = str(item.get("description") or "")
            self.screen.write(f"  {self.screen.paint(name, BOLD)}{self.screen.paint(state, DIM)}")
            if about:
                self.screen.write("     " + self.screen.paint(about[:88], DIM))
        self.screen.write()

    def connectors(self) -> None:
        """Conectores ligados e quantas ferramentas cada um trouxe."""
        items = self.api.connections().get("items")
        rows = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
        if not rows:
            self.screen.note("  Nenhum conector ligado.")
            self.screen.note("  Ligue um no site, em Configurações › Conectores.")
            return
        self.screen.write()
        for item in rows:
            tools = item.get("tools")
            count = len(tools) if isinstance(tools, list) else 0
            name = str(item.get("name") or item.get("connector_id") or "conector")
            state = "" if item.get("enabled", True) else " (desligado)"
            detail = f"{count} ferramenta{'s' if count != 1 else ''}"
            self.screen.write(
                f"  {self.screen.paint(name, BOLD)}{self.screen.paint(state, DIM)}"
                f"  {self.screen.paint(detail, DIM)}"
            )
        self.screen.write()

    def projects(self) -> None:
        """Projetos da conta."""
        items = self.api.projects().get("items")
        rows = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
        if not rows:
            self.screen.note("  Nenhum projeto ainda.")
            return
        self.screen.write()
        for item in rows:
            name = str(item.get("name") or "sem nome")
            goal = str(item.get("goal") or "")
            self.screen.write(f"  {self.screen.paint(name, BOLD)}")
            if goal:
                self.screen.write("     " + self.screen.paint(goal.splitlines()[0][:88], DIM))
        self.screen.write()

    def library(self) -> None:
        """Biblioteca: o que já passou pelas conversas."""
        items = self.api.library().get("items")
        rows = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
        if not rows:
            self.screen.note("  A Biblioteca está vazia.")
            return
        self.screen.write()
        for item in rows:
            kind = str(item.get("kind") or item.get("type") or "item")
            title = str(item.get("title") or item.get("name") or "sem título")
            self.screen.write(f"  {self.screen.paint(f'[{kind}]', DIM)} {title[:80]}")
        self.screen.write()

    def status(self) -> None:
        """Conta, plano e uso — só o que o servidor informa, sem estimativa."""
        raw = self.api.plans().get("usage")
        usage: dict[str, Any] = raw if isinstance(raw, dict) else {}
        self.screen.write()
        self.screen.write(f"  Conta     {self.session.email}")
        self.screen.write(f"  Servidor  {self.session.server}")
        plan = str(usage.get("plan_name") or usage.get("plan") or "—")
        self.screen.write(f"  Plano     {plan}")
        allowance, consumed = usage.get("allowance"), usage.get("consumed")
        if isinstance(allowance, int) and isinstance(consumed, int) and allowance > 0:
            left = max(allowance - consumed, 0)
            self.screen.write(f"  Franquia  {left} de {allowance} nesta janela")
        renews = usage.get("renews_in_text") or usage.get("renews_at_text")
        if isinstance(renews, str) and renews:
            self.screen.write(f"  Renova    {renews}")
        if self.conversation:
            self.screen.write(f"  Conversa  {self.conversation}")
        self.screen.write()

    # ---------- A conversa ----------

    def ask(self, text: str) -> bool:
        """Manda a pergunta e pinta a resposta chegando. Devolve se completou."""
        body: dict[str, Any] = {
            "client_id": client_id(),
            "content": text,
            "forja": self.forja,
            "tools": {"memory": True},
        }
        if self.conversation:
            body["conversation_id"] = self.conversation
        try:
            return self._paint(self.api.send(body))
        except TerminalError as error:
            self.screen.fail("  " + message_for(error))
            if error.code == "plan_required":
                self.screen.note("  Veja os planos no site, em Configurações › Planos.")
            return False

    def _emit(self, text: str) -> None:
        """Escreve a resposta chegando, recuada, sem deixar espaço em linha vazia.

        Em saída crua (arquivo, cano) o texto sai como está: quem redireciona
        quer a resposta, não a moldura.
        """
        if self.screen.bare:
            self.screen.chunk(text)
            return
        for index, part in enumerate(text.split("\n")):
            if index:
                self.screen.chunk("\n")
                self._fresh = True
            if not part:
                continue
            if self._fresh:
                self.screen.chunk("  ")
                self._fresh = False
            self.screen.chunk(part)

    def _paint(self, events: Iterator[dict[str, Any]]) -> bool:
        """Desenha o fluxo de eventos; devolve se a resposta terminou inteira."""
        reply_id = ""
        opened = False
        wrote = False
        self._fresh = True
        try:
            for event in events:
                kind = event.get("type")
                if kind == "start":
                    reply = event.get("reply")
                    message = event.get("conversation")
                    if isinstance(reply, dict):
                        reply_id = str(reply.get("id") or "")
                    if isinstance(message, dict) and message.get("id"):
                        self.conversation = str(message["id"])
                elif kind == "delta":
                    if not opened:
                        self._open()
                        opened = True
                    text = str(event.get("text") or "")
                    self._emit(text)
                    wrote = wrote or bool(text.strip())
                elif kind == "thinking" and self.thinking:
                    self.screen.chunk(self.screen.paint(str(event.get("text") or ""), DIM))
                elif kind == "searching":
                    self.screen.note("  · buscando na web")
                elif kind == "step":
                    label = str(event.get("label") or "").strip()
                    if label:
                        self.screen.note(f"  · {label}")
                elif kind == "pending" and reply_id:
                    # Outro processo está gerando: acompanha pelo fluxo da mensagem.
                    return self._paint(self.api.follow(reply_id))
                elif kind == "done":
                    self._close(opened)
                    return self._finish(event, wrote)
        except KeyboardInterrupt:
            self._interrupt(reply_id, opened)
            return False
        self._close(opened)
        return wrote

    def _open(self) -> None:
        """Abre o bloco da resposta (nada disso em saída crua)."""
        if self.screen.bare:
            return
        self.screen.write()
        self.screen.chunk("  " + self.screen.paint("KAZER  ", ACCENT, BOLD))
        self._fresh = False

    def _close(self, opened: bool) -> None:
        """Fecha a linha da resposta sem deixar linha vazia sobrando."""
        if not opened:
            return
        if not self._fresh:
            self.screen.chunk("\n")
            self._fresh = True
        if not self.screen.bare:
            # Uma linha de respiro antes do próximo prompt; em saída crua, nada.
            self.screen.write()

    def _finish(self, event: dict[str, Any], wrote: bool) -> bool:
        reply = event.get("reply")
        if not isinstance(reply, dict):
            return wrote
        status = str(reply.get("status") or "")
        if status == "complete":
            artifacts = reply.get("artifacts")
            if isinstance(artifacts, list) and artifacts:
                names = [
                    str(item.get("title") or "artefato")
                    for item in artifacts
                    if isinstance(item, dict)
                ]
                self.screen.note(f"  · na Biblioteca: {', '.join(names)}")
            return True
        code = str(reply.get("error") or "")
        if status == "stopped":
            self.screen.note("  · resposta interrompida")
            return False
        self.screen.fail("  " + REPLY_ERRORS.get(code, f"A resposta falhou ({code or status})."))
        return False

    def _interrupt(self, reply_id: str, opened: bool) -> None:
        """Ctrl-C: interrompe de verdade no servidor, não só na tela."""
        self._close(opened)
        if reply_id:
            try:
                self.api.stop(reply_id)
            except TerminalError:
                pass
        self.screen.note("  · interrompido")

    # ---------- Laço ----------

    def repl(self) -> int:
        """Conversa interativa até `/sair` ou fim da entrada."""
        try:
            import readline  # noqa: F401 - só importar já liga histórico e setas
        except ImportError:
            pass
        while True:
            try:
                raw = input(self.screen.paint("você  ", DIM) if self.screen.color else "você  ")
            except (EOFError, KeyboardInterrupt):
                self.screen.write()
                return 0
            text = raw.strip()
            if not text:
                continue
            if text.startswith("/"):
                if self.command(text):
                    return 0
                continue
            self.ask(text)

    def command(self, raw: str) -> bool:
        """Comando de barra dentro da conversa; devolve se é hora de sair."""
        name, _, rest = raw[1:].partition(" ")
        argument = rest.strip()
        try:
            return self._command(name.lower(), argument)
        except TerminalError as error:
            self.screen.fail("  " + message_for(error))
            return False

    def _command(self, name: str, argument: str) -> bool:
        if name in {"sair", "fim", "q", "quit", "exit"}:
            return True
        if name in {"nova", "n"}:
            self.conversation = None
            self.screen.note("  Conversa nova.")
        elif name in {"conversas", "c"}:
            self.conversations(argument)
        elif name in {"continuar", "voltar"}:
            self.resume(argument)
        elif name in {"habilidades", "h"}:
            self.skills()
        elif name in {"conectores", "k"}:
            self.connectors()
        elif name in {"projetos", "p"}:
            self.projects()
        elif name in {"biblioteca", "b"}:
            self.library()
        elif name in {"status", "s"}:
            self.status()
        elif name == "forja":
            self.forja = not self.forja
            self.screen.note(f"  Forja {'ligada' if self.forja else 'desligada'}.")
        elif name in {"pensamento", "pensar"}:
            self.thinking = not self.thinking
            self.screen.note(f"  Pensamento {'visível' if self.thinking else 'escondido'}.")
        elif name in {"ajuda", "?", "help"}:
            self.screen.write(HELP)
        else:
            self.screen.note(f"  Não conheço /{name}. Veja /ajuda.")
        return False

    def resume(self, choice: str) -> None:
        """Volta para uma conversa pelo número da lista ou pelo identificador."""
        rows = self.conversations()
        if not rows:
            return
        if not choice:
            self.screen.note("  Diga qual: /continuar 1")
            return
        picked: dict[str, Any] | None = None
        if choice.isdigit() and 1 <= int(choice) <= len(rows):
            picked = rows[int(choice) - 1]
        else:
            picked = next((item for item in rows if item.get("id") == choice), None)
        if picked is None:
            self.screen.note("  Não achei essa conversa.")
            return
        self.conversation = str(picked.get("id") or "")
        self.screen.note(f"  Continuando: {picked.get('title') or self.conversation}")
        self.transcript()

    def transcript(self, limit: int = 6) -> None:
        """As últimas trocas da conversa, para retomar o fio."""
        if not self.conversation:
            return
        items = self.api.messages(self.conversation).get("items")
        rows = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
        for item in rows[-limit:]:
            content = str(item.get("content") or "").strip()
            if not content:
                continue
            who = "você" if item.get("role") == "user" else "KAZER"
            label = self.screen.paint(f"{who:>5}  ", DIM if who == "você" else ACCENT)
            self.screen.write()
            self.screen.write("  " + label + content.replace("\n", "\n  ")[:1200])
        self.screen.write()


# ---------- Entrada ----------


def _server() -> str:
    """Endereço do servidor: ambiente, sessão salva, ou o padrão local."""
    from_env = credentials.server_from_env()
    if from_env:
        return from_env
    saved = credentials.load()
    if saved is not None:
        return saved.server
    return credentials.DEFAULT_SERVER


def enter(screen: Screen, email: str = "") -> int:
    """`kazer entrar`: pede e-mail e senha e guarda a sessão."""
    server = _server()
    if not valid_server(server):
        screen.fail(f"  Endereço inválido: {server}")
        screen.note("  Fora de localhost o KAZER só fala https.")
        return 2
    screen.write()
    screen.write("  Entrando em " + screen.paint(server, BOLD))
    screen.note("  Use a mesma conta do site. Para trocar de servidor: kazer servidor <url>")
    screen.write()
    try:
        address = email or input("  e-mail  ").strip()
        # getpass: a senha não aparece na tela nem fica no histórico do shell.
        password = getpass.getpass("  senha    ")
    except (EOFError, KeyboardInterrupt):
        screen.write()
        return 1
    if not address or not password:
        screen.fail("  E-mail e senha são obrigatórios.")
        return 2
    with ApiClient(server) as api:
        try:
            cookie_name, cookie, confirmed = api.login(address, password)
        except TerminalError as error:
            screen.fail("  " + message_for(error))
            return 1
    path = credentials.save(
        Session(server=server, cookie_name=cookie_name, cookie=cookie, email=confirmed)
    )
    screen.write()
    screen.write("  Pronto, " + screen.paint(confirmed, BOLD) + ".")
    screen.note(f"  Sessão guardada em {path} (só você lê).")
    screen.note("  Agora: kazer   ou   kazer \"sua pergunta\"")
    screen.write()
    return 0


def leave(screen: Screen) -> int:
    """`kazer sair`: encerra no servidor e apaga a sessão local."""
    saved = credentials.load()
    if saved is None:
        screen.note("  Nenhuma sessão neste computador.")
        return 0
    with ApiClient(saved.server, saved.cookie_name, saved.cookie) as api:
        try:
            api.logout()
        except TerminalError:
            # Sem rede, a sessão local sai de qualquer jeito: ela não fica para trás.
            screen.note("  Servidor fora de alcance; a sessão local foi apagada.")
    credentials.forget()
    screen.note("  Sessão encerrada.")
    return 0


def show_server(screen: Screen, address: str = "") -> int:
    """`kazer servidor [endereço]`: mostra ou troca o servidor."""
    if not address:
        screen.note(f"  Servidor: {_server()}")
        screen.note("  Troque com: kazer servidor https://… (ou a variável KAZER_URL)")
        return 0
    clean = address.rstrip("/")
    if not valid_server(clean):
        screen.fail(f"  Endereço inválido: {clean}")
        screen.note("  Fora de localhost o KAZER só fala https.")
        return 2
    saved = credentials.load()
    if saved is not None and saved.server != clean:
        # O cookie é do servidor antigo: trocar de servidor é entrar de novo.
        credentials.forget()
        screen.note("  Sessão antiga apagada: entre de novo neste servidor.")
    screen.note(f"  Servidor: {clean}")
    screen.note(f'  Guarde no seu shell:  export KAZER_URL="{clean}"')
    return 0


def _connect(screen: Screen) -> Shell | None:
    """Abre o cliente com a sessão salva, ou explica o que falta."""
    saved = credentials.load()
    if saved is None:
        screen.note("  Nenhuma sessão neste computador. Rode: kazer entrar")
        return None
    api = ApiClient(saved.server, saved.cookie_name, saved.cookie)
    try:
        body = api.session()
    except TerminalError as error:
        api.close()
        screen.fail("  " + message_for(error))
        return None
    if not body.get("authenticated"):
        api.close()
        credentials.forget()
        screen.note("  Sua sessão expirou. Rode: kazer entrar")
        return None
    email = str(body.get("email") or saved.email)
    return Shell(screen, api, Session(saved.server, saved.cookie_name, saved.cookie, email))


def _keep_session(shell: Shell) -> None:
    """Regrava a sessão quando o servidor a renovou durante o uso."""
    fresh = shell.api.current_cookie()
    if fresh and fresh != shell.session.cookie:
        credentials.save(
            Session(
                server=shell.session.server,
                cookie_name=shell.session.cookie_name,
                cookie=fresh,
                email=shell.session.email,
            )
        )


def main(argv: Sequence[str] | None = None) -> int:
    """Ponto de entrada do comando `kazer`."""
    args = list(sys.argv[1:] if argv is None else argv)
    screen = Screen()
    command = args[0].lower() if args else ""
    rest = " ".join(args[1:]).strip()

    if command in {"ajuda", "-h", "--help", "help"}:
        screen.banner([f"versão {VERSION}"])
        screen.write(HELP)
        return 0
    if command in {"versao", "versão", "--version", "-v"}:
        screen.write(f"KAZER no terminal {VERSION}")
        return 0
    if command == "entrar":
        return enter(screen, rest)
    if command == "sair":
        return leave(screen)
    if command == "servidor":
        return show_server(screen, rest)

    shell = _connect(screen)
    if shell is None:
        return 1
    try:
        return _run(screen, shell, command, rest, args)
    finally:
        _keep_session(shell)
        shell.api.close()


def _run(screen: Screen, shell: Shell, command: str, rest: str, args: list[str]) -> int:
    """Executa o comando pedido com a sessão já aberta."""
    try:
        if command == "conversas":
            shell.conversations(rest)
            return 0
        if command == "habilidades":
            shell.skills()
            return 0
        if command == "conectores":
            shell.connectors()
            return 0
        if command == "projetos":
            shell.projects()
            return 0
        if command == "biblioteca":
            shell.library()
            return 0
        if command == "status":
            shell.status()
            return 0
        if command == "continuar":
            shell.resume(rest)
            return shell.repl()
    except TerminalError as error:
        screen.fail("  " + message_for(error))
        return 1
    question = " ".join(args).strip()
    piped = _piped(screen)
    if question and piped:
        # `cat erro.log | kazer "o que é isso?"`: o texto vira contexto da pergunta.
        question = f"{question}\n\n{piped}"
    elif piped:
        # `cat erro.log | kazer`: o que veio pelo cano é a pergunta.
        question = piped
    if question:
        return 0 if shell.ask(question) else 1
    screen.banner([f"{shell.session.email} · {shell.session.server}", "/ajuda para os comandos"])
    return shell.repl()


def _piped(screen: Screen) -> str:
    """Texto vindo pelo cano, quando há um (nunca espera por teclado)."""
    if sys.stdin is None or sys.stdin.isatty():
        return ""
    try:
        # Um a mais que o teto: é assim que se sabe que havia mais.
        text = sys.stdin.read(MAX_PIPED_CHARS + 1)
    except (OSError, ValueError, UnicodeDecodeError):
        return ""
    if len(text) > MAX_PIPED_CHARS:
        screen.warn(f"  · o texto do cano foi cortado em {MAX_PIPED_CHARS} caracteres")
        text = text[:MAX_PIPED_CHARS]
    return text.strip()
