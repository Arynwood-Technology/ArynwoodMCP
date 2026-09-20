# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What This Is

**Arynwood MCP** is a local-first AI creative studio built by Arynwood LLC. It
exposes a unified UI for multi-persona LLM chat (with tool-calling into a running
Kdenlive instance), GPU media generation (Stable Diffusion, TTS, voice conversion,
LoRA training, and more), a music/sound production studio, a design canvas, and
social media publishing. Deployment target: multi-tenant managed hosting or
self-hosted license.

## Running the App

```bash
# Start backend + frontend together
./start.sh

# Backend only (repo root, venv active)
source venv/bin/activate
uvicorn backend.api:app --host 0.0.0.0 --port 8010 --reload

# Frontend only
cd frontend && npm run dev
```

URLs: App → http://localhost:5180 | API → http://localhost:8010 | API docs → http://localhost:8010/docs

This is the source-checkout dev workflow. The packaged Linux desktop build
(AppImage/`.deb`, what actually ships to users) is a separate path — see
`docs/installation.md` for end-user instructions and the "Tauri packaging" gotcha
below for how it's built and its packaged-build-only failure modes.

> **Port mismatch fixed 2026-09-10.** `start.sh` and `arynwood-desktop.sh` used to
> launch uvicorn on `:8000` while `frontend/vite.config.ts` pins the dev server to
> `5180` (`strictPort: true`) and proxies `/api` — and the chat WebSocket — to
> `:8010`. All three launch scripts (`start.sh`, `arynwood-desktop.sh`,
> `arynwood-app.sh`), `tauri.conf.json`'s `devUrl`, and every hardcoded
> `localhost:8000`/`:5173` reference in the frontend/backend now agree on
> `8010`/`5180` — one canonical port pair, dev and packaged production build alike.
> All three launchers also now bind the backend (and Ollama) to `127.0.0.1` by
> default instead of `0.0.0.0`; set `ARYNWOOD_BIND_HOST=0.0.0.0` (and `OLLAMA_HOST`)
> in `.env` to opt into LAN exposure deliberately — pair that with
> `ARYNWOOD_API_KEY` when you do, since there's still no frontend login flow.

## 4-Layer Architecture

### Layer 1 — Frontend (React 19 / Vite / TypeScript)

All source in `frontend/src/`.

- **`main.tsx`** → **`App.tsx`** (React Router v7 entry) — `App.tsx` is now only a
  route table; every route is a child of one layout route, `AppShell`
- **`pages/`** — one file per section: `Dashboard`, `Chat`, `ModelManager`, `Servers`,
  `ToolLibrary`, `Deploy`, `DesignCenter`, `Knowledge`, `Studio`, `DJStudio`, `Social`, `Video`
- **`components/layout/`** — `AppShell` (the single host for global chrome: mounts
  `Sidebar` + `TopBar` + `CommandPalette` + `StatusDrawer` once, owns the
  system-status poll, keeps `DesignCenter` permanently mounted so its iframe survives
  navigation, and wraps `<Outlet/>` in `PageErrorBoundary` keyed by route). `TopBar`
  is presentational — its title comes from `AppShell`'s `ROUTE_TITLES`, or from
  `usePageTitle()` for a page whose title is state-derived (only `Chat`, which shows
  the live persona name). Do **not** render `TopBar` from a page; that was the old
  pattern and left no host for global UI.
  - **`nav.ts`** — the one nav model. `NAV` drives the sidebar; `NAV_DESTINATIONS`
    (flattened) is what the command palette searches, so adding a page here makes it
    reachable from both with no second list
  - **`CommandPalette`** — Ctrl/Cmd+K. Searches pages, personas, models, recent
    conversations, tools, plus actions (new chat, status, toggle sidebar, restart API).
    All its state lives in an inner `PaletteBody`, because Radix unmounts portal
    children while closed — so each open starts clean with no reset effect
  - **`StatusDrawer`** — opened from the sidebar's connectivity dot, the TopBar GPU
    chip, or the palette. One place showing backend/Ollama/servers/active-model/GPU +
    queue/Qdrant/MCP/sidecars/SD/TTS/Prometheus, each with a live retry (ping, restart,
    start sidecar) and a concrete fix line shown only when that row is not OK. Same
    inner-body pattern as the palette
- **`components/ui/`** — shared primitives: `Button`, `IconButton`, `StatusBadge`,
  `SectionCard`/`SectionLabel`, `EmptyState`, `PageShell`/`PageBar`/`PageBody`.
  CVA variants live in `ui/variants.ts` (kept out of the component files so React
  Fast Refresh keeps working). `IconButton` **requires** a `label` prop, which becomes
  both `aria-label` and the tooltip — the type is what stops new unlabelled icon buttons
- **`components/studio/`** — `EffectsRack`, `StemSeparator`, `VoiceConversion`
- **`lib/cn.ts`** — `clsx` + `tailwind-merge`; lets a caller's `className` override a
  primitive's built-in classes instead of both landing in the output
- **`lib/api.ts`** — typed fetch wrapper; all calls go through `request()` which prefixes `/api` (Vite proxies to `:8010`, including WebSocket)
- **`lib/ws.ts`** — WebSocket client for streaming chat. Reconnects with 1s→10s backoff and ignores events from any socket that is no longer current (`ws.test.ts`); `Chat`/`Dashboard` reset in-flight state (and hand a failed message back to the composer) in their `onClose`. `disconnect()` is intentional teardown: no reconnect, no `onClose`
- **`lib/api.ts` `apiUrl()`, `lib/download.ts`, `components/DownloadButton.tsx`, `lib/mic.ts`** — the pieces that make the
  *packaged* app behave: absolute backend URLs for media elements and links, blob-based downloads, and microphone
  helpers that survive WebKitGTK's quirks. See the "`fetch()` is patched…" gotcha below before adding any media or
  download UI
- **`store/useAppStore.ts`** — single Zustand store: system status, active persona/model/server, conversations, tools, `pageTitle` override, `sidebarExpanded`, palette/drawer open flags, the Dashboard's embedded Arynwood chat state. Wrapped in `persist` with a `partialize` that saves **only** `sidebarExpanded` — everything else is server state or per-session and must not survive a reload
- **`lib/useMediaQuery.ts`** — `useSyncExternalStore` over `matchMedia`, for the few places a breakpoint changes behaviour rather than styling (the sidebar forces its rail under 900px regardless of the saved preference)
- **`frontend/src-tauri/`** — Tauri v2 Rust shell for desktop packaging

Key dependencies: `lucide-react`, `react-router-dom`, Radix UI (Dialog, DropdownMenu, Tabs),
Tailwind v4 + `clsx`/`tailwind-merge`/`class-variance-authority`.

### Styling: mid-migration to Tailwind v4

`index.css` holds the single source of truth for design tokens in a Tailwind v4
`@theme` block (`--color-bg`, `--color-surface`, `--color-accent`, …), which emits both
the CSS custom properties *and* the matching utilities (`bg-surface`, `text-muted`).
The old `--bg` / `--surface` / `--text-muted` names are kept as plain `:root` aliases
that re-export `@theme`, so the ~1,000 inline `style={{}}` objects still in unmigrated
pages keep working with no second source of truth. They are deliberately *not* in
`@theme` — Tailwind v4 owns the `--text-*` namespace for font sizes and `--text` would
collide.

