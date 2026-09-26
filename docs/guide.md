# Arynwood MCP — Developer Guide

---

## What Is Arynwood MCP?

Arynwood MCP is a **local-first AI creative studio** built and operated by Arynwood. It combines:

- **Multi-model LLM chat** via Ollama (local) and remote servers, with tool-calling into a running Kdenlive instance
- **GPU tool orchestration** — Stable Diffusion, TortoiseTTS, SadTalker, Whisper, and more
- **Music/sound production** — AI generation (ACE-Step/MusicGen), jam with AI, stem separation, voice conversion, effects, mastering
- **Design center** — canvas-based design tool
- **Video Studio** — Kdenlive automation, video generation/edit/caption pipeline
- **Social media publishing** — Facebook, Instagram, YouTube, LinkedIn
- **Tauri desktop app** — wraps the React frontend in a native window

The backend is Python/FastAPI. The frontend is React 19 + Vite + Tailwind v4. The whole thing runs locally on a Linux workstation.

---

## Installation

### Requirements

- Python 3.10+
- Node.js 20.19+ or 22.12+
- Rust (for Tauri builds)
- Ollama (for LLM features)
- Docker (for TortoiseTTS and other containerized tools)

### Setup

```bash
git clone https://github.com/Arynwood-Technology/Arynwood-MCP
cd Arynwood-MCP

# Python backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Frontend
cd frontend && npm install && cd ..

# Copy and fill in secrets
cp .env.example .env
# Edit .env with your credentials
```

---

## Running the App

### Development (Vite dev server)

```bash
./start.sh
```

This starts:
- FastAPI backend with `--reload`
- React Vite dev server

Access the app at `http://localhost:5180`.
API docs at `http://localhost:8010/docs`.

Backend and Ollama bind to `127.0.0.1` by default; set `ARYNWOOD_BIND_HOST=0.0.0.0`
and `OLLAMA_HOST=0.0.0.0` in `.env` for LAN access (pair with `ARYNWOOD_API_KEY`).

### Production (Tauri desktop app)

```bash
./arynwood-desktop.sh
```

This starts:
- FastAPI backend on port 8010
- Tauri binary (`frontend/src-tauri/target/release/arynwood`)
- Builds Tauri on first run (~2 minutes)

### Backend only

```bash
source venv/bin/activate
uvicorn backend.api:app --host 0.0.0.0 --port 8010 --reload
```

---

## AI Chat System

### WebSocket Protocol

Connect to `ws://localhost:8010/api/chat/ws` (the Vite dev server proxies this, so
in-app it is just `/api/chat/ws`).

**Send** — a new turn:
```json
{
  "message": "Hello, Arynwood",
  "persona": "central",
  "model": "qwen2.5-coder:14b",
  "server_host": "localhost",
  "server_port": 11434,
  "conversation_id": 42,
  "project_id": null
}
```
(`project_id` is optional and only matters when `conversation_id` is omitted, i.e. on
new-conversation creation.)

**Send** — a response to a pending `approval_request` (see below): this is not a new
turn, it answers one already in progress, and must be sent before anything else once
`approval_request` arrives:
```json
{"type": "approval_response", "request_id": "...", "approved": true}
```

**Receive** (streaming):
```json
{"type": "conversation_id", "id": 42}
{"type": "status", "label": "Checking your knowledge base…"}
{"type": "context_used", "web_search": false, "kb_sources": [...], "tool_servers": []}
{"type": "approval_request", "request_id": "...", "tool": "delete_track", "arguments": {...}, "tier": "destructive"}
{"type": "token", "token": "Hello", "done": false}
{"type": "token", "token": "!", "done": true}
{"type": "memory_saved", "items": [...]}
{"type": "error", "message": "..."}
```
`status` is purely informational (drives the "what Arynwood is doing" indicator in the
UI). `context_used` is sent once, right before the reply streams, only when there's
something to disclose. `approval_request` pauses the turn — see "MCP Tool-Calling"
below for what requires it.

### Personas

Defined in `mcp/config/models.json`, hot-reloaded on every `GET /api/chat/personas` call:

| Key | Display Name | Character | Model |
|-----|-------------|-----------|-------|
| `central` | Arynwood | Coordinator, general assistant | `qwen2.5-coder:14b` |
| `doc` | Doc | Systems architect | `qwen2.5` |
| `kona` | Kona | Creative, exploratory | `qwen2.5` |
| `glyph` | Glyph | Automation specialist | `qwen2.5` |
| `estra` | Estra | Writer, editor | `qwen2.5` |

Only `central` has native tool-calling and MCP tool-server access (Kdenlive etc.) — see
below. To change a persona's model, edit `mcp/config/models.json`.

### Web Search

Two different mechanisms, depending on persona:

- **`central`**: a native tool the model calls itself when it decides a question
  needs current/changing information — no keyword matching, an actual judgment call
  made by the model each turn.
