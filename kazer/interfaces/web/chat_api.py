"""Rotas do chat, anexos, memória, preferências e conta (todas autenticadas).

A identidade vem sempre do cookie de sessão validado no servidor. Identificadores
de conversa, mensagem ou anexo de outra conta recebem o mesmo 404 de algo que
não existe. Respostas do modelo chegam em NDJSON (uma linha JSON por evento).
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import quote, unquote

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from kazer.auth.service import AuthError
from kazer.chat.generation import LiveGeneration
from kazer.chat.service import ChatError, ChatService
from kazer.chat.store import Message
from kazer.chat.uploads import MAX_UPLOAD_BYTES
from kazer.interfaces.web.common import WebContext, client_of, endpoint

SEND_BODY_BYTES = 256 * 1024
SETTINGS_BODY_BYTES = 16 * 1024
_STREAM_HEADERS = {"X-Accel-Buffering": "no"}


def _line(event: dict[str, Any]) -> bytes:
    return (json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def _final_event(message: Message) -> dict[str, Any]:
    if message.status == "streaming":
        # Gerada em outro processo ou ainda gravando: o navegador consulta de novo.
        return {"type": "pending", "reply": message.public()}
    return {"type": "done", "reply": message.public()}


async def _events(
    head: dict[str, Any] | None,
    live: LiveGeneration | None,
    fallback: Message | None,
    after: int = -1,
) -> AsyncIterator[bytes]:
    if head is not None:
        yield _line(head)
    if live is not None:
        async for event in live.follow(after):
            yield _line(event)
    elif fallback is not None:
        yield _line(_final_event(fallback))


def _ndjson(body: AsyncIterator[bytes]) -> StreamingResponse:
    return StreamingResponse(
        body, media_type="application/x-ndjson", headers=_STREAM_HEADERS
    )


def chat_routes(ctx: WebContext, chat: ChatService | None) -> list[Route]:
    """Monta as rotas; sem serviço de chat (contas fechadas) tudo responde 503."""

    def service() -> ChatService:
        if chat is None:
            raise AuthError("auth_unavailable", 503)
        return chat

    def timezone_of(data: dict[str, Any]) -> str | None:
        value = data.get("timezone")
        return value if isinstance(value, str) and len(value) <= 64 else None

    @endpoint
    async def config(request: Request) -> Response:
        await ctx.user(request)
        return JSONResponse(service().config())

    @endpoint
    async def send(request: Request) -> Response:
        user, _ = await ctx.user(request)
        data = await ctx.read_json(request, SEND_BODY_BYTES)
        exchange, live = await run_in_threadpool(service().send, user.id, data)
        head = {
            "type": "start",
            "duplicate": exchange.duplicate,
            "conversation": exchange.conversation.public(),
            "message": exchange.user_message.public(),
            "reply": exchange.reply.public(),
        }
        fallback = None
        if live is None:
            fallback = await run_in_threadpool(service().message, user.id, exchange.reply.id)
        return _ndjson(_events(head, live, fallback))

    @endpoint
    async def retry(request: Request) -> Response:
        user, _ = await ctx.user(request)
        data = await ctx.read_json(request)
        reply, live = await run_in_threadpool(
            service().retry, user.id, request.path_params["message_id"], timezone_of(data)
        )
        return _ndjson(_events({"type": "start", "reply": reply.public()}, live, None))

    @endpoint
    async def follow(request: Request) -> Response:
        user, _ = await ctx.user(request)
        message_id = request.path_params["message_id"]
        after_raw = request.query_params.get("after", "-1")
        try:
            after = max(int(after_raw), -1)
        except ValueError:
            raise ChatError("invalid_request", 400) from None
        live = service().live(user.id, message_id)
        fallback = None
        if live is None:
            fallback = await run_in_threadpool(service().message, user.id, message_id)
        return _ndjson(_events(None, live, fallback, after))

    @endpoint
    async def message(request: Request) -> Response:
        user, _ = await ctx.user(request)
        found = await run_in_threadpool(
            service().message, user.id, request.path_params["message_id"]
        )
        return JSONResponse({"message": found.public()})

    @endpoint
    async def stop(request: Request) -> Response:
        user, _ = await ctx.user(request)
        ctx.check_origin(request)
        await run_in_threadpool(service().stop, user.id, request.path_params["message_id"])
        return JSONResponse({"status": "stopping"}, status_code=202)

    @endpoint
    async def conversations(request: Request) -> Response:
        user, _ = await ctx.user(request)
        page = await run_in_threadpool(
            lambda: service().list_conversations(
                user.id,
                cursor=request.query_params.get("cursor"),
                query=request.query_params.get("q"),
            )
        )
        return JSONResponse(page)

    @endpoint
    async def clear_conversations(request: Request) -> Response:
        user, _ = await ctx.user(request)
        data = await ctx.read_json(request)
        if data.get("confirm") is not True:
            raise ChatError("invalid_request", 400)
        await run_in_threadpool(service().delete_all, user.id)
        return JSONResponse({"status": "deleted"})

    @endpoint
    async def conversation(request: Request) -> Response:
        user, _ = await ctx.user(request)
        conversation_id = request.path_params["conversation_id"]
        if request.method == "DELETE":
            ctx.check_origin(request)
            await run_in_threadpool(service().delete_conversation, user.id, conversation_id)
            return JSONResponse({"status": "deleted"})
        if request.method == "POST":
            data = await ctx.read_json(request)
            renamed = await run_in_threadpool(
                service().rename, user.id, conversation_id, data.get("title")
            )
            return JSONResponse({"conversation": renamed.public()})
        found = await run_in_threadpool(service().conversation, user.id, conversation_id)
        page = await run_in_threadpool(service().messages, user.id, conversation_id, None)
        return JSONResponse({"conversation": found.public(), "messages": page})

    @endpoint
    async def messages(request: Request) -> Response:
        user, _ = await ctx.user(request)
        page = await run_in_threadpool(
            service().messages,
            user.id,
            request.path_params["conversation_id"],
            request.query_params.get("before"),
        )
        return JSONResponse(page)

    @endpoint
    async def upload(request: Request) -> Response:
        user, _ = await ctx.user(request)
        ctx.check_origin(request)
        media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if media_type in ("", "application/json", "application/x-www-form-urlencoded",
                          "multipart/form-data", "text/html"):
            raise AuthError("unsupported_media_type", 415)
        name = unquote(request.headers.get("x-file-name", ""))[:512]
        data = await ctx.read_body(request, MAX_UPLOAD_BYTES)
        attachment = await run_in_threadpool(service().upload, user.id, name, data)
        return JSONResponse({"attachment": attachment.public()}, status_code=201)

    @endpoint
    async def attachment(request: Request) -> Response:
        user, _ = await ctx.user(request)
        attachment_id = request.path_params["attachment_id"]
        if request.method == "DELETE":
            ctx.check_origin(request)
            await run_in_threadpool(service().discard_attachment, user.id, attachment_id)
            return JSONResponse({"status": "deleted"})
        found, data = await run_in_threadpool(service().attachment, user.id, attachment_id)
        inline = found.kind == "image"
        disposition = "inline" if inline else "attachment"
        return Response(
            data,
            media_type=found.media_type if inline else "application/octet-stream",
            headers={
                "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(found.name)}",
                "Cache-Control": "private, no-store",
            },
        )

    @endpoint
    async def settings(request: Request) -> Response:
        user, _ = await ctx.user(request)
        chat_service = service()
        if request.method == "POST":
            data = await ctx.read_json(request, SETTINGS_BODY_BYTES)
            changes = data.get("preferences")
            if not isinstance(changes, dict):
                raise ChatError("invalid_request", 400)
            prefs = await run_in_threadpool(chat_service.update_preferences, user.id, changes)
            return JSONResponse({"preferences": prefs})
        prefs = await run_in_threadpool(chat_service.preferences, user.id)
        memories = await run_in_threadpool(chat_service.memories, user.id)
        return JSONResponse(
            {
                "preferences": prefs,
                "memories": [memory.public() for memory in memories],
                "account": {
                    "email": user.email,
                    "created_at": user.created_at,
                    "verified_at": user.email_verified_at,
                },
                "model": chat_service.config(),
            }
        )

    @endpoint
    async def memories(request: Request) -> Response:
        user, _ = await ctx.user(request)
        data = await ctx.read_json(request)
        memory = await run_in_threadpool(service().add_memory, user.id, data.get("content"))
        return JSONResponse({"memory": memory.public()}, status_code=201)

    @endpoint
    async def memory(request: Request) -> Response:
        user, _ = await ctx.user(request)
        ctx.check_origin(request)
        await run_in_threadpool(service().delete_memory, user.id, request.path_params["memory_id"])
        return JSONResponse({"status": "deleted"})

    @endpoint
    async def clear_memories(request: Request) -> Response:
        user, _ = await ctx.user(request)
        data = await ctx.read_json(request)
        if data.get("confirm") is not True:
            raise ChatError("invalid_request", 400)
        await run_in_threadpool(service().clear_memories, user.id)
        return JSONResponse({"status": "deleted"})

    @endpoint
    async def change_password(request: Request) -> Response:
        user, token = await ctx.user(request)
        data = await ctx.read_json(request)
        current, new = ctx.field(data, "current_password"), ctx.field(data, "password")
        await run_in_threadpool(
            ctx.require_auth().change_password, user, current, new, token, client_of(request)
        )
        return JSONResponse({"status": "password_updated"})

    @endpoint
    async def revoke_sessions(request: Request) -> Response:
        user, token = await ctx.user(request)
        ctx.check_origin(request)
        count = await run_in_threadpool(ctx.require_auth().revoke_other_sessions, user, token)
        return JSONResponse({"revoked": count})

    @endpoint
    async def delete_account(request: Request) -> Response:
        user, _ = await ctx.user(request)
        data = await ctx.read_json(request)
        password = ctx.field(data, "password")
        await run_in_threadpool(
            ctx.require_auth().delete_account, user, password, client_of(request)
        )
        if chat is not None:
            await run_in_threadpool(chat.forget_user, user.id)
        response = JSONResponse({"status": "deleted"})
        ctx.clear_session_cookie(response)
        return response

    @endpoint
    async def export(request: Request) -> Response:
        user, _ = await ctx.user(request)
        data = await run_in_threadpool(service().export, user.id)
        payload = {
            "format": "kazer-export/1",
            "account": {
                "email": user.email,
                "created_at": user.created_at,
                "verified_at": user.email_verified_at,
            },
            **data,
        }
        return Response(
            json.dumps(payload, ensure_ascii=False, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="kazer-dados.json"'},
        )

    return [
        Route("/api/chat/config", config, methods=["GET"]),
        Route("/api/chat", send, methods=["POST"]),
        Route("/api/messages/{message_id}", message, methods=["GET"]),
        Route("/api/messages/{message_id}/stream", follow, methods=["GET"]),
        Route("/api/messages/{message_id}/stop", stop, methods=["POST"]),
        Route("/api/messages/{message_id}/retry", retry, methods=["POST"]),
        Route("/api/conversations", conversations, methods=["GET"]),
        Route("/api/conversations/clear", clear_conversations, methods=["POST"]),
        Route(
            "/api/conversations/{conversation_id}",
            conversation,
            methods=["GET", "POST", "DELETE"],
        ),
        Route("/api/conversations/{conversation_id}/messages", messages, methods=["GET"]),
        Route("/api/attachments", upload, methods=["POST"]),
        Route("/api/attachments/{attachment_id}", attachment, methods=["GET", "DELETE"]),
        Route("/api/settings", settings, methods=["GET", "POST"]),
        Route("/api/memories", memories, methods=["POST"]),
        Route("/api/memories/clear", clear_memories, methods=["POST"]),
        Route("/api/memories/{memory_id}", memory, methods=["DELETE"]),
        Route("/api/account/password", change_password, methods=["POST"]),
        Route("/api/account/sessions/revoke", revoke_sessions, methods=["POST"]),
        Route("/api/account/delete", delete_account, methods=["POST"]),
        Route("/api/account/export", export, methods=["GET"]),
    ]
