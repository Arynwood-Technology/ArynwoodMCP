"""_load_relevant_memories() logic: pinned memories always included, non-pinned ones
only when memory_index ranks them relevant, with a recency fallback when there's
nothing pinned and nothing relevant. memory_index itself is stubbed here — its own
contract is covered in test_memory_index.py."""

import os

import aiosqlite

from backend.routers import chat as chat_mod
from backend.routers.chat import _load_relevant_memories


async def _db():
    db = await aiosqlite.connect(os.environ["ARYNWOOD_DB_PATH"])
    db.row_factory = aiosqlite.Row
    return db


async def _insert(db, title, pinned=0):
    cur = await db.execute(
        "INSERT INTO arynwood_memory (type, title, content, pinned, status) VALUES ('fact', ?, 'x', ?, 'confirmed')",
        (title, pinned),
    )
    await db.commit()
    return cur.lastrowid


async def test_pinned_memories_always_included_regardless_of_relevance(client, monkeypatch):
    db = await _db()
    try:
        pinned_id = await _insert(db, "Pinned-RM-1", pinned=1)
        monkeypatch.setattr(chat_mod.memory_index, "search_relevant_memory_ids", _empty)

        result = await _load_relevant_memories(db, "totally unrelated query")
        assert pinned_id in {m["id"] for m in result}
    finally:
        await db.close()


async def test_relevant_non_pinned_memories_included_in_relevance_order(client, monkeypatch):
    db = await _db()
    try:
        id_a = await _insert(db, "Relevant-RM-A")
        id_b = await _insert(db, "Relevant-RM-B")
        await _insert(db, "Irrelevant-RM-C")

        async def _fake_search(message, top_k=8):
            return [id_b, id_a]  # deliberately not insertion order

        monkeypatch.setattr(chat_mod.memory_index, "search_relevant_memory_ids", _fake_search)

        result_ids = [m["id"] for m in await _load_relevant_memories(db, "query")]
        assert id_a in result_ids and id_b in result_ids
        # Relevance order (as returned by memory_index) must be preserved, not
        # re-sorted by SQL's arbitrary IN-clause order.
        assert result_ids.index(id_b) < result_ids.index(id_a)
    finally:
        await db.close()


async def test_does_not_inject_unrelated_recent_memories(client, monkeypatch):
    db = await _db()
    try:
        # This test's premise is "nothing pinned" — the shared test DB persists rows
        # across the whole session, so an earlier test's pinned memory would otherwise
        # still be sitting there and short-circuit the fallback branch under test.
        await db.execute("UPDATE arynwood_memory SET pinned=0")
        await db.commit()
        recent_id = await _insert(db, "Recent-RM-1")
        monkeypatch.setattr(chat_mod.memory_index, "search_relevant_memory_ids", _empty)

        result = await _load_relevant_memories(db, "query")
        assert recent_id not in {m["id"] for m in result}
    finally:
        await db.close()


async def test_no_fallback_when_pinned_exists_but_nothing_relevant(client, monkeypatch):
    db = await _db()
    try:
        pinned_id = await _insert(db, "Pinned-RM-2", pinned=1)
        unrelated_id = await _insert(db, "Unrelated-RM-1")
        monkeypatch.setattr(chat_mod.memory_index, "search_relevant_memory_ids", _empty)

        result = await _load_relevant_memories(db, "query")
        result_ids = {m["id"] for m in result}
        assert pinned_id in result_ids
        # An empty relevant-set shouldn't be padded out with unrelated recent notes
        # once there's already something pinned — this test's own unrelated row
        # must not appear via the recency fallback.
        assert unrelated_id not in result_ids
    finally:
        await db.close()


async def _empty(message, top_k=8):
    return []
