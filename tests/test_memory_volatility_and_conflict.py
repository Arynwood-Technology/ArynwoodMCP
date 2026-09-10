import os
from datetime import datetime, timedelta, timezone

import aiosqlite

from backend.routers import chat as chat_mod
from backend.routers.chat import _load_relevant_memories, _process_memories, _is_stale_transient
from backend.services import ollama_client


async def _db():
    db = await aiosqlite.connect(os.environ["ARYNWOOD_DB_PATH"])
    db.row_factory = aiosqlite.Row
    return db


def test_is_stale_transient_true_for_old_unpinned_transient():
    old = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
    m = {"volatility": "transient", "pinned": 0, "updated_at": old}
    assert _is_stale_transient(m) is True


def test_is_stale_transient_false_for_recent_transient():
    recent = datetime.now(timezone.utc).replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S")
    m = {"volatility": "transient", "pinned": 0, "updated_at": recent}
    assert _is_stale_transient(m) is False


def test_is_stale_transient_false_for_durable_regardless_of_age():
    old = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=365)).strftime("%Y-%m-%d %H:%M:%S")
    m = {"volatility": "durable", "pinned": 0, "updated_at": old}
    assert _is_stale_transient(m) is False


def test_is_stale_transient_false_when_pinned_even_if_old():
    old = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=365)).strftime("%Y-%m-%d %H:%M:%S")
    m = {"volatility": "transient", "pinned": 1, "updated_at": old}
    assert _is_stale_transient(m) is False


async def test_stale_transient_excluded_from_relevant_memories(client, monkeypatch):
    db = await _db()
    try:
        old = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
        cur = await db.execute(
            "INSERT INTO arynwood_memory (type, title, content, pinned, status, volatility, updated_at) "
            "VALUES ('note','Stale-Transient-1','x',0,'confirmed','transient',?)",
            (old,),
        )
        await db.commit()
        stale_id = cur.lastrowid

        async def _fake_search(message, top_k=8):
            return [stale_id]

        monkeypatch.setattr(chat_mod.memory_index, "search_relevant_memory_ids", _fake_search)
        result = await _load_relevant_memories(db, "query")
        assert stale_id not in {m["id"] for m in result}
    finally:
        await db.close()


async def test_new_memory_flagged_when_it_contradicts_a_confirmed_one(client, monkeypatch):
    db = await _db()
    try:
        cur = await db.execute(
            "INSERT INTO arynwood_memory (type, title, content, status) VALUES ('fact','Existing-Conflict-Fact','The GPU has 12GB VRAM.','confirmed')"
        )
        await db.commit()
        existing_id = cur.lastrowid

        async def _fake_search(query, top_k=3, min_score=0.72):
            return [existing_id]

        async def _fake_chat(*, model, messages, host=None, port=None, options=None, timeout=None):
            return {"output": "YES"}

        monkeypatch.setattr(chat_mod.memory_index, "search_relevant_memory_ids", _fake_search)
        monkeypatch.setattr(ollama_client, "chat", _fake_chat)

        saved = await _process_memories(
            '<remember type="fact" title="New-Conflict-Fact">The GPU has 24GB VRAM.</remember>', db,
        )
        assert saved[0]["conflict_with"] == "Existing-Conflict-Fact"

        async with db.execute("SELECT conflict_with_id FROM arynwood_memory WHERE title=?", ("New-Conflict-Fact",)) as c:
            row = await c.fetchone()
        assert row["conflict_with_id"] == existing_id
    finally:
        await db.close()


async def test_new_memory_not_flagged_when_no_contradiction(client, monkeypatch):
    db = await _db()
    try:
        async def _fake_search(query, top_k=3, min_score=0.72):
            return []

        monkeypatch.setattr(chat_mod.memory_index, "search_relevant_memory_ids", _fake_search)

        saved = await _process_memories(
            '<remember type="fact" title="No-Conflict-Fact">Some unrelated fact.</remember>', db,
        )
        assert "conflict_with" not in saved[0]
    finally:
        await db.close()


async def test_updating_existing_memory_by_title_skips_conflict_check(client, monkeypatch):
    db = await _db()
    try:
        await db.execute(
            "INSERT INTO arynwood_memory (type, title, content, status) VALUES ('fact','Update-No-Conflict-Check','old','confirmed')"
        )
        await db.commit()

        called = {"n": 0}

        async def _fail_if_called(query, top_k=3, min_score=0.72):
            called["n"] += 1
            return []

        monkeypatch.setattr(chat_mod.memory_index, "search_relevant_memory_ids", _fail_if_called)

        await _process_memories(
            '<remember type="fact" title="Update-No-Conflict-Check">new content</remember>', db,
        )
        assert called["n"] == 0
    finally:
        await db.close()
