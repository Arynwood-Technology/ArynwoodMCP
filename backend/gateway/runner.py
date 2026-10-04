"""The gateway's turn runner: inbound messages in, agent turns out, no UI attached.

A turn is turn.run_turn: the desktop chat's prompt assembly and persistence, gated by the
session's trust level, with tools run mid-reply by the conversational loop. The runner
supplies what a desktop window used to provide implicitly:

- which conversation a message belongs to: a session key mapped to a conversation that
  survives restarts (sessions.py), and how far that session is trusted;
- ordering: one turn at a time per session, plus a global limit on turns in flight,
  because every turn lands on the same 12GB GPU (max_concurrent_turns, default 1);
- somebody to ask before a destructive or external-publish tool call. Only an owner turn
  asks at all, and only an owner-trust approver can answer. With nobody to answer, the
  timeout passed or the last approver gone, the answer is no. Nothing destructive runs
  silently.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections import defaultdict
from dataclasses import asdict, dataclass, field

from backend.db import get_db
from backend.gateway import sessions, turn
from backend.gateway.config import load_config, trust_policy
from backend.gateway.file_memory import FileMemory
from backend.gateway.sessions import InvalidSession
from backend.routers import chat
from backend.services.mcp_tool_agent import APPROVAL_TIMED_OUT, APPROVAL_UNAVAILABLE
from backend.services.tool_policy import approval_metadata

logger = logging.getLogger(__name__)

SUBSCRIBER_QUEUE_SIZE = 512


class GatewayBusy(Exception):
    """A session already has max_queued_per_session messages waiting (maps to HTTP 429)."""


@dataclass
class InboundMessage:
    """One message from outside, in the shape every adapter translates into."""
    session: str
    text: str
    source: str = "api"          # adapter that delivered it: "api", "irc", "schedule", ...
    sender: str | None = None    # who sent it, as that adapter names them
    label: str | None = None     # display name for a new session's conversation
    # "deny": a destructive/publish tool call is approved only by an attached approver
    # (a WebSocket subscriber), else denied at once. "wait": also hold it open for
    # POST /api/gateway/approvals/{id}, up to approval_timeout_seconds.
    approvals: str = "deny"
    # The trust the adapter vouches for for this one message (an IRC nick that is or isn't
    # identified right now). It can only lower the session's level, never raise it.
    trust_level: str | None = None
    # Only used when this message creates the session.
    persona: str | None = None
    model: str | None = None
    server_id: int | None = None
    project_id: int | None = None


@dataclass
class TurnResult:
    session: str
    conversation_id: int | None
    run_id: str | None
    status: str                  # completed | failed | interrupted | timeout
    reply: str                   # without any <remember> blocks
    trust_level: str = "stranger"
    error: str | None = None
    evidence: list = field(default_factory=list)

    def public(self) -> dict:
        return asdict(self)


@dataclass
class Subscription:
    """A listener for one or more sessions' events ("*" = all). An approver with owner trust
    can answer approval requests, so its presence keeps them open instead of auto-denied.
    Local WebSocket clients are owner trust: reaching the API at all takes loopback access
    (or ARYNWOOD_API_KEY). A chat-network adapter must pass the trust it has verified."""
    keys: set[str]
    approver: bool = True
    trust: str = "owner"
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(SUBSCRIBER_QUEUE_SIZE))

    def matches(self, key: str) -> bool:
        return key in self.keys or "*" in self.keys


@dataclass
class PendingApproval:
    request_id: str
    session: str
    tool: str
    arguments: dict
    tier: str
    held_for_http: bool
    created_at: float = field(default_factory=time.time)
    settled_by: str | None = None
    metadata: dict = field(default_factory=dict)
    future: asyncio.Future = field(default_factory=lambda: asyncio.get_running_loop().create_future())

    def public(self) -> dict:
        return {"request_id": self.request_id, "session": self.session, "tool": self.tool,
                "arguments": self.arguments, "tier": self.tier, "created_at": self.created_at, **self.metadata}


class _GatewaySink:
    """What a turn talks to in place of a WebSocket: collects the reply and evidence and
    forwards every event to the session's subscribers. Approvals don't come through here;
    the turn gets an approve callback (Gateway._approver) instead."""

    def __init__(self, gateway: "Gateway", key: str):
        self.gateway = gateway
        self.key = key
        self.reply = ""
        self.error: str | None = None
        self.run_id: str | None = None
        self.status: str | None = None
        self.evidence: list = []

    async def send_json(self, event: dict) -> None:
        kind = event.get("type")
        if kind == "token":
            self.reply += event.get("token", "")
        elif kind == "error":
            self.error = event.get("message")
        elif kind == "turn_completed":
            self.run_id, self.status, self.evidence = event.get("run_id"), event.get("status"), event.get("evidence") or []
        self.gateway.publish(self.key, event)

    async def receive_text(self) -> str:
        # Only reached by a code path that asks over the socket; there is no socket. Deny.
        return json.dumps({"type": "approval_response", "request_id": None, "approved": False})


class Gateway:
    def __init__(self, config: dict | None = None):
        self.config = config or load_config()
        self._turn_slots = asyncio.Semaphore(max(1, int(self.config["max_concurrent_turns"])))
        self._session_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._waiting: dict[str, int] = defaultdict(int)
        self._active: dict[str, asyncio.Task] = {}
        self._background: set[asyncio.Task] = set()
        self._subscriptions: list[Subscription] = []
        self._approvals: dict[str, PendingApproval] = {}
        self.file_memory = FileMemory(self.config.get("file_memory"))
        self.adapters: dict = {}

    # ── events ──────────────────────────────────────────────────────────────────

    def subscribe(self, keys, approver: bool = True, trust: str = "owner") -> Subscription:
        sub = Subscription(set(keys), approver, sessions.validate_trust(trust))
        self._subscriptions.append(sub)
        return sub

    def unsubscribe(self, sub: Subscription) -> None:
        if sub in self._subscriptions:
            self._subscriptions.remove(sub)
        # An approval nobody is left to answer is a no, now — not after the timeout.
        for pending in list(self._approvals.values()):
            if sub.matches(pending.session) and not pending.held_for_http and not self.has_approver(pending.session):
                self._settle(pending, False, by=APPROVAL_UNAVAILABLE)

    def publish(self, key: str, event: dict) -> None:
        tagged = {**event, "session": key}
        for sub in self._subscriptions:
            if not sub.matches(key):
                continue
            if sub.queue.full():  # a stalled listener loses its oldest events, never blocks a turn
                sub.queue.get_nowait()
            sub.queue.put_nowait(tagged)

    def has_approver(self, key: str) -> bool:
        return any(sub.approver and sub.trust == "owner" and sub.matches(key) for sub in self._subscriptions)

    # ── approvals ───────────────────────────────────────────────────────────────

    def _approver(self, key: str, hold_for_http: bool):
        """The approve callback for one owner turn: publish the request, wait for an owner's
        answer (or the timeout), and fail closed on anything else."""
        async def approve(tool: str, arguments: dict, tier: str) -> tuple[bool, str]:
            event = {"type": "approval_request", "request_id": str(uuid.uuid4()),
                     "tool": tool, "arguments": arguments, "tier": tier, **approval_metadata()}
            self.publish(key, event)
            pending = self._open_approval(key, event, hold_for_http)
            approved = await self._await_approval(pending)
            # The tool loop words its denial by this: a timeout or an absent approver isn't a "no".
            if not approved and pending.settled_by in (APPROVAL_TIMED_OUT, APPROVAL_UNAVAILABLE):
                return False, pending.settled_by
            return approved, "approved" if approved else "declined"
        return approve

    def _open_approval(self, key: str, event: dict, hold_for_http: bool) -> PendingApproval:
        pending = PendingApproval(
            request_id=event["request_id"], session=key, tool=event.get("tool", ""),
            arguments=event.get("arguments") or {}, tier=event.get("tier", ""), held_for_http=hold_for_http,
            metadata={field: event[field] for field in ("server", "intent_digest", "expires_in_seconds") if field in event},
        )
        self._approvals[pending.request_id] = pending
        if not hold_for_http and not self.has_approver(key):
            self._settle(pending, False, by=APPROVAL_UNAVAILABLE)
        return pending

    async def _await_approval(self, pending: PendingApproval) -> bool:
        try:
            return await asyncio.wait_for(asyncio.shield(pending.future), self.config["approval_timeout_seconds"])
        except asyncio.TimeoutError:
            self._settle(pending, False, by=APPROVAL_TIMED_OUT)
            return False
        except asyncio.CancelledError:
            self._settle(pending, False, by="turn stopped")
            raise
        finally:
            self._approvals.pop(pending.request_id, None)

    def _settle(self, pending: PendingApproval, approved: bool, by: str) -> bool:
        if pending.future.done():
            return False
        pending.settled_by = by
        pending.future.set_result(approved)
        logger.info("gateway approval %s for %s (%s) in %s: %s by %s", pending.request_id, pending.tool,
                    pending.tier, pending.session, "approved" if approved else "denied", by)
        self.publish(pending.session, {"type": "approval_resolved", "request_id": pending.request_id,
                                       "tool": pending.tool, "approved": approved, "by": by})
        return True

    def pending_approvals(self) -> list[dict]:
        return [p.public() for p in self._approvals.values() if not p.future.done()]

    def resolve_approval(self, request_id: str, approved: bool, by: str = "api", trust: str = "owner") -> bool:
        """Answer a pending approval. False if there's no such request, it's already settled,
        or the answer doesn't come with owner trust (which is refused and logged, never counted)."""
        pending = self._approvals.get(request_id)
        if not pending:
            return False
        if type(approved) is not bool:
            return False
        if trust != "owner":
            logger.warning("gateway approval %s for %s: refused an answer from %s at %s trust",
                           request_id, pending.tool, by, trust)
            return False
        return self._settle(pending, bool(approved), by=by)

    # ── turns ───────────────────────────────────────────────────────────────────

    async def submit(self, msg: InboundMessage) -> TurnResult:
        """Run one turn for msg.session and return its result. Turns for the same session
        run strictly in order; at most max_concurrent_turns run at once overall."""
        sessions.validate_key(msg.session)
        if not (msg.text or "").strip():
            raise InvalidSession("Message text is empty")
        if msg.approvals not in ("deny", "wait"):
            raise InvalidSession('approvals must be "deny" or "wait"')
        if msg.trust_level is not None:
            sessions.validate_trust(msg.trust_level)
        key = msg.session
        if self._waiting[key] >= int(self.config["max_queued_per_session"]):
            raise GatewayBusy(f"Session {key} already has {self._waiting[key]} messages waiting")
        self._waiting[key] += 1
        queued = True
        try:
            async with self._session_locks[key]:
                self._waiting[key] -= 1
                queued = False
                async with self._turn_slots:
                    return await self._run(msg)
        finally:
            if queued:
                self._waiting[key] -= 1

    def submit_in_background(self, msg: InboundMessage) -> asyncio.Task:
        """Run a turn that outlives whoever asked for it (a WebSocket that disconnects, an
        HTTP call with wait=false). Its result is published as a turn_result event."""
        async def run():
            try:
                result = await self.submit(msg)
            except (InvalidSession, GatewayBusy) as exc:
                self.publish(msg.session, {"type": "error", "message": str(exc)})
                return
            except Exception as exc:
                logger.exception("gateway turn for %s failed", msg.session)
                self.publish(msg.session, {"type": "error", "message": str(exc)})
                return
            self.publish(msg.session, {"type": "turn_result", **result.public()})

        return self._spawn(run())

    def _spawn(self, coro) -> asyncio.Task:
        """A task the gateway owns: kept referenced while it runs, cancelled on shutdown."""
        task = asyncio.create_task(coro)
        self._background.add(task)
        task.add_done_callback(self._background.discard)
        return task

    async def _write_memory(self, key: str, user_text: str, reply: str) -> None:
        try:
            written = await self.file_memory.write_back(user_text, reply, key)
        except Exception:
            logger.exception("file memory write-back for %s failed", key)
            return
        if written["durable"] or written["today"]:
            self.publish(key, {"type": "memory_written", **written})

    async def ensure_session(self, key: str, *, persona: str, label: str, trust_level: str,
                             source: str, enforce_trust: bool = False) -> sessions.Session:
        """For adapters: create a session with the trust its config gives it. enforce_trust also
        resets an existing session to that level (a configured IRC channel, on every connect),
        since the adapter's config file is the owner's word for those sessions."""
        sessions.validate_key(key)
        sessions.validate_trust(trust_level)
        db_gen = get_db()
        db = await anext(db_gen)
        try:
            session = await sessions.get(db, key)
            if session is None:
                check_persona(persona)
                await sessions.create(db, key, persona=persona, source=source, label=label)
                return await sessions.update(db, key, trust_level=trust_level)
            if enforce_trust and session.trust_level != trust_level:
                return await sessions.update(db, key, trust_level=trust_level)
            return session
        finally:
            await db_gen.aclose()

    async def start_adapters(self) -> None:
        """Connect the chat networks configured for this daemon (only `irc` so far). A broken
        adapter config is logged and skipped; it never stops the gateway from starting."""
        irc_config = self.config.get("irc") or {}
        if irc_config.get("enabled"):
            from backend.gateway.irc import IrcAdapter, IrcConfigError
            try:
                adapter = IrcAdapter(self, irc_config)
            except (IrcConfigError, InvalidSession) as exc:
                logger.error("irc adapter not started: %s", exc)
                self.adapters["irc"] = {"error": str(exc)}
                return
            adapter.start()
            self.adapters["irc"] = adapter

    async def cancel(self, key: str) -> bool:
        task = self._active.get(key)
        if not task:
            return False
        task.cancel()
        await asyncio.wait({task}, timeout=10)
        return True

    async def _run(self, msg: InboundMessage) -> TurnResult:
        db_gen = get_db()
        db = await anext(db_gen)
        try:
            session = await self._session_for(db, msg)
            trust = sessions.effective_trust(session.trust_level, msg.trust_level)
            policy = trust_policy(self.config, trust)
            memory_config = self.config.get("file_memory") or {}
            uses_files = session.persona in (memory_config.get("personas") or [])
            sink = _GatewaySink(self, session.key)
            self.publish(session.key, {"type": "turn_started", "conversation_id": session.conversation_id,
                                       "sender": msg.sender, "trust_level": trust})
            task = asyncio.create_task(turn.run_turn(
                sink, db, session=session, msg=msg, trust=trust, policy=policy,
                approve=self._approver(session.key, hold_for_http=msg.approvals == "wait"),
                file_memory=self.file_memory if uses_files and policy["memories"] else None,
                memory_share=float(memory_config.get("context_share", 0.15)),
            ))
            self._active[session.key] = task
            status = None
            try:
                done, _ = await asyncio.wait({task}, timeout=self.config["turn_timeout_seconds"])
                if not done:
                    status = "timeout"
                    task.cancel()
                    await asyncio.wait({task}, timeout=10)
            except asyncio.CancelledError:
                # The gateway itself is shutting down: stop the turn (its partial reply is
                # saved by _run_turn's own cancellation handling) and keep unwinding.
                task.cancel()
                await asyncio.wait({task}, timeout=10)
                raise
            finally:
                self._active.pop(session.key, None)

            if status is None:
                if task.cancelled():
                    status = "interrupted"
                elif task.exception() is not None:
                    status, sink.error = "failed", str(task.exception())
                else:
                    status = sink.status or ("failed" if sink.error else "completed")
            await sessions.touch(db, session.key, last_sender=msg.sender, last_source=msg.source)
            if status == "completed" and uses_files and policy["memory_writes"] and sink.reply.strip():
                # After the reply, not before it: the write-back may make one more model call.
                self._spawn(self._write_memory(session.key, msg.text, sink.reply))
            return TurnResult(session=session.key, conversation_id=session.conversation_id, run_id=sink.run_id,
                              status=status, reply=chat._REMEMBER_RE.sub("", sink.reply).strip(),
                              trust_level=trust, error=sink.error, evidence=sink.evidence)
        finally:
            await db_gen.aclose()

    async def _session_for(self, db, msg: InboundMessage) -> sessions.Session:
        """The session for msg, created on first contact, with a live conversation."""
        session = await sessions.get(db, msg.session)
        if session is None:
            defaults = self.config["session_defaults"]
            settings = {name: getattr(msg, name) if getattr(msg, name) is not None else defaults.get(name)
                        for name in ("persona", "model", "server_id", "project_id")}
            check_persona(settings["persona"])
            session = await sessions.create(db, msg.session, source=msg.source, label=msg.label or "", **settings)
        else:
            check_persona(session.persona)  # removed from models.json since: fail loudly, don't guess
        return await ensure_conversation(db, session)

    # ── lifecycle ───────────────────────────────────────────────────────────────

    def status(self) -> dict:
        return {
            "active_turns": sorted(self._active),
            "queued": {k: n for k, n in self._waiting.items() if n},
            "pending_approvals": len(self.pending_approvals()),
            "subscribers": len(self._subscriptions),
            "max_concurrent_turns": self.config["max_concurrent_turns"],
            "adapters": {name: a if isinstance(a, dict) else a.status() for name, a in self.adapters.items()},
        }

    async def shutdown(self) -> None:
        for adapter in list(self.adapters.values()):
            if not isinstance(adapter, dict):
                await adapter.stop()
        self.adapters.clear()
        tasks = list(self._background) + list(self._active.values())
        for pending in list(self._approvals.values()):
            self._settle(pending, False, by="gateway shutting down")
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.wait(tasks, timeout=15)