- **Every other persona**: the older heuristic — a message containing one of ~19
  trigger words (`search`, `look up`, `what is`, `latest`, `news`, `today`, `price`,
  `best`, `tool`, etc.) gets DuckDuckGo results injected automatically. Known to
  false-positive on generic phrasing; not yet worth native tool-calling for personas
  whose models haven't been verified to call tools reliably.

### Knowledge Base

Every persona's messages now run a semantic similarity search against the knowledge
base (Qdrant + Ollama embeddings, hybrid with a lexical pass so an exact name/path/
error string can surface even with an unremarkable cosine score) and inject the top
matches automatically — set `knowledge_enabled: false` on a persona in
`mcp/config/models.json` to opt it out. See `backend/services/knowledge.py` and the
Knowledge page.

Re-learning a URL/file you've already taught Arynwood supersedes the old version instead
of creating a duplicate — the old source row is kept (for history) but its vectors
are removed from search. `POST /api/knowledge/preview` shows how a text would be
chunked before you commit to ingesting it.

PDFs learned via the Knowledge page's file mode get a deep parse instead of a plain
text dump: Sycamore's local layout model (+ optional OCR, table-structure extraction)
runs as a background job (`POST /api/knowledge/sycamore/jobs`, polled via
`GET /api/knowledge/jobs/{id}`), producing chunks tagged with page number and whether
they contain a table, so search results can cite "p.4" or "table" instead of an opaque
chunk index. Runs in a dedicated venv at `~/GitHub/sycamore/lib/sycamore/.venv` (a
sibling checkout, not part of this repo) — if that path doesn't exist on a given
machine, PDF learning fails with a clear error rather than silently degrading. See
`docs/sycamore-integration-plan.md` for the full design and `docs/architecture.md`'s
`/api/knowledge` section for the endpoint list. Non-PDF files (text, code, `.docx`)
still go through plain pdfminer/pypdf extraction via `POST /api/knowledge/upload`.

### MCP Tool-Calling (Kdenlive and beyond)

For the `central` persona, every message is checked against each registered server's
gate in `mcp/config/local_agent/gates.json` — **an LLM classification call, not a
keyword match** (a `hints` list is descriptive context for the classifier, not an
allowlist) — and a match runs a bounded tool-calling loop against that MCP server
(see `backend/services/mcp_tool_agent.py`, `gather_context_for_message`) before the
reply streams, injecting the result as context. This always uses a fixed local model
(`mcp/config/local_agent/config.json`) regardless of the conversation's own model.
Adding a new server needs no new Python — just an entry in `mcp_servers.json`, a
`<server>.md`, and a `gates.json` entry.

Every tool the loop can call is classified read-only / reversible-write / destructive
/ external-publish (`mcp_tool_agent.classify_tool_tier`). Read-only and
reversible-write calls just happen; destructive and publish-tier calls pause the turn
and send an `approval_request` over the websocket (tool name, arguments, tier) — the
call only proceeds if the client sends back `{"type": "approval_response", ...,
"approved": true}` with the matching `request_id`. No approval mechanism wired up (or
a "no") denies by default; the model is told why rather than the action silently
happening. Arguments are also schema-validated before a call goes out — an invalid
call gets a specific repair message back instead of an opaque server error.

This is distinct from `central`'s own native web/memory/knowledge-base tools
(see "Web Search" and "Knowledge Base" above) — those are a small, fixed, read-only
toolset the model calls directly, no external server or approval step involved.

### Memory System

The chat router parses `<remember>` blocks in AI responses and saves them to the
`arynwood_memory` table — always as `status: "provisional"`, never auto-confirmed. A
provisional memory still shows up in future system prompts (labeled "(unconfirmed)"
so the model treats it as its own claim, not settled fact) but only counts as
trusted once a human confirms it via `POST /api/memory/{id}/confirm` (the Chat page's
memory panel has a one-click button for this). Memories also carry a `volatility`
(`durable` vs `transient` — a stale transient one ages out of retrieval after about a
week) and an optional `conflict_with_id`, set when a new memory looks like it
contradicts an existing pinned/confirmed one. Retrieval is relevance-ranked (a
separate Qdrant collection, `backend/services/memory_index.py`) rather than loading
every memory into every prompt — pinned memories are always included regardless.

### File Upload

`POST /api/chat/upload` — accepts PDF, DOCX, code files, plain text (1 MB limit). Returns extracted text (truncated to 12,000 characters) for use as conversation context.

This is deliberately small — it's for pasting a file into the current chat's context
window, not for full-document ingestion. The Knowledge page's file-learn path uses its
own separate `POST /api/knowledge/upload` (50 MB, no truncation) instead — see
Knowledge Base above.

---

## Ollama Integration

### Supported Server Types

- **Local Ollama** (`localhost:11434`) — auto-seeded in the database
- **Remote Ollama** — add via Servers page or POST `/api/servers`
- **OpenAI-compatible** — any server implementing `/v1/models` + `/v1/chat/completions`

