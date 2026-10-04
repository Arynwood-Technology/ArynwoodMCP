"""IRC adapter (backend/gateway/irc.py) against a fake IRC server on localhost: registration,
PING/PONG, reconnect, identity by account tag and by WHOIS, sessions, replies, and approvals
that only an identified owner account can answer. The gateway is real; the model is scripted."""

import asyncio
import json
import uuid

import pytest

from backend.gateway import Gateway, sessions
from backend.gateway.config import load_config
from backend.gateway.irc import IrcAdapter, IrcConfigError, irc_lower, parse_line, wrap_reply
from backend.services import knowledge, mcp_tool_agent, memory_index, ollama_client


# ── a small IRC server ──────────────────────────────────────────────────────────


class FakeIrcd:
    """Speaks just enough IRC for the adapter: CAP (optional), registration, PING, JOIN, WHOIS."""

    def __init__(self, caps=("account-tag",), accounts=None):
        self.caps = caps                     # None = a server without CAP support
        self.accounts = accounts or {}       # nick -> services account, for WHOIS
        self.received: list[str] = []
        self.writers: list[asyncio.StreamWriter] = []
        self.connections = 0
        self.lines = asyncio.Queue()

    async def start(self):
        self.server = await asyncio.start_server(self._client, "127.0.0.1", 0)
        self.port = self.server.sockets[0].getsockname()[1]

    async def stop(self):
        for w in self.writers:
            w.close()
        self.server.close()
        await self.server.wait_closed()

    def send(self, line: str):
        writer = self.writers[-1]
        writer.write((line + "\r\n").encode())

    async def drop(self):
        self.writers[-1].close()

    async def expect(self, predicate, timeout=5.0):
        """The next received line matching predicate (str prefix or callable)."""
        test = predicate if callable(predicate) else (lambda line: line.startswith(predicate))
        async def find():
            while True:
                line = await self.lines.get()
                if test(line):
                    return line
        return await asyncio.wait_for(find(), timeout)

    async def _client(self, reader, writer):
        self.connections += 1
        self.writers.append(writer)
        nick = None
        negotiating = welcome_waiting = False   # a CAP-capable server holds 001 until CAP END
        while True:
            raw = await reader.readline()
            if not raw:
                return
            line = raw.decode().rstrip("\r\n")
            self.received.append(line)
            self.lines.put_nowait(line)
            msg = parse_line(line)
            if msg.command == "CAP" and self.caps is not None:
                if msg.params[0] == "LS":
                    negotiating = True
                    writer.write(f":fake CAP * LS :{' '.join(self.caps)}\r\n".encode())
                elif msg.params[0] == "REQ":
                    writer.write(f":fake CAP * ACK :{msg.params[-1]}\r\n".encode())
                elif msg.params[0] == "END" and welcome_waiting:
                    writer.write(f":fake 001 {nick} :Welcome\r\n".encode())
            elif msg.command == "NICK":
                nick = msg.params[0]
            elif msg.command == "USER":
                if negotiating:
                    welcome_waiting = True
                else:
                    writer.write(f":fake 001 {nick} :Welcome\r\n".encode())
            elif msg.command == "JOIN":
                writer.write(f":{nick}!u@h JOIN {msg.params[0]}\r\n".encode())
            elif msg.command == "WHOIS":
                target = msg.params[0]
                if target in self.accounts:
                    writer.write(f":fake 330 {nick} {target} {self.accounts[target]} :is logged in as\r\n".encode())
                writer.write(f":fake 318 {nick} {target} :End of WHOIS\r\n".encode())
            await writer.drain()


# ── fixtures ────────────────────────────────────────────────────────────────────


@pytest.fixture()
async def ircd():
    server = FakeIrcd()
    await server.start()
    yield server
    await server.stop()


def irc_config(port, **overrides):
    config = {
        **load_config()["irc"], "enabled": True, "network": "testnet", "host": "127.0.0.1", "port": port,
        "tls": False, "nick": "aryn-bot", "channels": ["#lobby", {"name": "#home", "trust": "owner"}],
        "owner_accounts": ["owner-acct"], "flood_burst": 50,
        "flood_interval_seconds": 0.01, "reconnect_min_seconds": 0.05, "reconnect_max_seconds": 0.1,
        "coalesce_seconds": 0.05,
    }
    config.update(overrides)
    return config


