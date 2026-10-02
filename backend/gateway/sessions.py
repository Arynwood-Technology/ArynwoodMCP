"""Gateway sessions: one persistent session per outside conversation.

A session key names who the agent is talking to ("api:notes", "irc:<network>:#channel",
"irc:<network>:<nick>", "schedule:<job>"). Each key maps to one row in `conversations`, so
history, the running summary, chat runs and evidence all use the machinery the desktop chat
already has, and the conversation shows up in the desktop's conversation list. The mapping
lives in SQLite (`gateway_sessions`), so it survives restarts.

Deleting a session drops only the mapping; its conversation stays in the history. Resetting
one starts a new conversation on the next message, like "/new".

Every session has a trust level: owner, known or stranger (the default). It decides what
private context and which tools a turn gets (`trust_levels` in the gateway config). Only the
owner sets it, through the API. An adapter can pass a lower level for one message (an IRC nick
that isn't verified right now), never a higher one: see effective_trust().
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field

# No whitespace (keys arrive from chat protocols that split on it), and no '/', '?' or '%' so
# a key is one URL path segment. '#' is allowed for IRC channels; HTTP clients send it as %23.
SESSION_KEY_RE = re.compile(r"^[^\s/?%]{1,200}$")

_COLUMNS = ("key", "conversation_id", "persona", "model", "server_id", "project_id",
            "label", "source", "meta", "created_at", "last_active_at", "trust_level")
SETTINGS = ("persona", "model", "server_id", "project_id", "label", "trust_level")

# Least to most trusted.
TRUST_LEVELS = ("stranger", "known", "owner")


class InvalidSession(ValueError):
    """A session key or setting the gateway can't use (maps to HTTP 400)."""


@dataclass
class Session:
    key: str
    persona: str
    conversation_id: int | None = None
    model: str | None = None
    server_id: int | None = None
    project_id: int | None = None
    label: str = ""
    source: str = "api"
    meta: dict = field(default_factory=dict)
    created_at: str | None = None
    last_active_at: str | None = None
    trust_level: str = "stranger"

    def public(self) -> dict:
        return asdict(self)


def validate_key(key: str) -> str:
    if not isinstance(key, str) or not SESSION_KEY_RE.match(key):
        raise InvalidSession("Session key must be 1-200 characters with no spaces, '/', '?' or '%'")
    return key


def validate_trust(level: str) -> str:
    if level not in TRUST_LEVELS:
        raise InvalidSession(f"trust_level must be one of {', '.join(TRUST_LEVELS)}")
    return level


def effective_trust(session_level: str, message_level: str | None = None) -> str:
    """The trust a turn runs at: the session's level, lowered (never raised) by the level an
    adapter vouches for this particular message. Anything unrecognized counts as stranger."""
    levels = [session_level] + ([message_level] if message_level is not None else [])
    return min((lvl if lvl in TRUST_LEVELS else "stranger" for lvl in levels), key=TRUST_LEVELS.index)


def _row_to_session(row) -> Session:
    data = dict(zip(_COLUMNS, row))
    try:
        data["meta"] = json.loads(data.get("meta") or "{}")
    except ValueError:
        data["meta"] = {}
    return Session(**data)


async def get(db, key: str) -> Session | None:
    async with db.execute(f"SELECT {', '.join(_COLUMNS)} FROM gateway_sessions WHERE key=?", (key,)) as cur:
        row = await cur.fetchone()
    return _row_to_session(row) if row else None


async def list_all(db) -> list[Session]:
    async with db.execute(
        f"SELECT {', '.join(_COLUMNS)} FROM gateway_sessions ORDER BY COALESCE(last_active_at, created_at) DESC"
    ) as cur:
        return [_row_to_session(r) for r in await cur.fetchall()]


async def create(db, key: str, *, persona: str, source: str = "api", label: str = "", **settings) -> Session:
    validate_key(key)
    await db.execute(
        "INSERT INTO gateway_sessions (key, persona, model, server_id, project_id, label, source) "
        "VALUES (?,?,?,?,?,?,?)",
        (key, persona, settings.get("model"), settings.get("server_id"), settings.get("project_id"),
         label or key, source),
    )
    await db.commit()
    return await get(db, key)


async def update(db, key: str, **changes) -> Session | None:
    allowed = {k: v for k, v in changes.items() if k in SETTINGS + ("conversation_id", "meta")}
    if "trust_level" in allowed:
        validate_trust(allowed["trust_level"])
    if allowed:
        if "meta" in allowed:
            allowed["meta"] = json.dumps(allowed["meta"])
        assignments = ", ".join(f"{k}=?" for k in allowed)
        await db.execute(f"UPDATE gateway_sessions SET {assignments} WHERE key=?", (*allowed.values(), key))
        await db.commit()
    return await get(db, key)


async def touch(db, key: str, **meta) -> None:
    """Stamp last activity; merge anything in `meta` (e.g. last_sender) into the session's meta."""
    session = await get(db, key)
    if session is None:
        return
    await db.execute(
        "UPDATE gateway_sessions SET last_active_at=datetime('now'), meta=? WHERE key=?",
        (json.dumps({**session.meta, **meta}), key),
    )
    await db.commit()


async def delete(db, key: str) -> bool:
    cur = await db.execute("DELETE FROM gateway_sessions WHERE key=?", (key,))
    await db.commit()
    return cur.rowcount > 0
