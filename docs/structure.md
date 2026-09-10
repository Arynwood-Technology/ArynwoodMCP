# Arynwood MCP — File, Folder & Service Directory

---

## Project Root

```
arynwood-mcp/
├── backend/                  Python FastAPI backend
├── config/                   Runtime config, database
├── docker/                   Docker Compose files for infrastructure
├── docs/                     Project documentation
├── frontend/                 React/Vite/Tauri desktop frontend
├── mcp/                      MCP persona definitions and config
├── scripts/                  GPU tool runner scripts
├── static/                   Static HTML tools served by FastAPI (design-center, terminal, etc.)
├── triggers/                 File-watching triggers for GPU jobs
│
├── .env                      Secrets (not committed)
├── .env.example              Template for .env
├── .gitignore
├── CLAUDE.md                 Instructions for Claude Code AI assistant
├── README.md
├── requirements.txt          Python dependencies
├── start.sh                  Launch backend + Vite dev server
├── arynwood-desktop.sh       Launch backend + Tauri binary (production)
└── arynwood-mcp.desktop      Linux desktop entry file
```

---

## Backend (`backend/`)

```
backend/
├── api.py                    FastAPI app entry point
│                             - CORS config
│                             - Router registration (14 domains)
│                             - lifespan: DB init
│                             - Prometheus metrics at /metrics
│                             - HTML tools served at /html-tools/{file}
│
├── db.py                     SQLite schema and initialization (config/arynwood.db)
├── mcp_orchestrator.py       CLI persona runner (not part of the web app)
├── persona_runner.py         Synchronous HTTP client to Ollama (CLI use)
│
├── services/
│   ├── knowledge.py          Qdrant embeddings CRUD, text extraction (txt/md/pdf/docx/epub),
│   │                         page/table-aware chunk ingestion for Sycamore-parsed PDFs
│   ├── mcp_tool_agent.py     Shared bounded tool-calling loop, dispatched across every
│   │                         registered server via mcp/config/local_agent/gates.json
│   ├── gpu_jobs.py           GPU job tracking shared by tools/lora/video
│   └── youtube_pipeline.py   YouTube publish watcher pipeline
│
└── routers/                  One file per API domain
    ├── chat.py                WebSocket streaming chat, web search, memory, file upload
    ├── ollama.py               Model listing, pulling, deletion, ping
    ├── servers.py              Remote server registry (Ollama, OpenAI-compatible)
    ├── system.py               System status, GPU info, hardware profile
    ├── deploy.py               SSH/SFTP deployment file management
    ├── fs.py                   File system operations (browse, read, write)
    ├── memory.py               Persistent memory CRUD (arynwood_memory table)
    ├── knowledge.py            !learn-equivalent + semantic search via Qdrant;
    │                           Sycamore PDF parse jobs (backend/services/gpu_jobs.py)
    ├── mcp_proxy.py            MCP protocol proxying → kdenlive
    ├── social.py               Social media OAuth + posting
    ├── studio.py               Music sidecar management (stems, RVC, effects, mastering) — stateless proxy
    ├── music.py                Music Lab: AI generation (ACE-Step/MusicGen), jam with AI, asset library
    ├── tools.py                GPU/AI tool registry
    ├── lora.py                 LoRA dataset prep + training job management
    └── video.py                Video generation/edit/caption jobs, video library
```

### Router URL Prefixes

| File | Prefix | Key Endpoints |
|------|--------|---------------|
| `chat.py` | `/api/chat` | `GET /ws` (WebSocket), `POST /upload`, `GET /conversations` |
| `ollama.py` | `/api/ollama` | `GET /models`, `POST /pull`, `DELETE /delete` |
| `servers.py` | `/api/servers` | CRUD + `GET /{id}/ping` |
| `system.py` | `/api/system` | `GET /status`, `GET /gpu`, `GET /hardware` |
| `tools.py` | `/api/tools` | `GET /`, tool status + runners |
| `deploy.py` | `/api/deploy` | `GET /targets`, file upload/download/delete |
| `memory.py` | `/api/memory` | CRUD for persistent memories |
| `knowledge.py` | `/api/knowledge` | `GET /status`, `GET /search`, `POST /learn`, `POST /upload`, `POST /sycamore/jobs`, `GET /jobs/{id}` |
| `mcp_proxy.py` | `/api/mcp` | `GET /servers`, `POST /call` |
| `social.py` | `/api/social` | OAuth flow + posting per platform |
| `studio.py` | `/api/studio` | Sidecar proxy: stems, voice conversion, effects |
| `music.py` | `/api/music` | Music Lab: `POST /generate`, `POST /jam`, `POST /stems`, asset library CRUD, DB-backed jobs |
| `lora.py` | `/api/lora` | Dataset prep + training job CRUD, `POST /projects/{id}/captions/{filename}/auto` (Florence-2 one-click caption) |
| `video.py` | `/api/video` | Generation/edit/caption jobs, `GET /library` |
| `fs.py` | `/api/fs` | File system browse, read, write |
| `dj.py` | `/api/dj` | DJ Toolkit launcher/status for desktop apps (Mixxx/Ardour/Hydrogen/etc.) — no HTTP surface of its own, status via `flatpak ps`/`pgrep` |
| `models.py` | `/api/models` | Read-only listing of SD checkpoints/LoRAs on disk (size, path) — Ollama models already have their own UI via `/api/ollama`; no delete/install here yet by design |
| `projects.py` | `/api/projects` | CRUD for the lightweight `projects` entity conversations/memories/knowledge sources can link to |