class Script:
    """ollama_client.chat/chat_stream for every turn, scripted; records each request."""

    def __init__(self, monkeypatch, replies):
        self.replies = list(replies)
        self.requests = []
        monkeypatch.setattr(ollama_client, "chat", self.chat)
        monkeypatch.setattr(ollama_client, "chat_stream", self.stream)

    async def chat(self, *, model, messages, host=None, port=None, options=None, tools=None, timeout=None):
        if "long-term memory" in messages[0]["content"]:
            return {"output": '{"durable": [], "today": []}'}
        self.requests.append({"messages": messages, "tools": tools})
        return {"output": self.replies.pop(0) if self.replies else "ok", "tool_calls": None}

    async def stream(self, *, model, messages, host, port, options=None, tools=None):
        self.requests.append({"messages": messages, "tools": tools})
        yield {"token": self.replies.pop(0) if self.replies else "ok", "done": True}


@pytest.fixture()
async def gateway(tmp_path, monkeypatch):
    from backend.db import init_db
    await init_db()

    async def ctx(model, host=None, port=None, timeout=5.0):
        return 8192

    async def nothing(*a, **k):
        return []

    monkeypatch.setattr(ollama_client, "context_length", ctx)
    monkeypatch.setattr(knowledge, "search", nothing)
    monkeypatch.setattr(memory_index, "search_relevant_memory_ids", nothing)
    monkeypatch.setattr(mcp_tool_agent, "select_servers", nothing)
    config = load_config()
    config["file_memory"] = {**config["file_memory"], "dir": str(tmp_path / "memory")}
    gw = Gateway(config)
    yield gw
    await gw.shutdown()


async def connected(gateway, ircd, **overrides):
    network = f"net{uuid.uuid4().hex[:6]}"   # fresh session keys for every test
    adapter = IrcAdapter(gateway, irc_config(ircd.port, network=network, **overrides))
    adapter.start()
    gateway.adapters["irc"] = adapter
    await ircd.expect("JOIN #home")
    for _ in range(100):
        if len(adapter.joined) == 2:
            break
        await asyncio.sleep(0.01)
    return adapter


def tagged(account, nick, target, text):
    tag = f"@account={account} " if account else ""
    return f"{tag}:{nick}!u@h PRIVMSG {target} :{text}"


async def reply_to(ircd, target):
    return await ircd.expect(f"PRIVMSG {target} :")


async def silence(ircd, prefix, seconds=0.3):
    try:
        line = await ircd.expect(prefix, timeout=seconds)
    except asyncio.TimeoutError:
        return True
    raise AssertionError(f"unexpected: {line}")


# ── protocol pieces ─────────────────────────────────────────────────────────────


def test_parse_line_handles_tags_prefix_and_trailing():
    msg = parse_line(r"@account=first\slast;time=x :nick!user@host PRIVMSG #chan :hello there: friend")
    assert msg.tags == {"account": "first last", "time": "x"}
    assert (msg.nick, msg.command, msg.params) == ("nick", "PRIVMSG", ["#chan", "hello there: friend"])
    assert parse_line("PING :abc").params == ["abc"]


def test_casemapping_and_wrapping():
    assert irc_lower("Nick[A]") == "nick{a}"
    lines = wrap_reply("```python\nprint(1)\n```\n\n" + "word " * 200, max_lines=3, max_bytes=100)
    assert lines[0] == "print(1)" and all(len(l.encode()) <= 100 for l in lines)
    assert len(lines) == 3 and lines[-1].startswith("… (")


def test_config_without_server_details_is_refused(gateway):
    with pytest.raises(IrcConfigError, match="host"):
        IrcAdapter(gateway, {**load_config()["irc"], "enabled": True, "network": "n", "nick": "x", "port": 1})


# ── connection ──────────────────────────────────────────────────────────────────


async def test_registers_joins_and_answers_ping(gateway, ircd):
    adapter = await connected(gateway, ircd)
    assert "CAP REQ :account-tag" in ircd.received
    assert ircd.received.index("CAP END") < ircd.received.index("JOIN #lobby")
    assert adapter.status()["connected"] and adapter.status()["account_tag"]
    ircd.send("PING :are-you-there")
    assert await ircd.expect("PONG") == "PONG :are-you-there"


async def test_reconnects_and_rejoins_after_a_drop(gateway, ircd):
    adapter = await connected(gateway, ircd)
    await ircd.drop()
    await ircd.expect("NICK aryn-bot", timeout=5)
    await ircd.expect("JOIN #home", timeout=5)
    assert ircd.connections == 2 and adapter.status()["connected"]