`AppShell`, `Sidebar`, `TopBar`, `Chat`, `Dashboard` and everything in `components/ui/`
are migrated to Tailwind classes; the rest of `pages/` and `components/` still use
inline styles. Both idioms coexist safely — migrate a file when you're already working
in it rather than in a separate sweep. Data-driven colours (e.g. `TYPE_COLORS` in
Chat's memory panel) legitimately stay inline; Tailwind can't generate dynamic classes.

**Cascade-layer trap:** Tailwind v4 emits utilities in `@layer utilities`, and *unlayered* CSS
beats every layered rule regardless of specificity. The global form-control reset in
`index.css` therefore lives in `@layer base` — as plain CSS it silently overrode every
`text-*`/`px-*`/`rounded-*`/`bg-*` class on an `<input>`/`<select>`/`<textarea>` in a
migrated file. Put any new element-level default in `@layer base`, never bare.

`index.css` also carries the global `:focus-visible` ring and a
`prefers-reduced-motion` block — the app had neither, and the form reset strips the UA
outline, so keyboard users previously had no focus indicator anywhere.

### Layer 2 — Backend (FastAPI / Python 3.10+)

- **`backend/api.py`** — entry point; registers all routers, calls `init_db()` via `lifespan()`
- **`backend/db.py`** — SQLite at `config/arynwood.db`; `get_db()` yields an `aiosqlite` connection with `row_factory = aiosqlite.Row`
- **`backend/routers/`** — one router file per domain (see table below)
- **`backend/services/knowledge.py`** — Qdrant embeddings async CRUD; extracts text from txt/md/pdf/docx/epub. PDFs additionally get a background-job deep parse via Sycamore (local layout model + optional OCR/table extraction) — see `docs/sycamore-integration-plan.md`
- **`backend/services/mcp_tool_agent.py`** — shared bounded tool-calling loop that bridges Arynwood's chat to any server in `mcp/config/mcp_servers.json`; `gather_context_for_message` dispatches across every registered server whose `mcp/config/local_agent/gates.json` gate is classified a match by an LLM call (not keyword substring matching — see "Local tool-calling agents" below). Also owns tool permission tiers (`classify_tool_tier`), schema validation/repair, and optional fallback-model escalation on repeated stalls.
- **`backend/services/memory_index.py`** — semantic index for `arynwood_memory` (separate Qdrant collection from the knowledge base), so chat retrieves memories relevant to the current turn instead of loading all of them every time
- **`backend/services/telemetry.py`** — Prometheus counters/histograms for LLM calls (`ollama_client`) and MCP tool calls (`mcp_tool_agent`), exposed at `/metrics` alongside the HTTP-level metrics `prometheus-fastapi-instrumentator` already provides
- **`backend/services/auth.py`** — opt-in bearer-token gate for the whole `/api/*` surface (HTTP + the chat WebSocket); a no-op unless `ARYNWOOD_API_KEY` is set in the environment
- **`backend/external_paths.py`** — where the tools that live *outside* the repo are found (kohya_ss, AnimateDiff, Whisper/SadTalker/Chatterbox venvs, A1111 model dirs, MusicStudio, Sycamore). Each resolves own `ARYNWOOD_*` env var > group root (`ARYNWOOD_TOOLS_DIR`/`_SERVICES_DIR`/`_PROJECTS_DIR`) > a default under `$HOME`; nothing checks existence, so a missing tool degrades that one feature. Standalone `scripts/run_*.py` can't import it (different interpreter) and repeat the lookup inline — keep the env var names in sync. Documented in `docs/supported-platforms.md`
- **`backend/mcp_orchestrator.py`** — CLI persona picker + chat loop (not part of web app)
- **`backend/persona_runner.py`** — synchronous Ollama client used by CLI only

### Layer 3 — Config & Static Data

| Path | Purpose |
|---|---|
| `config/arynwood.db` | SQLite runtime state (all tables) |
| `mcp/config/models.json` | Persona definitions (Arynwood, Doc, Kona, Glyph, Estra — see Personas below) — loaded at runtime by `chat.py` |
| `mcp/config/mcp_servers.json` | External MCP tool server registry (name → HTTP URL, currently configured for just `kdenlive` when present), read by `mcp_proxy.py`. Gitignored/personal — not tracked in git, shared across branches on this machine, and **not guaranteed to exist** on a given checkout (its absence silently disables all MCP tool dispatch — see gotcha below) |
| `mcp/config/local_agent/` | Config + instructions for the local tool-calling model (see below) — `config.json` (`model`, `ollama_url`, `max_tool_rounds`, optional `fallback_model` for stall escalation), `AGENT.md` (shared rules: tool-call discipline, untrusted-tool-result framing, pre/post-action self-check), `gates.json` (one entry per server — `hints` are descriptive context for the LLM classifier now, not a substring allowlist), `<server>.md` per registered server (currently `kdenlive.md`, includes worked example call sequences) |

### Layer 4 — External Services

| Service | Port / Address | Consumer(s) |
|---|---|---|
| Ollama (local or remote) | `:11434` (remote: `<remote-ollama-host>`) | `chat.py`, `ollama.py` |
| TortoiseTTS / AllTalk | `:5003` | `tools.py` |
| Stable Diffusion A1111 | `:7860` | `tools.py` |
| Qdrant | local socket | `backend/services/knowledge.py` |
| SearXNG | local instance | `tools.py` |
| Facebook / Instagram / YouTube / LinkedIn | OAuth | `social.py` |
| Prometheus | `:9090` | `system.py` |
| Docker Compose | — | TortoiseTTS, Prometheus |
| mcp-kdenlive (systemd user service, `~/GitHub/kdenlive-arynwood/mcp-kdenlive`) | `:8420` | `mcp_proxy.py` → `mcp_tool_agent.py` |

### Tool-calling: two distinct mechanisms

There are now two separate ways a reply can involve a tool — don't conflate them
when reading `chat.py`/`mcp_tool_agent.py`.

**1. Native tool-calling (central only).** `central`'s own model (`qwen2.5-coder:14b`
— chosen specifically because it's the same model mechanism 2 below already trusts
for reliable tool-calling) gets a small curated toolset — `web_search`,
`search_memory`, `search_knowledge_base` — via `chat.py`'s `_stream_reply` /
`_NATIVE_TOOLS`. Ollama streams identically whether or not tools are attached (it
never populates the native `tool_calls` field for this model; a tool call arrives as
`{"name":...,"arguments":...}` JSON in plain content, sometimes *prefaced with a full
prose lead-in sentence* — confirmed live, not just in theory). Because of that,
`_stream_reply` fully buffers a tools-enabled round before deciding whether it's a
tool call or a real answer, then delivers a real answer as a progressive reveal
(`_deliver_complete_text`) rather than a true live network stream. Every other
persona (Doc, Kona, Glyph, Estra) has no native tools and streams truly
live from the first token, exactly as before this existed — only `central` pays the
buffering trade, and only on tool-enabled rounds.

**2. The external MCP tool-calling loop (any registered server, e.g. Kdenlive).**
For every message, `chat_ws` calls `mcp_tool_agent.gather_context_for_message`, which
checks the message against every server's gate in `mcp/config/local_agent/gates.json`
— **an LLM classification call now, not keyword substring matching** — and on a
match, runs a small bounded tool-calling loop *before* the streaming reply via
`mcp_tool_agent.run_tool_loop` (same "auto-injected context block" idiom as the
web-search / knowledge-base injections in `chat.py`). This loop always uses the fixed
local model in `mcp/config/local_agent/config.json` (currently `qwen2.5-coder:14b`)
regardless of which model the conversation itself is using — empirically the other
persona models don't reliably call tools at all.