---

## Config (`config/`)

```
config/
└── arynwood.db               SQLite database (auto-created on first run)
```

---

## Database (`config/arynwood.db`)

| Table | Purpose |
|-------|---------|
| `servers` | Remote Ollama/OpenAI-compatible servers |
| `conversations` | Chat sessions (title, persona, model, server_id, project_id, history_summary, created_at) |
| `messages` | Chat messages (conversation_id, role, content, created_at) |
| `settings` | Key-value config (default_model, theme, agent context) |
| `deploy_targets` | SSH/SFTP targets |
| `arynwood_memory` | Persistent memories — type, title, content, pinned, `status` (confirmed/provisional), `volatility` (durable/transient), `conflict_with_id`, project_id |
| `knowledge_sources` | Knowledge base source registry — versioned (`version`, `superseded_by`); re-learning a source supersedes rather than duplicates |
| `social_accounts` / `social_posts` | Social media OAuth accounts and post history |
| `lora_projects` | LoRA training job state |
| `youtube_uploads` / `content_projects` | Video publish pipeline |
| `music_assets` | Music Lab audio library — generated ideas, jam responses, stems, recordings |
| `music_generation_jobs` | Music Lab generation job tracking (status, progress, provider) |
| `projects` | Optional lightweight project (name, description) that conversations/memories/knowledge sources can link to via `project_id` — not unified with `lora_projects`/`content_projects` |

---

## Frontend (`frontend/`)

```
frontend/
├── package.json              React 19, Vite, Tailwind v4, Zustand
├── vite.config.ts            Vite config — dev server on 5180, proxies /api/* to localhost:8010
├── index.html
│
├── src/
│   ├── main.tsx              React entry point (imports index.css)
│   ├── App.tsx               Route table only — 12 routes, all children of the AppShell layout route
│   ├── index.css             Tailwind v4 @theme tokens, legacy :root aliases, focus ring,
│   │                         reduced-motion block, form theming
│   │
│   ├── lib/
│   │   ├── api.ts            Typed fetch wrapper (request() prefixes /api)
│   │   ├── ws.ts             WebSocket chat client (ws://localhost:8010/api/chat/ws)
│   │   ├── cn.ts             clsx + tailwind-merge class merger
│   │   └── useMediaQuery.ts  useSyncExternalStore over matchMedia
│   │
│   ├── store/
│   │   ├── useAppStore.ts           Single Zustand store — status, servers, tools, chat state
│   │   ├── useVideoJobStore.ts      GPU job state per Video Studio panel (keyed slots)
│   │   ├── useKnowledgeJobStore.ts  Single in-flight Sycamore PDF-parse job — survives navigation
│   │   └── useMusicJobStore.ts      Music Lab generation jobs, keyed by job id (several can run at once)
│   │
│   ├── pages/
│   │   ├── Dashboard.tsx     Service health, embedded Arynwood chat, quick links
│   │   ├── Chat.tsx          WebSocket streaming chat with personas & models
│   │   ├── ModelManager.tsx  Pull/delete/list Ollama models
│   │   ├── Servers.tsx       Add/configure/test remote servers
│   │   ├── ToolLibrary.tsx   Tool status cards, runner UI
│   │   ├── Deploy.tsx        SSH/SFTP deployment UI
│   │   ├── DesignCenter.tsx  Iframe wrapping static/html-tools/design-center.html
│   │   ├── Knowledge.tsx     Knowledge base search / management; PDF learn routes
│   │   │                     through useKnowledgeJobPoll.ts (Sycamore parse job polling)
│   │   ├── Studio.tsx        Music Lab: AI generation, jam with AI, stems, RVC, effects
│   │   ├── Social.tsx        Social media publishing
│   │   └── Video.tsx         Kdenlive automation, video jobs
│   │
│   ├── components/layout/    Global chrome — mounted once by AppShell, outlives navigation
│   │   ├── AppShell.tsx      Layout route: chrome + status polling + always-mounted DesignCenter
│   │   ├── Sidebar.tsx       Nav — 64px icon rail or 224px labelled; preference persisted,
│   │   │                     rail forced under 900px
│   │   ├── TopBar.tsx        Presentational title bar; search + GPU chip open the overlays
│   │   ├── CommandPalette.tsx  Ctrl/Cmd+K — pages, personas, models, conversations, tools, actions
│   │   ├── StatusDrawer.tsx  Subsystem health with retry actions and fix hints
│   │   ├── PageErrorBoundary.tsx  Route-keyed, so navigating away clears a crash
│   │   ├── nav.ts            Single nav model — NAV (sidebar) + NAV_DESTINATIONS (palette)
│   │   └── usePageTitle.ts   Page-level override of the route's TopBar title
│   ├── components/ui/        Shared primitives (Tailwind + CVA)
│   │   ├── Button.tsx / IconButton.tsx   IconButton *requires* a label → aria-label + tooltip
│   │   ├── StatusBadge.tsx   Renders Link / anchor / span to match its actual behaviour
│   │   ├── SectionCard.tsx   SectionCard + SectionLabel
│   │   ├── EmptyState.tsx
│   │   ├── PageShell.tsx     PageShell / PageBar / PageBody page skeleton
│   │   └── variants.ts       CVA variants, kept out of component files for Fast Refresh
│   └── components/studio/
│       ├── EffectsRack.tsx
│       ├── StemSeparator.tsx
│       ├── VoiceConversion.tsx
│       ├── InstrumentGenerator.tsx    AI instrument/idea generation (ACE-Step/MusicGen)
│       ├── JamWithAI.tsx              Melody-conditioned AI response to recorded/uploaded audio
│       ├── MusicAssetCard.tsx         Shared asset card (waveform, play, rename, favorite, regenerate)
│       └── useMusicJobPoll.ts         Job-poll hook for Music Lab generation (see store/useMusicJobStore.ts)
│
└── src-tauri/                Tauri v2 desktop shell
    ├── Cargo.toml            Rust deps: tauri v2, tauri-plugin-shell
    ├── tauri.conf.json       Window config
    ├── src/main.rs           Tauri entry point
    └── icons/                App icons for all platforms
```

