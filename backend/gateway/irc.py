"""IRC adapter: a persistent client connection that puts the gateway on your own IRC server.

Everything about the server comes from the `irc` section of the gateway config. Host, port,
nick, channels and passwords belong in the overlay (<data dir>/gateway.json), outside the repo;
nothing about any server is written in code. Runs only in the daemon (is_daemon()), since two
processes holding one nick would fight over it.

Identity. Anyone can take any nick, so trust follows services *accounts*, never nicks:
- with the IRCv3 `account-tag` capability, every message carries its sender's account;
- without it, the adapter asks WHOIS (numeric 330, "is logged in as") and caches the answer
  briefly, dropping it when that nick changes or quits.
`owner_accounts` and `known_accounts` map accounts to trust; anyone else is a stranger, and
strangers get no answer unless `answer_strangers` is on.

Sessions:
- A channel is one session, irc:<network>:<#channel>, at the trust its config entry gives it
  (default stranger). Each message runs at the lower of the channel's trust and its sender's.
- A direct message from an identified account is irc:<network>:~<account>, at that account's
  trust. One from an unidentified nick is irc:<network>:<nick>, a stranger session, never the
  account's, so taking someone's nick doesn't get you their conversation.
The config file is the owner's word on IRC sessions' trust: it's applied when a session is
created, and to configured channels on every connect.

Approvals. A destructive/publish tool call (only ever asked on an owner turn) is relayed into
the conversation with a short code and answered with "approve <code>" or "deny <code>". An
answer counts only if its sender is identified, at that moment, as an owner account; anyone
else's is refused and logged.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import random
import re
import ssl
import time
from dataclasses import dataclass, field

from backend.gateway import sessions
from backend.gateway.runner import GatewayBusy, InboundMessage
from backend.gateway.sessions import InvalidSession

logger = logging.getLogger(__name__)

WANTED_CAPS = ("account-tag", "account-notify", "message-tags")
WHOIS_TIMEOUT = 5.0
WHOIS_CACHE_SECONDS = 60.0
MAX_LINE_BYTES = 400  # payload per PRIVMSG; the server adds our prefix and the command to 512


# ── protocol ─────────────────────────────────────────────────────────────────────


@dataclass
class IrcMessage:
    command: str
    params: list[str] = field(default_factory=list)
    tags: dict = field(default_factory=dict)
    nick: str | None = None
    prefix: str | None = None


_TAG_UNESCAPE = {":": ";", "s": " ", "\\": "\\", "r": "\r", "n": "\n"}


def _unescape_tag(value: str) -> str:
    return re.sub(r"\\(.)", lambda m: _TAG_UNESCAPE.get(m.group(1), m.group(1)), value)


def parse_line(line: str) -> IrcMessage:
    """One IRC line (RFC 1459 + IRCv3 message tags) into its parts."""
    tags: dict = {}
    prefix = None
    if line.startswith("@"):
        raw_tags, _, line = line[1:].partition(" ")
        for item in raw_tags.split(";"):
            key, _, value = item.partition("=")
            tags[key] = _unescape_tag(value)
    if line.startswith(":"):
        prefix, _, line = line[1:].partition(" ")
    trailing = None
    if " :" in line:
        line, _, trailing = line.partition(" :")
    elif line.startswith(":"):
        line, trailing = "", line[1:]
    parts = line.split()
    params = parts[1:] + ([trailing] if trailing is not None else [])
    nick = prefix.split("!", 1)[0] if prefix else None
    return IrcMessage(command=(parts[0].upper() if parts else ""), params=params, tags=tags, nick=nick, prefix=prefix)


def irc_lower(text: str) -> str:
    """RFC 1459 casemapping, the default on most networks: []\\~ are the capitals of {}|^."""
    return text.lower().translate(str.maketrans("[]\\~", "{}|^"))


def wrap_reply(text: str, max_lines: int, max_bytes: int = MAX_LINE_BYTES) -> list[str]:
    """A reply as IRC lines: no blank lines or code-fence markers, long lines wrapped at word
    boundaries within max_bytes, at most max_lines (the last says how much was left out)."""
    lines: list[str] = []
    for raw in (text or "").splitlines():
        raw = raw.rstrip()
        if not raw.strip() or re.fullmatch(r"\s*```\w*\s*", raw):
            continue
        while len(raw.encode()) > max_bytes:
            cut = raw.encode()[:max_bytes].decode("utf-8", "ignore")
            space = cut.rfind(" ")
            cut = cut[:space] if space > max_bytes // 2 else cut
            lines.append(cut)
            raw = raw[len(cut):].lstrip()
        if raw:
            lines.append(raw)
    if len(lines) > max_lines:
        hidden = len(lines) - (max_lines - 1)
        lines = lines[:max_lines - 1] + [f"… ({hidden} more lines in the Arynwood MCP conversation)"]
    return lines


# ── adapter ──────────────────────────────────────────────────────────────────────


class IrcConfigError(ValueError):
    pass


class IrcAdapter:
    def __init__(self, gateway, config: dict):
        self.gateway = gateway
        self.config = config
        missing = [k for k in ("host", "port", "nick", "network") if not config.get(k)]
        if missing:
            raise IrcConfigError(f"irc config is missing {', '.join(missing)} (set them in the gateway overlay)")
        self.network = str(config["network"])
        self.channels: dict[str, dict] = {}
        for entry in config.get("channels") or []:
            entry = {"name": entry} if isinstance(entry, str) else dict(entry)
            entry["trust"] = sessions.validate_trust(entry.get("trust", "stranger"))
            self.channels[irc_lower(entry["name"])] = entry
        self.owner_accounts = {irc_lower(a) for a in config.get("owner_accounts") or []}
        self.known_accounts = {irc_lower(a) for a in config.get("known_accounts") or []}
        self.nick = config["nick"]
        self.caps: set[str] = set()
        self.connected = False
        self.joined: set[str] = set()
        self.last_error: str | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._task: asyncio.Task | None = None
        self._events_task: asyncio.Task | None = None
        self._handlers: set[asyncio.Task] = set()
        self._stopping = False
        self._whois: dict[str, tuple[float, str | None]] = {}
        self._whois_pending: dict[str, asyncio.Future] = {}
        self._whois_account: dict[str, str] = {}
        self._targets: dict[str, str] = {}             # session key -> where its replies go
        self._lines: dict[tuple, list[str]] = {}       # (session key, nick) -> lines waiting to be joined
        self._line_context: dict[tuple, dict] = {}
        self._line_timers: dict[tuple, asyncio.Task] = {}
        self._approvals: dict[str, tuple[str, str]] = {}  # short code -> (request_id, session key)
        self._send_tokens = float(config.get("flood_burst", 4))
        self._send_refill = time.monotonic()
        self._sub = gateway.subscribe(set(), approver=True, trust="owner")

    # ── lifecycle ───────────────────────────────────────────────────────────────

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())
        self._events_task = asyncio.create_task(self._relay_events())

    async def stop(self) -> None:
        self._stopping = True
        if self._writer and self.connected:
            try:
                await self._send_now(f"QUIT :{self.config.get('quit_message', 'Arynwood MCP gateway stopping')}")
            except Exception:
                pass
        tasks = [t for t in (self._task, self._events_task, *self._handlers, *self._line_timers.values()) if t]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.gateway.unsubscribe(self._sub)

    def status(self) -> dict:
        return {"network": self.network, "connected": self.connected, "nick": self.nick,
                "channels": sorted(self.joined), "account_tag": "account-tag" in self.caps,
                "last_error": self.last_error}

    async def _run(self) -> None:
        delay = float(self.config.get("reconnect_min_seconds", 5))
        while not self._stopping:
            registered = False
            try:
                registered = await self._session()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_error = f"{type(exc).__name__}: {exc}"
                logger.warning("irc %s: connection lost: %s", self.network, self.last_error)
            finally:
                self.connected = False
                self.joined.clear()
                if self._writer:
                    self._writer.close()
                    self._writer = None
            if self._stopping:
                break
            if registered:
                delay = float(self.config.get("reconnect_min_seconds", 5))
            await asyncio.sleep(delay * random.uniform(0.8, 1.2))
            delay = min(delay * 2, float(self.config.get("reconnect_max_seconds", 300)))

    async def _session(self) -> bool:
        """One connection, from connect to disconnect. True if it got as far as registering."""
        context = None
        if self.config.get("tls", True):
            context = ssl.create_default_context()
            if self.config.get("tls_verify", True) is False:
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE
        reader, self._writer = await asyncio.wait_for(
            asyncio.open_connection(self.config["host"], int(self.config["port"]), ssl=context), 30)
        self.caps = set()
        self.nick = self.config["nick"]
        await self._send_now("CAP LS 302")
        if self.config.get("server_password"):
            await self._send_now(f"PASS {self.config['server_password']}")
        await self._send_now(f"NICK {self.nick}")
        await self._send_now(f"USER {self.config.get('username') or self.nick} 0 * :{self.config.get('realname', 'Arynwood MCP')}")

        idle = float(self.config.get("ping_interval_seconds", 120))
        pinged = False
        registered = False
        while True:
            try:
                raw = await asyncio.wait_for(reader.readline(), idle)
            except asyncio.TimeoutError:
                if pinged:
                    raise ConnectionError("no reply to PING")
                await self._send_now("PING :arynwood")
                pinged = True
                continue
            if not raw:
                raise ConnectionError("server closed the connection")
            pinged = False
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            if not line:
                continue
            message = parse_line(line)
            if message.command == "001":
                registered = True
            await self._dispatch(message)

    # ── incoming ────────────────────────────────────────────────────────────────

    async def _dispatch(self, msg: IrcMessage) -> None:
        cmd = msg.command
        if cmd == "PING":
            await self._send_now("PONG :" + (msg.params[-1] if msg.params else ""))
        elif cmd == "CAP":
            await self._on_cap(msg)
        elif cmd == "AUTHENTICATE" and msg.params and msg.params[0] == "+":
            sasl = self.config.get("sasl") or {}
            token = f"{sasl['account']}\0{sasl['account']}\0{sasl['password']}".encode()
            await self._send_now("AUTHENTICATE " + base64.b64encode(token).decode())
        elif cmd in ("903", "904", "905", "906", "907"):
            if cmd != "903":
                self.last_error = "SASL login failed"
                logger.warning("irc %s: SASL login failed (%s)", self.network, cmd)
            await self._send_now("CAP END")
        elif cmd == "001":
            self.connected = True
            self.last_error = None
            self.nick = msg.params[0] if msg.params else self.nick
            nickserv = self.config.get("nickserv_password")
            if nickserv and "sasl" not in self.caps:
                await self._send(f"PRIVMSG NickServ :IDENTIFY {nickserv}")
            await self._sync_channel_sessions()
            for name, entry in self.channels.items():
                key = f" {entry['key']}" if entry.get("key") else ""
                await self._send(f"JOIN {entry['name']}{key}")
        elif cmd == "433" and not self.connected:  # nick in use while registering
            self.nick = self.nick + "_"
            await self._send_now(f"NICK {self.nick}")
        elif cmd == "JOIN" and msg.nick and irc_lower(msg.nick) == irc_lower(self.nick):
            self.joined.add(msg.params[0])
        elif cmd in ("PART", "KICK"):
            if cmd == "KICK" and len(msg.params) > 1 and irc_lower(msg.params[1]) == irc_lower(self.nick):
                self.joined.discard(msg.params[0])
            elif cmd == "PART" and msg.nick and irc_lower(msg.nick) == irc_lower(self.nick):
                self.joined.discard(msg.params[0])
        elif cmd == "NICK" and msg.nick:
            self._forget(msg.nick)
            if irc_lower(msg.nick) == irc_lower(self.nick) and msg.params:
                self.nick = msg.params[0]
        elif cmd in ("QUIT", "ACCOUNT") and msg.nick:
            self._forget(msg.nick)
        elif cmd == "330" and len(msg.params) >= 3:  # RPL_WHOISACCOUNT: me nick account :is logged in as
            self._whois_account[irc_lower(msg.params[1])] = msg.params[2]
        elif cmd == "318" and len(msg.params) >= 2:  # RPL_ENDOFWHOIS
            nick = irc_lower(msg.params[1])
            account = self._whois_account.pop(nick, None)
            self._whois[nick] = (time.monotonic(), account)
            future = self._whois_pending.pop(nick, None)
            if future and not future.done():
                future.set_result(account)
        elif cmd == "ERROR":
            raise ConnectionError(msg.params[-1] if msg.params else "server error")
        elif cmd == "PRIVMSG" and msg.nick and len(msg.params) >= 2:
            task = asyncio.create_task(self._on_privmsg(msg))
            self._handlers.add(task)
            task.add_done_callback(self._handlers.discard)

    async def _on_cap(self, msg: IrcMessage) -> None:
        sub = msg.params[1].upper() if len(msg.params) > 1 else ""
        if sub == "LS":
            offered = {c.split("=", 1)[0] for c in msg.params[-1].split()}
            self._offered = getattr(self, "_offered", set()) | offered
            if len(msg.params) > 3 and msg.params[2] == "*":
                return  # more LS lines to come
            wanted = [c for c in WANTED_CAPS if c in self._offered]
            if self.config.get("sasl") and "sasl" in self._offered:
                wanted.append("sasl")
            self._offered = set()
            if wanted:
                await self._send_now("CAP REQ :" + " ".join(wanted))
            else:
                await self._send_now("CAP END")
        elif sub == "ACK":
            self.caps |= set(msg.params[-1].split())
            if "sasl" in self.caps:
                await self._send_now("AUTHENTICATE PLAIN")
            else:
                await self._send_now("CAP END")
        elif sub == "NAK":
            await self._send_now("CAP END")

    def _forget(self, nick: str) -> None:
        self._whois.pop(irc_lower(nick), None)

    async def identify(self, msg: IrcMessage) -> str | None:
        """The services account behind a message, or None if its sender isn't logged in."""
        if "account-tag" in self.caps:
            account = msg.tags.get("account")
            return account if account and account != "*" else None
        nick = irc_lower(msg.nick or "")
        cached = self._whois.get(nick)
        if cached and time.monotonic() - cached[0] < WHOIS_CACHE_SECONDS:
            return cached[1]
        future = self._whois_pending.get(nick)
        if future is None:
            future = asyncio.get_running_loop().create_future()
            self._whois_pending[nick] = future
            await self._send(f"WHOIS {msg.nick}")
        try:
            return await asyncio.wait_for(asyncio.shield(future), WHOIS_TIMEOUT)
        except asyncio.TimeoutError:
            self._whois_pending.pop(nick, None)
            return None  # can't verify: treat as not logged in

    def trust_for(self, account: str | None) -> str:
        if account and irc_lower(account) in self.owner_accounts:
            return "owner"
        if account and irc_lower(account) in self.known_accounts:
            return "known"
        return "stranger"

    def _addressed(self, text: str) -> str | None:
        """The message body if it addresses the bot ("nick: ...", "nick, ...", "@nick ..."), else None."""
        match = re.match(r"^@?(\S+?)[:,]?\s+(.*)$", text.strip(), re.DOTALL)
        if match and irc_lower(match.group(1).rstrip(":,")) == irc_lower(self.nick):
            return match.group(2).strip()
        return None

    async def _on_privmsg(self, msg: IrcMessage) -> None:
        target, text = msg.params[0], msg.params[-1]
        if irc_lower(msg.nick) == irc_lower(self.nick) or text.startswith("\x01"):
            return  # our own echo, or CTCP
        in_channel = target[:1] in "#&!+"
        account = await self.identify(msg)
        trust = self.trust_for(account)

        if in_channel:
            channel = self.channels.get(irc_lower(target))
            body = self._addressed(text)
            if self.config.get("channel_mode", "mention") == "all" and body is None:
                body = text
            if channel is None or body is None:
                return
            key = f"irc:{self.network}:{irc_lower(target)}"
            reply_to, label = target, f"IRC {target}"
            session_trust = channel["trust"]
        else:
            body = text.strip()
            if account:
                key, session_trust = f"irc:{self.network}:~{irc_lower(account)}", trust
            else:
                key, session_trust = f"irc:{self.network}:{irc_lower(msg.nick)}", "stranger"
            reply_to, label = msg.nick, f"IRC {msg.nick} (direct)"

        if await self._maybe_approval(body, msg.nick, account, trust, reply_to):
            return
        if trust == "stranger" and not self.config.get("answer_strangers", False):
            logger.info("irc %s: ignored %s (not identified as a known account)", self.network, msg.nick)
            return
        try:
            sessions.validate_key(key)
        except InvalidSession:
            logger.warning("irc %s: can't make a session key from %r", self.network, key)
            return

        # A long message often arrives as several lines (the client wrapped it, or it was pasted
        # with line breaks). Seen live: answering each line on its own made the bot reply "I need
        # more context" to the first half of a question. Lines from the same person to the same
        # place are joined until they stop for coalesce_seconds.
        slot = (key, irc_lower(msg.nick))
        self._lines.setdefault(slot, []).append(body)
        self._line_context[slot] = {"key": key, "session_trust": session_trust, "reply_to": reply_to,
                                    "label": label, "trust": trust, "nick": msg.nick, "in_channel": in_channel}
        timer = self._line_timers.pop(slot, None)
        if timer:
            timer.cancel()
        self._line_timers[slot] = asyncio.create_task(self._flush_lines(slot))

    async def _flush_lines(self, slot: tuple) -> None:
        await asyncio.sleep(float(self.config.get("coalesce_seconds", 1.5)))
        # Past the wait: hand off, so a later line can't cancel a turn already under way.
        self._line_timers.pop(slot, None)
        lines, context = self._lines.pop(slot, []), self._line_context.pop(slot, None)
        if lines and context:
            task = asyncio.create_task(self._answer(context, "\n".join(lines)))
            self._handlers.add(task)
            task.add_done_callback(self._handlers.discard)

    async def _answer(self, context: dict, body: str) -> None:
        key, reply_to, label, nick = context["key"], context["reply_to"], context["label"], context["nick"]
        prompt_text = f"{nick}: {body}" if context["in_channel"] else body
        await self.gateway.ensure_session(key, persona=self.config.get("persona", "central"),
                                          label=label, trust_level=context["session_trust"], source="irc")
        self._targets[key] = reply_to
        self._sub.keys.add(key)  # hear this session's approval requests
        prefix = f"{nick}: " if context["in_channel"] else ""
        try:
            result = await self.gateway.submit(InboundMessage(
                session=key, text=prompt_text, source="irc", sender=nick, label=label,
                trust_level=context["trust"]))
        except GatewayBusy:
            await self.say(reply_to, f"{prefix}I'm still working through earlier messages; try again in a moment.")
            return
        except InvalidSession as exc:
            logger.warning("irc %s: %s", self.network, exc)
            return
        reply = result.reply if result.reply.strip() else f"(I couldn't answer that: {result.error or result.status}.)"
        lines = wrap_reply(reply, int(self.config.get("max_reply_lines", 8)), MAX_LINE_BYTES - len(prefix.encode()))
        for i, line in enumerate(lines):
            await self.say(reply_to, (prefix if i == 0 else "") + line)

    # ── approvals ───────────────────────────────────────────────────────────────

    async def _relay_events(self) -> None:
        while True:
            event = await self._sub.queue.get()
            key = event.get("session")
            target = self._targets.get(key)
            if not target:
                continue
            if event["type"] == "approval_request":
                code = event["request_id"].replace("-", "")[:6]
                self._approvals[code] = (event["request_id"], key)
                args = json.dumps(event.get("arguments"), ensure_ascii=False)
                args = args if len(args) <= 200 else args[:199] + "…"
                tier = event.get("tier", "").replace("_", " ")
                await self.say(target, f"Approval needed: {event.get('tool')} {args} ({tier}). Only the owner, "
                                       f"identified to services, can answer: \"approve {code}\" or \"deny {code}\".")
            elif event["type"] == "approval_resolved":
                code = event["request_id"].replace("-", "")[:6]
                if self._approvals.pop(code, None) and event.get("by") in ("timed out", "no approver attached"):
                    await self.say(target, f"Approval {code} {event['by']}: {event.get('tool')} was not run.")

    async def _maybe_approval(self, text: str, nick: str, account: str | None, trust: str, reply_to: str) -> bool:
        match = re.fullmatch(r"(approve|deny)\s+([0-9a-f]{6})", (text or "").strip(), re.IGNORECASE)
        if not match or match.group(2).lower() not in self._approvals:
            return False
        code = match.group(2).lower()
        request_id, _ = self._approvals[code]
        approved = match.group(1).lower() == "approve"
        who = f"irc:{account}" if account else f"irc:{nick} (unidentified)"
        if not self.gateway.resolve_approval(request_id, approved, by=who, trust=trust):
            if trust != "owner":
                await self.say(reply_to, f"{nick}: only the owner, identified to services, can answer approval {code}.")
            return True
        await self.say(reply_to, f"{'Approved' if approved else 'Denied'} {code}.")
        return True

    # ── outgoing ────────────────────────────────────────────────────────────────

    async def say(self, target: str, text: str) -> None:
        await self._send(f"PRIVMSG {target} :{text}")

    async def _send(self, line: str) -> None:
        """Rate-limited send: a short burst, then one line per flood_interval_seconds, so a long
        reply doesn't get the bot disconnected for flooding."""
        burst = float(self.config.get("flood_burst", 4))
        interval = float(self.config.get("flood_interval_seconds", 1.0))
        while True:
            now = time.monotonic()
            self._send_tokens = min(burst, self._send_tokens + (now - self._send_refill) / interval)
            self._send_refill = now
            if self._send_tokens >= 1:
                self._send_tokens -= 1
                break
            await asyncio.sleep((1 - self._send_tokens) * interval)
        await self._send_now(line)

    async def _send_now(self, line: str) -> None:
        if not self._writer:
            raise ConnectionError("not connected")
        line = line.replace("\r", " ").replace("\n", " ")
        payload = line.encode("utf-8")[:510].decode("utf-8", "ignore").encode("utf-8")  # never split a character
        self._writer.write(payload + b"\r\n")
        await self._writer.drain()

    async def _sync_channel_sessions(self) -> None:
        for name, entry in self.channels.items():
            key = f"irc:{self.network}:{name}"
            try:
                await self.gateway.ensure_session(key, persona=self.config.get("persona", "central"),
                                                  label=f"IRC {entry['name']}", trust_level=entry["trust"],
                                                  source="irc", enforce_trust=True)
                self._targets[key] = entry["name"]
                self._sub.keys.add(key)
            except InvalidSession as exc:
                logger.warning("irc %s: channel %s: %s", self.network, entry["name"], exc)
