"""Regression tests for bugs found by talking to the personas against real Ollama/Qdrant
while verifying the AI-runtime improvements for 0.4.4 (2026-09-23). Each test names
the live symptom it guards against. All hermetic: no Ollama, Qdrant or DDG needed."""

import asyncio
import json
import sys
import time
import types

import pytest

from backend.routers import chat
from backend.services import context_budget, knowledge, mcp_tool_agent, memory_store, ollama_client, runtime_context


# ── Web search: an outage is not "no results" ────────────────────────────────────
# Live symptom: ddgs.news() intermittently *raises* "No results found." and that
# skipped the text() fallback, so a working search returned "" and the reply said
# it "couldn't find" a well-known fact.

class _FakeDDGSException(Exception):
    pass


def _install_fake_ddgs(monkeypatch, news, text):
    mod = types.ModuleType("ddgs")
    exc_mod = types.ModuleType("ddgs.exceptions")
    exc_mod.DDGSException = _FakeDDGSException

    class DDGS:
        def news(self, *a, **k):
            return news()

        def text(self, *a, **k):
            return text()

    mod.DDGS = DDGS
    monkeypatch.setitem(sys.modules, "ddgs", mod)
    monkeypatch.setitem(sys.modules, "ddgs.exceptions", exc_mod)


def _raise(exc):
    def f():
        raise exc
    return f


def test_news_no_results_exception_falls_back_to_web_results(monkeypatch):
    _install_fake_ddgs(monkeypatch, news=_raise(_FakeDDGSException("No results found.")),
                       text=lambda: [{"title": "Blender 5.2", "href": "https://blender.org", "body": "LTS"}])
    out = asyncio.run(chat._web_search("breaking news about blender"))
    assert "Blender 5.2" in out and "https://blender.org" in out


def test_search_backend_failure_raises_unavailable(monkeypatch):
    _install_fake_ddgs(monkeypatch, news=lambda: [], text=_raise(_FakeDDGSException("ratelimit 202")))
    with pytest.raises(chat.WebSearchUnavailable):
        asyncio.run(chat._web_search("anything"))


def test_search_with_no_matches_returns_empty(monkeypatch):
    _install_fake_ddgs(monkeypatch, news=lambda: [], text=_raise(_FakeDDGSException("No results found.")))
    assert asyncio.run(chat._web_search("zzqx")) == ""


def test_native_web_search_tells_model_outage_apart_from_no_results(monkeypatch):
    async def down(query, max_results=5):
        raise chat.WebSearchUnavailable("boom")

    async def empty(query, max_results=5):
        return ""

    monkeypatch.setattr(chat, "_web_search", down)
    unavailable = asyncio.run(chat._call_native_tool("web_search", {"query": "q"}, None))
    monkeypatch.setattr(chat, "_web_search", empty)
    no_results = asyncio.run(chat._call_native_tool("web_search", {"query": "q"}, None))
    assert "unavailable" in unavailable and "unavailable" not in no_results


# ── Token estimates calibrate to real counts ─────────────────────────────────────
# Live symptom: the bytes/3 estimate overcounted central's real prompt by 48%
# (6881 vs 4636), which (with a fixed 50% system share) pushed every relevant
# memory out of Arynwood's prompt — it never saw its memories and invented answers.

@pytest.fixture()
def clean_calibration(monkeypatch):
    monkeypatch.setattr(context_budget, "_calibration", {})


def _prose(n):
    return [{"role": "system", "content": "The quick brown fox jumps over the lazy dog. " * n}]


def test_calibration_relaxes_estimate_toward_measured_count(clean_calibration):
    msgs = _prose(200)
    raw = context_budget.request_tokens(msgs)
    context_budget.observe("m", msgs, None, int(raw * 0.67))
    assert 0.67 < context_budget.scale("m") < 0.8  # measured ratio plus safety margin
    assert context_budget.request_tokens(msgs, model="m") < raw
    assert context_budget.request_tokens(msgs, model="other") == raw


def test_calibration_never_exceeds_default_or_goes_below_floor(clean_calibration):
    msgs = _prose(200)
    raw = context_budget.request_tokens(msgs)
    context_budget.observe("big", msgs, None, raw * 3)
    context_budget.observe("tiny", msgs, None, 1)
    assert context_budget.scale("big") == 1.0
    assert context_budget.scale("tiny") == 0.55


def test_calibration_ignores_tiny_requests_and_round_trips(clean_calibration):
    context_budget.observe("m", [{"role": "user", "content": "hi"}], None, 3)
    assert context_budget.scale("m") == 1.0
    context_budget.load({"m": 0.7, "bad": "x"})
    assert context_budget.snapshot() == {"m": 0.7}
    context_budget.load({"m": 0.9})  # an already-known model isn't overwritten by stale data
    assert context_budget.scale("m") == 0.7


# ── Ollama model residency ───────────────────────────────────────────────────────
# Live symptom: the gate classifier (no num_ctx → server default 4096) and chat
# (8192) made Ollama unload/reload the 14B model every turn; so did GPU embeddings.