### Frontend Routes

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard | Service health, embedded Arynwood chat, quick links |
| `/chat` | Chat | Streaming LLM chat |
| `/models` | ModelManager | Ollama model management |
| `/servers` | Servers | Remote server registry |
| `/tools` | ToolLibrary | GPU/AI tool control |
| `/publish` | Deploy | SSH/SFTP deployments |
| `/design` | DesignCenter | Design canvas |
| `/knowledge` | Knowledge | Semantic knowledge base |
| `/studio` | Studio | Music Lab: AI generation, jam with AI, stems, RVC, effects |
| `/social` | Social | Social media publishing |
| `/video` | Video | Kdenlive automation, video jobs |

---

## Static HTML Tools (`static/html-tools/`)

Served at `http://localhost:8010/html-tools/{filename}` by FastAPI, and registered as
entries in the `tools.py` GPU tool registry.

| File | Description |
|------|-------------|
| `design-center.html` | Canvas design tool — this **is** the `DesignCenter.tsx` page (loaded via iframe) |
| `paint-studio.html` | Canvas paint app |
| `flowchart.html` | Flowchart builder |
| `terminal.html` | Web terminal |
| `client-intake.html` | HTML form builder |

---

## Services & Ports

| Service | Port | How to Start | Notes |
|---------|------|--------------|-------|
| FastAPI backend | 8010 | `uvicorn backend.api:app --port 8010` | Core API — this is what `vite.config.ts` proxies to |
| React dev server | 5180 | `npm run dev` (frontend/) | `strictPort: true`; proxies /api and the chat WebSocket to :8010 |
| Tauri desktop app | N/A | `./arynwood-desktop.sh` | Bundles frontend |
| Ollama (local) | 11434 | `ollama serve` | LLM inference |
| TortoiseTTS | 5003 | Docker | Text-to-speech |
| Stable Diffusion (A1111) | 7860 | Docker / `./webui.sh` | Image generation |
| Prometheus | 9090 | Docker | Metrics |
| mcp-kdenlive | 8420 | systemd user service | Kdenlive D-Bus control, MCP over HTTP |

---

## Environment Variables (`.env`)

See `.env.example` — social media OAuth credentials (Facebook/Instagram, YouTube,
LinkedIn) plus the OAuth callback base URL. Also `ARYNWOOD_API_KEY` (optional, unset
by default): if set, gates the whole `/api/*` surface behind a bearer token —
there's no frontend login UI for this yet, so don't set it without also updating
whatever's calling the API.

---

## MCP Personas (`mcp/config/models.json`)

Seven personas available in the chat interface:

| Key | Name | Role | Model |
|-----|------|------|-------|
| `central` | Arynwood | Coordinator, general assistant | `qwen2.5-coder:14b` |
| `doc` | Doc | Systems architect | `qwen2.5` |
| `kona` | Kona | Creative, exploratory | `qwen2.5` |
| `glyph` | Glyph | Automation, workflows | `qwen2.5` |
| `estra` | Estra | Writer, editor | `qwen2.5` |
| `shai` | Shai | Novelist & creative co-writer | `shai-novelist:v1` (local fine-tune) |
| `chai` | Chai | Same co-writer role, unmodified base model | `hermes3:8b` |

Corrected: the frontend does **not** hardcode this list in a `PERSONAS` constant —
`GET /api/chat/personas` reads `mcp/config/models.json` fresh on every call (filtering
out non-persona config blocks like `sad-talker`), and the Chat page renders whatever
comes back. Editing `models.json` takes effect immediately, no frontend change or
restart needed. Only `central` gets native tool-calling, relevance-ranked memory, and
MCP tool-server access.
