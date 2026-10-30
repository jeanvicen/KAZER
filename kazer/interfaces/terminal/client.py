"""Cliente do terminal: fala com o KAZER pela mesma API do site.

Nenhuma lógica de produto vive aqui. Habilidades, conectores, projetos, planos,
limite e memória valem no terminal porque o pedido passa pelo mesmo servidor —
o terminal é outra janela da mesma conta, não um KAZER paralelo. Quando o
servidor ganha um recurso, o terminal ganha junto.

Duas decisões que merecem explicação:

* **`Origin`.** O servidor recusa escrita de outra origem (defesa CSRF por
  cabeçalho). Essa defesa existe para o navegador, onde um site qualquer pode
  disparar pedido com o cookie da pessoa. Um programa de terminal que já tem a
  credencial *é* a pessoa, então ele declara a origem do próprio servidor e
  passa pela porta da frente.
* **Cookie, não token no cabeçalho.** A sessão do KAZER é um cookie `HttpOnly`.
  O terminal guarda e devolve o mesmo cookie em vez de inventar um segundo
  formato de credencial, que o servidor teria de aprender a validar.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from typing import Any
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger("kazer.terminal")

CONNECT_TIMEOUT = 15.0
READ_TIMEOUT = 30.0
# A resposta pode demorar: o prazo de leitura do fluxo é o do servidor.
STREAM_TIMEOUT = 660.0
USER_AGENT = "KAZER-terminal/1.1"


class TerminalError(Exception):
    """Falha com código estável, do jeito que o servidor devolve."""

    def __init__(self, code: str, status: int = 0, data: dict[str, Any] | None = None) -> None:
        """`data` é o corpo do erro (sem credencial): o aviso de plano vem nele."""
        super().__init__(code)
        self.code = code
        self.status = status
        self.data = data or {}

    @property
    def retry_after(self) -> int:
        """Segundos que o servidor pediu para esperar, quando pediu."""
        value = self.data.get("retry_after")
        return value if isinstance(value, int) and value > 0 else 0


def valid_server(url: str) -> bool:
    """Endereço aceitável: http(s) com host. Fora de localhost, só https."""
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        return False
    host = parts.netloc.split(":", 1)[0].lower()
    local = host in {"localhost", "127.0.0.1", "::1", "[::1]"}
    return parts.scheme == "https" or local


class ApiClient:
    """Chamadas à API do KAZER com a sessão de quem está no terminal."""

    def __init__(self, server: str, cookie_name: str = "", cookie: str = "") -> None:
        """Sem cookie, só as rotas públicas (entrar, registrar) funcionam."""
        self.server = server.rstrip("/")
        self.cookie_name = cookie_name
        self._client = httpx.Client(
            base_url=self.server,
            timeout=httpx.Timeout(READ_TIMEOUT, connect=CONNECT_TIMEOUT),
            follow_redirects=False,
            headers={"User-Agent": USER_AGENT},
        )
        if cookie_name and cookie:
            self._client.cookies.set(cookie_name, cookie, domain=self._host())

    def _host(self) -> str:
        return urlsplit(self.server).netloc.split(":", 1)[0]

    def close(self) -> None:
        """Fecha a conexão HTTP."""
        self._client.close()

    def __enter__(self) -> ApiClient:
        """Permite `with ApiClient(...) as api:`."""
        return self

    def __exit__(self, *args: object) -> None:
        """Fecha a conexão ao sair do bloco."""
        self.close()

    # ---------- Fundação ----------

    def _headers(self, write: bool) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if write:
            headers["Origin"] = self.server
            headers["Content-Type"] = "application/json"
        return headers

    @staticmethod
    def _problem(response: httpx.Response) -> TerminalError:
        """Erro do servidor virando falha com código, sem vazar corpo cru."""
        data: dict[str, Any] = {}
        try:
            parsed = response.json()
            if isinstance(parsed, dict):
                data = parsed
        except ValueError:
            pass
        code = data.get("error")
        if not isinstance(code, str) or not code:
            code = f"http_{response.status_code}"
        return TerminalError(code, response.status_code, data)

    def _json(self, response: httpx.Response) -> dict[str, Any]:
        if response.status_code >= 400:
            raise self._problem(response)
        try:
            parsed = response.json()
        except ValueError:
            raise TerminalError("resposta_invalida", response.status_code) from None
        if not isinstance(parsed, dict):
            raise TerminalError("resposta_invalida", response.status_code)
        return parsed

    def get(self, path: str, params: dict[str, str] | None = None) -> dict[str, Any]:
        """GET autenticado pela sessão."""
        try:
            response = self._client.get(path, params=params, headers=self._headers(False))
        except httpx.HTTPError:
            raise TerminalError("sem_conexao") from None
        return self._json(response)

    def post(self, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        """POST autenticado, com a origem declarada."""
        try:
            response = self._client.post(
                path, json=body or {}, headers=self._headers(True)
            )
        except httpx.HTTPError:
            raise TerminalError("sem_conexao") from None
        return self._json(response)

    def delete(self, path: str) -> dict[str, Any]:
        """DELETE autenticado, com a origem declarada."""
        try:
            response = self._client.delete(path, headers=self._headers(True))
        except httpx.HTTPError:
            raise TerminalError("sem_conexao") from None
        return self._json(response)

    # ---------- Conta ----------

    def login(self, email: str, password: str) -> tuple[str, str, str]:
        """Entra e devolve (nome do cookie, cookie, e-mail) para guardar.

        A senha só existe nesta chamada: ela não é guardada em lugar nenhum.
        """
        body = self.post("/api/auth/login", {"email": email, "password": password})
        for name, value in self._client.cookies.items():
            if "kazer_session" in name:
                self.cookie_name = name
                return name, value, str(body.get("email") or email)
        raise TerminalError("sessao_nao_veio")

    def logout(self) -> None:
        """Encerra a sessão no servidor (o arquivo local é apagado fora daqui)."""
        self.post("/api/auth/logout")

    def session(self) -> dict[str, Any]:
        """Quem está autenticado nesta sessão, segundo o servidor."""
        return self.get("/api/auth/session")

    def current_cookie(self) -> str:
        """Cookie que o cliente tem agora.

        O servidor renova a sessão quando o access token vence e manda o cookie
        novo na resposta. Quem chama compara com o que está em disco e regrava
        — sem isso, a sessão do terminal morreria na primeira renovação.
        """
        for name, value in self._client.cookies.items():
            if name == self.cookie_name:
                return value
        return ""

    # ---------- Conversa ----------

    def config(self) -> dict[str, Any]:
        """Capacidades reais do ambiente (modelo, anexos, busca)."""
        return self.get("/api/chat/config")

    def plans(self) -> dict[str, Any]:
        """Catálogo de planos e o uso da conta."""
        return self.get("/api/plans")

    def conversations(self, query: str = "") -> dict[str, Any]:
        """Página de conversas, mais recentes primeiro."""
        return self.get("/api/conversations", {"q": query} if query else None)

    def messages(self, conversation_id: str) -> dict[str, Any]:
        """Mensagens de uma conversa."""
        return self.get(f"/api/conversations/{conversation_id}/messages")

    def skills(self) -> dict[str, Any]:
        """Habilidades instaladas na conta."""
        return self.get("/api/skills")

    def connections(self) -> dict[str, Any]:
        """Conectores ligados na conta."""
        return self.get("/api/connections")

    def projects(self) -> dict[str, Any]:
        """Projetos da conta."""
        return self.get("/api/projects")

    def library(self) -> dict[str, Any]:
        """Itens da Biblioteca."""
        return self.get("/api/library")

    def stop(self, message_id: str) -> None:
        """Interrompe uma resposta em andamento."""
        self.post(f"/api/messages/{message_id}/stop")

    def send(self, body: dict[str, Any]) -> Iterator[dict[str, Any]]:
        """Manda a pergunta e devolve os eventos da resposta, um por linha.

        O servidor responde NDJSON: cada linha é um evento (`start`, `delta`,
        `thinking`, `step`, `done`). O terminal pinta conforme chega, igual à
        tela do site, porque é o mesmo fluxo.
        """
        yield from self._stream("POST", "/api/chat", body=body)

    def follow(self, message_id: str, after: int = -1) -> Iterator[dict[str, Any]]:
        """Reata o acompanhamento de uma resposta que continua rodando."""
        yield from self._stream(
            "GET", f"/api/messages/{message_id}/stream", params={"after": str(after)}
        )

    def _stream(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
    ) -> Iterator[dict[str, Any]]:
        write = method != "GET"
        try:
            with self._client.stream(
                method,
                path,
                json=body,
                params=params,
                headers=self._headers(write),
                timeout=httpx.Timeout(STREAM_TIMEOUT, connect=CONNECT_TIMEOUT),
            ) as response:
                if response.status_code >= 400:
                    response.read()
                    raise self._problem(response)
                for line in response.iter_lines():
                    if not line.strip():
                        continue
                    try:
                        event = json.loads(line)
                    except ValueError:
                        logger.debug("terminal.linha_invalida")
                        continue
                    if isinstance(event, dict):
                        yield event
        except httpx.HTTPError:
            raise TerminalError("sem_conexao") from None
