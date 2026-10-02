"""
/api/gateway — the headless gateway's HTTP + WebSocket surface (backend/gateway/).

HTTP:
  POST   /inbound                     run one turn for a session (created on first contact)
  GET    /status                      what's running, queued, and waiting for approval
  GET    /sessions                    every session, most recently active first
  GET    /sessions/{key}              one session
  PUT    /sessions/{key}              create a session, or change its persona/model/server/label/trust_level
  DELETE /sessions/{key}              forget the session (its conversation stays in the history)
  POST   /sessions/{key}/reset        continue in a new conversation from the next message
  POST   /sessions/{key}/cancel       stop the turn in progress
  GET    /sessions/{key}/messages     the session's current conversation
  GET    /memory                      the file memory: MEMORY.md and the last few days' notes
  GET    /approvals                   destructive/publish tool calls waiting for a decision
  POST   /approvals/{request_id}      approve or deny one

Session keys go in the path, so a '#' (an IRC channel) is sent as %23. A session starts at
trust_level "stranger"; only PUT raises it. A message's own trust_level can only lower it.

WebSocket /ws?session=<key> — client sends {type: "subscribe"|"unsubscribe", session},
{type: "message", session, text, sender?}, {type: "approval_response", request_id, approved}
or {type: "cancel", session}. It receives every event of the sessions it follows (the chat
protocol's events, each tagged with "session", plus turn_started, approval_resolved and a
final turn_result). A connected client counts as an approver for the sessions it follows.
"""

import asyncio
import json
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from backend.db import get_db
from backend.gateway import GatewayBusy, InboundMessage, InvalidSession, get_gateway, is_daemon, sessions
from backend.gateway.runner import check_persona

router = APIRouter()


class InboundRequest(BaseModel):
    session: str
    text: str
    sender: Optional[str] = None
    source: str = "api"
    label: Optional[str] = None
    approvals: Literal["deny", "wait"] = "deny"
    trust_level: Optional[Literal["owner", "known", "stranger"]] = None  # caps this message only
    wait: bool = True       # false: return 202 at once; the result arrives as a turn_result event
    persona: Optional[str] = None
    model: Optional[str] = None
    server_id: Optional[int] = None
    project_id: Optional[int] = None


class SessionSettings(BaseModel):
    persona: Optional[str] = None
    model: Optional[str] = None
    server_id: Optional[int] = None
    project_id: Optional[int] = None
    label: Optional[str] = None
    trust_level: Optional[Literal["owner", "known", "stranger"]] = None


class ApprovalDecision(BaseModel):
    approved: bool


def _inbound(req: InboundRequest) -> InboundMessage:
    return InboundMessage(**req.model_dump(exclude={"wait"}))


@router.post("/inbound")
async def inbound(req: InboundRequest):
    gateway = get_gateway()
    try:
        sessions.validate_key(req.session)
        if not req.wait:
            gateway.submit_in_background(_inbound(req))
            return {"accepted": True, "session": req.session}
        result = await gateway.submit(_inbound(req))
    except InvalidSession as exc:
        raise HTTPException(400, str(exc))
    except GatewayBusy as exc:
        raise HTTPException(429, str(exc))
    return result.public()


@router.get("/status")
async def status(db=Depends(get_db)):
    async with db.execute("SELECT COUNT(*) FROM gateway_sessions") as cur:
        count = (await cur.fetchone())[0]
    return {"daemon": is_daemon(), "sessions": count, **get_gateway().status()}


@router.get("/sessions")
async def list_sessions(db=Depends(get_db)):
    return [s.public() for s in await sessions.list_all(db)]


async def _session_or_404(db, key: str) -> sessions.Session:
    session = await sessions.get(db, key)
    if session is None:
        raise HTTPException(404, f"No session {key}")
    return session


@router.get("/sessions/{key}")
async def get_session(key: str, db=Depends(get_db)):
    return (await _session_or_404(db, key)).public()


@router.put("/sessions/{key}")
async def put_session(key: str, body: SessionSettings, db=Depends(get_db)):
    changes = body.model_dump(exclude_unset=True)
    for required in ("persona", "trust_level"):
        if changes.get(required) is None:
            changes.pop(required, None)  # a session always has these; null means "leave it"
    try:
        sessions.validate_key(key)
        session = await sessions.get(db, key)
        if session is None:
            defaults = get_gateway().config["session_defaults"]
            settings = {name: changes.get(name, defaults.get(name)) for name in ("persona", "model", "server_id", "project_id")}
            check_persona(settings["persona"])
            session = await sessions.create(db, key, label=changes.get("label") or "", **settings)
            if "trust_level" in changes:
                session = await sessions.update(db, key, trust_level=changes["trust_level"])
        else:
            if "persona" in changes:
                check_persona(changes["persona"])
            session = await sessions.update(db, key, **changes)
    except InvalidSession as exc:
        raise HTTPException(400, str(exc))
    if "label" in changes and session.conversation_id is not None:
        await db.execute("UPDATE conversations SET title=? WHERE id=?", (session.label, session.conversation_id))
        await db.commit()
    return session.public()


