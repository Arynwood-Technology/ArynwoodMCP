# Headless gateway

> **Experimental, and parked.** The gateway is a remote control for the owner's own
> workspace, nothing more ([scope](scope.md)). It is off unless you start the daemon
> (`python -m backend.gateway`) or set `ARYNWOOD_ENABLE_GATEWAY=1` for the desktop backend.
> Over IRC it answers only your own services account. It runs from a source checkout; the
> desktop packages don't start it.

The gateway lets you reach Arynwood MCP with no desktop window attached. The language model
runs on your own GPU through Ollama, and conversations, memories and tools stay on your
machine. You reach it over HTTP or a WebSocket on loopback, or from your phone over your own
IRC server.

It keeps one persistent **session** per outside conversation: an API client, an IRC
user or channel, a scheduled job. Each session continues the same conversation across
restarts.

A gateway turn (`backend/gateway/turn.py`) builds its prompt from the desktop chat's own
helpers: persona prompt, history and running summary, knowledge base, memory saving, run
evidence. Gateway conversations also appear in the desktop's conversation list, titled with
the session's label. It differs from the desktop chat in two ways:

- **Trust decides what a turn sees.** Every session is `owner`, `known` or `stranger`.
- **Tools run inside the reply.** The model calls them as it goes, instead of a side loop
  running before it. See [Conversational tool loop](#conversational-tool-loop).

## Running it

```bash
source venv/bin/activate
python -m backend.gateway                 # 127.0.0.1:8020 by default
python -m backend.gateway --port 8021     # flags override the config file
```

This is the whole backend (`backend.api:app`, every `/api` route) started headless.
`/api/gateway/status` reports `"daemon": true` when it runs this way. A desktop backend
serves `/api/gateway` only with `ARYNWOOD_ENABLE_GATEWAY=1`, and then reports `false`.
Work that must run in exactly one process, such as a chat-network connection or a
scheduler, starts only in the daemon (`backend.gateway.is_daemon()`).
`python -m backend.security` reports whether the gateway is served (`gateway.enabled`).

### As a systemd user service

```ini
# ~/.config/systemd/user/arynwood-gateway.service
[Unit]
Description=Arynwood gateway (headless agent)
After=network-online.target ollama.service

[Service]
WorkingDirectory=%h/path/to/arynwood-mcp
ExecStart=%h/path/to/arynwood-mcp/venv/bin/python -m backend.gateway
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Then `systemctl --user daemon-reload && systemctl --user enable --now arynwood-gateway`.
Add `loginctl enable-linger $USER` if it should keep running while you're logged out.

## Config

Shared defaults: `mcp/config/gateway/config.json`. Personal settings go in the overlay
at `~/.local/share/arynwood-mcp/gateway.json` (or `ARYNWOOD_GATEWAY_CONFIG`), which is
outside the repo. Keys are documented in `mcp/config/gateway/README.md`.

Leave `max_concurrent_turns` at 1 on a single 12GB GPU. One model
serves every turn, and loading a second copy alongside other GPU work isn't worth it, so turns from
different sessions wait their turn instead of competing for VRAM. Turns in the same
session always run in order.

## Trust

A session starts as `stranger`. Only the owner raises it, through
`PUT /api/gateway/sessions/{key}` with `{"trust_level": "owner" | "known" | "stranger"}`. An
adapter can lower it for one message (`trust_level` on the inbound message), for example
when you address the bot in an ordinary IRC channel, but never raise it.

The `trust_levels` table in the config decides what each level's turns get:

- shared memories, and the other conversations' recent messages;
- the owner's Agent Config notes;
- the knowledge base and web search;
- local tools: MCP servers and file-creating tools;
- whether `<remember>` blocks are saved.

By default `owner` gets everything, and `known` and `stranger` get nothing but their own
conversation. A turn that isn't the owner's also gets `guest.md` in
its system prompt, telling the model it isn't talking with its owner. The effective level
and what it granted are recorded in the run evidence (`kind: "trust"`). Details are in
`mcp/config/gateway/README.md`.

**What someone else says stays in their conversation.** A turn that isn't the owner's
saves its message with that trust level (`messages.trust`), and those words never reach
the owner's other prompts:

- A conversation a non-owner turn has written in is never part of "recent conversations",
  the block of the owner's other recent messages, at any trust level. That block is quoted
  to the model as the owner's own words, in turns that have tools and private memory.
- Inside one conversation, an owner turn sees an earlier non-owner message only as
  `<untrusted-data>`, for example when you continue a lower-trust gateway conversation
  from the desktop.

Conversations from before this existed are tagged once, when the column is added: every
user message in a conversation that a non-owner turn wrote in, going by the sessions and
the run evidence.

## Sessions

A session key is any string of 1–200 characters without whitespace, `/`, `?` or `%`.
Suggested shapes:

- `api:<name>`
- `irc:<network>:#channel` or `irc:<network>:<nick>`
- `schedule:<job>`

A key appears in URL paths, so a `#` must be sent as `%23`.

A session is created on its first message (or by `PUT`) with `session_defaults` from
the config, overridden by any `persona`/`model`/`server_id`/`project_id` sent with that
first message. Later messages can't change these settings; use `PUT` for that.

- **Reset** (`POST …/reset`) starts a new conversation on the next message.
- **Delete** forgets the session. Its conversation stays in the history.
- If the conversation itself is deleted from the desktop, the session starts a new one.

## HTTP

| | |
|---|---|
| `POST /api/gateway/inbound` | `{session, text, sender?, source?, label?, approvals?, trust_level?, wait?, persona?, model?, server_id?, project_id?}` runs one turn and returns `{session, conversation_id, run_id, status, reply, trust_level, error, evidence}`. `reply` has any `<remember>` blocks removed. `status` is `completed`, `failed`, `interrupted` or `timeout`. With `"wait": false` it returns `202`-style `{accepted: true}` at once, and the result arrives as a `turn_result` event. `429` means the session's queue is full. |
| `GET /api/gateway/status` | Active turns, queue depths, pending approvals, subscriber count. |
| `GET/PUT/DELETE /api/gateway/sessions/{key}` | Read, create or update (`persona`, `model`, `server_id`, `project_id`, `label`, `trust_level`), or forget a session. |
| `GET /api/gateway/sessions` | All sessions, most recently active first. |
| `POST /api/gateway/sessions/{key}/reset` | Start a new conversation from the next message. |
| `POST /api/gateway/sessions/{key}/cancel` | Stop the turn in progress. Text already produced is saved, ending in `*(stopped)*`. |
| `GET /api/gateway/sessions/{key}/messages?limit=50` | The session's current conversation. |
| `GET /api/gateway/approvals` | Tool calls waiting for a decision. |
| `POST /api/gateway/approvals/{request_id}` | `{approved: bool}` |

`ARYNWOOD_API_KEY` gates all of these the same way it gates the rest of `/api`.

## WebSocket: `/api/gateway/ws?session=<key>`

Messages from the client:

- `{"type": "subscribe" | "unsubscribe", "session": key}`
- `{"type": "message", "session": key, "text": …, "sender"?: …}`. This also subscribes
  the client to that session.
- `{"type": "approval_response", "request_id": …, "approved": bool}`
- `{"type": "cancel", "session": key}`

The client receives every event of the sessions it follows, each tagged with
`"session"`. These include the chat protocol's events (`status`, `context_used`,
`token`, `approval_request`, `turn_completed`, `memory_saved`, `error`) plus
`turn_started`, `approval_resolved` and a final `turn_result`. A turn started over the
socket keeps running if the socket closes, and its reply is still saved.

