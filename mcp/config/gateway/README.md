# gateway

Config for the headless gateway (`backend/gateway/`): the always-on service that
runs the agent with no desktop window attached and keeps one persistent session per
outside conversation (an API client, later an IRC user or channel, a scheduled job).

- `config.json` — shared defaults, safe to commit. Nothing personal goes here.
- **Overlay:** `<data dir>/gateway.json` (`~/.local/share/arynwood-mcp/gateway.json`
  on Linux; `ARYNWOOD_GATEWAY_CONFIG` points somewhere else). Same keys, merged on
  top of `config.json` (nested objects key by key). It lives outside the repo in
  every build, like `personas.local.json`, so it can't be committed or pushed by
  accident — put anything personal there.

| Key | Meaning |
|---|---|
| `bind_host`, `port` | Where `python -m backend.gateway` listens. Loopback by default; set `ARYNWOOD_API_KEY` before opening it to the LAN. |
| `session_defaults` | `persona`, `model` (`null` = the persona's own), `server_id` (`null` = local Ollama), `project_id` for a session created without explicit settings. Only `central` gets memory and tool servers. |
| `max_concurrent_turns` | Turns running at once across all sessions. Every turn lands on the same GPU; leave at 1 unless the model fits twice in VRAM. |
| `max_queued_per_session` | Messages a session may have waiting before new ones are refused (HTTP 429). |
| `approval_timeout_seconds` | How long a destructive or external-publish tool call waits for an approver before it is denied. |
| `turn_timeout_seconds` | A turn still running after this is stopped. Text already produced is kept, ending in `*(stopped)*`. |
| `trust_levels` | What a turn at each trust level may use (below). A missing level or key means no. |
| `irc` | The IRC adapter (daemon only). Server, nick, channels, accounts and passwords go in the overlay, never here; see docs/gateway.md. `enabled`, `network` (label in session keys), `host`, `port`, `tls`, `nick`, `sasl` or `nickserv_password`, `channels` (names, or `{name, key, trust}`), `owner_accounts`, `known_accounts`, `channel_mode`, `answer_strangers`, `persona`, reply/flood/reconnect limits. |
| `file_memory` | `dir` (`null` = `<data dir>/memory`), `personas` that use it (default `central`), `daily_days` of notes to read, `context_share` of the prompt it may take, `extract_facts` (the post-turn extraction call). See docs/gateway.md. |

- `guest.md` is added to the system prompt of any turn that isn't the owner's. `{who}` and
  `{source}` are filled in with the sender and the adapter.

## Trust levels

Every session is `owner`, `known` or `stranger`. A new session starts as `stranger`, and only
`PUT /api/gateway/sessions/{key}` raises it. An adapter can lower it for a single message
(an IRC nick that isn't identified right now), never raise it.

| Switch | Grants |
|---|---|
| `app_environment` | The prompt's Environment section: this machine's project path (your home directory), the project tree, local URLs and the app's capability list. Off = the persona's `app_aware: false` behavior. |
| `memories` | Shared memories in the prompt, and the `search_memory` tool. |
| `recent_conversations` | The last few user messages from *other* conversations. |
| `agent_notes` | The owner's Agent Config notes. |
| `knowledge_base` | Knowledge-base excerpts, and `search_knowledge_base`. |
| `web_search` | Web search: the `web_search` tool, or automatic search for personas without tools. The query goes to DuckDuckGo, the only thing a turn sends off this machine, so only `owner` has it by default. |
| `local_tools` | MCP tool servers (Kdenlive, codebase) and tools that create files on this machine. |
| `memory_writes` | `<remember>` blocks in the reply are saved. |

The persona prompt lists `chat.py`'s native tools as one set, so a level gets all of them
(it needs `memories`, `knowledge_base`, `web_search` and `local_tools`) or none of them. A
level with `web_search` alone gets automatic web search instead.

**Approvals aren't configurable.** A destructive or external-publish tool call is put to an
approver only on an owner turn. Only an owner-trust approver can answer it: a local WebSocket
client, or an HTTP caller that sent `"approvals": "wait"`. A chat-network adapter must verify
the person (NickServ for IRC) before it answers as owner. With nobody able to answer, the
call is denied at once, the same default `run_tool_loop` uses with no approve callback.
