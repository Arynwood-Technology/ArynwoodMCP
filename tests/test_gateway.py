"""Headless gateway (backend/gateway/): sessions that persist, turns that run in order,
and approvals that fail closed. The LLM, knowledge-base and tool-loop layers are stubbed
so this runs without Ollama; everything else (chat._run_turn, SQLite, the routes) is real."""

import asyncio
import json
import time
import uuid

import pytest

from backend.gateway import Gateway, GatewayBusy, InboundMessage, InvalidSession, sessions
from backend.gateway.config import load_config, trust_policy
from backend.routers import chat
from backend.services import knowledge, mcp_tool_agent, memory_index, ollama_client

SAFE_MESSAGE = "please summarize the plan for chapter three"

_requests: list[dict] = []   # every chat_stream call: {"messages": [...], "started": t, "ended": t}


async def _fake_context_length(model, host=None, port=None, timeout=5.0):
    return 8192


async def _fake_chat_stream(*, model, messages, host, port, options=None, tools=None):
    record = {"messages": messages, "started": time.monotonic()}
    _requests.append(record)
    await asyncio.sleep(0.02)
    record["ended"] = time.monotonic()
    yield {"token": "ok", "done": True}


async def _fake_kb_search(query, *args, **kwargs):
    return []


async def _fake_gather_context(message, approve=None):
    return "", []


async def _no_memories(*args, **kwargs):
    return []


@pytest.fixture(autouse=True)
def _stub_llm_layer(monkeypatch):
    _requests.clear()
    monkeypatch.setattr(ollama_client, "context_length", _fake_context_length)
    monkeypatch.setattr(ollama_client, "chat_stream", _fake_chat_stream)
    monkeypatch.setattr(knowledge, "search", _fake_kb_search)
    monkeypatch.setattr(mcp_tool_agent, "gather_context_for_message", _fake_gather_context)
    monkeypatch.setattr(memory_index, "search_relevant_memory_ids", _no_memories)


@pytest.fixture()
async def make_gateway():
    from backend.db import init_db
    await init_db()
    created = []

    def make(**overrides):
        config = load_config()
        config.update(overrides)
        gateway = Gateway(config)
        created.append(gateway)
        return gateway

    yield make
    for gateway in created:
        await gateway.shutdown()


def _key(prefix="api") -> str:
    return f"{prefix}:{uuid.uuid4().hex[:8]}"


def _user_turns(record) -> list[str]:
    return [m["content"] for m in record["messages"] if m["role"] == "user"]


async def _db():
    from backend.db import get_db
    gen = get_db()
    return gen, await anext(gen)


# ── sessions ────────────────────────────────────────────────────────────────────


async def test_two_sessions_keep_separate_conversations(make_gateway):
    gateway = make_gateway()
    alice, bob = _key(), _key()
    first = await gateway.submit(InboundMessage(session=alice, text="alice one", persona="doc"))
    await gateway.submit(InboundMessage(session=bob, text="bob one", persona="doc"))
    second = await gateway.submit(InboundMessage(session=alice, text="alice two", persona="doc"))

    assert first.status == "completed" and first.reply == "ok"
    assert first.conversation_id == second.conversation_id
    assert _user_turns(_requests[1]) == ["bob one"]                 # nothing of alice's leaks in
    assert _user_turns(_requests[2]) == ["alice one", "alice two"]  # alice's own history continues


async def test_session_survives_a_restart(make_gateway):
    key = _key()
    before = await make_gateway().submit(InboundMessage(session=key, text="remember the lighthouse", persona="doc"))

    after = await make_gateway().submit(InboundMessage(session=key, text="what did I mention?"))  # a fresh process
    assert after.conversation_id == before.conversation_id
    assert _user_turns(_requests[-1]) == ["remember the lighthouse", "what did I mention?"]


async def test_session_settings_apply_only_at_creation(make_gateway):
    gateway = make_gateway()
    key = _key()
    await gateway.submit(InboundMessage(session=key, text=SAFE_MESSAGE, persona="doc", label="Notes"))
    await gateway.submit(InboundMessage(session=key, text=SAFE_MESSAGE, persona="kona"))
    gen, db = await _db()
    try:
        session = await sessions.get(db, key)
        async with db.execute("SELECT persona, title FROM conversations WHERE id=?", (session.conversation_id,)) as cur:
            conversation = dict(await cur.fetchone())
    finally:
        await gen.aclose()
    assert session.persona == "doc"
    assert conversation == {"persona": "doc", "title": "Notes"}
    assert session.meta["last_source"] == "api" and session.last_active_at