## Conversational tool loop

The desktop chat runs tools in a side loop before the persona replies, then pastes the
results into the message. A gateway turn attaches the tools to the conversation itself
(`mcp_tool_agent.run_agent_loop`). Each round, the model either calls tools, whose results
are added to the conversation, or answers. There is no fixed number of rounds: the model
decides when it's done. `max_agent_rounds` in `mcp/config/local_agent/config.json`
(default 10) only stops a model that never answers; it then gets one tool-free round to
answer from what it has.

- **When tools are attached.** A turn gets tools only on the pinned tool-calling model
  (`local_agent/config.json` `model`), on the default server, for a persona with tools
  (`central`, `glyph`, or `tools_enabled`), and at a trust level that grants them. Every
  other turn streams a plain reply, as the desktop does.
- **Which tools.** `central` also gets the MCP servers its message needs. Those are
  picked by the same `gates.json` classifier the desktop uses, asked with the recent
  conversation so follow-ups still route.
- **Same call rules as the desktop's tool loop.** One runner (`_CallRunner`) handles
  repeat detection and fallback-model escalation, schema validation, tiers, approvals,
  telemetry and run steps.
- **The 24-schema cap.** It covers native tools plus every attached server, shared
  round-robin so a big catalog can't crowd out a small one. It limits what's *sent*: a
  server tool that didn't make the cut can still be called by its exact name, and is
  validated and tiered like any other.