@router.delete("/sessions/{key}")
async def delete_session(key: str, db=Depends(get_db)):
    if not await sessions.delete(db, key):
        raise HTTPException(404, f"No session {key}")
    return {"deleted": key}


@router.post("/sessions/{key}/reset")
async def reset_session(key: str, db=Depends(get_db)):
    await _session_or_404(db, key)
    return (await sessions.update(db, key, conversation_id=None)).public()


@router.post("/sessions/{key}/cancel")
async def cancel_session_turn(key: str):
    return {"cancelled": await get_gateway().cancel(key)}


@router.get("/sessions/{key}/messages")
async def session_messages(key: str, limit: int = 50, db=Depends(get_db)):
    session = await _session_or_404(db, key)
    if session.conversation_id is None:
        return []
    async with db.execute(
        "SELECT id, role, content, created_at FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT ?",
        (session.conversation_id, max(1, min(limit, 500))),
    ) as cur:
        rows = [dict(r) for r in await cur.fetchall()]
    return list(reversed(rows))


@router.get("/memory")
async def file_memory():
    """Read-only. The files themselves are the place to edit; this is for looking."""
    from datetime import datetime, timedelta
    memory = get_gateway().file_memory
    today = datetime.now().astimezone().date()
    days = [today - timedelta(days=n) for n in range(memory.daily_days)]
    return {"memory": memory.read_memory(),
            "daily": {day.isoformat(): memory.read_daily(day) for day in days if memory.read_daily(day)}}


@router.get("/approvals")
async def list_approvals():
    return get_gateway().pending_approvals()


@router.post("/approvals/{request_id}")
async def decide_approval(request_id: str, decision: ApprovalDecision):
    if not get_gateway().resolve_approval(request_id, decision.approved, by="http"):
        raise HTTPException(404, "No pending approval with that id")
    return {"request_id": request_id, "approved": decision.approved}


@router.websocket("/ws")
async def gateway_ws(websocket: WebSocket):
    await websocket.accept()
    gateway = get_gateway()
    initial = websocket.query_params.get("session")
    sub = gateway.subscribe({initial} if initial else set())

    async def forward():
        while True:
            await websocket.send_json(await sub.queue.get())

    sender = asyncio.create_task(forward())
    try:
        while True:
            try:
                data = json.loads(await websocket.receive_text())
                if not isinstance(data, dict):
                    raise ValueError
            except (ValueError, TypeError):
                await websocket.send_json({"type": "error", "message": "Invalid gateway message"})
                continue
            kind, key = data.get("type"), data.get("session")
            try:
                if kind in ("subscribe", "unsubscribe", "message", "cancel"):
                    sessions.validate_key(key)
                if kind == "subscribe":
                    sub.keys.add(key)
                elif kind == "unsubscribe":
                    sub.keys.discard(key)
                elif kind == "message":
                    sub.keys.add(key)  # whoever sends a message hears the reply and can approve its tool calls
                    gateway.submit_in_background(InboundMessage(
                        session=key, text=str(data.get("text") or ""), sender=data.get("sender"),
                        source=str(data.get("source") or "api"), label=data.get("label"),
                        trust_level=data.get("trust_level"),
                    ))
                elif kind == "approval_response":
                    if not gateway.resolve_approval(str(data.get("request_id")), bool(data.get("approved")), by="websocket"):
                        await websocket.send_json({"type": "error", "message": "No pending approval with that id"})
                elif kind == "cancel":
                    await websocket.send_json({"type": "cancelled", "session": key, "stopped": await gateway.cancel(key)})
                else:
                    await websocket.send_json({"type": "error", "message": f"Unknown message type: {kind}"})
            except InvalidSession as exc:
                await websocket.send_json({"type": "error", "message": str(exc)})
    except WebSocketDisconnect:
        pass
    finally:
        sender.cancel()
        gateway.unsubscribe(sub)
        await asyncio.gather(sender, return_exceptions=True)