async def test_deleted_conversation_is_replaced(make_gateway):
    gateway = make_gateway()
    key = _key()
    first = await gateway.submit(InboundMessage(session=key, text="one", persona="doc"))
    gen, db = await _db()
    try:
        await db.execute("DELETE FROM conversations WHERE id=?", (first.conversation_id,))
        await db.commit()
    finally:
        await gen.aclose()
    second = await gateway.submit(InboundMessage(session=key, text="two"))
    assert second.status == "completed"
    assert second.conversation_id != first.conversation_id


@pytest.mark.parametrize("msg", [
    InboundMessage(session="has space", text="hi"),
    InboundMessage(session="a/b", text="hi"),
    InboundMessage(session="api:x", text="   "),
    InboundMessage(session="api:x", text="hi", approvals="always"),
])
async def test_bad_messages_are_rejected(make_gateway, msg):
    with pytest.raises(InvalidSession):
        await make_gateway().submit(msg)


async def test_unknown_persona_is_rejected(make_gateway):
    with pytest.raises(InvalidSession, match="Unknown persona"):
        await make_gateway().submit(InboundMessage(session=_key(), text="hi", persona="nobody"))


# ── trust: what a turn may see ──────────────────────────────────────────────────

MARKERS = {
    "notes": "AGENT-NOTES-XYZZY",
    "memory": "MEMORY-TEAL-XYZZY",
    "other_conversation": "OTHER-CONVERSATION-XYZZY",
}
GUEST = "who is not your owner"