- **What the model sees.** Tool results are framed as `<untrusted-data>`. The loop's own
  notes (DENIED, INVALID CALL) are not, because they're instructions. The attached
  servers' `<server>.md` and `AGENT.md` go into the system prompt.
- **Context size.** A turn with MCP servers attached runs at the tool loop's existing
  ceiling (`MAX_TOOL_NUM_CTX`, 12288). Measured: the prompt, 24 Kdenlive schemas and the
  instructions come to about 7k tokens before any history, which doesn't fit 8192. Other
  turns stay at the chat ceiling.
- **Temperature.** Rounds run at temperature 0, like the tool loop, so the final answer
  is deterministic too.

## File memory

The agent keeps a plain-text memory you can open in any editor:

```
~/.local/share/arynwood-mcp/memory/
├── MEMORY.md              durable facts: what it has learned about you and your projects
└── daily/2026-10-02.md    that day's notes: a line per turn, plus short-lived context
```

- **Before each owner turn,** the agent reads `MEMORY.md` and the last two days' notes into
  its prompt, within 15% of the context. A large `MEMORY.md` contributes only the entries
  that share the most words with the message, in their original order.
- **After the turn,** the reply's own `<remember>` blocks are recorded. If there are none,
  one short extraction call on the already-loaded model asks for facts *you* stated or
  confirmed. The assistant's own guesses, web pages and tool output don't count.
- **Where facts go.** Durable facts are appended to `MEMORY.md` with their date and session.
  Short-lived ones go to today's note. A fact already there, or a fragment of one, isn't
  written twice. The write-back runs after the reply, so it never delays an answer.
- **Who it applies to.** Only owner turns read or write it (the `memories` and `memory_writes`
  grants), and only for the personas listed under `file_memory.personas` (default
  `central`). Strangers' messages never reach it. They stay in their own conversation's
  history in the local database, like any conversation.
- **It's yours to edit.** The agent only ever appends, and writes atomically.
  `GET /api/gateway/memory` shows the current files.

This sits alongside the desktop's SQLite memory (the Memory page), which owner turns also
read and which `<remember>` blocks still update.

## IRC

The gateway can live on your own IRC server, so you can message your home AI from any IRC
client, anywhere, and nothing passes through a cloud service. `backend/gateway/irc.py` keeps
a persistent connection. It answers `PING`, reconnects with backoff when the connection
drops, rejoins its channels, and stays under flood limits when it replies.

**Setup.** Everything about your server goes in the overlay
(`~/.local/share/arynwood-mcp/gateway.json`), never in the repo:

```json
{
  "irc": {
    "enabled": true,
    "network": "home",
    "host": "irc.example.net",
    "port": 6697,
    "tls": true,
    "nick": "aryn-bot",
    "nickserv_password": "…",
    "channels": [{"name": "#home", "trust": "owner"}, "#lobby"],
    "owner_accounts": ["your-services-account"]
  }
}
```

Then start the daemon (`python -m backend.gateway`). `GET /api/gateway/status` shows the
connection under `adapters.irc`. Other keys are in `mcp/config/gateway/config.json`:

- `sasl: {"account", "password"}` instead of `nickserv_password`;
- `channel_mode` (`mention` by default: in channels it answers only when addressed as
  `aryn-bot: …`);
- `coalesce_seconds` (1.5): lines from the same person within this window become one
  message, since phone clients often send a long message as several lines;
- `max_reply_lines`, plus the flood and reconnect timings.

**Owner only.** The bot answers messages from `owner_accounts` and nobody else. Everyone else
is ignored and logged: other logged-in accounts, unidentified nicks, and other people in its
channels. Talking with other people isn't something the gateway does (see [scope](scope.md)).

