from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from backend.db import get_db
from backend.services import memory_index

router = APIRouter()


class MemoryCreate(BaseModel):
    type: str = "note"   # project | idea | decision | fact | note
    title: str
    content: str
    pinned: int = 0
    status: str = "confirmed"        # confirmed | provisional — provenance/trust
    volatility: str = "durable"      # durable | transient — independent of status; see db.py migration
    project_id: int | None = None    # roadmap 4.1


class MemoryUpdate(BaseModel):
    type: str
    title: str
    content: str
    pinned: int = 0
    status: str = "confirmed"
    volatility: str = "durable"
    project_id: int | None = None


@router.get("")
async def list_memories(db=Depends(get_db)):
    """Return all Arynwood memory entries, pinned first then newest first."""
    async with db.execute(
        "SELECT * FROM arynwood_memory ORDER BY pinned DESC, updated_at DESC"
    ) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.post("")
async def create_memory(body: MemoryCreate, db=Depends(get_db)):
    """Insert a new memory entry and return the created row."""
    await db.execute(
        "INSERT INTO arynwood_memory (type, title, content, pinned, status, volatility, project_id) VALUES (?,?,?,?,?,?,?)",
        (body.type, body.title, body.content, body.pinned, body.status, body.volatility, body.project_id),
    )
    await db.commit()
    async with db.execute("SELECT * FROM arynwood_memory WHERE id = last_insert_rowid()") as cur:
        row = await cur.fetchone()
    await memory_index.index_memory(row["id"], row["title"], row["content"])
    return dict(row)


@router.put("/{memory_id}")
async def update_memory(memory_id: int, body: MemoryUpdate, db=Depends(get_db)):
    """Update an existing memory entry by ID."""
    await db.execute(
        "UPDATE arynwood_memory SET type=?, title=?, content=?, pinned=?, status=?, volatility=?, project_id=?, updated_at=datetime('now') WHERE id=?",
        (body.type, body.title, body.content, body.pinned, body.status, body.volatility, body.project_id, memory_id),
    )
    await db.commit()
    async with db.execute("SELECT * FROM arynwood_memory WHERE id=?", (memory_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Memory not found")
    await memory_index.index_memory(row["id"], row["title"], row["content"])
    return dict(row)


@router.post("/{memory_id}/confirm")
async def confirm_memory(memory_id: int, db=Depends(get_db)):
    """Mark a model-written ('provisional') memory as reviewed and trusted.

    Arynwood's system prompt tells it to write <remember> blocks proactively, and
    chat.py saves every one automatically — this is the human-in-the-loop step
    that turns "the model claimed this" into "the user confirmed this," without
    which a hallucinated fact would be indistinguishable from a real one the next
    time it's re-injected into a system prompt.
    """
    await db.execute(
        "UPDATE arynwood_memory SET status='confirmed', updated_at=datetime('now') WHERE id=?",
        (memory_id,),
    )
    await db.commit()
    async with db.execute("SELECT * FROM arynwood_memory WHERE id=?", (memory_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Memory not found")
    return dict(row)


@router.delete("/{memory_id}")
async def delete_memory(memory_id: int, db=Depends(get_db)):
    """Delete a memory entry by ID."""
    await db.execute("DELETE FROM arynwood_memory WHERE id=?", (memory_id,))
    await db.commit()
    await memory_index.delete_memory_index(memory_id)
    return {"deleted": memory_id}
