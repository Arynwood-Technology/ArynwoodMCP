"""_make_approve_callback (roadmap 2.3) — the WS-facing half of the approval gate.
Every test here checks the same fail-safe property from a different angle: anything
other than a clean, matching, explicit approval must deny."""

import json

from backend.routers.chat import _make_approve_callback


class FakeWebSocket:
    def __init__(self, incoming: list[str]):
        self._incoming = list(incoming)
        self.sent: list[dict] = []

    async def send_json(self, msg):
        self.sent.append(msg)

    async def receive_text(self):
        if not self._incoming:
            raise RuntimeError("no more incoming messages queued")
        return self._incoming.pop(0)


def _response(request_id: str, approved: bool) -> str:
    return json.dumps({"type": "approval_response", "request_id": request_id, "approved": approved})


async def test_sends_approval_request_with_tool_details():
    ws = FakeWebSocket([_response("placeholder", True)])
    approve = _make_approve_callback(ws)
    # Patch the request_id after the fact isn't possible (it's generated inside),
    # so read back what was actually sent and reply with the real id via a second ws.
    await approve("delete_track", {"track": 1}, "destructive")
    req = ws.sent[0]
    assert req["type"] == "approval_request"
    assert req["tool"] == "delete_track"
    assert req["arguments"] == {"track": 1}
    assert req["tier"] == "destructive"
    assert "request_id" in req


async def test_approved_response_returns_true():
    ws = FakeWebSocket([])

    async def receive_text():
        sent_id = ws.sent[-1]["request_id"]
        return _response(sent_id, True)
    ws.receive_text = receive_text

    approve = _make_approve_callback(ws)
    assert await approve("delete_track", {}, "destructive") is True


async def test_denied_response_returns_false():
    ws = FakeWebSocket([])

    async def receive_text():
        sent_id = ws.sent[-1]["request_id"]
        return _response(sent_id, False)
    ws.receive_text = receive_text

    approve = _make_approve_callback(ws)
    assert await approve("delete_track", {}, "destructive") is False


async def test_mismatched_request_id_denies():
    """A response to a DIFFERENT (e.g. stale) request must not approve this one."""
    ws = FakeWebSocket([_response("some-other-request-id", True)])
    approve = _make_approve_callback(ws)
    assert await approve("delete_track", {}, "destructive") is False


async def test_wrong_message_type_denies():
    ws = FakeWebSocket([json.dumps({"type": "chat_message", "message": "hello"})])
    approve = _make_approve_callback(ws)
    assert await approve("delete_track", {}, "destructive") is False


async def test_malformed_json_denies_instead_of_raising():
    ws = FakeWebSocket(["not valid json{{{"])
    approve = _make_approve_callback(ws)
    assert await approve("delete_track", {}, "destructive") is False


async def test_disconnect_while_waiting_denies_instead_of_raising():
    class DisconnectingWebSocket:
        async def send_json(self, msg):
            pass

        async def receive_text(self):
            raise RuntimeError("client disconnected")

    approve = _make_approve_callback(DisconnectingWebSocket())
    assert await approve("delete_track", {}, "destructive") is False


async def test_missing_approved_field_defaults_to_denied():
    ws = FakeWebSocket([])

    async def receive_text():
        sent_id = ws.sent[-1]["request_id"]
        return json.dumps({"type": "approval_response", "request_id": sent_id})  # no "approved" key
    ws.receive_text = receive_text

    approve = _make_approve_callback(ws)
    assert await approve("delete_track", {}, "destructive") is False