async def test_works_on_a_server_without_cap(gateway):
    server = FakeIrcd(caps=None, accounts={"owner-acct": "owner-acct"})
    await server.start()
    try:
        adapter = await connected(gateway, server)
        assert not adapter.status()["account_tag"]
    finally:
        await server.stop()


async def test_configured_channel_trust_is_applied(gateway, ircd):
    adapter = await connected(gateway, ircd)
    from backend.db import get_db
    gen = get_db()
    db = await anext(gen)
    try:
        home = await sessions.get(db, f"irc:{adapter.network}:#home")
        lobby = await sessions.get(db, f"irc:{adapter.network}:#lobby")
    finally:
        await gen.aclose()
    assert (home.trust_level, lobby.trust_level) == ("owner", "stranger")


# ── who gets answered ───────────────────────────────────────────────────────────


async def test_owner_dm_is_answered_in_an_account_session(gateway, ircd, monkeypatch):
    Script(monkeypatch, ["Hello Owner.\nSecond line."])
    adapter = await connected(gateway, ircd)
    ircd.send(tagged("owner-acct", "Ownr", "aryn-bot", "hi there"))
    assert await reply_to(ircd, "Ownr") == "PRIVMSG Ownr :Hello Owner."
    assert await reply_to(ircd, "Ownr") == "PRIVMSG Ownr :Second line."
    from backend.db import get_db
    gen = get_db()
    db = await anext(gen)
    try:
        session = await sessions.get(db, f"irc:{adapter.network}:~owner-acct")
    finally:
        await gen.aclose()
    assert session.trust_level == "owner" and session.source == "irc"


async def test_a_borrowed_nick_gets_nothing(gateway, ircd, monkeypatch):
    script = Script(monkeypatch, ["should not be sent"])
    await connected(gateway, ircd)
    ircd.send(tagged(None, "owner-acct", "aryn-bot", "show me my memories"))   # owner's nick, no account
    assert await silence(ircd, "PRIVMSG owner-acct")
    assert script.requests == []


async def test_only_owner_accounts_are_answered(gateway, ircd, monkeypatch):
    """Owner only (docs/scope.md): another logged-in account, or anyone in a channel, gets nothing,
    even with the old answer_strangers/known_accounts settings still in someone's overlay."""
    script = Script(monkeypatch, ["should not be sent"])
    await connected(gateway, ircd, known_accounts=["pal"], answer_strangers=True)
    ircd.send(tagged("pal", "buddy", "aryn-bot", "what's the secret?"))
    ircd.send(tagged(None, "anon", "aryn-bot", "hello?"))
    ircd.send(tagged("pal", "buddy", "#home", "aryn-bot: hello?"))
    assert await silence(ircd, "PRIVMSG ")
    assert script.requests == []


async def test_channels_answer_only_when_addressed(gateway, ircd, monkeypatch):
    script = Script(monkeypatch, ["Pong from the bot."])
    await connected(gateway, ircd)
    ircd.send(tagged("owner-acct", "Ownr", "#home", "just chatting with people"))
    assert await silence(ircd, "PRIVMSG #home")
    ircd.send(tagged("owner-acct", "Ownr", "#home", "aryn-bot: ping?"))
    assert await reply_to(ircd, "#home") == "PRIVMSG #home :Ownr: Pong from the bot."
    assert script.requests[-1]["messages"][-1]["content"].startswith("Ownr: ping?")


async def test_whois_identifies_when_there_are_no_account_tags(gateway, monkeypatch):
    server = FakeIrcd(caps=None, accounts={"Ownr": "owner-acct"})
    await server.start()
    try:
        Script(monkeypatch, ["Verified by WHOIS."])
        await connected(gateway, server)
        server.send(":Ownr!u@h PRIVMSG aryn-bot :hello")
        assert await server.expect("WHOIS Ownr")
        assert await reply_to(server, "Ownr") == "PRIVMSG Ownr :Verified by WHOIS."
        server.send(":Mallory!u@h PRIVMSG aryn-bot :hello")   # WHOIS shows no account
        assert await silence(server, "PRIVMSG Mallory")
    finally:
        await server.stop()


# ── a tool-using reply, and approvals only the owner can give ──────────────────


