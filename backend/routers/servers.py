import os
from typing import Optional
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException
import httpx
from pydantic import BaseModel, Field
from typing import Literal
from backend.services import providers
from backend.db import get_db

router = APIRouter()

# Which server chat uses until the owner picks another (seeded '1', Local Ollama).
DEFAULT_SERVER_SETTING = "default_server_id"


class ServerCreate(BaseModel):
    name: str
    host: str
    port: int = 11434
    type: str = "ollama"
    auth_token: Optional[str] = None
    context_window: int = Field(default=8192, ge=2048, le=1048576)
    tools_mode: Literal["native", "text_json", "none"] = "native"
    model: Optional[str] = None


class ServerUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    type: Optional[str] = None
    auth_token: Optional[str] = None
    enabled: Optional[int] = None
    context_window: Optional[int] = Field(default=None, ge=2048, le=1048576)
    tools_mode: Optional[Literal["native", "text_json", "none"]] = None
    model: Optional[str] = None


class DefaultServer(BaseModel):
    server_id: int


def public_row(row) -> dict:
    """A server row for the UI: the token stays on the backend (providers.py adds it to each
    request), so the page only learns whether one is set."""
    server = dict(row)
    server["has_token"] = bool(server.pop("auth_token", None))
    return server


def request_headers(server: dict) -> dict:
    return {"Authorization": f"Bearer {server['auth_token']}"} if server.get("auth_token") else {}


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


