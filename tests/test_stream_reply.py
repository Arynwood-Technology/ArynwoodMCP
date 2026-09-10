"""Dedicated coverage for _stream_reply (roadmap 2.1) — the highest-risk new code
this session. Tools attached => a round is fully buffered before deciding whether
it's a tool call or a real answer, then delivered via _deliver_complete_text; no
tools => true live network streaming, unchanged from before tool-calling existed.
(The original design peeked at only the first few characters to decide whether to
stream live; confirmed live against central's real system prompt that this wasn't
reliable — qwen2.5-coder:14b can preface a tool call with a full prose sentence
before the JSON starts — so the tool-enabled path was redesigned to buffer fully;
see test_extract_tool_calls.py for the parsing half of that fix.) Tests drive
_stream_reply directly against a fake websocket for precise control over what
each round of chat_stream returns."""

from backend.routers import chat as chat_mod
from backend.routers.chat import _stream_reply, _NATIVE_TOOLS
from backend.services import ollama_client


class FakeWebSocket:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_json(self, msg):
        self.sent.append(msg)


def _tokens(text: str):
    """Split into single-character 'tokens' — the strictest case for the
    peek-and-decide buffering logic, since it must not assume any minimum chunk size."""
    return list(text)


async def _stream_from(chunks: list[str]):
    for i, tok in enumerate(chunks):
        yield {"token": tok, "done": i == len(chunks) - 1}


async def test_plain_answer_with_no_tools_streams_live_from_first_token(monkeypatch):
    sent_tokens = []

    async def fake_chat_stream(*, model, messages, host, port, options=None, tools=None):
        async for c in _stream_from(_tokens("Hello there!")):
            sent_tokens.append(c["token"])
            yield c

    monkeypatch.setattr(ollama_client, "chat_stream", fake_chat_stream)
    ws = FakeWebSocket()
    result = await _stream_reply(ws, [{"role": "user", "content": "hi"}], "m", "h", 1, 8192, db=None, tools=None)

    assert result == "Hello there!"
    # Every token should have been forwarded individually (no tools => always live
    # from the first character), not held back and burst-sent as one chunk.
    token_events = [m for m in ws.sent if m["type"] == "token"]
    assert "".join(t["token"] for t in token_events) == "Hello there!"
    assert len(token_events) > 1


async def test_native_tools_plain_answer_is_delivered_progressively_not_dumped(monkeypatch):
    """A real answer (not tool-call-shaped) still reaches the client as multiple
    events even though the tools-enabled path buffers the whole round first — see
    _deliver_complete_text — rather than as one giant dumped blob."""
    async def fake_chat_stream(*, model, messages, host, port, options=None, tools=None):
        async for c in _stream_from(_tokens("Sure, here's the plan.")):
            yield c

    monkeypatch.setattr(ollama_client, "chat_stream", fake_chat_stream)
    ws = FakeWebSocket()
    result = await _stream_reply(ws, [{"role": "user", "content": "hi"}], "m", "h", 1, 8192, db=None, tools=_NATIVE_TOOLS)

    assert result == "Sure, here's the plan."
    token_events = [m for m in ws.sent if m["type"] == "token"]
    assert len(token_events) > 1  # delivered word-by-word, not dumped as one chunk
    assert "".join(t["token"] for t in token_events) == "Sure, here's the plan."


async def test_no_tools_streams_truly_live_tools_enabled_buffers_first(monkeypatch):
    """Locks in the actual distinction between the two paths: without tools, each
    network chunk is forwarded to the client the moment it arrives (no buffering);
    with tools, nothing reaches the client until the whole round has been checked
    for a tool call. Both end up delivering the same text — only the timing differs."""
    sent_order = []

    async def fake_chat_stream(*, model, messages, host, port, options=None, tools=None):
        for tok in ["A", "B", "C"]:
            sent_order.append(("generated", tok))
            yield {"token": tok, "done": tok == "C"}

    async def spy_send_json(msg):
        if msg["type"] == "token" and msg["token"]:
            sent_order.append(("sent", msg["token"]))

    monkeypatch.setattr(ollama_client, "chat_stream", fake_chat_stream)

    ws_no_tools = FakeWebSocket()
    ws_no_tools.send_json = spy_send_json
    await _stream_reply(ws_no_tools, [{"role": "user", "content": "hi"}], "m", "h", 1, 8192, db=None, tools=None)
    # Live: each chunk is sent right after it's generated, interleaved.
    assert sent_order == [
        ("generated", "A"), ("sent", "A"),
        ("generated", "B"), ("sent", "B"),
        ("generated", "C"), ("sent", "C"),
    ]

    sent_order.clear()
    ws_with_tools = FakeWebSocket()
    ws_with_tools.send_json = spy_send_json
    await _stream_reply(ws_with_tools, [{"role": "user", "content": "hi"}], "m", "h", 1, 8192, db=None, tools=_NATIVE_TOOLS)
    # Buffered: every chunk is generated first, nothing is sent until all of it is in.
    assert sent_order == [
        ("generated", "A"), ("generated", "B"), ("generated", "C"),
        ("sent", "ABC"),
    ]