**Identity: accounts, not nicks.** On IRC anyone can take any nick, so the adapter recognises
you by your services account:

- **With the IRCv3 `account-tag` capability,** each message carries its sender's account.
- **Without it,** the adapter asks `WHOIS` and reads the "is logged in as" reply (numeric
  330). It caches that briefly and forgets it when the nick changes or quits.

If the network has no services, nobody can be identified, so the bot answers nobody. It
fails closed.

**Sessions.**

- **A direct message from your account** is your own session, keyed by the account
  (`irc:<network>:~account`), at owner trust.
- **A channel is one session,** at the trust its config entry gives it (default `stranger`).
  When you address the bot there, your message runs at the channel's trust, so in an
  ordinary channel even your own messages can't reach private context or tools.

**Delivery.** A direct reply goes to a nick, and a turn can take minutes. In that time you
could drop off and someone else could take your nick, without the bot seeing it if you
share no channel with it. So before it sends a reply or an approval request in an
account's direct session, the bot re-checks that the nick is still logged in as that
account. It uses `WHOIS`, unless it saw the account on that nick in the last 10 seconds.
If the check fails, the reply is held: it is saved in the conversation, where the desktop
shows it, but it isn't sent. A held approval request times out and is denied. If you
change nick while a turn runs, the reply follows you and is checked the same way.

**Approvals over IRC.** When an owner turn wants a destructive or publishing tool, the bot
posts `Approval needed: <tool> <arguments> … "approve 1a2b3c" or "deny 1a2b3c"`. An answer
counts only if the sender is identified as an owner account at that moment. Anyone else's
is ignored like the rest of their messages, and the request stays pending. Unanswered requests are denied after
`approval_timeout_seconds`, and the reply says the request timed out rather than that you
declined it.

## Approvals

Destructive and external-publish tool calls are never auto-approved. Two rules hold
regardless of config:

- **Only an owner turn asks.** On any other turn there's no approve callback, so the call
  is denied without asking anyone.
- **Only owner trust answers.** A local WebSocket client or HTTP caller counts as owner,
  since reaching the API takes loopback access or `ARYNWOOD_API_KEY`. A chat-network
  adapter must verify the person (NickServ for IRC) before it may answer as owner. An
  answer at lower trust is refused and logged, and doesn't settle the request.

On an owner turn:

- **An owner-trust WebSocket client follows the session:** the request goes to it and
  waits up to `approval_timeout_seconds`.
- **The message was sent with `"approvals": "wait"`:** the request is also held for
  `POST /api/gateway/approvals/{id}`.
- **Nobody can answer:** it's denied at once, and the model is told to say it didn't do
  it.

If the last approver disconnects, or the timeout passes, the request is denied. The
decision and who made it are published as `approval_resolved` and logged.

## Things to know

- **Port and database.** The daemon defaults to `:8020` and the normal database
  (`config/arynwood.db` in a source checkout). That keeps it from colliding with the
  desktop backend on `:8010`. If both run, they share that SQLite file and each has
  its own GPU job queue. To make the daemon *the* backend that the desktop attaches to,
  set `"port": 8010` in the overlay. The packaged app uses an existing backend on
  `:8010` instead of starting its own. Also point `ARYNWOOD_DB_PATH` at the database
  you want the agent to use.
- **Codebase tools are built in.** With `ARYNWOOD_ENABLE_CODEBASE_TOOLS=1`, `mcp_proxy`
  registers the `codebase` server itself and calls it in-process. Whichever backend runs
  the turn uses its own tools. An old `mcp_servers.json` entry pointing at `:8010` is
  overridden.
- **Depends on the uncommitted `chat.py` work.** `turn.py` uses `_persona_reply_tokens`
  and `_stream_reply(reply_tokens=…)`, which are in the working tree's writer-tuning
  changes.

## FAQ

### Can I run Arynwood MCP as an always-on AI agent without the desktop app?

Yes. `python -m backend.gateway` starts the whole Arynwood MCP backend with no window,
listening on `127.0.0.1:8020`. It's meant to run as a systemd user service (the unit
above). Each person or channel that talks to it gets a persistent session that survives
restarts, reached over plain HTTP or a WebSocket.

### Does a self-hosted AI agent like this send my conversations to the cloud?

No:

