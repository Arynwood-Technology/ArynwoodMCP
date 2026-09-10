"""Minimal project CRUD (roadmap 4.1) — the connective tissue that lets a
conversation, memory, or knowledge source declare which project they belong to.
Deliberately does not touch lora_projects/content_projects/music_assets — those
already work standalone; unifying them is a separate, larger initiative."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.db import get_db

router = APIRouter()


class ProjectCreate(BaseModel):
    name: str
    description: str = ""


class ProjectUpdate(BaseModel):
    name: str
    description: str = ""


@router.get("")
async def list_projects(db=Depends(get_db)):
    async with db.execute("SELECT * FROM projects ORDER BY updated_at DESC") as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.post("")
async def create_project(body: ProjectCreate, db=Depends(get_db)):
    cur = await db.execute(
        "INSERT INTO projects (name, description) VALUES (?,?)", (body.name, body.description)
    )
    await db.commit()
    async with db.execute("SELECT * FROM projects WHERE id=?", (cur.lastrowid,)) as c:
        row = await c.fetchone()
    return dict(row)


@router.put("/{project_id}")
async def update_project(project_id: int, body: ProjectUpdate, db=Depends(get_db)):
    await db.execute(
        "UPDATE projects SET name=?, description=?, updated_at=datetime('now') WHERE id=?",
        (body.name, body.description, project_id),
    )
    await db.commit()
    async with db.execute("SELECT * FROM projects WHERE id=?", (project_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Project not found")
    return dict(row)


@router.delete("/{project_id}")
async def delete_project(project_id: int, db=Depends(get_db)):
    """Deletes the project itself only — conversations/memories/knowledge sources
    linked to it keep their project_id (now pointing at a deleted row) rather than
    being deleted or silently reassigned; the frontend treats an unresolvable
    project_id the same as no project."""
    await db.execute("DELETE FROM projects WHERE id=?", (project_id,))
    await db.commit()
    return {"deleted": project_id}


@router.get("/{project_id}/summary")
async def project_summary(project_id: int, db=Depends(get_db)):
    """Counts only — enough for a project switcher to show what's attached to a
    project without each caller re-implementing the same three counts."""
    async with db.execute("SELECT * FROM projects WHERE id=?", (project_id,)) as cur:
        project = await cur.fetchone()
    if not project:
        raise HTTPException(404, "Project not found")

    async def _count(table: str) -> int:
        async with db.execute(f"SELECT COUNT(*) AS n FROM {table} WHERE project_id=?", (project_id,)) as cur:
            row = await cur.fetchone()
        return row["n"]

    return {
        "project": dict(project),
        "conversations": await _count("conversations"),
        "memories": await _count("arynwood_memory"),
        "knowledge_sources": await _count("knowledge_sources"),
    }