async def test_tool_call_json_is_never_forwarded_to_the_client(monkeypatch):
    """The defining correctness property: raw {"name": ..., "arguments": ...} text
    must never reach the websocket, even partially, while a tool call is in flight."""
    call_log = []

    async def fake_chat_stream(*, model, messages, host, port, options=None, tools=None):
        if not call_log:
            call_log.append("decision")
            payload = '{"name": "web_search", "arguments": {"query": "weather in Seattle"}}'
            async for c in _stream_from(_tokens(payload)):
                yield c
        else:
            call_log.append("final")
            async for c in _stream_from(_tokens("It's cloudy in Seattle.")):
                yield c

    async def fake_web_search(query, max_results=5):
        assert query == "weather in Seattle"
        return "Cloudy, 55F"

    monkeypatch.setattr(ollama_client, "chat_stream", fake_chat_stream)
    monkeypatch.setattr(chat_mod, "_web_search", fake_web_search)
    ws = FakeWebSocket()
    result = await _stream_reply(ws, [{"role": "user", "content": "weather?"}], "m", "h", 1, 8192, db=None, tools=_NATIVE_TOOLS)

    assert result == "It's cloudy in Seattle."
    assert call_log == ["decision", "final"]
    all_streamed_text = "".join(m["token"] for m in ws.sent if m["type"] == "token")
    assert "web_search" not in all_streamed_text
    assert '"name"' not in all_streamed_text
    assert all_streamed_text == "It's cloudy in Seattle."


async def test_tool_result_is_fed_back_as_a_tool_message(monkeypatch):
    messages = [{"role": "user", "content": "weather?"}]
    seen_message_lists = []

    async def fake_chat_stream(*, model, messages, host, port, options=None, tools=None):
        seen_message_lists.append([dict(m) for m in messages])
        if len(seen_message_lists) == 1:
            payload = '{"name": "web_search", "arguments": {"query": "weather"}}'
            async for c in _stream_from(_tokens(payload)):
                yield c
        else:
            async for c in _stream_from(_tokens("Answer.")):
                yield c

    async def fake_web_search(query, max_results=5):
        return "Sunny, 70F"

    monkeypatch.setattr(ollama_client, "chat_stream", fake_chat_stream)
    monkeypatch.setattr(chat_mod, "_web_search", fake_web_search)
    ws = FakeWebSocket()
    await _stream_reply(ws, messages, "m", "h", 1, 8192, db=None, tools=_NATIVE_TOOLS)

    # The second round's request must include the tool's result as a 'tool' message,
    # wrapped as untrusted data (roadmap 3.2) rather than fed back as bare text.
    second_round_messages = seen_message_lists[1]
    tool_messages = [m for m in second_round_messages if m["role"] == "tool"]
    assert len(tool_messages) == 1
    assert "Sunny, 70F" in tool_messages[0]["content"]
    assert tool_messages[0]["content"].startswith('<untrusted-data source="web_search">')
    assert tool_messages[0]["tool_name"] == "web_search"


async def test_round_cap_forces_a_final_tool_free_answer(monkeypatch):
    """If the model keeps calling tools past max_tool_rounds, force a plain-text
    turn instead of silently returning nothing (mirrors mcp_tool_agent's own
    round-cap fallback)."""
    call_count = {"n": 0}

    async def fake_chat_stream(*, model, messages, host, port, options=None, tools=None):
        call_count["n"] += 1
        if tools:  # every tool-enabled round keeps calling the same tool
            payload = '{"name": "web_search", "arguments": {"query": "x"}}'
            async for c in _stream_from(_tokens(payload)):
                yield c
        else:  # the forced final round (tools=None) must answer in plain text
            async for c in _stream_from(_tokens("Final answer after giving up on tools.")):
                yield c

    async def fake_web_search(query, max_results=5):
        return "result"

    monkeypatch.setattr(ollama_client, "chat_stream", fake_chat_stream)
    monkeypatch.setattr(chat_mod, "_web_search", fake_web_search)
    ws = FakeWebSocket()
    result = await _stream_reply(
        ws, [{"role": "user", "content": "x"}], "m", "h", 1, 8192, db=None,
        tools=_NATIVE_TOOLS, max_tool_rounds=2,
    )

    assert result == "Final answer after giving up on tools."
    assert call_count["n"] == 3  # 2 tool rounds + 1 forced final round


async def test_disconnect_mid_stream_returns_partial_text_instead_of_raising(monkeypatch):
    class DyingWebSocket:
        def __init__(self):
            self.sent = []

        async def send_json(self, msg):
            if msg["type"] == "token" and msg["token"] == "!":
                raise RuntimeError("client disconnected")
            self.sent.append(msg)

    async def fake_chat_stream(*, model, messages, host, port, options=None, tools=None):
        async for c in _stream_from(_tokens("Hello!")):
            yield c

    monkeypatch.setattr(ollama_client, "chat_stream", fake_chat_stream)
    ws = DyingWebSocket()
    # Must not raise — _stream_reply is expected to catch this and return whatever
    # was produced up to the failure point (see roadmap 0.1).
    result = await _stream_reply(ws, [{"role": "user", "content": "hi"}], "m", "h", 1, 8192, db=None, tools=None)
    assert result == "Hello!"