@pytest.fixture()
def kdenlive(monkeypatch):
    calls = []

    async def post(cfg, method, params, req_id=1):
        if method == "tools/list":
            return {"tools": [
                {"name": "get_timeline_summary", "description": "", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "delete_clip", "description": "",
                 "inputSchema": {"type": "object", "properties": {"clip_id": {"type": "integer"}}, "required": ["clip_id"]}},
            ]}
        calls.append(params["name"])
        return {"content": [{"type": "text", "text": "3 clips: intro, b-roll, outro"}]}

    async def select(message):
        return ["kdenlive"]

    monkeypatch.setattr(mcp_tool_agent, "_load_servers", lambda: {"kdenlive": {"url": "http://x"}})
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", post)
    monkeypatch.setattr(mcp_tool_agent, "select_servers", select)
    return calls


def call(name, **arguments):
    return json.dumps({"name": name, "arguments": arguments})


async def test_owner_gets_a_tool_using_reply_over_irc(gateway, ircd, kdenlive, monkeypatch):
    Script(monkeypatch, [call("get_timeline_summary"), "Your timeline has 3 clips: intro, b-roll, outro."])
    await connected(gateway, ircd)
    ircd.send(tagged("owner-acct", "Ownr", "aryn-bot", "what's on my kdenlive timeline?"))
    assert await reply_to(ircd, "Ownr") == "PRIVMSG Ownr :Your timeline has 3 clips: intro, b-roll, outro."
    assert kdenlive == ["get_timeline_summary"]


async def test_only_the_identified_owner_can_approve(gateway, ircd, kdenlive, monkeypatch):
    Script(monkeypatch, [call("delete_clip", clip_id=2), "Deleted clip 2."])
    await connected(gateway, ircd)
    ircd.send(tagged("owner-acct", "Ownr", "aryn-bot", "delete clip 2"))
    request = await reply_to(ircd, "Ownr")
    assert request.startswith("PRIVMSG Ownr :Approval needed: delete_clip")
    code = request.split('"approve ')[1][:6]

    # Same nick, but not identified: ignored, and the call stays pending.
    ircd.send(tagged(None, "Ownr", "aryn-bot", f"approve {code}"))
    # Another logged-in account isn't enough either.
    ircd.send(tagged("pal", "buddy", "aryn-bot", f"approve {code}"))
    assert await silence(ircd, "PRIVMSG ")
    assert kdenlive == [] and gateway.pending_approvals()

    ircd.send(tagged("owner-acct", "Ownr", "aryn-bot", f"approve {code}"))
    assert await reply_to(ircd, "Ownr") == f"PRIVMSG Ownr :Approved {code}."
    assert await reply_to(ircd, "Ownr") == "PRIVMSG Ownr :Deleted clip 2."
    assert kdenlive == ["delete_clip"]


async def test_stranger_channel_never_asks_for_approval(gateway, ircd, kdenlive, monkeypatch):
    # #lobby is a stranger channel: even the owner's message there runs at stranger trust,
    # so no tools are attached and nothing can be put up for approval.
    script = Script(monkeypatch, ["I can't do that here."])
    await connected(gateway, ircd)
    ircd.send(tagged("owner-acct", "Ownr", "#lobby", "aryn-bot: delete clip 2"))
    assert await reply_to(ircd, "#lobby") == "PRIVMSG #lobby :Ownr: I can't do that here."
    assert script.requests[-1]["tools"] is None and kdenlive == []


async def test_a_message_split_across_lines_is_one_turn(gateway, ircd, monkeypatch):
    """Seen live: a phone client sent one question as two lines, and the bot answered the
    first half on its own ("I need more context")."""
    script = Script(monkeypatch, ["One answer."])
    await connected(gateway, ircd, coalesce_seconds=0.3)
    ircd.send(tagged("owner-acct", "Ownr", "aryn-bot", "Which file in this app's codebase defines"))
    ircd.send(tagged("owner-acct", "Ownr", "aryn-bot", "SESSION_KEY_RE?"))
    assert await reply_to(ircd, "Ownr") == "PRIVMSG Ownr :One answer."
    assert len(script.requests) == 1
    assert script.requests[0]["messages"][-1]["content"].startswith(
        "Which file in this app's codebase defines\nSESSION_KEY_RE?")
    assert await silence(ircd, "PRIVMSG Ownr")