async def _seed_private_context():
    gen, db = await _db()
    try:
        await db.execute("INSERT INTO settings (key, value) VALUES ('agent_context', ?) "
                         "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (MARKERS["notes"],))
        await db.execute("DELETE FROM arynwood_memory WHERE title='Cover colour'")
        await db.execute("INSERT INTO arynwood_memory (title, content, pinned) VALUES ('Cover colour', ?, 1)",
                         (MARKERS["memory"],))
        # Dated ahead so it's always among the "last few conversations" central is shown
        # (updated_at has one-second resolution; ties with other tests' rows are otherwise a coin flip).
        cur = await db.execute("INSERT INTO conversations (persona, model, updated_at) "
                               "VALUES ('central', 'x', datetime('now', '+1 day'))")
        await db.execute("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)",
                         (cur.lastrowid, MARKERS["other_conversation"]))
        await db.commit()
    finally:
        await gen.aclose()


async def _session(key, trust, persona="central"):
    gen, db = await _db()
    try:
        await sessions.create(db, key, persona=persona)
        await sessions.update(db, key, trust_level=trust)
    finally:
        await gen.aclose()


def _script(monkeypatch, outputs):
    """ollama_client.chat as the agent loop sees it: one scripted output per round."""
    requests = []

    async def chat(*, model, messages, host=None, port=None, options=None, tools=None, timeout=None):
        requests.append({"messages": messages, "tools": tools})
        return {"output": outputs.pop(0) if outputs else "ok", "tool_calls": None}

    monkeypatch.setattr(ollama_client, "chat", chat)
    return requests


async def _select_nothing(message):
    return []


def _system_prompt(messages) -> str:
    return messages[0]["content"]


async def test_a_new_session_is_a_stranger_and_sees_no_private_context(make_gateway, monkeypatch):
    await _seed_private_context()
    kb_queries = []

    async def kb(query, *a, **k):
        kb_queries.append(query)
        return []

    monkeypatch.setattr(knowledge, "search", kb)
    result = await make_gateway().submit(InboundMessage(session=_key("irc"), text="what colour is the cover?",
                                                        persona="central", sender="visitor"))
    assert result.trust_level == "stranger"
    prompt = _system_prompt(_requests[-1]["messages"])
    assert not [name for name, marker in MARKERS.items() if marker in prompt]
    assert GUEST in prompt and "visitor" in prompt
    assert chat.BASE_DIR not in prompt and "## Environment" not in prompt   # no home path, no layout
    assert kb_queries == []


async def test_owner_session_gets_its_private_context(make_gateway, monkeypatch):
    await _seed_private_context()
    monkeypatch.setattr(mcp_tool_agent, "select_servers", _select_nothing)
    requests = _script(monkeypatch, ["Teal."])
    key = _key()
    await _session(key, "owner")
    result = await make_gateway().submit(InboundMessage(session=key, text="what colour is the cover?"))
    assert result.trust_level == "owner" and result.reply == "Teal."
    prompt = _system_prompt(requests[0]["messages"])   # the turn's round, not the memory write-back after it
    assert [name for name, marker in MARKERS.items() if marker in prompt] == list(MARKERS)
    assert GUEST not in prompt and chat.BASE_DIR in prompt
    # The owner's central turn runs the agent loop with chat.py's native tools attached.
    assert {t["function"]["name"] for t in requests[0]["tools"]} >= {"web_search", "search_memory"}


async def test_message_trust_lowers_but_never_raises(make_gateway, monkeypatch):
    await _seed_private_context()
    gateway = make_gateway()
    owner = _key()
    await _session(owner, "owner")
    lowered = await gateway.submit(InboundMessage(session=owner, text="hi", trust_level="stranger"))
    assert lowered.trust_level == "stranger"
    assert MARKERS["memory"] not in _system_prompt(_requests[-1]["messages"])

    stranger = _key()
    await _session(stranger, "stranger")
    raised = await gateway.submit(InboundMessage(session=stranger, text="hi", trust_level="owner"))
    assert raised.trust_level == "stranger"


async def test_only_owner_turns_save_memories(make_gateway, monkeypatch):
    remember = 'Noted. <remember title="Gateway test fact">The gateway test colour is ochre.</remember>'

    async def stream_remember(**kwargs):
        yield {"token": remember, "done": True}

    async def saved_count():
        gen, db = await _db()
        try:
            async with db.execute("SELECT COUNT(*) FROM arynwood_memory WHERE title='Gateway test fact'") as cur:
                return (await cur.fetchone())[0]
        finally:
            await gen.aclose()

    gateway = make_gateway()
    monkeypatch.setattr(ollama_client, "chat_stream", stream_remember)
    stranger = await gateway.submit(InboundMessage(session=_key(), text="remember ochre", persona="central"))
    assert stranger.reply == "Noted." and await saved_count() == 0

    monkeypatch.setattr(mcp_tool_agent, "select_servers", _select_nothing)
    _script(monkeypatch, [remember])
    key = _key()
    await _session(key, "owner")
    owner = await gateway.submit(InboundMessage(session=key, text="remember ochre"))
    assert owner.reply == "Noted." and await saved_count() == 1


def test_trust_policy_fails_closed():
    config = {"trust_levels": {"known": {"web_search": True, "memories": "yes"}}}
    assert trust_policy(config, "known")["web_search"] is True
    assert trust_policy(config, "known")["memories"] is False       # only a real true grants
    assert not any(trust_policy(config, "owner").values())          # an absent level grants nothing
    assert sessions.effective_trust("owner", "known") == "known"
    assert sessions.effective_trust("known", "owner") == "known"
    assert sessions.effective_trust("bogus") == "stranger"


# ── approvals: owner turns only, owner answers only ─────────────────────────────

DELETE = json.dumps({"name": "delete_clip", "arguments": {"clip_id": 3}})


@pytest.fixture()
def kdenlive(monkeypatch):
    """A fake Kdenlive server selected for every turn; returns the tools/call log."""
    calls = []

    async def post(cfg, method, params, req_id=1):
        if method == "tools/list":
            return {"tools": [
                {"name": "get_timeline_summary", "description": "", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "delete_clip", "description": "",
                 "inputSchema": {"type": "object", "properties": {"clip_id": {"type": "integer"}}, "required": ["clip_id"]}},
            ]}
        calls.append(params["name"])
        return {"content": [{"type": "text", "text": "done"}]}

    async def select(message):
        return ["kdenlive"]

    monkeypatch.setattr(mcp_tool_agent, "_load_servers", lambda: {"kdenlive": {"url": "http://x"}})
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", post)
    monkeypatch.setattr(mcp_tool_agent, "select_servers", select)
    return calls


async def _owner_key():
    key = _key()
    await _session(key, "owner")
    return key


def _drain(sub) -> list[dict]:
    return [sub.queue.get_nowait() for _ in range(sub.queue.qsize())]


async def test_destructive_call_denied_at_once_with_no_approver(make_gateway, kdenlive, monkeypatch):
    requests = _script(monkeypatch, [DELETE, "I didn't delete it."])
    gateway = make_gateway(approval_timeout_seconds=30)
    watcher = gateway.subscribe({"*"}, approver=False)  # sees events, can't approve
    started = time.monotonic()
    result = await gateway.submit(InboundMessage(session=await _owner_key(), text="delete clip 3"))
    assert result.status == "completed" and kdenlive == []
    assert time.monotonic() - started < 5  # denied, not left waiting for the 30s timeout
    assert "DENIED" in [m for m in requests[1]["messages"] if m["role"] == "tool"][0]["content"]
    resolved = [e for e in _drain(watcher) if e["type"] == "approval_resolved"]
    assert resolved and resolved[0]["approved"] is False and resolved[0]["by"] == "no approver attached"


async def test_destructive_call_waits_for_an_http_decision(make_gateway, kdenlive, monkeypatch):
    _script(monkeypatch, [DELETE, "Deleted."])
    gateway = make_gateway()
    turn = asyncio.create_task(gateway.submit(
        InboundMessage(session=await _owner_key(), text="delete clip 3", approvals="wait")))
    for _ in range(200):
        if gateway.pending_approvals():
            break
        await asyncio.sleep(0.01)
    [pending] = gateway.pending_approvals()
    assert pending["tool"] == "delete_clip" and pending["tier"] == "destructive"
    assert gateway.resolve_approval(pending["request_id"], True)
    assert (await turn).reply == "Deleted."
    assert kdenlive == ["delete_clip"]
    assert not gateway.resolve_approval(pending["request_id"], False)  # already settled


async def test_unanswered_approval_times_out_to_denial(make_gateway, kdenlive, monkeypatch):
    _script(monkeypatch, [DELETE, "Not deleted."])
    gateway = make_gateway(approval_timeout_seconds=0.05)
    await gateway.submit(InboundMessage(session=await _owner_key(), text="delete clip 3", approvals="wait"))
    assert kdenlive == [] and gateway.pending_approvals() == []


async def test_attached_owner_subscriber_can_approve(make_gateway, kdenlive, monkeypatch):
    _script(monkeypatch, [DELETE, "Deleted."])
    gateway = make_gateway()
    key = await _owner_key()
    sub = gateway.subscribe({key})
    turn = asyncio.create_task(gateway.submit(InboundMessage(session=key, text="delete clip 3")))
    while (event := await asyncio.wait_for(sub.queue.get(), 5))["type"] != "approval_request":
        pass
    assert event["session"] == key and event["tool"] == "delete_clip"
    gateway.resolve_approval(event["request_id"], True, by="test")
    await turn
    assert kdenlive == ["delete_clip"]


async def test_approver_leaving_denies_its_pending_request(make_gateway, kdenlive, monkeypatch):
    _script(monkeypatch, [DELETE, "Not deleted."])
    gateway = make_gateway()
    key = await _owner_key()
    sub = gateway.subscribe({key})
    turn = asyncio.create_task(gateway.submit(InboundMessage(session=key, text="delete clip 3")))
    while (await asyncio.wait_for(sub.queue.get(), 5))["type"] != "approval_request":
        pass
    gateway.unsubscribe(sub)
    await asyncio.wait_for(turn, 5)
    assert kdenlive == []


async def test_non_owner_turn_is_never_put_to_an_approver(make_gateway, kdenlive, monkeypatch):
    # Even if the config hands tools to "known", a known turn can't get a destructive call
    # approved: it isn't asked, though an owner approver is right there.
    config = load_config()
    levels = {**config["trust_levels"], "known": {key: True for key in config["trust_levels"]["owner"]}}
    _script(monkeypatch, [DELETE, "I can't do that."])
    gateway = make_gateway(trust_levels=levels, approval_timeout_seconds=2)  # a regression fails fast, not in 300s
    key = _key()
    await _session(key, "known")
    owner = gateway.subscribe({key})
    result = await gateway.submit(InboundMessage(session=key, text="delete clip 3", sender="friend"))
    assert result.trust_level == "known" and kdenlive == []
    assert "approval_request" not in [e["type"] for e in _drain(owner)]


async def test_only_owner_trust_can_answer_an_approval(make_gateway, kdenlive, monkeypatch):
    _script(monkeypatch, [DELETE, "Deleted."])
    gateway = make_gateway()
    key = await _owner_key()
    unverified = gateway.subscribe({key}, trust="known")
    assert not gateway.has_approver(key)   # a non-owner listener doesn't keep requests open
    turn = asyncio.create_task(gateway.submit(InboundMessage(session=key, text="delete clip 3", approvals="wait")))
    for _ in range(200):
        if gateway.pending_approvals():
            break
        await asyncio.sleep(0.01)
    [pending] = gateway.pending_approvals()
    assert not gateway.resolve_approval(pending["request_id"], True, by="irc:spoofed", trust="known")
    assert gateway.pending_approvals()     # the refused answer didn't settle it
    assert gateway.resolve_approval(pending["request_id"], True, by="owner")
    await turn
    assert kdenlive == ["delete_clip"]
    gateway.unsubscribe(unverified)


async def test_owner_turn_runs_tools_mid_reply(make_gateway, kdenlive, monkeypatch):
    requests = _script(monkeypatch, [json.dumps({"name": "get_timeline_summary", "arguments": {}}), "Three clips."])
    gateway = make_gateway()
    key = await _owner_key()
    result = await gateway.submit(InboundMessage(session=key, text="what's on my timeline?"))
    assert result.reply == "Three clips." and kdenlive == ["get_timeline_summary"]
    loop = [e for e in result.evidence if e["kind"] == "agent_loop"][0]
    assert loop["rounds"] == 2 and loop["calls"][0]["outcome"] == "success"
    # The tool notes and Kdenlive's own instructions ride in the system prompt.
    assert "## Tools for this turn" in _system_prompt(requests[0]["messages"])
    gen, db = await _db()
    try:
        async with db.execute("SELECT tool, status FROM run_steps WHERE run_id=?", (result.run_id,)) as cur:
            assert [tuple(r) for r in await cur.fetchall()] == [("kdenlive.get_timeline_summary", "unverified")]
    finally:
        await gen.aclose()


def test_http_sets_and_validates_trust(client):
    path = "/api/gateway/sessions/api:trust-check"
    assert client.put(path, json={"label": "x"}).json()["trust_level"] == "stranger"
    assert client.put(path, json={"trust_level": "owner"}).json()["trust_level"] == "owner"
    assert client.put(path, json={"trust_level": "admin"}).status_code == 422
    assert client.put("/api/gateway/sessions/api:trust-new", json={"trust_level": "known"}).json()["trust_level"] == "known"
    r = client.post("/api/gateway/inbound", json={"session": "api:x", "text": "hi", "trust_level": "root"})
    assert r.status_code == 422


# ── ordering, limits, stopping ──────────────────────────────────────────────────


def _overlaps(records) -> bool:
    spans = sorted((r["started"], r["ended"]) for r in records)
    return any(nxt[0] < cur[1] for cur, nxt in zip(spans, spans[1:]))


async def test_turns_never_overlap_on_one_gpu_slot(make_gateway):
    gateway = make_gateway(max_concurrent_turns=1)
    same = _key()
    await asyncio.gather(
        gateway.submit(InboundMessage(session=same, text="first", persona="doc")),
        gateway.submit(InboundMessage(session=same, text="second", persona="doc")),
        gateway.submit(InboundMessage(session=_key(), text="other session", persona="doc")),
    )
    assert len(_requests) == 3 and not _overlaps(_requests)
    same_session = [r for r in _requests if "other session" not in _user_turns(r)]
    assert _user_turns(same_session[1]) == ["first", "second"]  # in order, with history


async def test_full_session_queue_is_refused(make_gateway, monkeypatch):
    release = asyncio.Event()

    async def blocking_stream(**kwargs):
        await release.wait()
        yield {"token": "ok", "done": True}

    monkeypatch.setattr(ollama_client, "chat_stream", blocking_stream)
    gateway = make_gateway(max_queued_per_session=1)
    key = _key()
    running = asyncio.create_task(gateway.submit(InboundMessage(session=key, text="1", persona="doc")))
    await asyncio.sleep(0.1)
    queued = asyncio.create_task(gateway.submit(InboundMessage(session=key, text="2", persona="doc")))
    await asyncio.sleep(0.05)
    with pytest.raises(GatewayBusy):
        await gateway.submit(InboundMessage(session=key, text="3", persona="doc"))
    release.set()
    assert [r.status for r in await asyncio.gather(running, queued)] == ["completed", "completed"]


async def _hanging_stream(**kwargs):
    yield {"token": "partial thought", "done": False}
    await asyncio.Event().wait()


async def test_cancel_stops_the_turn_and_keeps_what_was_said(make_gateway, monkeypatch):
    monkeypatch.setattr(ollama_client, "chat_stream", _hanging_stream)
    gateway = make_gateway()
    key = _key()
    turn = asyncio.create_task(gateway.submit(InboundMessage(session=key, text=SAFE_MESSAGE, persona="doc")))
    await asyncio.sleep(0.2)
    assert await gateway.cancel(key)
    result = await turn
    assert result.status == "interrupted" and result.reply == "partial thought"
    gen, db = await _db()
    try:
        async with db.execute("SELECT content FROM messages WHERE conversation_id=? AND role='assistant'",
                              (result.conversation_id,)) as cur:
            saved = [r[0] for r in await cur.fetchall()]
    finally:
        await gen.aclose()
    assert saved == ["partial thought\n\n*(stopped)*"]
    assert not await gateway.cancel(key)  # nothing left running


async def test_stuck_turn_times_out(make_gateway, monkeypatch):
    monkeypatch.setattr(ollama_client, "chat_stream", _hanging_stream)
    result = await make_gateway(turn_timeout_seconds=0.2).submit(
        InboundMessage(session=_key(), text=SAFE_MESSAGE, persona="doc"))
    assert result.status == "timeout"


# ── HTTP + WebSocket ────────────────────────────────────────────────────────────


def test_http_session_lifecycle(client):
    key = "irc:testnet:#writers"
    path = "/api/gateway/sessions/irc:testnet:%23writers"
    r = client.post("/api/gateway/inbound", json={"session": key, "text": SAFE_MESSAGE, "persona": "doc"})
    assert r.status_code == 200, r.text
    first = r.json()
    assert first["reply"] == "ok" and first["status"] == "completed" and first["run_id"]

    assert client.get(path).json()["conversation_id"] == first["conversation_id"]
    assert key in [s["key"] for s in client.get("/api/gateway/sessions").json()]
    assert [m["role"] for m in client.get(f"{path}/messages").json()] == ["user", "assistant"]

    assert client.put(path, json={"label": "Writers' room"}).json()["label"] == "Writers' room"
    assert client.post(f"{path}/reset").json()["conversation_id"] is None
    second = client.post("/api/gateway/inbound", json={"session": key, "text": "fresh start"}).json()
    assert second["conversation_id"] != first["conversation_id"]
    assert [m["content"] for m in client.get(f"{path}/messages").json()] == ["fresh start", "ok"]

    status = client.get("/api/gateway/status").json()
    assert status["daemon"] is False and status["sessions"] >= 1 and status["active_turns"] == []

    assert client.delete(path).json() == {"deleted": key}
    assert client.get(path).status_code == 404
    # The conversation itself is kept in the history.
    assert any(c["id"] == second["conversation_id"] for c in client.get("/api/chat/conversations").json())


def test_http_rejects_bad_input(client):
    assert client.post("/api/gateway/inbound", json={"session": "a b", "text": "hi"}).status_code == 400
    assert client.post("/api/gateway/inbound", json={"session": "api:x", "text": "hi", "persona": "nobody"}).status_code == 400
    assert client.put("/api/gateway/sessions/api:y", json={"persona": "nobody"}).status_code == 400
    assert client.post("/api/gateway/approvals/nope", json={"approved": True}).status_code == 404
    assert client.get("/api/gateway/sessions/api:missing").status_code == 404


def test_http_put_creates_a_session_with_settings(client):
    r = client.put("/api/gateway/sessions/schedule:daily-notes", json={"persona": "estra", "label": "Daily notes"})
    assert r.status_code == 200
    assert {k: r.json()[k] for k in ("persona", "label", "conversation_id")} == {
        "persona": "estra", "label": "Daily notes", "conversation_id": None}


def test_websocket_runs_a_turn_and_streams_its_events(client):
    key = "api:ws-client"
    with client.websocket_connect(f"/api/gateway/ws?session={key}") as ws:
        ws.send_json({"type": "message", "session": key, "text": SAFE_MESSAGE})
        events = []
        while True:
            event = ws.receive_json()
            events.append(event)
            if event["type"] in ("turn_result", "error"):
                break
    types = [e["type"] for e in events]
    assert types[0] == "turn_started" and types[-1] == "turn_result"
    assert "token" in types and "turn_completed" in types
    assert all(e["session"] == key for e in events)
    assert events[-1]["reply"] == "ok"


def test_websocket_reports_bad_input(client):
    with client.websocket_connect("/api/gateway/ws") as ws:
        ws.send_text("not json")
        assert ws.receive_json()["type"] == "error"
        ws.send_json({"type": "subscribe", "session": "no spaces allowed"})
        assert ws.receive_json()["type"] == "error"


# ── config ──────────────────────────────────────────────────────────────────────


def test_overlay_merges_over_shipped_config(tmp_path, monkeypatch):
    overlay = tmp_path / "gateway.json"
    overlay.write_text(json.dumps({"port": 9999, "session_defaults": {"persona": "doc"}, "_comment": "x"}))
    monkeypatch.setenv("ARYNWOOD_GATEWAY_CONFIG", str(overlay))
    config = load_config()
    assert config["port"] == 9999
    assert config["session_defaults"]["persona"] == "doc"
    assert "model" in config["session_defaults"]   # untouched nested keys survive
    assert config["max_concurrent_turns"] == 1


def test_malformed_overlay_is_ignored(tmp_path, monkeypatch):
    overlay = tmp_path / "gateway.json"
    overlay.write_text("{not json")
    monkeypatch.setenv("ARYNWOOD_GATEWAY_CONFIG", str(overlay))
    assert load_config()["port"] == 8020


def test_http_reads_file_memory(client):
    from backend.gateway import get_gateway
    memory = get_gateway().file_memory
    asyncio.run(memory.record({"durable": ["The cover is teal."], "today": []}, "api:me", gist="cover"))
    body = client.get("/api/gateway/memory").json()
    assert "- The cover is teal." in body["memory"]
    assert any("api:me: cover" in text for text in body["daily"].values())



def _denial(requests) -> str:
    return [m for r in requests for m in r["messages"] if m["role"] == "tool"][0]["content"]


async def test_timed_out_approval_is_not_reported_as_a_decline(make_gateway, kdenlive, monkeypatch):
    """Seen live: nobody answered within the timeout, and the model told the owner they had declined."""
    requests = _script(monkeypatch, [DELETE, "Not done."])
    await make_gateway(approval_timeout_seconds=0.05).submit(
        InboundMessage(session=await _owner_key(), text="delete clip 3", approvals="wait"))
    denial = _denial(requests)
    assert "timed out" in denial and "declined" not in denial and kdenlive == []


async def test_no_approver_is_not_reported_as_a_decline(make_gateway, kdenlive, monkeypatch):
    requests = _script(monkeypatch, [DELETE, "Not done."])
    await make_gateway().submit(InboundMessage(session=await _owner_key(), text="delete clip 3"))
    denial = _denial(requests)
    assert "requires user approval" in denial and "declined" not in denial


async def test_an_explicit_deny_is_reported_as_one(make_gateway, kdenlive, monkeypatch):
    requests = _script(monkeypatch, [DELETE, "Not done."])
    gateway = make_gateway()
    turn = asyncio.create_task(gateway.submit(
        InboundMessage(session=await _owner_key(), text="delete clip 3", approvals="wait")))
    for _ in range(200):
        if gateway.pending_approvals():
            break
        await asyncio.sleep(0.01)
    gateway.resolve_approval(gateway.pending_approvals()[0]["request_id"], False)
    await turn
    assert "declined" in _denial(requests) and kdenlive == []


async def test_nonboolean_gateway_decisions_do_not_settle_pending_request(make_gateway):
    gateway = make_gateway()
    pending = gateway._open_approval('api:approval-strict-test', {
        'request_id': 'strict-test', 'tool': 'delete_clip', 'arguments': {}, 'tier': 'destructive',
    }, True)
    for value in ['false', 'true', 1, {}, None]:
        assert not gateway.resolve_approval(pending.request_id, value)
        assert not pending.future.done()
    assert gateway.resolve_approval(pending.request_id, False)
    assert pending.future.result() is False


def test_http_approval_requires_actual_boolean(client):
    for value in ['false', 'true', 1]:
        response = client.post('/api/gateway/approvals/nonexistent', json={'approved': value})
        assert response.status_code == 422