def check_persona(persona_key: str) -> None:
    persona = chat.get_personas().get(persona_key)
    if not persona or "llm" not in persona:
        raise InvalidSession(f"Unknown persona: {persona_key}")


async def ensure_conversation(db, session: sessions.Session) -> sessions.Session:
    """Give the session a conversation if it has none, or if its conversation was deleted
    (from the desktop's conversation list, say) since the last turn."""
    if session.conversation_id is not None:
        async with db.execute("SELECT 1 FROM conversations WHERE id=?", (session.conversation_id,)) as cur:
            if await cur.fetchone():
                return session
    persona = chat.get_personas().get(session.persona, {})
    model = session.model or persona.get("llm", {}).get("model", "hermes3:8b")  # same fallback as _execute_turn
    conversation_id = await chat.ensure_conversation(db, session.persona, model, session.project_id)
    await db.execute("UPDATE conversations SET title=? WHERE id=?", (session.label or session.key, conversation_id))
    await db.commit()
    return await sessions.update(db, session.key, conversation_id=conversation_id)


_instance: Gateway | None = None


def get_gateway() -> Gateway:
    global _instance
    if _instance is None:
        _instance = Gateway()
    return _instance


async def shutdown_gateway() -> None:
    global _instance
    if _instance is not None:
        await _instance.shutdown()
        _instance = None
