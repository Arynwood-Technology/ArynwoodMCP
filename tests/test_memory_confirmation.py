import os

import aiosqlite

from backend.routers.chat import _process_memories, build_system_prompt


async def _get_db():
    db = await aiosqlite.connect(os.environ["ARYNWOOD_DB_PATH"])
    db.row_factory = aiosqlite.Row
    return db


async def test_model_written_remember_block_is_provisional(client):
    db = await _get_db()
    try:
        saved = await _process_memories(
            '<remember type="fact" title="Confirm-Test-A">The GPU has 12GB VRAM.</remember>', db,
        )
        assert saved == [{"title": "Confirm-Test-A", "type": "fact", "status": "provisional"}]

        async with db.execute("SELECT status FROM arynwood_memory WHERE title=?", ("Confirm-Test-A",)) as cur:
            row = await cur.fetchone()
        assert row["status"] == "provisional"
    finally:
        await db.close()


async def test_updating_a_confirmed_memory_via_remember_resets_to_provisional(client):
    db = await _get_db()
    try:
        await db.execute(
            "INSERT INTO arynwood_memory (type, title, content, status) VALUES ('fact','Confirm-Test-B','old','confirmed')"
        )
        await db.commit()

        await _process_memories(
            '<remember type="fact" title="Confirm-Test-B">new content</remember>', db,
        )

        async with db.execute("SELECT content, status FROM arynwood_memory WHERE title=?", ("Confirm-Test-B",)) as cur:
            row = await cur.fetchone()
        assert row["content"] == "new content"
        assert row["status"] == "provisional"
    finally:
        await db.close()


def test_unconfirmed_memory_is_labeled_in_system_prompt():
    persona = {"name": "Arynwood", "role": "Coordinator", "personality": "direct"}
    memories = [
        {"type": "fact", "title": "Confirmed one", "content": "x", "pinned": 0,
         "status": "confirmed", "updated_at": "2026-01-01"},
        {"type": "fact", "title": "Guessed one", "content": "y", "pinned": 0,
         "status": "provisional", "updated_at": "2026-01-01"},
    ]
    prompt = build_system_prompt(persona, "", memories, "")
    assert "**Confirmed one** (updated" in prompt
    assert "**Guessed one** (unconfirmed) (updated" in prompt