async def _get_server(db, server_id: int) -> dict:
    async with db.execute("SELECT * FROM servers WHERE id=?", (server_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Server not found")
    return dict(row)


async def _set_default(db, server_id: int) -> None:
    await db.execute(
        "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (DEFAULT_SERVER_SETTING, str(server_id)))
    await db.commit()


@router.get("")
async def list_servers(db=Depends(get_db)):
    """GET /servers — return all registered Ollama/OpenAI servers (tokens left out)."""
    async with db.execute("SELECT * FROM servers ORDER BY id") as cur:
        rows = await cur.fetchall()
    return [public_row(r) for r in rows]


@router.post("")
async def create_server(body: ServerCreate, db=Depends(get_db)):
    """POST /servers — register a new model server and return the created row."""
    await db.execute(
        "INSERT INTO servers (name, host, port, type, auth_token, context_window, tools_mode, model) VALUES (?,?,?,?,?,?,?,?)",
        (body.name, body.host, body.port, body.type, body.auth_token or None, body.context_window, body.tools_mode,
         body.model or None)
    )
    await db.commit()
    async with db.execute("SELECT * FROM servers WHERE id = last_insert_rowid()") as cur:
        row = await cur.fetchone()
    return public_row(row)


# Declared before /{server_id}: that route's int parameter would answer "default" with a 422.
@router.get("/default")
async def get_default_server(db=Depends(get_db)):
    """GET /servers/default — the server chat uses until the owner picks another: their last
    choice, an installer's preset endpoint, or Local Ollama. Falls back to the first enabled
    server when the saved one is gone or disabled."""
    async with db.execute("SELECT value FROM settings WHERE key=?", (DEFAULT_SERVER_SETTING,)) as cur:
        row = await cur.fetchone()
    saved = int(row["value"]) if row and str(row["value"]).isdigit() else None
    async with db.execute("SELECT * FROM servers WHERE enabled=1 ORDER BY (id = ?) DESC, id LIMIT 1", (saved,)) as cur:
        server = await cur.fetchone()
    return {"server": public_row(server) if server else None}


@router.put("/default")
async def put_default_server(body: DefaultServer, db=Depends(get_db)):
    """PUT /servers/default — remember the server chat uses, across launches."""
    server = await _get_server(db, body.server_id)
    if not server["enabled"]:
        raise HTTPException(400, "That server is disabled")
    await _set_default(db, body.server_id)
    return {"server": public_row(server)}


@router.get("/{server_id}")
async def get_server(server_id: int, db=Depends(get_db)):
    """GET /servers/{id} — fetch a single server record by ID."""
    return public_row(await _get_server(db, server_id))


@router.patch("/{server_id}")
async def update_server(server_id: int, body: ServerUpdate, db=Depends(get_db)):
    """PATCH /servers/{id} — update non-null fields on a server record. An empty model
    clears it (back to each persona's own model)."""
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "No fields to update")
    if "model" in fields:
        fields["model"] = fields["model"].strip() or None
    set_clause = ", ".join(f"{k}=?" for k in fields)
    await db.execute(
        f"UPDATE servers SET {set_clause} WHERE id=?",
        (*fields.values(), server_id)
    )
    await db.commit()
    return public_row(await _get_server(db, server_id))


@router.delete("/{server_id}")
async def delete_server(server_id: int, db=Depends(get_db)):
    """DELETE /servers/{id} — remove a server record."""
    await db.execute("DELETE FROM servers WHERE id=?", (server_id,))
    await db.commit()
    return {"deleted": server_id}


@router.get("/{server_id}/ping")
async def ping(server_id: int, db=Depends(get_db)):
    """GET /servers/{id}/ping — probe a registered server and return its online status."""
    s = await _get_server(db, server_id)
    result = await ping_server(s["host"], s["port"], s["type"], s.get("auth_token"))
    return result


@router.get("/{server_id}/models")
async def list_server_models(server_id: int, db=Depends(get_db)):
    """GET /servers/{id}/models — {models: [{name, ...}]} from any registered server:
    Ollama's /api/tags, or an OpenAI-compatible /v1/models (ids become names)."""
    server = await _get_server(db, server_id)
    base = providers.base_url(server)
    url = f"{base}/api/tags" if server["type"] == "ollama" else providers.endpoint(server, "models")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(url, headers=request_headers(server))
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Can't reach {server['name']}: {type(e).__name__}")
    if r.status_code != 200:
        raise HTTPException(502, f"{server['name']} answered HTTP {r.status_code} when asked for its models")
    data = r.json()
    if server["type"] == "ollama":
        return {"models": data.get("models", [])}
    return {"models": [{"name": m["id"]} for m in data.get("data", []) if isinstance(m, dict) and m.get("id")]}


# ── Installer preset ────────────────────────────────────────────────────────────

def _preset_from_env() -> dict | None:
    url = os.environ.get("ARYNWOOD_ENDPOINT_URL", "").strip()
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return None
    kind = os.environ.get("ARYNWOOD_ENDPOINT_TYPE", "openai-compatible").strip() or "openai-compatible"
    return {
        "name": os.environ.get("ARYNWOOD_ENDPOINT_NAME", "").strip() or "Remote endpoint",
        "host": url.rstrip("/"),
        "port": parsed.port or (443 if parsed.scheme == "https" else 80),
        "type": kind if kind in ("ollama", "openai-compatible") else "openai-compatible",
        "auth_token": os.environ.get("ARYNWOOD_ENDPOINT_TOKEN", "").strip() or None,
        "model": os.environ.get("ARYNWOOD_ENDPOINT_MODEL", "").strip() or None,
        "image_model": os.environ.get("ARYNWOOD_ENDPOINT_IMAGE_MODEL", "").strip() or None,
    }


async def apply_preset(db) -> int | None:
    """Register the endpoint an installer put in the backend's .env (ARYNWOOD_ENDPOINT_URL,
    _TYPE, _TOKEN, _MODEL, _IMAGE_MODEL, _NAME). The first time, it also becomes chat's default
    server, and image generation's endpoint when an image model is given. After that the
    owner's choices stand; a later run only refreshes the token, type and models. Returns the
    server id, or None without a preset."""
    preset = _preset_from_env()
    if not preset:
        return None
    async with db.execute("SELECT id FROM servers WHERE host=?", (preset["host"],)) as cur:
        row = await cur.fetchone()
    if row:
        server_id = row["id"]
        await db.execute(
            "UPDATE servers SET type=?, auth_token=COALESCE(?, auth_token), model=COALESCE(?, model) WHERE id=?",
            (preset["type"], preset["auth_token"], preset["model"], server_id))
        await db.commit()
        return server_id
    cur = await db.execute(
        "INSERT INTO servers (name, host, port, type, auth_token, model) VALUES (?,?,?,?,?,?)",
        (preset["name"], preset["host"], preset["port"], preset["type"], preset["auth_token"], preset["model"]))
    server_id = cur.lastrowid
    await db.commit()
    await _set_default(db, server_id)
    if preset["image_model"] and preset["type"] == "openai-compatible":
        from backend.routers import images
        await images.save_config(db, server_id, preset["image_model"])
    return server_id
