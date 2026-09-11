import os

import aiosqlite

from backend.routers.chat import _summarize_aged_out_history, build_system_prompt, _set_setting, MAX_HISTORY
from backend.services import ollama_client


async def _db():
    db = await aiosqlite.connect(os.environ["ARYNWOOD_DB_PATH"])
    db.row_factory = aiosqlite.Row
    return db


async def _make_conversation(db):
    cur = await db.execute("INSERT INTO conversations (persona, model) VALUES ('central','qwen2.5-coder:14b')")
    await db.commit()
    return cur.lastrowid


async def _add_messages(db, conversation_id, n):
    for i in range(n):
        await db.execute(
            "INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)",
            (conversation_id, "user" if i % 2 == 0 else "assistant", f"message {i}"),
        )
    await db.commit()


def test_history_summary_rendered_in_system_prompt():
    persona = {"name": "Arynwood", "role": "Coordinator", "personality": "direct"}
    prompt = build_system_prompt(persona, "", [], "", history_summary="User is writing a novel called Nightglass.")
    assert "## Earlier in this conversation" in prompt
    assert "Nightglass" in prompt


def test_history_summary_absent_when_empty():
    persona = {"name": "Arynwood", "role": "Coordinator", "personality": "direct"}
    prompt = build_system_prompt(persona, "", [], "", history_summary="")
    assert "## Earlier in this conversation" not in prompt


async def test_no_summary_when_conversation_shorter_than_max_history(client, monkeypatch):
    db = await _db()
    try:
        await _set_setting(db, "agent_max_history", "30")
        conv_id = await _make_conversation(db)
        await _add_messages(db, conv_id, 5)

        called = {"n": 0}

        async def _fail_if_called(*args, **kwargs):
            called["n"] += 1
            raise AssertionError("should not summarize when nothing has aged out")

        monkeypatch.setattr(ollama_client, "chat", _fail_if_called)
        await _summarize_aged_out_history(conv_id, "qwen2.5-coder:14b", "localhost", 11434)
        assert called["n"] == 0

        async with db.execute("SELECT history_summary FROM conversations WHERE id=?", (conv_id,)) as cur:
            row = await cur.fetchone()
        assert row["history_summary"] == ""
    finally:
        await db.close()


async def test_summarizes_and_persists_when_history_exceeds_max(client, monkeypatch):
    db = await _db()
    try:
        await _set_setting(db, "agent_max_history", "4")  # restored to the default at the end — this is a global setting
        conv_id = await _make_conversation(db)
        await _add_messages(db, conv_id, 10)  # 6 messages will have aged out

        captured = {}

        async def _fake_chat(*, model, messages, host=None, port=None, options=None, timeout=None):
            captured["prompt"] = messages[0]["content"]
            return {"output": "Summary: discussed messages 0 through 5."}

        async def _fake_context_length(*a, **k):
            return 8192

        monkeypatch.setattr(ollama_client, "context_length", _fake_context_length)
        monkeypatch.setattr(ollama_client, "chat", _fake_chat)

        await _summarize_aged_out_history(conv_id, "qwen2.5-coder:14b", "localhost", 11434)

        assert "message 0" in captured["prompt"]
        assert "message 5" in captured["prompt"]
        assert "message 6" not in captured["prompt"]  # message 6 is still in the live window

        async with db.execute(
            "SELECT history_summary, history_summary_through_id FROM conversations WHERE id=?", (conv_id,)
        ) as cur:
            row = await cur.fetchone()
        assert "discussed messages 0 through 5" in row["history_summary"]
        assert row["history_summary_through_id"] > 0

        # A second pass with nothing new aged out shouldn't call the model again.
        called_again = {"n": 0}

        async def _fail_if_called_again(*args, **kwargs):
            called_again["n"] += 1
            raise AssertionError("should not re-summarize the same range")

        monkeypatch.setattr(ollama_client, "chat", _fail_if_called_again)
        await _summarize_aged_out_history(conv_id, "qwen2.5-coder:14b", "localhost", 11434)
        assert called_again["n"] == 0
    finally:
        await _set_setting(db, "agent_max_history", str(MAX_HISTORY))  # agent_max_history is a global setting
        await db.close()
