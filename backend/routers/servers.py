import asyncio
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
import httpx
from pydantic import BaseModel, Field
from typing import Literal
from backend.services import providers
from backend.db import get_db

router = APIRouter()


class ServerCreate(BaseModel):
    name: str
    host: str
    port: int = 11434
    type: str = "ollama"
    auth_token: Optional[str] = None
    context_window: int = Field(default=8192, ge=2048, le=1048576)
    tools_mode: Literal["native", "text_json", "none"] = "native"


class ServerUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    type: Optional[str] = None
    auth_token: Optional[str] = None
    enabled: Optional[int] = None
    context_window: Optional[int] = Field(default=None, ge=2048, le=1048576)
    tools_mode: Optional[Literal["native", "text_json", "none"]] = None


async def ping_server(host: str, port: int, type: str, auth_token: Optional[str] = None) -> dict:
    """Check reachability of an Ollama or OpenAI-compatible server; returns {online, latency_ms}."""
    url = providers.base_url({"host": host, "port": port})
    try:
        headers = {}
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"
        endpoint = f"{url}/api/tags" if type == "ollama" else providers.endpoint({"host": host, "port": port}, "models")
        async with httpx.AsyncClient() as client:
            r = await client.get(endpoint, headers=headers, timeout=3.0)
            return {"online": 200 <= r.status_code < 300, "latency_ms": None}
    except Exception:
        return {"online": False, "latency_ms": None}


@router.get("")
async def list_servers(db=Depends(get_db)):
    """GET /servers — return all registered Ollama/OpenAI servers."""
    async with db.execute("SELECT * FROM servers ORDER BY id") as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.post("")
async def create_server(body: ServerCreate, db=Depends(get_db)):
    """POST /servers — register a new model server and return the created row."""
    await db.execute(
        "INSERT INTO servers (name, host, port, type, auth_token, context_window, tools_mode) VALUES (?,?,?,?,?,?,?)",
        (body.name, body.host, body.port, body.type, body.auth_token, body.context_window, body.tools_mode)
    )
    await db.commit()
    async with db.execute("SELECT * FROM servers WHERE id = last_insert_rowid()") as cur:
        row = await cur.fetchone()
    return dict(row)


@router.get("/{server_id}")
async def get_server(server_id: int, db=Depends(get_db)):
    """GET /servers/{id} — fetch a single server record by ID."""
    async with db.execute("SELECT * FROM servers WHERE id=?", (server_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Server not found")
    return dict(row)


@router.patch("/{server_id}")
async def update_server(server_id: int, body: ServerUpdate, db=Depends(get_db)):
    """PATCH /servers/{id} — update non-null fields on a server record."""
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "No fields to update")
    set_clause = ", ".join(f"{k}=?" for k in fields)
    await db.execute(
        f"UPDATE servers SET {set_clause} WHERE id=?",
        (*fields.values(), server_id)
    )
    await db.commit()
    async with db.execute("SELECT * FROM servers WHERE id=?", (server_id,)) as cur:
        row = await cur.fetchone()
    return dict(row)


@router.delete("/{server_id}")
async def delete_server(server_id: int, db=Depends(get_db)):
    """DELETE /servers/{id} — remove a server record."""
    await db.execute("DELETE FROM servers WHERE id=?", (server_id,))
    await db.commit()
    return {"deleted": server_id}


@router.get("/{server_id}/ping")
async def ping(server_id: int, db=Depends(get_db)):
    """GET /servers/{id}/ping — probe a registered server and return its online status."""
    async with db.execute("SELECT * FROM servers WHERE id=?", (server_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Server not found")
    s = dict(row)
    result = await ping_server(s["host"], s["port"], s["type"], s.get("auth_token"))
    return result