async def test_approval_request_shows_arguments_as_json(gateway, ircd, kdenlive, monkeypatch):
    Script(monkeypatch, [call("delete_clip", clip_id=2), "Not deleted."])
    await connected(gateway, ircd)
    ircd.send(tagged("owner-acct", "Ownr", "aryn-bot", "delete clip 2"))
    assert 'delete_clip {"clip_id": 2} (destructive)' in await reply_to(ircd, "Ownr")


# ── delivery: what a reply may reach ────────────────────────────────────────────


class Held:
    """A model that doesn't answer until released, so the test can act while a turn runs."""

    def __init__(self, monkeypatch, reply="Done thinking."):
        self.reply, self.entered, self.release = reply, asyncio.Event(), asyncio.Event()
        monkeypatch.setattr(ollama_client, "chat", self.chat)
        monkeypatch.setattr(ollama_client, "chat_stream", self.stream)

    async def chat(self, *, model, messages, host=None, port=None, options=None, tools=None, timeout=None):
        if "long-term memory" in messages[0]["content"]:
            return {"output": '{"durable": [], "today": []}'}
        self.entered.set()
        await self.release.wait()
        return {"output": self.reply, "tool_calls": None}

    async def stream(self, *, model, messages, host, port, options=None, tools=None):
        self.entered.set()
        await self.release.wait()
        yield {"token": self.reply, "done": True}


async def test_model_output_cannot_send_a_ctcp_request(gateway, ircd, monkeypatch):
    Script(monkeypatch, ["\x01DCC SEND evil 0 0 0\x01"])
    await connected(gateway, ircd)
    ircd.send(tagged("owner-acct", "Ownr", "aryn-bot", "hi"))
    assert await reply_to(ircd, "Ownr") == "PRIVMSG Ownr :DCC SEND evil 0 0 0"


async def test_owner_reply_is_held_when_the_nick_is_no_longer_theirs(gateway, monkeypatch):
    """A turn can outlast the owner's connection, and the bot may share no channel with them,
    so it never sees the nick change hands. Delivery re-checks the account first."""
    from backend.gateway import irc
    monkeypatch.setattr(irc, "VERIFY_FRESH_SECONDS", 0.0)   # as if the turn had taken minutes
    server = FakeIrcd(accounts={})                           # by then, nobody on Ownr is owner-acct
    await server.start()
    try:
        Script(monkeypatch, ["Your private notes say teal."])
        await connected(gateway, server)
        server.send(tagged("owner-acct", "Ownr", "aryn-bot", "what do my notes say?"))
        await server.expect("WHOIS Ownr")
        assert await silence(server, "PRIVMSG Ownr")

        server.accounts["Ownr"] = "owner-acct"               # the owner is back on their nick
        server.send(tagged("owner-acct", "Ownr", "aryn-bot", "again?"))
        assert await reply_to(server, "Ownr") == "PRIVMSG Ownr :ok"
    finally:
        await server.stop()


async def test_approval_request_is_held_from_an_unverified_nick(gateway, kdenlive, monkeypatch):
    from backend.gateway import irc
    monkeypatch.setattr(irc, "VERIFY_FRESH_SECONDS", 0.0)
    monkeypatch.setattr(gateway, "config", {**gateway.config, "approval_timeout_seconds": 0.5})
    server = FakeIrcd(accounts={})
    await server.start()
    try:
        Script(monkeypatch, [call("delete_clip", clip_id=2), "Not deleted."])
        await connected(gateway, server)
        server.send(tagged("owner-acct", "Ownr", "aryn-bot", "delete clip 2"))
        assert await silence(server, "PRIVMSG Ownr :Approval needed", seconds=1.0)
        assert kdenlive == []
    finally:
        await server.stop()


async def test_reply_follows_the_owner_to_a_new_nick(gateway, monkeypatch):
    server = FakeIrcd(accounts={"NewOwnr": "owner-acct"})
    await server.start()
    try:
        model = Held(monkeypatch)
        adapter = await connected(gateway, server)
        server.send(tagged("owner-acct", "Ownr", "aryn-bot", "think it over"))
        await asyncio.wait_for(model.entered.wait(), 5)
        server.send(":Ownr!u@h NICK NewOwnr")
        for _ in range(100):
            if "NewOwnr" in adapter._targets.values():
                break
            await asyncio.sleep(0.01)
        model.release.set()
        assert await reply_to(server, "NewOwnr") == "PRIVMSG NewOwnr :Done thinking."
    finally:
        await server.stop()
