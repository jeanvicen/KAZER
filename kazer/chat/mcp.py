"""Cliente MCP: é assim que um conector do KAZER vira ferramenta de verdade.

O Model Context Protocol é JSON-RPC 2.0 sobre HTTP. Um servidor MCP diz quais
ferramentas tem (`tools/list`) e executa uma delas quando pedido
(`tools/call`). Qualquer serviço com um endereço MCP pode ser ligado ao KAZER
sem código novo — é isso que faz o "conector personalizado" funcionar.

Regras que valem aqui:

* A credencial do conector fica **só no servidor**. Ela entra no cabeçalho da
  chamada e nunca volta para o navegador, nem em erro.
* O que o servidor do outro lado devolve é **dado, não instrução**. O texto da
  ferramenta vai para o modelo como resultado, e o resto do sistema continua
  mandando nas regras.
* Prazo curto e resposta limitada: um conector lento ou tagarela não pode
  prender a conversa nem estourar o contexto.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger("kazer.chat.mcp")

PROTOCOL_VERSION = "2025-06-18"
CONNECT_TIMEOUT = 10.0
CALL_TIMEOUT = 45.0
# Resposta de ferramenta acima disto é cortada: contexto é recurso finito.
MAX_RESULT_CHARS = 20_000
MAX_TOOLS = 60


class ConnectorError(Exception):
    """Falha do conector com código estável; nunca carrega credencial."""

    def __init__(self, code: str, detail: str = "") -> None:
        """Códigos: connector_unreachable, connector_rejected, connector_invalid."""
        super().__init__(code)
        self.code = code
        # `detail` é mensagem do outro lado, já truncada; vai para a tela, não para o log.
        self.detail = detail[:200]


@dataclass(frozen=True, slots=True)
class Tool:
    """Uma ferramenta anunciada pelo servidor MCP."""

    name: str
    description: str
    schema: dict[str, Any]

    def public(self) -> dict[str, Any]:
        """Sem o esquema: a tela só mostra nome e para que serve."""
        return {"name": self.name, "description": self.description}


def valid_endpoint(url: str) -> bool:
    """Só HTTPS, com host. HTTP simples mandaria a credencial em claro."""
    if len(url) > 500:
        return False
    parts = urlsplit(url)
    return parts.scheme == "https" and bool(parts.netloc) and "@" not in parts.netloc


class McpClient:
    """Conversa JSON-RPC com um servidor MCP."""

    def __init__(self, url: str, token: str = "", client: httpx.Client | None = None) -> None:
        """`token` vira `Authorization: Bearer`, como manda o protocolo."""
        self._url = url
        self._token = token
        self._client = client or httpx.Client(timeout=CALL_TIMEOUT, follow_redirects=False)
        self._id = 0

    def _headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            # Servidores MCP respondem JSON ou SSE conforme o pedido.
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": PROTOCOL_VERSION,
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    def _rpc(self, method: str, params: dict[str, Any] | None, timeout: float) -> Any:
        self._id += 1
        body = {"jsonrpc": "2.0", "id": self._id, "method": method, "params": params or {}}
        try:
            response = self._client.post(
                self._url, headers=self._headers(), json=body, timeout=timeout
            )
        except httpx.HTTPError:
            # O endereço pode conter token em query: nunca entra no log.
            logger.warning("mcp.unreachable", extra={"method": method})
            raise ConnectorError("connector_unreachable") from None
        if response.status_code in (401, 403):
            raise ConnectorError("connector_rejected", "Credencial recusada pelo serviço.")
        if response.status_code >= 400:
            raise ConnectorError("connector_rejected", f"HTTP {response.status_code}.")
        payload = _decode(response)
        if "error" in payload:
            message = str(payload["error"].get("message", ""))
            raise ConnectorError("connector_rejected", message)
        return payload.get("result")

    def connect(self) -> list[Tool]:
        """Aperta a mão e devolve as ferramentas anunciadas."""
        self._rpc(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "KAZER", "version": "1.1"},
            },
            CONNECT_TIMEOUT,
        )
        return self.tools()

    def tools(self) -> list[Tool]:
        """Ferramentas do servidor, já validadas e limitadas."""
        result = self._rpc("tools/list", None, CONNECT_TIMEOUT) or {}
        found: list[Tool] = []
        for item in result.get("tools", [])[:MAX_TOOLS]:
            name = str(item.get("name", ""))
            if not name:
                continue
            schema = item.get("inputSchema")
            found.append(
                Tool(
                    name=name[:64],
                    description=str(item.get("description", ""))[:400],
                    schema=schema if isinstance(schema, dict) else {"type": "object"},
                )
            )
        if not found:
            raise ConnectorError("connector_invalid", "O serviço não anunciou ferramenta nenhuma.")
        return found

    def call(self, name: str, arguments: dict[str, Any]) -> str:
        """Executa uma ferramenta e devolve o texto do resultado.

        O retorno é dado vindo de fora: vai para o modelo como resultado da
        ferramenta, nunca como instrução do sistema.
        """
        result = self._rpc("tools/call", {"name": name, "arguments": arguments}, CALL_TIMEOUT)
        return _as_text(result)

    def close(self) -> None:
        """Fecha a conexão HTTP."""
        self._client.close()


def _decode(response: httpx.Response) -> dict[str, Any]:
    """JSON direto, ou o primeiro evento de um fluxo SSE."""
    media = response.headers.get("content-type", "").split(";", 1)[0].strip()
    if media == "text/event-stream":
        for line in response.text.splitlines():
            if line.startswith("data:"):
                try:
                    parsed = json.loads(line[5:].strip())
                except ValueError:
                    continue
                if isinstance(parsed, dict):
                    return parsed
        raise ConnectorError("connector_invalid", "Resposta em fluxo sem conteúdo.")
    try:
        parsed = response.json()
    except ValueError:
        raise ConnectorError("connector_invalid", "O serviço não respondeu em JSON.") from None
    if not isinstance(parsed, dict):
        raise ConnectorError("connector_invalid", "Resposta fora do formato do protocolo.")
    return parsed


def _as_text(result: Any) -> str:
    """Conteúdo MCP (lista de blocos) virando texto para o modelo."""
    if result is None:
        return "(sem resultado)"
    if isinstance(result, dict):
        blocks = result.get("content")
        if isinstance(blocks, list):
            parts: list[str] = []
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "text":
                    parts.append(str(block.get("text", "")))
                else:
                    # Imagem, áudio ou recurso: o modelo recebe a descrição.
                    parts.append(f"[{block.get('type', 'conteúdo')}]")
            text = "\n".join(part for part in parts if part)
            if result.get("isError"):
                text = f"A ferramenta falhou: {text}" if text else "A ferramenta falhou."
            return text[:MAX_RESULT_CHARS] or "(sem resultado)"
    return json.dumps(result, ensure_ascii=False)[:MAX_RESULT_CHARS]