### Model Management

Pull, list, and delete models from the Model Manager page or directly:

```bash
curl -X POST http://localhost:8010/api/ollama/pull \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen2.5-coder:14b", "host": "localhost", "port": 11434}'
```

Pull requests stream progress back. The endpoint checks server reachability first.

---

## Tool Library

Registered in `tools.py`. Categories:

| Category | Tools |
|----------|-------|
| Image | Stable Diffusion (A1111), Real-ESRGAN, rembg, Florence-2 |
| Audio | TortoiseTTS, AllTalk (XTTSv2), Kokoro, Chatterbox, Whisper |
| Video | SadTalker |
| Search / Data | SearXNG, Qdrant, Scrapling (web scraping) |
| Static HTML tools | design-center, paint-studio, flowchart, terminal, client-intake (see `static/html-tools/`) |

Each tool has a `port` or `endpoint` and the system checks if it's running via HTTP ping. Tools report status (`running`, `stopped`, `unknown`) in the Tool Library page.

### Running a Tool

Tools are started externally (via their own launch scripts or Docker). Arynwood MCP monitors and communicates with them via their local HTTP APIs.

**Stable Diffusion** (port 7860): Start with `./webui.sh` in the A1111 directory. The Design Center page embeds a canvas UI that generates via A1111.

**TortoiseTTS** (port 5003): Run via Docker.

---

## Deployment System

The Deploy page (route `/publish`) manages SSH/SFTP deployments to remote web servers.

**Add a target**:
- Via Servers page or POST `/api/deploy/targets`
- Supports password auth or SSH key auth
- Supports IPv4 and IPv6 addresses

**Operations**: File upload, download, delete, directory listing. Path traversal protection enforced.

---

## Adding a New Backend Route

1. Create `backend/routers/myfeature.py`:
```python
from fastapi import APIRouter

router = APIRouter()

@router.get("/")
async def list_things():
    return {"things": []}
```

2. Register in `backend/api.py`:
```python
from backend.routers import myfeature
app.include_router(myfeature.router, prefix="/api/myfeature")
```

3. Add a frontend API call in `frontend/src/lib/api.ts`:
```typescript
export const getThings = () => request<Thing[]>('/myfeature')
```

---

## Adding a New Frontend Page

1. Create `frontend/src/pages/MyPage.tsx`. Build it from the shared primitives and
   the page skeleton rather than inline styles:

```tsx
import { PageShell, PageBar, PageBody, Button, EmptyState } from '../components/ui'

export function MyPage() {
  return (
    <PageShell>
      <PageBar><Button variant="primary">Do the thing</Button></PageBar>
      <PageBody>
        <EmptyState title="Nothing here yet" />
      </PageBody>
    </PageShell>
  )
}
```

2. Add the route in `frontend/src/App.tsx`, **inside** the `AppShell` layout route:

```tsx
<Route element={<AppShell />}>
  ...
  <Route path="/mypage" element={<MyPage />} />
</Route>
```

3. Add the destination to `frontend/src/components/layout/nav.ts`:

```ts
{ to: '/mypage', icon: Sparkles, label: 'My Page' },
```

That one entry drives both the sidebar and the command palette (`NAV_DESTINATIONS`
is derived from `NAV`), so there is no second list to keep in sync.

A page that is a *tool reached from another page* rather than a destination (the DJ
Toolkit is the example: a small button on Music opens `/dj`) skips this step. Give the
parent's nav entry `also: ['/dj']` so it stays highlighted, and add a "Back to …" link on the
tool page.

4. Add the page's title to `ROUTE_TITLES` in
   `frontend/src/components/layout/AppShell.tsx`. Only do something else if the
   title depends on state — then call `usePageTitle()` from the page instead, the
   way `Chat` does for the active persona name.

**Playing or downloading a backend file?** Use `apiUrl('/api/...')` for `<audio src>`,
`<video src>`, `<img src>` and links, and `DownloadButton` for downloads — a relative `/api/...`
there only works in a dev run, not in the packaged desktop app (see `docs/architecture.md`,
"The packaged desktop app").

**Do not render `TopBar` from the page.** It is mounted once by `AppShell`. Every
page used to render its own, which is why there was nowhere to host the command
palette or status drawer.

---

## Troubleshooting

### Ollama connection failing

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve
```

### Frontend not reflecting backend changes

If running without `--reload`, restart uvicorn:
```bash
pkill -f uvicorn
source venv/bin/activate
uvicorn backend.api:app --host 0.0.0.0 --port 8010 --reload
```

---

## Project Philosophy

- **Local-first**: Everything runs on your own hardware. No cloud dependencies for core features.
- **One hub**: Rather than separate apps for chat, generation, editing, and publishing, Arynwood MCP is a single interface for all of it.
- **AI-assisted, not AI-only**: Every tool has a direct UI; Arynwood's chat is an additional way in (e.g. Kdenlive tool-calling), not a replacement for the tool UI.
