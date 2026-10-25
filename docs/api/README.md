# API reference

Everything the Arynwood MCP backend accepts and answers: its HTTP API, its three WebSockets, the one
MCP server it exposes, and its command-line entry points. The per-route pages are generated from the
backend itself; this page explains how to read them and covers what a generator cannot see.

- [HTTP and WebSocket reference](http/README.md): every route, by area, with its parameters, request
  body, response, errors and access rules.
- [`openapi.json`](openapi.json): the machine-readable OpenAPI document, with the opt-in routes included
  and marked `x-arynwood-mounted-only-with`. A running backend serves its own copy at
  `http://localhost:8010/openapi.json`. There is no `/docs` or `/redoc` page: FastAPI loads those from a
  CDN, which would run third-party code on the backend's trusted origin, so they are off. Open the file
  in any OpenAPI viewer you run yourself, or read the pages here.

## Which interface to use

| You are | Use |
|---|---|
| Working on the app (frontend or backend) | The [HTTP reference](http/README.md) and the [chat WebSocket](#chat-websocket-apichatws). The frontend calls the API through `frontend/src/lib/api.ts` (`/api/...`, proxied by Vite in development) and `frontend/src/lib/ws.ts`. |
| Hosting a Grove | The Grove's own API, documented in the [Arynwood Grove repository](https://github.com/Arynwood-Technology/arynwood-community/blob/main/docs/API.md). The Community page reaches it only through [`/api/community/grove/{path}`](http/community.md), which passes requests through unchanged; this backend adds no Grove features of its own. Hosting tasks use the Grove's `arynwood-grove` command on the server. |
| Scripting the app or connecting another program | The HTTP API with a key (see [Access](#access)). For a chat turn: [`POST /api/chat/complete`](http/chat.md#post-api-chat-complete) for the whole reply, or the [chat WebSocket](#chat-websocket-apichatws) to stream it. Tool servers are registered, not called directly: [`/api/mcp`](http/mcp.md) is a client of the MCP servers in `mcp/config/mcp_servers.json`, behind the same approval rules as chat. |
| Running it headless (owner only, experimental) | The [gateway](http/gateway.md) and its [event stream](#gateway-event-stream-apigatewayws); see [docs/gateway.md](../gateway.md). |

The only MCP server the backend itself exposes is [`/api/mcp-codebase`](http/mcp-codebase.md) (JSON-RPC
`tools/list` and `tools/call` over its own source tree), mounted only with
`ARYNWOOD_ENABLE_CODEBASE_TOOLS=1` and inert in a packaged build.

## Access

Every request passes the same checks (`backend/services/auth.py`), in this order:

1. **Host.** The `Host` header must be `localhost`, `127.0.0.1` or `::1`, or an exact name in
   `ARYNWOOD_ALLOWED_HOSTS` (comma-separated; no wildcards). This stops DNS rebinding.
2. **Origin.** A browser request's `Origin` must be the app's own: `http://localhost:5180`,
   `http://127.0.0.1:5180`, `http://localhost:8010`, `http://127.0.0.1:8010`, `tauri://localhost`,
   `http://tauri.localhost` or `https://tauri.localhost`. One exception: GET/HEAD of a Grove website
   preview may come from `Origin: null`, because previews run sandboxed.
3. **Cross-site without Origin.** A request marked `Sec-Fetch-Site: cross-site` with no `Origin` is
   refused, except GET/HEAD of the app's own media files and HTML-tool frames: the packaged app's web view
   loads those exactly that way. Each route open to either exception says so under "Access".
4. **Key.** Without `ARYNWOOD_API_KEY`, only clients on this computer (loopback) are answered. With it,
   every request to `/api/*`, `/metrics` and `/social-media/*`, and every request from another computer,
   needs `Authorization: Bearer <key>`. Browsers can't add that header to a WebSocket, so a WebSocket
   sends `?token=<key>` instead (the backend removes it from its logs).

This is one owner's boundary, not accounts or tenants. [SECURITY.md](../../SECURITY.md) lists what it
protects and the known gaps; `python -m backend.security --json` reports the current configuration.

## Errors

Errors are JSON: `{"detail": "<message>"}`, with the HTTP status. Each route lists the errors it and the
helpers it calls raise, with their messages. A `422` (request doesn't match the documented parameters or
body) carries FastAPI's list instead: `{"detail": [{"loc": [...], "msg": "...", "type": "..."}]}`.

Every route can also answer these, from the access checks above:

| Status | Detail | When |
|---|---|---|
| 400 | `Untrusted Host header` | The `Host` header is not an allowed name |
| 403 | `Untrusted browser origin` | A browser `Origin` that isn't the app's |
| 403 | `Cross-site request denied` | A cross-site request without `Origin` to a route not open to it |
| 401 | `Remote access requires ARYNWOOD_API_KEY` | A request from another computer while no key is set |
| 401 | `Unauthorized` | A key is set and the request's is missing or wrong |

A WebSocket refused by these checks is closed with code 4400 (Host), 4403 (Origin or cross-site) or
4401 (key). GPU-only features answer `409` while CPU mode is on; the message names the feature.

Other conventions: every `/api/*` answer carries `Cache-Control: no-store`; every answer carries
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and, unless a route sets its own,
`Content-Security-Policy: frame-ancestors 'none'`. Several routes relay another service (Ollama, A1111,
an MCP server, a Grove); their reference says "the upstream service's JSON answer, passed through".

## WebSockets

### Chat WebSocket (`/api/chat/ws`)

One socket carries many turns. Send JSON text messages; anything that isn't a JSON object gets
`{"type": "error", "message": "Invalid chat message"}`.

**Send:**

| Message | Meaning |
|---|---|
| `{"message", "persona", "model", "server_host", "server_port", "server_id"?, "conversation_id"?, "project_id"?}` | A new turn (the fields of [`ChatRequest`](http/chat.md#schema-chatrequest)). Without `conversation_id` a new conversation is created; `project_id` only matters then. Up to 8 turns wait behind the active one; another gets an error. |
| `{"type": "approval_response", "request_id", "approved": true\|false}` | Answers the pending `approval_request`. Any other id, a duplicate, or a disconnect counts as a denial. |
| `{"type": "cancel"}` | Stops the active turn. Text already streamed is saved, ending in `*(stopped)*`. |

**Receive** (`type`, then fields):

| Type | Fields | Meaning |
|---|---|---|
| `conversation_id` | `id` | A new conversation was created for this turn |
| `status` | `label` | What is happening before the reply streams ("Checking your knowledge base…") |
| `context_used` | `web_search`, `kb_sources` (`title`, `source`, `source_id`, `score`, `page_start`, `page_end`), `tool_servers` | What informed the reply; sent once before it streams, only when something did |
| `approval_request` | `request_id`, `tool`, `arguments`, `tier`, and for MCP calls `server`, `intent_digest`, `expires_in_seconds` | A destructive or publishing tool call is waiting; answer with `approval_response` |
| `approval_resolved` | `request_id`, `tool`, `approved` | The decision, whichever way it was made |
| `token` | `token`, `done` | Reply text; `done: true` comes after the reply is saved and `turn_completed` sent |
| `turn_completed` | `run_id`, `status`, `evidence` | The run's evidence trail (also at [`GET /api/chat/conversations/{id}/runs`](http/chat.md#get-api-chat-conversations-conversation-id-runs)) |
| `memory_saved` | `items` (each may carry `conflict_with`) | The persona saved provisional memories |
| `cancelled` | | The active turn has stopped and cleaned up |
| `error` | `message` | The turn failed, or the message was invalid |

### Gateway event stream (`/api/gateway/ws`)

Only where the gateway is mounted. Connect with `?session=<key>` to follow one session at once.

**Send:** `{"type": "subscribe" | "unsubscribe", "session"}`, `{"type": "message", "session", "text",
"sender"?, "source"?, "label"?, "trust_level"?}` (also subscribes you to its replies),
`{"type": "approval_response", "request_id", "approved"}` and `{"type": "cancel", "session"}`.

**Receive:** the chat events above, each tagged with `session`, plus `turn_started` (`conversation_id`,
`sender`, `trust_level`), `approval_resolved` (with `by`), `memory_written` and a final `turn_result`
(the fields of the gateway's turn result). `cancel` is answered with `{"type": "cancelled", "session",
"stopped"}`. A connected client counts as an approver for the sessions it follows. Rules for trust and
approvals: [docs/gateway.md](../gateway.md).

### Grove relay (`/api/community/grove/{path}`)

Only `irc/ws` (the Grove host's IRC connection) and `chat/ws` (the Grove's Public chat). The backend
opens the same socket on the Grove with the sign-in it holds, then passes messages both ways unchanged
(text and binary, up to 8 MB each). If the Grove refuses or can't be reached, this socket closes with
1011; any other path closes with 1008. The message format is the Grove's own.

## Command line

| Command | What it does |
|---|---|
| `./start.sh` | Backend (`:8010`) and the Vite dev server (`:5180`), from a source checkout |
| `uvicorn backend.api:app --host 127.0.0.1 --port 8010` | The backend alone |
| `./arynwood-desktop.sh`, `./arynwood-app.sh` | The desktop shell over a source checkout ([installation](../installation.md)) |
| `python -m backend.gateway [--host H] [--port P]` | The headless gateway daemon (`:8020` by default) |
| `python -m backend.security [--json] [--strict] [--host H]` | The exposure checks, without credentials or network probes |
| `python backend/mcp_orchestrator.py` | A terminal persona picker and chat loop (not used by the app) |
| `scripts/push-guard.py`, `scripts/smoke_packaged_backend.py` | Maintainer tools; each starts with its own usage |

Settings come from the environment and `.env` (`ARYNWOOD_*`; see [supported platforms](../supported-platforms.md)
and [`.env.example`](../../.env.example)).

## How this reference is made

```bash
venv/bin/python scripts/gen_api_reference.py          # rewrite docs/api/http/ and docs/api/openapi.json
venv/bin/python scripts/gen_api_reference.py --check  # fail if they are out of date
```

The generator imports the backend with a throwaway database and every optional router mounted, reads
FastAPI's OpenAPI document for methods, paths, parameters, request bodies and descriptions (the route
handlers' docstrings), and reads each handler's source for what the spec doesn't have: response shapes
(return statements, the columns of a returned database row, what a stream yields) and errors (the
`HTTPException`s the handler, its dependencies and the backend helpers it calls raise). Nothing is fetched
from the network. `tests/test_api_reference.py` fails when the checked-in pages are out of date, and checks
that every route the backend serves has a section.

What that means for reading it:

- The response descriptions are read from code, not from a typed schema: a field list says which keys the
  handler builds, not each value's type. The [index](http/README.md) gives the counts; one operation's
  response is shown as the expression its handler returns.
- A relayed answer (Ollama, A1111, an MCP server, a Grove) is described as passed through; its shape is the
  other service's.
- This page (access, errors, WebSocket messages, command line) is written by hand. It was checked against
  `backend/services/auth.py`, `backend/routers/chat.py`, `backend/routers/gateway.py`,
  `backend/gateway/runner.py` and `backend/routers/community.py`; when they change, change it too.
