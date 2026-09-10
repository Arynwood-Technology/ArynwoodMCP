"""WebSocket-level tests for chat_ws — stubs the LLM/knowledge/tool-agent layers so
these run hermetically (no live Ollama/Qdrant needed) and fast."""

import pytest

from backend.services import ollama_client, knowledge, mcp_tool_agent

# A message with zero overlap with _SEARCH_HINTS in chat.py, so tests don't
# accidentally trigger a real (unmocked) DuckDuckGo call.
SAFE_MESSAGE = "please summarize the plan for chapter three"


async def _fake_context_length(model, host=None, port=None, timeout=5.0):
    return 8192


async def _fake_gather_context(message, approve=None):
    return "", []


_kb_hits: list[dict] = []


async def _fake_kb_search(query, *args, **kwargs):
    return _kb_hits


async def _fake_chat_stream(*, model, messages, host, port, options=None, tools=None):
    yield {"token": "ok", "done": True}


@pytest.fixture(autouse=True)
def _stub_llm_layer(monkeypatch):
    global _kb_hits
    _kb_hits = []
    monkeypatch.setattr(ollama_client, "context_length", _fake_context_length)
    monkeypatch.setattr(ollama_client, "chat_stream", _fake_chat_stream)
    monkeypatch.setattr(knowledge, "search", _fake_kb_search)
    monkeypatch.setattr(mcp_tool_agent, "gather_context_for_message", _fake_gather_context)


def _run_until_done(ws, cap=10):
    msgs = []
    for _ in range(cap):
        msg = ws.receive_json()
        msgs.append(msg)
        if msg.get("type") == "token" and msg.get("done"):
            break
        if msg.get("type") == "error":
            break
    return msgs


def test_ws_streams_tokens_and_creates_conversation(client):
    with client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"message": SAFE_MESSAGE, "persona": "doc", "model": "qwen2.5"})
        msgs = _run_until_done(ws)
    types = [m["type"] for m in msgs]
    assert "conversation_id" in types
    assert any(m["type"] == "token" and m.get("done") for m in msgs)


def test_non_central_persona_gets_knowledge_context(client, monkeypatch):
    global _kb_hits
    _kb_hits = [{
        "title": "Style Guide", "source": "style.md", "source_id": 1,
        "text": "Chapter three should open in media res.",
        "page_start": None, "page_end": None, "has_table": False,
    }]
    captured = {}

    async def _capture_chat_stream(*, model, messages, host, port, options=None, tools=None):
        captured["messages"] = messages
        yield {"token": "ok", "done": True}

    monkeypatch.setattr(ollama_client, "chat_stream", _capture_chat_stream)

    with client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"message": SAFE_MESSAGE, "persona": "doc", "model": "qwen2.5"})
        _run_until_done(ws)

    last_user_msg = captured["messages"][-1]["content"]
    assert "Chapter three should open in media res." in last_user_msg


def test_context_used_event_discloses_kb_sources(client):
    global _kb_hits
    _kb_hits = [{
        "title": "Style Guide", "source": "style.md", "source_id": 1, "score": 0.81,
        "text": "irrelevant to this assertion", "page_start": 2, "page_end": 3, "has_table": False,
    }]
    with client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"message": SAFE_MESSAGE, "persona": "doc", "model": "qwen2.5"})
        msgs = _run_until_done(ws)

    ctx_events = [m for m in msgs if m["type"] == "context_used"]
    assert len(ctx_events) == 1
    assert ctx_events[0]["kb_sources"] == [{
        "title": "Style Guide", "source": "style.md", "source_id": 1,
        "score": 0.81, "page_start": 2, "page_end": 3,
    }]
    assert ctx_events[0]["tool_servers"] == []
    assert ctx_events[0]["web_search"] is False


def test_context_used_event_absent_when_nothing_to_disclose(client):
    with client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"message": SAFE_MESSAGE, "persona": "doc", "model": "qwen2.5"})
        msgs = _run_until_done(ws)
    assert not any(m["type"] == "context_used" for m in msgs)


def test_status_events_fire_before_the_reply_streams(client):
    """Activity trace (roadmap 3.1) — the user should see what's happening before
    the first token, not just a silent pause."""
    with client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"message": SAFE_MESSAGE, "persona": "doc", "model": "qwen2.5"})
        msgs = _run_until_done(ws)

    status_labels = [m["label"] for m in msgs if m["type"] == "status"]
    assert "Checking your knowledge base…" in status_labels
    # Status events must arrive before the first token, not interleaved after.
    first_token_index = next(i for i, m in enumerate(msgs) if m["type"] == "token")
    status_indices = [i for i, m in enumerate(msgs) if m["type"] == "status"]
    assert all(i < first_token_index for i in status_indices)


def test_status_events_include_tool_check_for_central(client):
    with client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"message": SAFE_MESSAGE, "persona": "central", "model": "qwen2.5-coder:14b"})
        msgs = _run_until_done(ws)

    status_labels = [m["label"] for m in msgs if m["type"] == "status"]
    assert "Checking available tools…" in status_labels


def test_context_used_event_discloses_tool_servers(client, monkeypatch):
    async def _fake_gather_with_tools(message, approve=None):
        return "[Kdenlive — live results]\nsomething", ["Kdenlive"]

    monkeypatch.setattr(mcp_tool_agent, "gather_context_for_message", _fake_gather_with_tools)

    with client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"message": SAFE_MESSAGE, "persona": "central", "model": "qwen2.5-coder:14b"})
        msgs = _run_until_done(ws)

    ctx_events = [m for m in msgs if m["type"] == "context_used"]
    assert len(ctx_events) == 1
    assert ctx_events[0]["tool_servers"] == ["Kdenlive"]
