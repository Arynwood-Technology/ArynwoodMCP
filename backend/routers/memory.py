from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from backend.db import get_db
from backend.services import memory_index, memory_store, index_jobs

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
    memories = [dict(r) for r in rows]
    for memory in memories:
        async with db.execute("SELECT * FROM memory_revisions WHERE memory_id=? AND state='pending' ORDER BY id DESC LIMIT 1", (memory['id'],)) as cur:
            revision = await cur.fetchone()
        memory['pending_revision'] = dict(revision) if revision else None
    return memories


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
    await index_jobs.enqueue(db, "memory", row["id"], {"content": row["content"], "title": row["title"]})
    await db.commit()
    return dict(row)


@router.put("/{memory_id}")
async def update_memory(memory_id: int, body: MemoryUpdate, db=Depends(get_db)):
    """Update an existing memory entry by ID."""
    async with db.execute("SELECT * FROM arynwood_memory WHERE id=?", (memory_id,)) as cur:
        old = await cur.fetchone()
    if old is None:
        raise HTTPException(404, "Memory not found")
    await memory_store.snapshot(db, dict(old))
    await db.execute(
        "UPDATE arynwood_memory SET type=?, title=?, content=?, pinned=?, status=?, volatility=?, project_id=?, updated_at=datetime('now') WHERE id=?",
        (body.type, body.title, body.content, body.pinned, body.status, body.volatility, body.project_id, memory_id),
    )
    await db.commit()
    async with db.execute("SELECT * FROM arynwood_memory WHERE id=?", (memory_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Memory not found")
    await index_jobs.enqueue(db, "memory", row["id"], {"content": row["content"], "title": row["title"]})
    await db.commit()
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
    await db.execute("DELETE FROM memory_revisions WHERE memory_id=?", (memory_id,))
    await index_jobs.enqueue(db, "memory", memory_id)
    await db.commit()
    return {"deleted": memory_id}


@router.get("/{memory_id}/revisions")
async def memory_revisions(memory_id: int, db=Depends(get_db)):
    async with db.execute("SELECT * FROM memory_revisions WHERE memory_id=? ORDER BY id DESC", (memory_id,)) as cur:
        return [dict(r) for r in await cur.fetchall()]


@router.post("/{memory_id}/revisions/{revision_id}/accept")
async def accept_revision(memory_id: int, revision_id: int, db=Depends(get_db)):
    await db.execute("BEGIN IMMEDIATE")
    async with db.execute("SELECT * FROM arynwood_memory WHERE id=?", (memory_id,)) as cur:
        memory = await cur.fetchone()
    async with db.execute("SELECT * FROM memory_revisions WHERE id=? AND memory_id=? AND state='pending'", (revision_id, memory_id)) as cur:
        revision = await cur.fetchone()
    if not memory or not revision:
        raise HTTPException(404, "Memory or pending revision not found")
    if memory['content'] != revision['base_content']:
        raise HTTPException(409, "This memory changed since the proposal. Review a new revision.")
    await memory_store.snapshot(db, dict(memory))
    await db.execute("UPDATE arynwood_memory SET content=?,type=?,volatility=?,status='confirmed',conflict_with_id=NULL,updated_at=datetime('now') WHERE id=?",
                     (revision['content'], revision['type'], revision['volatility'], memory_id))
    await db.execute("UPDATE memory_revisions SET state='accepted' WHERE id=?", (revision_id,))
    await index_jobs.enqueue(db, 'memory', memory_id, {'content': revision['content'], 'title': memory['title']})
    await db.commit()
    return {"accepted": revision_id}


@router.post("/{memory_id}/revisions/{revision_id}/reject")
async def reject_revision(memory_id: int, revision_id: int, db=Depends(get_db)):
    cur = await db.execute("UPDATE memory_revisions SET state='rejected' WHERE id=? AND memory_id=? AND state='pending'", (revision_id, memory_id))
    await db.commit()
    if not cur.rowcount:
        raise HTTPException(404, "Pending revision not found")
    return {"rejected": revision_id}