- The model runs on your GPU through Ollama, with no cloud AI API.
- Conversations, memories and tool calls are stored in a local SQLite file.
- There's no telemetry. The Prometheus metrics at `/metrics` are only served locally.

The one thing that can leave the machine is a web search query, sent to DuckDuckGo when
the agent decides to search. By default only your own (owner) sessions can search; turn
`web_search` off in the config to stop even that.

### Can other people talk to my AI agent?

Not over IRC: the bot answers only your own services account and ignores everyone else.
Sessions created through the local API start as `stranger`, and a stranger's turns get
none of your memories, notes, documents, other conversations, machine paths or tools. Only
you raise a session's trust, through the API.

### Can a local LLM use tools in several steps, like a cloud AI agent does?

Yes. In a gateway turn, the model calls a tool, reads the result, and decides whether to
call another or answer. It keeps going until it decides it's done, with 10 rounds as a
backstop. In a live run it found a definition in this codebase with `find_symbol`, checked
it with `search_code`, then answered with the right file and characters. All of that ran
on a local 14B model.

### Which local model is reliable for tool calling on a 12 GB GPU?

In this project's testing, `hermes3:8b` (Nous Research's Hermes 3, built on Meta's Llama 3.1).
It made all 20 of Arynwood MCP's tool decisions correctly, never called a tool it didn't need,
and ignored instructions planted in tool results. The full comparison of eight models is in the
[tool-calling benchmark](https://github.com/Arynwood-Technology/local-ai-benchmarks/blob/main/TOOL-CALLING.md).

- **Measured on an RTX 3060 (12 GB):** 6.7 GB at an 8,192-token context and 7.5 GB at 12,288,
  all on the GPU, at about 44 tokens per second. Tool turns use the larger context.
- **Keep one turn at a time.** One model serves every turn, and the GPU also runs image
  generation.

### How do I stop a local AI agent from deleting files or publishing without asking?

You don't have to set anything up: Arynwood MCP sorts every tool call into read-only,
reversible, destructive or external-publish. A destructive or publishing call:

- is asked of the owner only, and only on the owner's own turn;
- runs only after an explicit yes;
- is denied if nobody answers, the request times out, or the approver disconnects.

In a live run the agent prepared a patch to a file, the request was denied over the
WebSocket, and the agent replied that it hadn't made the change because the user declined.
The file was untouched.

### Where does a local AI agent keep its long-term memory?

In plain Markdown files on your own disk: `MEMORY.md` for durable facts, plus one note per
day, in `~/.local/share/arynwood-mcp/memory/`. Nothing is uploaded. Arynwood MCP reads the
relevant parts at the start of each of your turns and adds what it learned at the end.

### Can I see and edit what my AI assistant remembers about me?

Yes. Open `MEMORY.md` in any text editor and change or delete anything. The agent only
appends, and each fact it adds is tagged with the date and the conversation it came from,
so you can see where every fact came from. The agent picks up your edits on its next turn.

### Does the agent remember what other people tell it?

No. Only your own owner turns are read into memory or written to it, and the agent may only
record facts you stated or confirmed, never its own guesses or the contents of a web page.
Over IRC nobody else gets through at all. A message saved by a turn that wasn't at owner
trust never appears in your other conversations, and if you continue that conversation
yourself, the agent sees it as an untrusted quote, not as your instruction.

### How do I talk to my home AI server from my phone?

Run Arynwood MCP's gateway at home with the IRC adapter enabled. It connects to your own IRC
server as a bot. Then use any IRC app on your phone and send it a direct message. The model,
the tools and your memory all stay on your home machine; only IRC messages travel, over TLS,
to a server you run.

### Is it safe to put a personal AI agent on IRC, where anyone can take any nick?

Arynwood MCP recognises you by your services account, not your nick. It checks each sender's
account through the IRCv3 `account-tag` capability, or by asking `WHOIS`, and answers only
your account. Someone using your nick without being logged in to your account gets no reply.
Before a private reply goes out, it checks again that the nick is still yours. If the
network can't verify anyone, the bot answers nobody.

### Can someone in my IRC channel make the agent delete files or run tools?

No. The bot ignores everyone but your account. A destructive call is only ever proposed on
your own owner turn, and only your identified account can approve it, with
`approve <code>`.