To wire up a new server: register it in `mcp/config/mcp_servers.json`, add
`mcp/config/local_agent/<server>.md` with its tool/schema hints and (ideally) a few
worked example call sequences, and add a `gates.json` entry (its `hints` are
descriptive context fed to the classifier, not an allowlist). No new Python module
needed — this used to require a `<server>_agent.py` with a hardcoded keyword list per
server; `gates.json` + LLM classification replaced that pattern.

Every tool call through this loop — Kdenlive's ~180 tools included — is classified
read-only / reversible-write / destructive / external-publish
(`mcp_tool_agent.classify_tool_tier`, verified against the real tool manifest).
Destructive/publish calls require a caller-supplied `approve` callback to say yes;
with none given (or a "no"), the call is denied and the model is told why rather than
the action silently happening. `chat_ws` wires this to a real approval round-trip
over the websocket — see the WebSocket protocol section below. Arguments are also
schema-validated before a call goes out (`_validate_tool_arguments`) — an invalid
call gets a specific repair message instead of an opaque server error, and only ~24
of a large tool catalog get sent as schemas per call (`_filter_relevant_tools`) since
sending Kdenlive's full ~180-tool list on every round both cost latency and made
model tool-selection worse.

Expect real limitations regardless of tier: the model sometimes guesses a
plausible-but-wrong tool/column name and needs the curated hints in
`mcp/config/local_agent/kdenlive.md` to recover, and it can confidently report a
wrong-but-plausible answer from real query results (verify anything consequential).
`mcp/config/local_agent/AGENT.md` now also asks it to state its expected outcome
before a destructive call and verify with a read-only follow-up after, but that's
prompt guidance, not a hard guarantee.

Kdenlive is also registered directly with Claude Code itself at user scope
(`claude mcp list`), so Claude Code sessions can drive it without going through Arynwood
at all.

Both mechanisms wrap externally-sourced text (web search results, KB excerpts, tool
results) in `<untrusted-data source="...">` tags before it reaches a persona's
prompt, paired with a standing system-prompt rule to never treat delimited content as
instructions — a scraped page or a maliciously-named clip is exactly the kind of
thing that could contain text engineered to look like a command.

