"""memory_index degrades gracefully when Ollama/Qdrant aren't reachable — pointed at
a closed local port so these fail fast (connection refused) rather than waiting out
a real timeout, and without depending on live services being up for the suite to pass."""

from backend.services import memory_index

_DEAD = "http://localhost:1"


async def test_index_memory_returns_false_when_unreachable():
    ok = await memory_index.index_memory(1, "title", "content", ollama_url=_DEAD, qdrant_url=_DEAD)
    assert ok is False


async def test_search_returns_empty_list_when_unreachable():
    hits = await memory_index.search_relevant_memory_ids("query", ollama_url=_DEAD, qdrant_url=_DEAD)
    assert hits == []


async def test_delete_does_not_raise_when_unreachable():
    await memory_index.delete_memory_index(1, qdrant_url=_DEAD)  # just must not raise


async def test_backfill_returns_zero_when_ollama_unreachable(client):
    import aiosqlite
    import os
    db = await aiosqlite.connect(os.environ["ARYNWOOD_DB_PATH"])
    db.row_factory = aiosqlite.Row
    try:
        count = await memory_index.backfill_all(db, ollama_url=_DEAD, qdrant_url=_DEAD)
        assert count == 0
    finally:
        await db.close()
