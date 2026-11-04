"""Regression: a Supabase usage reservation must not crash chat startup."""

from typing import Any

from kazer.chat.supabase_store import SupabaseChatStore


def test_exchange_with_reservation_id() -> None:
    conversation = {"id": "conv-id", "title": "Teste", "created_at": 1, "updated_at": 1}

    def message(message_id: str, role: str, seq: int) -> dict[str, Any]:
        return {
            "id": message_id,
            "conversation_id": "conv-id",
            "seq": seq,
            "role": role,
            "content": "Oi" if role == "user" else "",
            "created_at": 1,
            "status": "complete" if role == "user" else "streaming",
        }

    class FakeRPCStore(SupabaseChatStore):
        def _rpc(self, name: str, params: dict[str, Any] | None = None) -> Any:
            assert name == "kazer_begin_exchange"
            return {
                "conversation": conversation,
                "message": message("msg", "user", 1),
                "reply": message("reply", "assistant", 2),
                "request_id": "reservation-id",
            }

    store = FakeRPCStore("https://example.supabase.co", "public")
    exchange = store.begin_exchange(
        "user-id", conversation_id=None, title="Teste", content="Oi",
        client_id="abcdefgh", attachment_ids=[], options={}, units=1, windows=[], now=1,
    )
    assert exchange.request_id == "reservation-id"
    assert exchange.reply.status == "streaming"