def test_omitted_num_ctx_reuses_the_models_last_context(monkeypatch):
    monkeypatch.setattr(ollama_client, "_resident_ctx", {})
    run = asyncio.run
    assert run(ollama_client._ollama_options("m", "localhost", 11434, {"num_ctx": 8192}))["num_ctx"] == 8192
    # Same server spelled differently, caller didn't care about context size:
    assert run(ollama_client._ollama_options("m", "http://127.0.0.1:11434", None, {"temperature": 0}))["num_ctx"] == 8192
    assert run(ollama_client._ollama_options("m", "localhost", 11434, {"num_ctx": 4096}))["num_ctx"] == 4096


def test_embeddings_run_on_cpu_unless_opted_out(monkeypatch):
    seen = []

    class FakeClient:
        async def embed(self, **kwargs):
            seen.append(kwargs.get("options"))
            return types.SimpleNamespace(embeddings=[[0.1]])

    monkeypatch.setattr(ollama_client, "get_async_client", lambda *a, **k: FakeClient())
    monkeypatch.delenv("ARYNWOOD_EMBED_ON_GPU", raising=False)
    asyncio.run(ollama_client.aembed_texts(["x"], model="nomic-embed-text"))
    monkeypatch.setenv("ARYNWOOD_EMBED_ON_GPU", "1")
    asyncio.run(ollama_client.aembed_texts(["x"], model="nomic-embed-text"))
    assert seen == [{"num_gpu": 0}, None]


# ── System prompt: memory visibility and honest capabilities ─────────────────────

def _central():
    return chat.get_personas()["central"]


MEM = [{"id": 4, "type": "decision", "title": "Cover palette", "content": "Teal and amber.",
        "pinned": 0, "status": "confirmed", "volatility": "durable", "updated_at": "2026-09-23"}]


def test_empty_memory_is_stated_so_the_model_doesnt_invent_one():
    prompt = chat.build_system_prompt(_central(), memories=[], memory_enabled=True, has_native_tools=True)
    assert "No saved memories matched" in prompt and "never reconstruct or invent" in prompt
    assert "No saved memories" not in chat.build_system_prompt(_central(), memories=[], has_native_tools=True)


def test_memories_trimmed_for_space_point_to_search_memory():
    prompt = chat.build_system_prompt(_central(), memories=MEM, budget_tokens=10, memory_enabled=True,
                                      has_native_tools=True)
    assert "Teal and amber" not in prompt and "call search_memory" in prompt


def test_capabilities_reflect_the_personas_real_toolset():
    doc = chat.build_system_prompt(chat.get_personas()["doc"], has_native_tools=False, tool_servers=[])
    aryn = chat.build_system_prompt(_central(), has_native_tools=True, tool_servers=["Kdenlive"])
    assert "Kdenlive video editor control" not in doc and "cannot call any tools" in doc
    assert "Kdenlive video editor control" in aryn and "Codebase awareness —" not in aryn
    for prompt in (doc, aryn):
        assert "cannot run them" in prompt  # GPU/studio features are the user's, not callable


def test_bundled_personas_dont_deny_the_tools_they_have():
    for key, persona in chat.get_personas().items():
        assert "You have no real tools" not in persona.get("system", ""), key


# ── Memory proposals: no churn ───────────────────────────────────────────────────

def test_restating_a_saved_memory_creates_no_revision(client, monkeypatch):
    import aiosqlite
    from backend.db import DB_PATH

    async def no_conflicts(*a, **k):
        return None

    async def go():
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            await db.execute("INSERT INTO arynwood_memory (type,title,content,status) VALUES ('fact','Tempo','92 BPM.','confirmed')")
            await db.commit()
            reply = '<remember type="fact" title="Tempo">92  BPM.</remember>'
            first = await chat._process_memories(reply, db)
            second = await chat._process_memories('<remember type="fact" title="Tempo">96 BPM.</remember>', db)
            third = await chat._process_memories('<remember type="fact" title="Tempo">96 BPM.</remember>', db)
            async with db.execute("SELECT COUNT(*) FROM memory_revisions r JOIN arynwood_memory m ON m.id=r.memory_id "
                                  "WHERE m.title='Tempo' AND r.state='pending'") as cur:
                pending = (await cur.fetchone())[0]
            return first, second, third, pending

    first, second, third, pending = asyncio.run(go())
    assert first == [] and len(second) == 1 and third == [] and pending == 1


# ── Stop keeps what was shown, exactly once ──────────────────────────────────────

@pytest.fixture()
def stub_turn(monkeypatch):
    async def ctx_len(model, host=None, port=None, timeout=5.0):
        return 8192

    async def no_kb(*a, **k):
        return []

    async def no_tools(message, approve=None):
        return "", []

    async def no_memories(db, message):
        return []

    monkeypatch.setattr(ollama_client, "context_length", ctx_len)
    monkeypatch.setattr(knowledge, "search", no_kb)
    monkeypatch.setattr(mcp_tool_agent, "gather_context_for_message", no_tools)
    monkeypatch.setattr(chat, "_load_relevant_memories", no_memories)


def _messages(client, conversation_id):
    return client.get(f"/api/chat/conversations/{conversation_id}/messages").json()