A small live eval suite (`tests/test_evals_live_behavior.py`, excluded from the
default `pytest` run — see `pytest.ini`'s `-m "not eval"`) checks both mechanisms'
actual decisions against real Ollama: gate classification accuracy and native
web-search trigger accuracy. Run it after touching either mechanism's prompts or
model:

```bash
pytest tests/ -m eval -v   # needs Ollama reachable; ~30s
```

It already earned its keep once: it caught native tool-calling silently leaking raw
tool-call JSON into a reply when the model prefaced the JSON with a lead-in sentence
— a case a manual check with a simplified stand-in system prompt had missed, because
the real (long, conversational) `central` system prompt behaves differently.

## The Routers

All mounted under `/api/<domain>` by `backend/api.py`.

| Domain | Router | Endpoint prefix | What it does |
|---|---|---|---|
| **Core** | `chat.py` | `/api/chat` | Multi-persona (5) LLM chat with WebSocket streaming (`/ws`) — token-budgeted system prompt (memory/history/project-tree trimmed to fit the model's real context window, not Ollama's silent 2048 default), native tool-calling + approval gating for `central`, relevance-ranked memory retrieval, web search / knowledge-base injection, per-conversation history summarization |
| | `ollama.py` | `/api/ollama` | Ollama model management — list, pull (SSE stream), delete, show, ping |
| | `servers.py` | `/api/servers` | Ollama server registry with live connectivity ping |
| | `system.py` | `/api/system` | Health check, GPU info (nvidia-smi), backend restart, and `GET /gpu-queue` — a read-only view of `gpu_jobs.gpu_queue` (`running`, `depth`, `waiting`) so the UI's status drawer can explain *why* a generate is waiting rather than looking hung |
| **Productivity** | `deploy.py` | `/api/deploy` | SFTP deployment targets, remote file browser, upload, publish-to-web |
| | `fs.py` | `/api/fs` | Local filesystem tree/read for AI context injection, and Design Center's save dialog |
| **AI / Memory** | `memory.py` | `/api/memory` | Persistent named memories for Arynwood (CRUD) — `status` (confirmed/provisional, `POST /{id}/confirm` to promote), `volatility` (durable/transient, stale transient ones age out of retrieval), `conflict_with_id` (flagged when a new memory looks like it contradicts an existing trusted one) |
| | `knowledge.py` | `/api/knowledge` | `!learn` command + hybrid (vector + lexical) semantic search via Qdrant; requires ollama.service running. Source versioning (`POST /learn` on an already-learned `source` supersedes it — old row kept for history, old vectors removed) and `POST /preview` (see chunk boundaries before committing an ingest). PDF learn routes through a Sycamore parse job (dedicated sibling-repo venv, `gpu_queue`-coordinated — see gotcha below) |
| | `mcp_proxy.py` | `/api/mcp` | Proxy to external MCP tool servers (list tools, call tool) |
| | `projects.py` | `/api/projects` | Minimal project entity (name/description) that conversations, memories, and knowledge sources can optionally link to via a `project_id` column — additive; does not touch or unify `lora_projects`/`content_projects`/`music_assets`, which remain separate, already-working per-domain project concepts |
| **Social** | `social.py` | `/api/social` | OAuth flow + posting for Facebook, Instagram, YouTube, LinkedIn |
| **Creative** | `studio.py` | `/api/studio` | Music sidecar management: stem separation (Demucs), voice conversion (RVC), effects chain, reference mastering — stateless HTTP proxy to `~/GitHub/MusicStudio/sidecars/*` |
| | `music.py` | `/api/music` | Music Lab: Instrument Generator + Jam with AI, backed by the song-gen sidecar (ACE-Step/MusicGen). DB-backed (`music_assets`, `music_generation_jobs`) and `gpu_queue`-coordinated, unlike `studio.py`'s stateless proxy — see `MusicStudio/CLAUDE.md`'s song-gen section for the two-venv ACE-Step/MusicGen split |
| | `tools.py` | `/api/tools` | GPU tool registry + generation: SD (A1111 proxy), TortoiseTTS, AllTalk, Kokoro, Chatterbox, SadTalker, rembg, Real-ESRGAN, Florence-2 caption, SearXNG, Qdrant |
| | `lora.py` | `/api/lora` | LoRA dataset prep + training job management |
| | `video.py` | `/api/video` | Video generation/edit/caption jobs, video library |
| | `dj.py` | `/api/dj` | DJ Toolkit — launcher + built-in manual for Mixxx/Ardour/Hydrogen/Surge XT/Vital/Flatseal/Calf/LSP/Dragonfly/Geonkick. Desktop GUI apps with no HTTP surface (unlike every other router here) — status comes from `flatpak ps` / `pgrep` on the backend host; launch just spawns and forgets (`start_new_session=True` so a `--reload` restart doesn't kill a running app). "Sessions" bundle multi-tool launches (e.g. Ardour+Hydrogen, which share transport over PipeWire/JACK). Deliberately not a sidebar destination: the Music page has a small "DJ Toolkit" button that opens `/dj` (see `nav.ts`'s `also`, which keeps Music highlighted there). Keep its content generic — no personal paths, no installed-version numbers; `tests/test_dj_router.py` fails if they come back |

## WebSocket Chat Protocol

Two distinct message shapes travel from client to server on the same socket — a new
chat turn, or a response to a pending approval — and the connection handler consumes
exactly one `receive_text()` per pending decision (see the approval flow below), so a
client must not send a new chat message while `approval_request` is outstanding; it
will be consumed as that request's (denied) response instead of starting a new turn.

Send a new turn: `{ message, persona, model, server_host, server_port, conversation_id?, project_id? }`
(`project_id` only matters on new-conversation creation, i.e. when `conversation_id` is omitted)

Send an approval decision: `{ type: "approval_response", request_id, approved }`
(`request_id` must match the pending `approval_request`; anything else — wrong id,
malformed JSON, a disconnect — is treated as `approved: false`)

Receive JSON messages by `type`:
- `"conversation_id"` — echoed on new conversation creation
- `"status"` — a short human-readable label describing what's happening before the reply streams (e.g. "Checking your knowledge base…", "Using web_search…") — purely informational, no response expected
- `"context_used"` — sent once, just before the reply streams, disclosing what actually informed it: `{ web_search: bool, kb_sources: [{title, source, source_id, score, page_start, page_end}], tool_servers: [label, ...] }`. Only sent when there's something to disclose
- `"approval_request"` — the turn is paused waiting for a decision on a destructive/external-publish tool call: `{ request_id, tool, arguments, tier }`. Reply with the approval-decision send shape above before anything else
- `"token"` — streaming token; `done: true` signals completion
- `"error"` — error string
- `"memory_saved"` — persona emitted a `<remember>` block; items saved to `arynwood_memory` as `status: "provisional"` (never auto-confirmed — see `POST /api/memory/{id}/confirm`); an item may include `conflict_with` if it looked like it contradicted an existing trusted memory

## Personas

Personas live in `mcp/config/models.json`, keyed by id:

| Key | Name | Role | Model |
|---|---|---|---|
| `central` | Arynwood | Coordinator | `qwen2.5-coder:14b` |
| `doc` | Doc | Architect | `qwen2.5` |
| `kona` | Kona | Creative | `qwen2.5` |
| `glyph` | Glyph | Automation | `qwen2.5` |
| `estra` | Estra | Writer | `qwen2.5` |

The frontend does **not** hardcode this list — `GET /api/chat/personas` (see `backend/routers/chat.py`) reads `mcp/config/models.json` fresh on every call, overlays the user's own `personas.local.json` on top (see below), and the Chat page renders whatever comes back — so adding/editing a persona takes effect immediately with no frontend change and no restart.

**Personal personas are data, not code.** `backend/routers/chat.py`'s `load_personas()` merges `personas_overlay_path()` — `ARYNWOOD_PERSONAS_FILE`, else `~/.local/share/arynwood-mcp/personas.local.json` (`_frozen.xdg_data_dir()`) — over the bundled set; an entry with a bundled id replaces it, a malformed file is ignored with one log line. It lives in the per-user data dir in *every* build (never the checkout) so it can't be committed. `tests/test_persona_overlay.py::test_bundled_personas_are_exactly_the_public_set` fails if a private persona is added to the bundled `models.json`. User-facing guide: `docs/customizing-personas.md`.

Only `central` has native tool-calling, relevance-ranked memory, and MCP tool-server access (Kdenlive etc.) — the other four run on system-prompt-plus-history plus (as of recently) knowledge-base injection, which is now on for every persona by default (`knowledge_enabled: false` in a persona's `models.json` entry opts out). See "Tool-calling: two distinct mechanisms" above.

Two more optional per-persona `models.json` fields, both consumed by `build_system_prompt`
in `backend/routers/chat.py`:

- **`app_aware`** (default `true`) — set `false` for a persona built entirely around its
  own `system` instructions with no real access to any of this app's features (no native
  tools, no MCP/Kdenlive gate). `true` unconditionally tells a persona it has GPU tools,
  web scraping, and Kdenlive control — accurate only for `central` (`NATIVE_TOOLS_PERSONAS`,
  `is_aryn` gate) — which measurably pulls a persona with no such access toward generic
  "capable assistant" behavior instead of staying in whatever voice its own instructions
  establish. `false` drops the Environment/Available-capabilities/Project-layout sections
  but keeps the "Handling external content" security instruction, since web search and
  knowledge-base injection still apply regardless of `app_aware`.
- **`llm.num_ctx`** — overrides `MAX_NUM_CTX` (currently 8192, a deliberate ceiling below
  any model's native max — see that constant's comment for the single-12GB-GPU VRAM
  tradeoff) for one persona specifically. Meant for a persona whose own `system` prompt is
  an unusually large fraction of the default ceiling — enough that conversation history
  and the reply itself can get squeezed and truncated even though nothing looks wrong at
  the request level. Still clamped to the model's real native context by the `min()` at
  each call site; this only raises the ceiling below that, at the same VRAM cost as raising
  `MAX_NUM_CTX` itself, so use it only for a persona that actually needs the headroom.

## Database

SQLite at `config/arynwood.db`. Key tables: `servers`, `conversations`, `messages`,
`settings`, `deploy_targets`, `arynwood_memory`, `knowledge_sources`, `social_accounts`,
`social_posts`, `lora_projects`, `youtube_uploads`, `content_projects`, `music_assets`,
`music_generation_jobs`, `projects`. Full schema in `backend/db.py`. Use `get_db()` as
a FastAPI dependency.

`conversations`, `arynwood_memory`, and `knowledge_sources` each carry a nullable
`project_id` pointing at `projects` (name/description only) — additive linkage, not a
merge of the pre-existing separate `lora_projects`/`content_projects`/`music_assets`
project concepts, which remain standalone. Arynwood's own long-term memory (`arynwood_memory`)
also has a parallel, non-SQL index: every row is embedded into a dedicated Qdrant
collection (`arynwood_memory_index`, see `backend/services/memory_index.py`) so retrieval
can rank by relevance to the current message instead of loading every row every turn;
it's kept in sync by `memory.py`'s CRUD endpoints and re-embedded in full on every
backend startup (cheap at this table's scale, and simpler than tracking dirty rows).

## Frontend Dev Commands

```bash
cd frontend
npm run dev       # dev server with HMR
npm run build     # tsc + vite build
npm run lint      # eslint
npm run preview   # preview production build
```

## Branching, private data, and pushing

**One branch of code: `main`, tracking the public remote. There is no long-lived personal
branch** (that model let general work pile up on the private side and made one wrong-direction
merge a leak). Anything personal is *data outside the repo*:

- Personal personas → `~/.local/share/arynwood-mcp/personas.local.json`, normally a symlink into a
  separate private repo (`~/GitHub/arynwood-private`, local-only, created by `install.sh` there).
  That repo also holds the fine-tuning pipeline and the push denylist.
- The daily-use desktop app is built from `main`; the overlay supplies the personal personas at
  runtime. What you run every day is exactly what ships.
- Developer-only features that expose the source tree (`mcp_codebase`) are opt-in:
  `ARYNWOOD_ENABLE_CODEBASE_TOOLS=1` in `.env`.

**Push guard.** Run `scripts/install-hooks.sh` once per clone (sets `core.hooksPath=.githooks`).
The `pre-push` hook runs `scripts/push-guard.py`, which for any remote not listed in the private
repo's `private-remotes.txt` (so an unknown remote is treated as public): allows only `main` and
`v*.*.*` tags; and scans every *new* commit's message, added lines and paths against the private
`push-denylist.txt` and a built-in list of forbidden paths. It scans commit by commit, so a
leak that a later commit "removes" is still refused. It **fails closed** if the private repo can't
be read. Dry-run: `python3 scripts/push-guard.py --range public/main..main`. Deliberate bypass:
`git push --no-verify`. The public repo contains none of the private terms — they're only in the
private repo — and `tests/test_push_guard.py` covers the guard with throwaway repos, including a
real `git push`.

## Known Issues / Gotchas

### `knowledge.py` requires `ollama.service` running
The knowledge router (`/api/knowledge`) depends on Qdrant for vector storage and Ollama for embeddings. If `learn` or `search` calls fail, check `systemctl status ollama` first.

Correction (2026-08-07): this used to say "bind address crash-loop issue" — checked
`journalctl -u ollama` going back 60 days and found no trace of that. What's actually
there: `ollama.service` (`Restart=always`, hasn't needed it — `NRestarts=0`, up since
Jul 25) periodically fails a single model load with `cudaMalloc failed: out of memory`
/ `unable to allocate CUDA0 buffer` when something else (A1111, most often) is already
holding most of the 12GB card. Same root cause as the SD/A1111 corruption bug fixed
via `gpu_queue` (see GPU job queue below) - except Ollama runs as its own systemd
service, outside this app's process, so `gpu_queue` can't coordinate with it directly.
Ollama exposes `GET /api/ps` (currently-loaded models) and accepts `keep_alive: 0` on
a request to unload immediately after - the hook a real fix would use, mirroring
`_free_sd_vram_for_job`. Not built yet (task #14 in the improvement backlog).

### A1111 `/sdapi/v1/unload-checkpoint` can 500 with VRAM still held
Seen 2026-08-08: the endpoint threw `AttributeError: 'NoneType' object has no attribute 'lowvram'` in `send_model_to_cpu` (A1111's own internal state got into `sd_model = None` while the checkpoint's VRAM was still allocated — `/sdapi/v1/memory` showed ~7GB still active). This isn't the same as the checkpoint-corruption bug `gpu_queue` was built for; it's a wedged A1111 process. Fix: `docker restart a1111` (check `/sdapi/v1/progress` first to confirm nothing is mid-render), wait for `/sdapi/v1/options` to return 200 again, then retry. Any script that frees A1111 VRAM before its own job (mirroring `_free_sd_vram_for_job`) will hard-fail with this exact traceback if it hits A1111 in this state.

### Ollama remote host
Remote Ollama is at whatever host is configured for it (see the Servers page / `servers` table). The local instance is at `localhost:11434`. Both are seeded into `config/arynwood.db` on first `init_db()`. Chat's server picker sends `server_host`/`server_port` per request.

### Tauri packaging (Linux desktop) — how it actually works, and what broke the first time

`frontend/src-tauri/` (Rust, Tauri v2) is the real desktop shell as of v0.4.x —
published as an AppImage and `.deb` (see `docs/installation.md`), not a later phase.
The backend ships as a PyInstaller onefile binary (`arynwood-backend.spec` →
`frontend/src-tauri/binaries/arynwood-backend-x86_64-unknown-linux-gnu`), spawned by
Tauri's Rust shell as an `externalBin` sidecar (`start_backend_sidecar()` in
`main.rs`) rather than the app trying to invoke `python3` directly. `backend/_frozen.py`
splits bundled read-only payload (`app_base_dir()` — `static/`, `mcp/config/`) from
writable state (`user_data_dir()` — DB, generated media — the XDG data dir when
frozen, since an AppImage mounts read-only and a `.deb` installs to a
non-user-writable path).

**The CORS trap that broke every `/api/*` call in the packaged build (fixed
2026-09-11).** The packaged webview's real `Origin` header on Linux is
`tauri://localhost` — a raw custom URI scheme, *not* remapped to `http://` the way
Windows/Android do it (WebView2/WKWebView can't navigate a non-http(s) scheme;
WebKitGTK on Linux has no such limitation and keeps the scheme as-is). This is
documented directly in the vendored `tauri` crate source
(`tauri-2.10.3/src/app.rs`, its doc comment on custom-protocol origin format) — an
earlier fix pass misread a *different* part of that same file (`get_for_scheme`,
which only affects CSP header text, not the runtime origin) and shipped a CORS
`allow_origin_regex` that required `https?://`, which can never match
`tauri://localhost`. The result: **100% of `/api/*` preflight requests failed with a
real HTTP 400** from `CORSMiddleware` — confirmed via a live traffic capture, not
guessed — while every curl-simulated preflight against the same backend succeeded,
because curl never triggers a real preflight the way a browser does. A 100%-vs-0%
split across every router, with zero exceptions, is the signature of this exact bug
class: a categorical origin/scheme mismatch, not an edge case. Fix:
`backend/api.py`'s `CORSMiddleware.allow_origins` includes `"tauri://localhost"` as
an exact string (not the regex — it's a fixed non-http(s) scheme, not a variable
one).

**Same root cause hit the CSP too.** Tauri's IPC channel itself uses the URI
`ipc://localhost/{cmd}` (confirmed in `tauri-2.10.3/src/ipc/protocol.rs`), which
needs to be in `connect-src` in `frontend/src-tauri/tauri.conf.json`'s `app.security.csp`
or internal plugin calls (e.g. the notification-permission check) get silently
blocked. Separately, `style-src` needs its own explicit directive listing
`https://fonts.googleapis.com` — CSP only falls back a specific directive (e.g.
`style-src`) to `default-src` when that directive is *entirely absent*, so an
unrelated `default-src` that doesn't list a host doesn't help once `style-src`
exists at all elsewhere. A Tauri plugin's JS-side call can also be blocked by a
*third*, unrelated gate — its ACL/capabilities system
(`frontend/src-tauri/capabilities/default.json`) — independent of CSP; the
notification plugin needed `"notification:default"` added there too, on top of the
CSP fix, before it actually worked.

**Other real packaged-build-only bugs worth knowing about, all fixed:**
- **WebKitGTK's DMA-BUF renderer bug** produced a blank gray window on launch —
  fixed by setting `WEBKIT_DISABLE_DMABUF_RENDERER=1` at the very top of `main()`
  (Linux-only).
- **WebKitGTK keeps its own persistent on-disk HTTP cache**
  (`~/.local/share/<tauri-identifier>/WebKitCache`) that kept serving stale
  `/api/*` responses across app relaunches even after the backend itself was
  already returning current data — a backend-side `Cache-Control: no-store` fix on
  every `/api/*` response (see `_no_cache_api_responses` in `backend/api.py`) was
  necessary but not sufficient on its own; the existing on-disk cache from earlier
  debugging had to be cleared once by hand too.
- **`DesignCenter.tsx`'s iframe `src` must be absolute** in a packaged build
  (`http://localhost:8010/html-tools/...`), not the relative path that works in dev
  via Vite's proxy — there's no such proxy once the frontend is served from Tauri's
  own origin, so a relative URL 404s inside Tauri's asset protocol and the iframe
  never loads at all.
- **A stale dev backend can "port-squat" `:8010`.** `start_backend_sidecar()`
  checks `port_open()` and skips spawning its own sidecar if something's already
  listening there — correct behavior for "don't double-launch," but it means a
  leftover `uvicorn --reload` process from source-checkout dev work (or, during
  debugging, a manually-started backend instance) will make the packaged app
  silently talk to the wrong backend instead of its own bundled one. Always confirm
  `lsof -i :8010` is clear of unrelated processes before treating a packaged-app
  bug report as reproduced.
- **A hand-rolled `__file__`-relative path chain silently broke `mcp_servers.json`
  in a packaged build** (fixed 2026-09-15). `mcp_proxy.py`'s `_CONFIG_PATH` used to
  compute its location via `dirname(dirname(dirname(__file__)))` instead of the
  `app_base_dir()`/`user_data_dir()` split `_frozen.py` exists specifically to
  replace (its own docstring warns this exact pattern "doesn't reliably land on the
  same place" once PyInstaller repacks the module tree) — nobody had migrated this
  one call site. Worse, `app_base_dir()` alone wouldn't have been the right fix
  either: unlike `models.json`/`local_agent/*` (real bundled app payload),
  `mcp_servers.json` is personal/gitignored per-install config (bearer tokens,
  host-specific URLs) — mutable state, not something baked into a build, so it
  needed the same split `db.py`'s `_default_db_path()` already uses for the DB.
  Fixed: source checkout keeps `mcp/config/mcp_servers.json` under the repo root
  unchanged; a packaged build now reads/writes it straight from `user_data_dir()`
  (`~/.local/share/arynwood-mcp/mcp_servers.json` by default) since a packaged
  install's own directory isn't writable anyway. **The same `dirname(dirname(dirname(__file__)))` pattern in `music.py`, `lora.py`,
  `tools.py`, `system.py` and `gpu_jobs.py` was audited and removed (2026-09-18).**
  It wasn't just an unmigrated path — in a packaged build it pointed into PyInstaller's
  temporary extraction dir, so Music Lab recordings, saved Chatterbox voices and every GPU
  job's output vanished on quit. Everything now goes through `_frozen.py`: read-only
  payload (`scripts/`, `static/`) via `app_base_dir()` (`gpu_jobs.APP_DIR`), writable
  per-user state via `user_data_dir()` (`gpu_jobs.DATA_DIR`). `tests/test_packaged_paths.py`
  fails if a `__file__` repo-root chain or a hardcoded `/home/<user>/` path reappears.
  **`scripts/` is still not bundled** by `arynwood-backend.spec`, and launching them
  isn't solved either: LoRA/Wan2/LTX run them via `sys.executable` (which, frozen, is the
  backend binary itself, not an interpreter) while the rest shell out to a bare `python3`
  on PATH — which is why GPU tools are source-checkout-only. Making them work in the
  packaged app is an open design decision (bundle + locate an interpreter, or disclose as
  unavailable), not a bug to patch.
- **`POST /api/system/restart` can't work in a packaged build** (it touches `backend/api.py`
  to trigger `uvicorn --reload`, and `main.rs` only logs a sidecar's `Terminated` event —
  it never respawns it). It returns 501 there, `GET /api/system/status` reports
  `can_restart`, and the UI hides the controls. A real fix means adding a respawn loop to
  `start_backend_sidecar()`, which needs a Tauri rebuild to verify.

- **The AppImage had no GStreamer plugins, so the first audio element crashed the web view** (fixed
  2026-09-18). WebKitGTK does all media through GStreamer — `<audio>`/`<video>`, `MediaRecorder`, microphone
  capture. Tauri bundles GStreamer's *libraries* but no *plugins* unless `bundle.linux.appimage.bundleMediaFramework`
  is on, and the AppImage's environment (`GST_PLUGIN_SYSTEM_PATH_1_0`, set by the gtk hook) points GStreamer only
  at the bundle, so the host's plugins weren't a fallback either. Result: `GStreamer element autoaudiosink not
  found` and a NULL-pointer `g_signal_connect_data` critical in `WebKitWebProcess`, then the process died —
  the window goes solid grey while `arynwood` and the backend keep running (`pgrep -f WebKitWebProcess` empty).
  Music Lab playback, Video Studio preview and mic recording all depend on it; none of it can be seen from a
  source checkout or Chrome. `scripts/stage_gstreamer_plugins.sh` stages the ~42 plugins a web view needs
  (playback, libav decode, pulse/alsa/pipewire, `transcode`+`voaacenc`+`encoding` for `MediaRecorder` — found by
  delta-debugging all 240 host plugins; without them it throws "unsupported" or records 0 bytes) and prints
  `GSTREAMER_PLUGINS_DIR` for the bundler; without it the bundler copies all 273 host plugins and their whole
  dependency tree (VA-API, CUDA, WebRTC…). Needs `patchelf` and the `gstreamer1.0-*` packages on the build machine.
  The `.deb` is unaffected (it uses the system's GStreamer). **Test media in a real WebKitGTK, not Chrome:**
  `scripts/check_webkit_media.py` (system `python3-gi` + `gir1.2-webkit2-4.1`, run under `xvfb-run`) plays a
  WAV/MP3/MP4 and records via `MediaRecorder` under whatever plugin set the environment gives it; its docstring has
  the environment for an extracted AppImage. WebKit's `no such element factory "x"` (with
  `GST_DEBUG=GST_ELEMENT_FACTORY:2`) names what to add. Beware `gst-launch` passing: it proves plugins load, not that
  WebKit can use them (MediaRecorder needed three plugins no gst-launch pipeline ever touched).
- **`fetch()` is patched for the packaged app; nothing else is** (fixed 2026-09-19). `main.tsx` rewrites a
  string `/api/...` passed to `fetch`, but `<audio src>`, `<video src>`, `<img src>`, `new Audio()`, `el.src =`,
  `<a href>` and `window.open()` resolve a relative `/api/...` against `tauri://localhost`, which serves the
  app's `index.html` (audio → `MEDIA_ERR_SRC_NOT_SUPPORTED`; a download saves the HTML page). **Wrap every such URL
  in `apiUrl()`** (`lib/api.ts`; `VITE_BACKEND_ORIGIN` overrides the origin for tests). **Downloads of backend files
  use `DownloadButton` / `downloadFile()`** (fetch → blob → `<a download>`), never a bare `<a href download>`: in real
  WebKitGTK a cross-origin `download` attribute is silently ignored, a blob one is honoured. The CSP in
  `tauri.conf.json` needs `media-src ... blob:` or every `blob:` preview (files picked from disk, recordings) fails
  with error 4. `main.rs`'s `on_download` must leave `destination` alone — wry pre-fills Downloads + the name WebKit
  suggests. None of this shows in a source checkout, because Vite proxies `/api` and the origin is the backend's.

**Building and verifying an AppImage locally (do NOT install it over the user's daily app).**
```bash
git status --short                                   # build from a CLEAN committed tree, never mid-edit
venv/bin/pyinstaller --noconfirm arynwood-backend.spec           # -> dist/arynwood-backend
venv/bin/python scripts/smoke_packaged_backend.py dist/arynwood-backend   # GATE: must print ALL CHECKS PASSED
cp dist/arynwood-backend frontend/src-tauri/binaries/arynwood-backend-x86_64-unknown-linux-gnu
eval "$(scripts/stage_gstreamer_plugins.sh "$TMPDIR/gst-plugins")"   # curated GStreamer set — see the gotcha below
cd frontend && APPIMAGE_EXTRACT_AND_RUN=1 npx tauri build --bundles appimage \
  --config '{"version":"0.4.2-dev.'$(git rev-parse --short HEAD)'"}'   # label it: it is NOT the published 0.4.2
```
Output: `frontend/src-tauri/target/release/bundle/appimage/`. The `--config` version override only names the
file, so the repo's version files stay in step (`tests/test_version_consistency.py`). Verify the artifact
without launching it (a launch opens a window and fights any running app for :8010): extract with
`APPIMAGE_EXTRACT_AND_RUN=1 ./x.AppImage --appimage-extract`, run the smoke test against
`squashfs-root/usr/bin/arynwood-backend`, check nothing private is bundled, and check the media stack in a real WebKitGTK:
`find squashfs-root -name 'libgst*.so' | wc -l` must be well above 0, then run `scripts/check_webkit_media.py` with
the extracted bundle's environment (its docstring has the exact command) — WAV, MP3, MP4 must play and the recorder
must produce bytes. Run it against the *previous* extraction as a control: it prints `GStreamer element autoaudiosink
not found` and times out (the renderer died = the grey window). The bundled backend is
~4 KB larger than `dist/arynwood-backend` (bundler alignment) — expected; the smoke test on the extracted
copy is the proof, not a checksum comparison. A Rust rebuild is ~2 minutes incrementally. Never
`pkill -f <pattern>` from a shell whose own command line contains the pattern — it kills the shell.

**Diagnosing the packaged app when something's wrong:** WebKitGTK devtools can be
enabled temporarily via the `"devtools"` Cargo feature on `tauri` plus
`window.open_devtools()` in `main.rs`'s `.setup()` — deliberately not left on by
default in a release build (stripped before v0.4.2 shipped), so re-add both
deliberately, rebuild, and remove them again before the next real release. A
`Monitor`-tail on a manually-launched instance of the exact bundled binary is
another way to capture real request traffic live (see the git history around
2026-09-11 for how that live-capture setup found the CORS bug above).

### mcp-kdenlive service must be running for Kdenlive chat features
`mcp_tool_agent.gather_context_for_message` silently skips a server (returns `""`, no context injected, no error surfaced to the user) if `mcp/config/mcp_servers.json` has no entry for it, or it isn't reachable — by design, so a down tool server never breaks normal chat. If Kdenlive questions to Arynwood stop producing live results, check `systemctl --user status mcp-kdenlive` first before assuming a code bug.

Verified 2026-09-04: on that checkout, `mcp/config/mcp_servers.json` didn't exist at
all (not just "kdenlive unreachable" — there was no file, so `_load_servers()`
returned `{}` and every gate was skipped before it even ran the classifier) — a more
basic failure mode than the service being down. Registered as of 2026-09-15 (see the
Tauri packaging section above for a related path-resolution bug this surfaced); gate
classification and a real read-only tool round-trip against a live Kdenlive session
are now confirmed working end-to-end, in both the source checkout and the packaged
build. Still open: the tool-permission-tier/approval-gate path in `mcp_tool_agent.py`
(destructive/external-publish tiers, the approval round-trip over the chat
WebSocket) has only ever been exercised through mocked tests, never a real
approve/deny click against a live Kdenlive session — that still needs doing.

**"Kdenlive isn't running" is a distinct, expected failure (2026-09-18).** The MCP service
can be up while the Kdenlive GUI is closed; every tool then fails at the D-Bus layer. Since
`kdenlive-api` now raises `KdenliveNotRunning`, tools return `ERROR: Kdenlive isn't running —
…` instead of a raw `gdbus … exit status 1` command line (which is all the model used to see,
hence replies like "an issue with the current setup"). That fix lives in the sibling
`kdenlive-arynwood/kdenlive-api` repo and only takes effect after
`systemctl --user restart mcp-kdenlive`. Tools still report failure as a *successful* MCP
result (`isError: false`, error only in the text) — a known, unfixed protocol-level nit.

### A packaged backend's environment is toxic to its children — and to any test that forgets it
The AppImage + PyInstaller backend runs with `PYTHONHOME`, `PYTHONPATH`, `LD_LIBRARY_PATH`, `PATH`, GTK/GIO
variables etc. all pointing into its own read-only bundle. Right for it, fatal for anything else it spawns:
a sidecar's venv Python under the bundle's `PYTHONHOME` dies at interpreter start with `Fatal Python error:
init_fs_encoding … No module named 'encodings'`, and it did so silently because stderr went to `DEVNULL`
(reproduced 2026-09-18 against the real running app's `/proc/<pid>/environ`). `_frozen.
sanitize_environ_for_children()` strips bundle-rooted entries (a user's own entries survive) and runs first
thing in `run_server.py`; `studio.start_sidecar` also sanitizes its copy. **Any new `subprocess`/`Popen` in
the backend inherits the clean environment for free — keep it that way; never spawn with an env built from
scratch that re-adds those variables.** Sidecar output goes to `~/.local/share/arynwood-mcp/logs/
sidecar-<id>.log`; a sidecar that dies is `failed` (with `error`), not `stopped`. Test it with a real child
process under a poisoned `PYTHONHOME` (`tests/test_child_environment.py`), not a mock.

### Before any release: smoke-test the FROZEN backend
`pyinstaller arynwood-backend.spec` then `python3 scripts/smoke_packaged_backend.py dist/arynwood-backend`.
Hermetic (isolated port/data dir, fake sidecar, poisoned AppImage-style environment) and Linux-only. It
covers exactly what unit tests can't see: sidecars starting, restart refusal, persona overlay, state going
to the user data dir, and the backend + sidecars dying when the launcher is hard-killed (the desktop shell
does that on quit). Every packaged-only bug found on 2026-09-18 was invisible until a real binary ran.
Children use `_frozen.die_with_parent` (`PR_SET_PDEATHSIG`) — spawn them from the event-loop thread, since
the "parent" is the forking *thread* — and `run_server.py` calls it too so a PyInstaller onefile child
doesn't outlive its bootloader.

### Numbers reaching ffmpeg or a loop are validated at the request boundary
`_atempo_chain(0)` (or negative/NaN/inf) looped forever on the event loop, growing a list to ~19 GB and
freezing the whole backend. `EditClip`/`EditTransition`/`EditAudioTrack` now bound every number
(`allow_inf_nan=False`, `MIN_SPEED..MAX_SPEED`, `MAX_SECONDS`) so nonsense is a 400, and the helper is total.
Any new endpoint that feeds user numbers into a filter graph, a `while`, or a subprocess needs the same;
`tests/test_video_edit_validation.py` shows the pattern including a SIGALRM fail-fast for hang regressions.

### Video preview: never seek a playing `<video>` to correct small drift
`TimelineEditor`'s playhead is `performance.now()`-driven while the `<video>` has its own clock. Seeking a
playing element to re-sync makes it report the target position immediately while the playhead keeps running,
so it looks behind again and gets seeked again (a storm — measured at 25 seeks per 12s). `previewSync.ts`
(`planVideoSync`, unit-tested) encodes the rule: no correction while `video.seeking`; small drift is closed
by nudging `playbackRate`; hard-seek only beyond 0.75s at ≤1 per 400ms; paused scrubbing stays frame-accurate.
Same-source clips (the halves of a split) must not reassign `video.src` — it forces a reload.

### A panel that depends on a sidecar must (re)load when the sidecar becomes ready
`InstrumentGenerator` and `JamWithAI` used to fetch the provider list once, on mount — so starting the Song Generation
sidecar *after* opening the tab left Generate/Jam disabled behind a stale "start the sidecar" warning until you switched
tabs. Use `useMusicCapabilities(sidecarReady)`: it fetches on the false→true edge and retries an empty answer, because
`/api/music/capabilities` returns **200 with an empty provider list** (not an error) while the sidecar is down or still
probing. `useMusicJobPoll().start()` returns `{jobId}` or `{error}` carrying the backend's own `detail`, and
`FailedMusicJobs` keeps a job that failed *inside* the sidecar visible until dismissed — a job that just vanishes from
the "Generating" list looks exactly like nothing happening.

### Page roots are never `100vh`
`AppShell` is `h-screen overflow-hidden` and spends 52px on the top bar, so a page root of `100vh` ends 52px
below the visible area inside an `overflow-hidden` parent — its bottom controls were unreachable. Use
`PageShell` (`h-full min-h-0`) or `height: '100%'`. A tall editor inside a scroll container wants
`flex: 1 0 auto` (fill when there's room, never shrink below content), not a fixed `height: 100%`.

### `mcp` name collision
This repo's own top-level `mcp/` directory (`mcp/config/...`) shadows the real `mcp` PyPI package for anything run from the repo root. Never `pip install mcp` into this venv expecting `import mcp` to resolve to the SDK — it won't.

### `mcp/config/mcp_servers.json` is gitignored and shared across branches
It's personal/per-install config (contains bearer tokens for some server registrations), never committed. Because git branches share one working directory, editing it affects whatever instance of this app is currently running from this checkout — not just this branch. Don't assume switching branches changes its contents.

Location differs by build (see the Tauri packaging section's path-resolution bugfix
above): a source checkout keeps it at `mcp/config/mcp_servers.json` under the repo
root, unchanged; a packaged build reads/writes it from `user_data_dir()` instead
(`~/.local/share/arynwood-mcp/mcp_servers.json` by default) since the install
location itself isn't writable. Required shape either way —
`backend/routers/mcp_proxy.py`'s `_load_servers()` reads a top-level `"mcpServers"`
key, not a bare `{"kdenlive": {...}}` object:
```json
{ "mcpServers": { "kdenlive": { "url": "http://127.0.0.1:8420/mcp" } } }
```

### PDF learning depends on a sibling repo's venv, not anything in this one
`POST /api/knowledge/sycamore/jobs` shells out to `~/GitHub/sycamore/lib/sycamore/.venv/bin/python3` (hardcoded path in `backend/routers/knowledge.py`) — a separate checkout of the Sycamore document-parsing project, not part of this repo and not in `requirements.txt`. Its local-inference path (torch/transformers/timm/easyocr/paddleocr) is heavy enough that it deliberately isn't installed into the main venv, same reasoning as `scripts/run_whisper.py`'s dedicated `whisper-venv`. If that sibling checkout is missing or its venv isn't set up, PDF learning hard-fails with a 404 pointing at `docs/sycamore-integration-plan.md` — it does not silently fall back to the plain pdfminer/pypdf extraction non-PDF files use. Non-PDF files (text, code, `.docx`) are unaffected either way.

### Music Lab's song-gen sidecar needs two separate venvs — don't merge them
`backend/routers/music.py` (`/api/music`) talks to the `song-gen` sidecar (`~/GitHub/MusicStudio/sidecars/song-gen/`, port 8003) for AI instrument generation (ACE-Step) and melody-conditioned "Jam with AI" responses (MusicGen). ACE-Step and MusicGen cannot share one venv — MusicGen's own torch pin (2.1.x) breaks ACE-Step (needs torch 2.10.x; confirmed hands-on as `module 'torch' has no attribute 'xpu'`), so the sidecar's `venv-musicgen/` is separate from `venv/` and MusicGen runs as a subprocess, not an in-process import. If you're touching this sidecar, read `MusicStudio/CLAUDE.md`'s song-gen section first — it documents the exact torch/torchcodec/numpy/transformers pins that were needed, all confirmed by a real generation + `ffprobe`, not just an import check. Also worth knowing before "fixing" Jam mode's output quality: MusicGen's melody conditioning discards drums/bass internally before it extracts anything from the input audio (confirmed against the installed `audiocraft` source), so it never does literal audio-following — this is disclosed in `JamWithAI.tsx`'s UI, not a bug to chase.

### API auth is opt-in, off by default
`backend/services/auth.py`'s `ApiKeyMiddleware` gates the whole `/api/*` surface (HTTP and the chat WebSocket) behind `Authorization: Bearer <token>` — but only if `ARYNWOOD_API_KEY` is set in the environment; with it unset (the default on a fresh checkout), every request passes through exactly as before this existed. Setting it without also updating whatever's calling the API (frontend, curl, another tool) will lock that caller out — there's no frontend login flow built for this yet, it's infrastructure for a future remote/multi-tenant deployment, not something to casually enable on a local box already in use. The WebSocket can't send a custom header, so its token travels as a `?token=` query param instead.

### `requirements.txt` is now version-pinned
Every entry uses `~=` (locks to the given minor/patch series). It used to have zero constraints, so a fresh `pip install -r requirements.txt` could silently pull a breaking release. Bump versions deliberately (edit the pin), not by leaving them unconstrained again.

### Florence-2 caption endpoint reloads the model on every call, outside `gpu_queue`
`POST /api/tools/florence2/caption` (and `lora.py`'s `POST /api/lora/projects/{id}/captions/{filename}/auto`, which reuses its core logic via `tools.run_florence2`) loads `microsoft/Florence-2-base` from disk fresh on every single call — no in-process model cache — and neither endpoint acquires `gpu_queue` except the new LoRA auto-caption route, which does (`priority=True`). Fine for one-off/interactive captioning; do not call either in a tight per-frame loop without adding model caching first, and be aware the plain `/api/tools/florence2/caption` route can still collide with a concurrent GPU job since it was never wrapped in `gpu_queue.acquire()`.

### Live eval suite for LLM-decision quality
`tests/test_evals_live_behavior.py` asserts on real Ollama output (gate classification accuracy, native web-search trigger accuracy) rather than mocks, so it's excluded from the default `pytest` run (`pytest.ini`'s `addopts = -m "not eval"`) and needs Ollama actually reachable. Run it after touching `mcp_tool_agent.py`'s classifier, `chat.py`'s native tool-calling, or any persona system-prompt text that affects `central`:
```bash
pytest tests/ -m eval -v
```
Treat a single failure on a borderline case as possible model non-determinism before assuming a regression (confirmed firsthand: one case flip-flopped pass/fail across identical reruns with zero code changes and was swapped for a less ambiguous example) — but a newly-failing clear-cut case (an obviously-time-sensitive question no longer triggering `web_search`, or an obviously-unrelated one now triggering it) is a real signal.