def test_stop_mid_stream_saves_the_partial_reply(client, monkeypatch, stub_turn):
    async def slow_stream(*, model, messages, host, port, options=None, tools=None):
        for word in ["Once ", "upon ", "a ", "time"] + ["..."] * 200:
            await asyncio.sleep(0.02)
            yield {"token": word, "done": False}
        yield {"token": "", "done": True}

    monkeypatch.setattr(ollama_client, "chat_stream", slow_stream)
    with client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"message": "please summarize chapter three", "persona": "doc", "model": "qwen2.5"})
        conversation_id = None
        while True:
            m = ws.receive_json()
            if m["type"] == "conversation_id":
                conversation_id = m["id"]
            if m["type"] == "token" and m["token"]:
                break
        ws.send_json({"type": "cancel"})
        while ws.receive_json()["type"] != "cancelled":
            pass
    replies = [m for m in _messages(client, conversation_id) if m["role"] == "assistant"]
    assert len(replies) == 1 and replies[0]["content"].startswith("Once") and "(stopped)" in replies[0]["content"]


def test_stop_during_post_reply_work_does_not_duplicate_the_reply(client, monkeypatch, stub_turn):
    async def quick_stream(*, model, messages, host, port, options=None, tools=None):
        yield {"token": 'Saved. <remember title="x">y</remember>', "done": True}

    async def slow_memories(text, db):
        await asyncio.sleep(5)
        return []

    monkeypatch.setattr(ollama_client, "chat_stream", quick_stream)
    monkeypatch.setattr(chat, "_process_memories", slow_memories)
    with client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"message": "please summarize chapter three", "persona": "central", "model": "qwen2.5"})
        conversation_id = None
        while True:
            m = ws.receive_json()
            if m["type"] == "conversation_id":
                conversation_id = m["id"]
            if m["type"] == "token" and m["token"]:
                break
        time.sleep(0.3)  # reply persisted; memory processing still running
        ws.send_json({"type": "cancel"})
        while ws.receive_json()["type"] != "cancelled":
            pass
    replies = [m for m in _messages(client, conversation_id) if m["role"] == "assistant"]
    assert len(replies) == 1 and "(stopped)" not in replies[0]["content"]


def test_first_turn_does_not_announce_a_summary(client, monkeypatch, stub_turn):
    async def stream(*, model, messages, host, port, options=None, tools=None):
        yield {"token": "ok", "done": True}

    monkeypatch.setattr(ollama_client, "chat_stream", stream)
    with client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"message": "please summarize chapter three", "persona": "doc", "model": "qwen2.5"})
        events = []
        while not (events and events[-1]["type"] == "token" and events[-1].get("done")):
            events.append(ws.receive_json())
    labels = [e.get("label", "") for e in events if e["type"] == "status"]
    completed = next(e for e in events if e["type"] == "turn_completed")
    assert not any("Preserving" in label for label in labels)
    assert not any(e["kind"] == "summary" for e in completed["evidence"])


# ── Recent-conversation context carries only the user's side ─────────────────────
# Live symptom: an answer quoting a since-deleted knowledge source kept being
# repeated in new chats, each repetition feeding the next.

def test_recent_context_excludes_past_assistant_answers(client):
    import aiosqlite
    from backend.db import DB_PATH

    async def go():
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            # Newest by far, so other tests' conversations can't push it out of the "last 3" window.
            cur = await db.execute("INSERT INTO conversations (persona, model, updated_at) VALUES ('central','m','2999-01-01')")
            old = cur.lastrowid
            await db.execute("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', 'When is the EP out?')", (old,))
            await db.execute("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'assistant', 'November 14.')", (old,))
            await db.commit()
            runtime_context.project_id.set(None)
            return await chat._load_recent_conversation_context(db, exclude_id=None)

    ctx = asyncio.run(go())
    assert "When is the EP out?" in ctx and "November 14" not in ctx


# ── Knowledge ────────────────────────────────────────────────────────────────────

def test_empty_knowledge_base_skips_embedding_and_reports_available(client, monkeypatch):
    calls = []

    async def embed(*a, **k):
        calls.append(1)
        return [0.0]

    monkeypatch.setattr(knowledge, "get_embedding", embed)
    tokens = [runtime_context.evidence.set([]), runtime_context.project_id.set(987654)]
    try:
        assert asyncio.run(knowledge.search("anything at all")) == []
        evidence = runtime_context.evidence.get()
    finally:
        runtime_context.project_id.reset(tokens[1])
        runtime_context.evidence.reset(tokens[0])
    assert calls == []
    assert evidence[-1]["kind"] == "knowledge" and evidence[-1]["semantic_available"] is True


def test_search_endpoint_is_cross_project_by_default(client, monkeypatch):
    seen = []

    async def fake_search(q, top_k=5, all_projects=False, **k):
        seen.append((all_projects, runtime_context.project_id.get()))
        return []

    monkeypatch.setattr(knowledge, "search", fake_search)
    client.get("/api/knowledge/search", params={"q": "x"})
    client.get("/api/knowledge/search", params={"q": "x", "project_id": 3})
    assert seen == [(True, None), (False, 3)]
