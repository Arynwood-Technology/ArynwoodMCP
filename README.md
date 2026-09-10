# Arynwood MCP

Local-first AI creative studio. One app for multi-persona chat, GPU generation tools, video editing (Kdenlive automation), audio production, design, and social publishing - all running on your own hardware.

---

## Table of Contents

- [What's Inside](#whats-inside)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Feature Guide](#feature-guide)
  - [Getting Around](#getting-around)
  - [Dashboard](#dashboard)
  - [Chat & Knowledge](#chat--knowledge)
  - [MCP Tool Servers](#mcp-tool-servers)
  - [Models & Servers](#models--servers)
  - [Studio](#studio)
  - [Tools (GPU Library)](#tools-gpu-library)
  - [Design Center](#design-center)
  - [Video Studio](#video-studio)
  - [Social Media](#social-media)
  - [Publish](#publish)
- [Stack & Ports](#stack--ports)
- [Database](#database)
- [Studio: Full Setup & Roadmap](#studio-full-setup--roadmap)
- [Knowledge Base Setup](#knowledge-base-setup)
- [Release & Packaging](#release--packaging)

---

## Release & Packaging

Linux desktop alpha (AppImage + `.deb`) - see:
- [`docs/supported-platforms.md`](docs/supported-platforms.md) - OS/hardware requirements
- [`docs/installation.md`](docs/installation.md) - install, first run, uninstall
- [`docs/troubleshooting.md`](docs/troubleshooting.md) - common problems
- [`docs/release-readiness-audit.md`](docs/release-readiness-audit.md) - current gaps/status
- [`docs/third-party-notices.md`](docs/third-party-notices.md) - dependency license inventory
- [`CHANGELOG.md`](CHANGELOG.md), [`SECURITY.md`](SECURITY.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`LICENSE`](LICENSE)

---

## What's Inside

| Section | What it does |
|---------|-------------|
| **Dashboard** | Live service health, GPU stats, embedded Arynwood chat, quick links |
| **Chat** | Streaming WebSocket chat with Arynwood - memory, file upload, Kdenlive tool-calling |
| **Knowledge** | Teach Arynwood via URL/file/text; semantic search injected into chat |
| **Models** | Browse, pull, delete Ollama models across local and remote servers |
| **Servers** | Register Ollama / OpenAI-compatible endpoints, ping and health-check |
| **Studio** | Audio production - AI music generation, jam with AI, stem separation, voice conversion, effects rack |
| **Tools** | Image gen (A1111), TTS/STT, video, vision - GPU tool library |
| **Design Center** | Canvas design tool with Stable Diffusion integration |
| **Video Studio** | Kdenlive automation, video generation/edit/caption jobs |
| **Social Media** | Publish generated content to Facebook, Instagram, YouTube, LinkedIn |
| **Publish** | SSH/SFTP file manager, upload to remote web servers |

Every screen shares the same chrome: a collapsible sidebar, a **⌘K / Ctrl+K command
palette**, and a **system status drawer**. See [Getting Around](#getting-around).

---

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- [Ollama](https://ollama.com) running locally or on a remote server

### 1. Clone & set up

```bash
git clone https://github.com/Arynwood-Technology/Arynwood-MCP.git
cd Arynwood-MCP

python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cd frontend && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Pull the models the default personas actually use

```bash
ollama pull qwen2.5-coder:14b   # central (Arynwood) - also the fixed tool-calling model
ollama pull qwen2.5             # doc, kona, glyph, estra
ollama pull hermes3:8b          # chai
ollama pull nomic-embed-text    # knowledge base + memory retrieval embeddings
```
`shai` uses a locally fine-tuned model (`shai-novelist:v1`) that isn't a plain
`ollama pull` - see [`training/novelist/README.md`](training/novelist/README.md) if
you want to build it; `chai` runs the same character on stock `hermes3:8b` in the
meantime. Swap any of these for whatever you'd rather run by editing
`mcp/config/models.json` - it hot-reloads, no restart needed.

### 4. Start

```bash
./start.sh
```

- App → http://localhost:5180
- API → http://localhost:8010
- API docs → http://localhost:8010/docs

Both the backend and Ollama bind to `127.0.0.1` (loopback) by default - set
`ARYNWOOD_BIND_HOST=0.0.0.0` and `OLLAMA_HOST=0.0.0.0` in `.env` to expose them to
your LAN deliberately, and set `ARYNWOOD_API_KEY` too if you do (see
[Environment Variables](#environment-variables)).

### Desktop launcher (Tauri, dev mode)

```bash
./arynwood-desktop.sh
```

Opens a native window connected to the Vite dev server with hot reload.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in values. The file is gitignored.

| Variable | Description |
|----------|-------------|
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Meta app credentials - Facebook + Instagram publishing |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | YouTube Data API v3 OAuth credentials |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth credentials |
| `SOCIAL_REDIRECT_BASE` | Base URL for OAuth callbacks - change if running behind a reverse proxy |
| `ARYNWOOD_API_KEY` | Optional. Unset by default - every request passes through unauthenticated, same as always. If set, every `/api/*` request (HTTP and the chat WebSocket) must present it as a Bearer token. There's no frontend login UI for this yet, so only set it if you've also updated whatever's calling the API; it's meant for a future remote/multi-tenant deployment, not a local box you're actively using |

See `.env.example` for the full list and where to obtain each credential.

---

## Feature Guide

### Getting Around

Chrome that is present on every screen:

**Sidebar** - collapses to a 64px icon rail or expands to show labels. The choice is
remembered between sessions. On narrow windows it stays a rail regardless, and returns
to your preference once there's room again.

**Command palette - `⌘K` / `Ctrl+K`** - one search box over everything:

| Type | What selecting it does |
|------|------------------------|
| Pages | Navigates there |
| Personas | Switches persona, adopts its configured model, opens Chat |
| Models | Sets the active model |
| Recent conversations | Opens that conversation in Chat |
| Tools | Opens that tool in the Tool Library |
| Actions | New chat · Open system status · Toggle sidebar · Restart API backend |

Arrow keys move, `Enter` runs, `Esc` closes.

**System status drawer** - click the connectivity dot at the bottom of the sidebar,
the GPU chip in the top bar, or run "Open system status" from the palette. It reports
the backend API, Ollama, every registered server, whether your active model is actually
installed on the active server, GPU + job-queue depth, Qdrant and the embedding model,
registered MCP tool servers, MusicStudio sidecars, and Stable Diffusion / TTS /
Prometheus.

Anything that isn't healthy shows the specific command to fix it, and rows carry live
actions - ping a server, restart the API, start a stopped sidecar. Two cases worth
knowing, because both otherwise fail silently:

- **"No servers registered" under MCP tool servers** means `mcp/config/mcp_servers.json`
  is missing. That file is gitignored per-install config, and without it *all* MCP tool
  dispatch is skipped with no error anywhere.
- **A warning on "Active model"** means the name in the top bar isn't installed on the
  active server. The model field is free text, so a typo is easy and otherwise only
  surfaces as a failed chat turn.

---

### Dashboard

The home screen. Shows:
- **Service health** - Ollama, Stable Diffusion, TortoiseTTS, Prometheus (polled every 10s)
- **GPU stats** - VRAM usage and utilization via nvidia-smi
- **Embedded Arynwood chat** - a quick-chat widget backed by the same WebSocket protocol as the full Chat page
- **Quick links** - Tools, Studio, Video Studio, Design Center, Social Media, Knowledge, Models, Servers

---

### Chat & Knowledge

#### Chat

Streaming WebSocket chat with Arynwood and the other personas. Each conversation is stored in SQLite and appears in the sidebar history.

**Personas:**

| Key | Name | Role |
|-----|------|------|
| `central` | Arynwood | Coordinator |
| `doc` | Doc | Architect |
| `kona` | Kona | Creative |
| `glyph` | Glyph | Automation |
| `estra` | Estra | Writer |
| `shai` | Shai | Novelist & creative co-writer (runs a locally fine-tuned model) |
| `chai` | Chai | Same co-writer, stock model |

Each persona has its own model in `mcp/config/models.json` (`shai` and `chai` run local Ollama models fine-tuned/selected for fiction writing; the rest default to a general-purpose model). Switch models per conversation from the model dropdown.

**Features:**
- File upload - attach files to provide context to the current message
- Memory - Arynwood remembers facts you tell her across sessions via a `<remember>` block in her own replies. New memories start **unconfirmed**: they show up in the memory panel with a badge and a one-click Confirm button, and only count as trusted once you confirm them - a hallucinated "fact" isn't silently treated the same as one you've reviewed. If a new memory looks like it contradicts something already confirmed, it's flagged with a conflict badge instead of just quietly coexisting. Only Arynwood (`central`) has memory; the other personas don't.
- Knowledge injection - relevant excerpts from the knowledge base are automatically retrieved for **every** persona's replies now, not just Arynwood's (turn it off per-persona in `mcp/config/models.json` with `knowledge_enabled: false`)
- Live activity indicator - while Arynwood's preparing a reply, the UI shows what's actually happening ("Checking your knowledge base…", "Using web_search…") instead of a silent pause, and once the reply lands, an expandable "Used: …" note discloses exactly which sources/tools informed it
- Arynwood tool-calling - Arynwood can decide for herself to search the web, re-check her memory, or search the knowledge base mid-reply (see [MCP Tool Servers](#mcp-tool-servers)), and - separately - when a message looks Kdenlive-related, she inspects/drives a running Kdenlive instance and answers from live results (same section)

#### Knowledge Base

Teach Arynwood new information that persists across all conversations.

**Adding knowledge:**
- Knowledge page: paste a URL, local file path, or raw text, then click Learn

**Viewing and managing:**
- The Knowledge page lists all sources with timestamps and chunk counts

**How it works:** On every message to Arynwood, the backend runs semantic similarity search against the knowledge base (Qdrant) using Ollama embeddings (`nomic-embed-text`). The top matching excerpts are injected into the system prompt automatically.

**Requires Qdrant and Ollama to be running** - see [Knowledge Base Setup](#knowledge-base-setup).

---

### MCP Tool Servers

There are two separate ways Arynwood (`central`) can act on something instead of
just talking about it.

**Arynwood's own tools.** She can decide, mid-reply, to search the web, re-check
her own memory, or search the knowledge base - these are read-only, so they
run without asking you first. This replaced an older "if the message contains
one of 19 keywords, auto-search" heuristic that false-positived constantly
(a chat app about *tools* asking "what's the best tool for X" used to trigger
a search just from the word "tool").

**External MCP servers - Kdenlive today.** Arynwood can also reach outside the
chat itself, inspecting/driving a running **Kdenlive** instance, through a
registered MCP server - the same integration point third-party MCP tools
plug into. When a message is classified as relevant to a registered server
(an LLM judgment call now, not a keyword match - "the best way to loop this
DJ track" no longer risks tripping a video-editing gate just because it's
adjacent-sounding), the backend runs a small bounded tool-calling loop
against that server *before* generating Arynwood's reply, and injects what it
found as a `[Kdenlive - live results]` block. Arynwood answers from that block
naturally - no raw JSON in the UI, no change to the streaming chat protocol.
Anything destructive (deleting a clip/track, rendering a final video) or that
publishes externally needs your explicit approval first: a card appears in
the chat showing exactly which tool and arguments, and nothing runs until you
approve or deny it.

That loop always uses one fixed local model for tool-calling
(`qwen2.5-coder:14b` by default), independent of whichever model/persona
you're actually chatting with - smaller/non-coder models don't reliably
call tools at all.

**Currently registered** (`mcp/config/mcp_servers.json` - gitignored, per-install,
**and not guaranteed to exist on a fresh checkout** - without it, none of the
above external-server behavior runs, silently, by design):

| Server | What it does | Runs as |
|---|---|---|
| `kdenlive` | Full NLE control over a running Kdenlive instance (needs the [D-Bus-patched fork](https://github.com/D-Ogi/kdenlive)) - timeline, clips, markers, transitions, rendering | `mcp-kdenlive` systemd user service, port 8420 |

Add a new MCP server by registering its URL in `mcp_servers.json`, dropping
instructions (and ideally a few worked example tool-call sequences) in
`mcp/config/local_agent/<name>.md`, and adding a `gates.json` entry - its
`hints` are descriptive context for the classifier now, not a keyword
allowlist. No new Python module needed, `mcp_tool_agent.gather_context_for_message`
dispatches across every gated server automatically. Servers that only speak
MCP over stdio need an HTTP bridge in front of them first; HTTP-native
servers (like `mcp-kdenlive`, run with `MCP_TRANSPORT=http`) don't.

Local model behavior/config lives in `mcp/config/local_agent/` - see that
directory's own README before editing prompts there.

---

### Models & Servers

#### Models

Manage Ollama models across all registered servers.

- Browse installed models with size, quantization, and parameter count
- Pull new models by name with download progress bar
- Delete models to free VRAM or disk space
- View which model is currently loaded and running

#### Servers

Register multiple Ollama or OpenAI-compatible endpoints.

- Add by name, host, port, and optional auth token
- Ping any server to check latency and online status
- Set a server as the active source for a conversation

---

### Studio

Audio production tools powered by the [MusicStudio](https://github.com/arynwood/MusicStudio) sidecars. The sidecars are independent FastAPI servers that live in `/home/lorelei/GitHub/MusicStudio/sidecars/` and are proxied through the Arynwood MCP backend.

The Studio page shows a **sidecar status bar** at the top with live health polling every 5 seconds. Each sidecar can be started and stopped directly from the UI using the ▶ / ■ buttons.

#### Generate (Instrument Generator)

Generate individual musical parts - bass, drums, guitar, piano, synth, strings, percussion, or a full arrangement - from a text prompt and structured fields (genre, style, mood, BPM, key, duration, energy, complexity), using ACE-Step (text-to-music) or MusicGen as the provider. Results are standalone stems, not full songs - the point is bringing AI-generated ideas into your own production, not asking the AI to finish the track for you.

**How to use:**
1. Pick an instrument
2. Pick a provider - an uninstalled provider shows disabled rather than failing at generate time
3. Fill in genre/style/mood/BPM/key/duration/energy/complexity and an optional free-text prompt; optionally attach reference or melody audio
4. Click **Generate** - results appear as numbered ideas ("Bass Idea 01", "Bass Idea 02", ...) with Play/Download/Rename/Favorite/Regenerate/Delete

**Requires:** song-gen sidecar (port 8003) - see [Studio: Full Setup & Roadmap](#studio-full-setup--roadmap) to install ACE-Step/MusicGen

---

#### Jam with AI

Play, record, or upload a musical idea and get an AI response, styled as a specific bandmate role (bass player, drummer, guitarist, keyboard player, string player, soloist, accompaniment, countermelody, full band). The response is always a separate file - never automatically merged into your recording.

**How to use:**
1. Record, upload, or pick an existing asset as the input
2. Choose an AI role and a provider that can actually listen to your input (currently MusicGen)
3. Set style/BPM/key/duration
4. Click **Generate response**

> **What "listening" actually means:** MusicGen's melody conditioning discards drums and bass internally before extracting anything from your input, and even melodic content (vocals, guitar) only produces a rough harmonic guide, not a literal transcription - expect an impression of your take, not a precise reply to it. Vocal/guitar/synth input works noticeably better than bass- or drum-heavy input.

**Requires:** song-gen sidecar (port 8003) with MusicGen specifically installed - ACE-Step alone can't do audio-conditioned generation yet

---

#### Stem Separation

Separate a mixed audio track into individual stems using machine learning.

**Engines:**
- **Demucs v4 (htdemucs)** - higher quality, uses PyTorch, recommended
- **Spleeter** - faster inference, lower quality

**Stem counts:**
- **2 stems** - Vocals + Other
- **4 stems** - Vocals / Drums / Bass / Other
- **6 stems** - Vocals / Drums / Bass / Other / Piano / Guitar (Demucs only)

**How to use:**
1. Click the file picker → select an audio file (WAV, MP3, OGG, FLAC, AIFF, M4A)
2. Choose engine and stem count
3. Click **Separate Stems** - a progress bar tracks the job
4. When complete, each stem has an inline audio player and a Download button

**First run:** Demucs downloads its model weights (~1.5 GB) automatically. The first job takes longer.

**Requires:** stem-sep sidecar (port 8004)

---

#### Voice Conversion (RVC)

Swap the vocal timbre of any audio recording using an RVC v3 checkpoint.

> **Scope:** Voice-to-voice conversion only. This is not text-to-speech. You provide audio in; you get audio out with a different voice. Generating speech from text or scratch is not supported.

**Importing a voice model:**
1. Obtain a trained RVC `.pth` checkpoint (and optionally a `.index` file)
2. In the Voice Conversion tab: enter a name, upload the `.pth`, optionally upload the `.index`
3. Click **+ Import** - saves to `~/.local/share/musicstudio/models/<name>/`

**Converting audio:**
1. Select a voice model from the list
2. Click the audio file picker → select your source audio
3. Configure:
   - **Pitch shift** - transpose in semitones (-24 to +24). Use +12 to shift an octave up, -12 for an octave down
   - **Index rate** - how strongly the `.index` file influences the result (0–1). Higher values give a closer match to the original voice character but may add artifacts
4. Click **Convert** - progress bar tracks the job
5. Listen inline or download `converted.wav`

**Requires:** voice sidecar (port 8001, Python 3.11 venv)

---

#### Effects Rack

Apply a non-destructive effects chain to any audio file using Pedalboard.

**Available effects:**

| Effect | Parameters |
|--------|-----------|
| Reverb | Room size, Damping, Wet level, Dry level |
| Compressor | Threshold (dB), Ratio, Attack (ms), Release (ms) |
| Chorus | Rate (Hz), Depth, Mix |
| Delay | Delay (seconds), Feedback, Mix |
| Distortion | Drive (dB), Tone |
| EQ - 3-band | Low (dB), Mid (dB), High (dB) |

**How to use:**
1. Click the file picker → select an audio file
2. Click effect buttons at the top to add them to the chain (effects stack in order)
3. Adjust parameters using the sliders - current value shown live next to each slider
4. Remove effects with the ✕ button
5. Click **Apply Chain** - processes the file and makes it available inline
6. Listen to the result or download `processed.wav`

**Requires:** audio-fx sidecar (port 8002, Python 3.11 venv)

---

### Tools (GPU Library)

Card grid of available GPU tools with live status indicators, port, and run controls.

| Tool | Category | Port | Notes |
|------|----------|------|-------|
| Stable Diffusion (A1111) | Image | 7860 | Text-to-image, img2img, ControlNet |
| TortoiseTTS | Audio | 5003 | High-quality neural TTS (Docker) |
| Whisper | Audio | - | Speech-to-text transcription |
| SadTalker | Video | - | Talking head video from image + audio |
| AnimateDiff | Video | - | Animation synthesis |

Click a tool card to open its run panel - upload inputs, set parameters, and preview output inline (video player, audio player, image grid).

**Stable Diffusion generation styles** (`style` param on `/api/tools/stable_diffusion/generate` and `/api/tools/sd/generate`) - each picks a checkpoint + the sampler/steps/cfg/hires-fix settings tuned for it, so you don't hand-tune generation params per model:

| Style | Checkpoint | Use for |
|-------|-----------|---------|
| `realistic` (default) | RealVisXL_V5.0 | Photoreal portraits/scenes. Full steps + hires fix for detail. |
| `general` | Juggernaut-XL-v9 | All-purpose SDXL - good default for mixed/unspecified subjects. |
| `stylized` | DreamShaperXL Turbo | Illustrative/stylized look. Few steps, low cfg, **no** hires fix (Turbo models oversaturate/melt under hires fix + normal cfg). |

An unrecognized `style` string silently falls back to `realistic` rather than erroring. Checkpoint filenames are validated against A1111's `/sdapi/v1/sd-models` on first request; a missing one logs a backend warning instead of failing generation.

Also includes LoRA dataset prep and training job management (`/api/lora`).

---

### Design Center

Canvas-based design tool running as a sandboxed iframe.

**Elements:**
- Images - upload from disk or generate via Stable Diffusion
- Text - font, size, color, bold, italic, underline, shadow, outline
- Shapes - rectangle, ellipse, star, arrow, speech bubble

**Layer panel:**
- Drag layers to reorder
- Toggle visibility and lock per layer

**Image filters (per element):**
- Brightness, contrast, saturation, hue rotation, blur, grayscale, sepia

**Stable Diffusion integration:**
- Enter a prompt → generates an image and places it on the canvas
- Requires A1111 running on port 7860

**Session persistence:**
- Canvas auto-saves to `localStorage` - survives navigation and page reloads
- Images stored as base64 data URLs so they don't depend on external files

**Export:** Download canvas as PNG, or save into a folder via the filesystem browser.

---

### Video Studio

Kdenlive automation and video generation/edit/caption jobs, backed by `video.py` and the `kdenlive` MCP server (see [MCP Tool Servers](#mcp-tool-servers)).

- Kick off generation/edit/caption jobs and track them in the video library
- Arynwood can drive a running Kdenlive instance conversationally from the Chat page

---

### Social Media

Publish generated content to Facebook, Instagram, YouTube, and LinkedIn.

- OAuth connect flow per platform, managed from the Social Media page
- Post text, images, and video directly from generated output

---

### Publish

SSH/SFTP file manager for deploying content to remote servers.

- Register deployment targets with host, port, user, key or password
- Browse remote directory trees
- Upload local files or export HTML pages directly
- One-click publish for static sites

---

## Stack & Ports

| Layer | Tech |
|-------|------|
| Backend | FastAPI + aiosqlite (port 8010) |
| Frontend | React 19 + Vite + Tailwind v4 + Zustand (port 5180) |
| Desktop | Tauri (native window, wraps dev server) |
| LLMs | Ollama (local + remote, port 11434) |
| GPU tools | Stable Diffusion A1111 (7860), TortoiseTTS (5003) |
| Monitoring | Prometheus (9090) |
| Vector DB | Qdrant (6333) - required for Knowledge Base |
| Studio sidecars | voice (8001), audio-fx (8002), song-gen (8003), stem-sep (8004), video-ai (8005) |
| MCP tool servers | mcp-kdenlive (8420) - see [MCP Tool Servers](#mcp-tool-servers) |

---

## Database

SQLite at `config/arynwood.db`. Created automatically on first run.

| Table | Contents |
|-------|----------|
| `servers` | Ollama/API server registry |
| `conversations` | Chat conversation metadata |
| `messages` | Chat message history |
| `settings` | Key-value config |
| `deploy_targets` | Publish SSH/SFTP targets |
| `arynwood_memory` | Arynwood's remembered facts - each has a confirmation status (provisional/confirmed), durable/transient volatility, and an optional flagged conflict with another memory |
| `knowledge_sources` | Knowledge base source registry - versioned, so re-learning a URL/file supersedes the old version instead of duplicating it |
| `social_accounts` / `social_posts` | Social media OAuth accounts and post history |
| `lora_projects` | LoRA training job state |
| `youtube_uploads` / `content_projects` | Video publish pipeline |
| `music_assets` | Music Lab audio library - generated ideas, jam responses, stems, recordings |
| `music_generation_jobs` | Music Lab generation job tracking (status, progress, provider) |
| `projects` | Optional lightweight project (name/description) that conversations, memories, and knowledge sources can link to - separate from `lora_projects`/`content_projects`, which aren't unified with it |

---

## Studio: Full Setup & Roadmap

### One-time venv setup

Each sidecar needs its own Python virtual environment. These are set up once in the MusicStudio directory at `/home/lorelei/GitHub/MusicStudio`.

#### audio-fx sidecar (port 8002)

Provides: Pedalboard effects, Matchering mastering, Basic Pitch MIDI transcription, librosa BPM/chord analysis.

> **Must use Python 3.11** - Basic Pitch requires tensorflow <2.15.1 which tops out at Python 3.11.

```bash
cd /home/lorelei/GitHub/MusicStudio
python3.11 -m venv sidecars/audio-fx/venv
source sidecars/audio-fx/venv/bin/activate
pip install setuptools<70
pip install -r sidecars/audio-fx/requirements.txt
```

Note: install `pedalboard>=0.7.7,<0.9.0` - newer versions require AVX2 CPU instructions and may fail on some hardware.

#### stem-sep sidecar (port 8004)

Provides: Demucs v4 stem separation, Spleeter (2/4/6 stems).

```bash
cd /home/lorelei/GitHub/MusicStudio
python3 -m venv sidecars/stem-sep/venv
source sidecars/stem-sep/venv/bin/activate
pip install -r sidecars/stem-sep/requirements.txt
```

Demucs downloads model weights (~1.5 GB) on the first separation job - this is automatic.

#### voice sidecar (port 8001)

Provides: RVC v3 voice conversion.

> **Must use Python 3.11** - rvc-python pins numpy ≤1.23.5 and fairseq == 0.12.2, neither builds on Python 3.12.

```bash
cd /home/lorelei/GitHub/MusicStudio
python3.11 -m venv sidecars/voice/venv
source sidecars/voice/venv/bin/activate
pip install "pip<24.1"
pip install -r sidecars/voice/requirements.txt
```

Voice models are not included - import your own trained RVC `.pth` checkpoints via the Studio → Voice Conversion tab.

#### video-ai sidecar (port 8005)

Provides: faster-whisper captions, silence/auto-cut detection.

```bash
cd /home/lorelei/GitHub/MusicStudio
python3 -m venv sidecars/video-ai/venv
source sidecars/video-ai/venv/bin/activate
pip install -r sidecars/video-ai/requirements.txt
```

#### song-gen sidecar (port 8003)

Provides: AI music generation - ACE-Step v1 (text-to-music, Apache-2.0) and MusicGen (also melody-conditioned generation, CC-BY-NC 4.0 - **non-commercial use only**).

> **Two separate venvs, not one.** MusicGen's own torch pin (2.1.x) is incompatible with the torch 2.10.x ACE-Step needs - installing both into one venv breaks ACE-Step outright. `setup_song_gen.sh` builds `venv/` (ACE-Step) and `venv-musicgen/` (MusicGen) separately; MusicGen runs as a subprocess dispatched from the main sidecar process, not imported in-process.

```bash
cd /home/lorelei/GitHub/MusicStudio/sidecars/song-gen
./setup_song_gen.sh                  # base only - sidecar starts, both providers report installed:false
./setup_song_gen.sh --with-acestep   # + ACE-Step v1 checkpoint (multi-GB download, confirmed before starting)
./setup_song_gen.sh --with-musicgen  # + MusicGen checkpoint (~1.2GB, confirmed before starting)
```

Neither model downloads automatically - each `--with-*` flag prints what it's about to fetch and asks for confirmation first. See `MusicStudio/CLAUDE.md`'s song-gen section for the full setup history (the exact torch/torchcodec/numpy/transformers pins needed, all hands-on-verified against a real generation).

### Starting sidecars

**From the UI:** Open Studio → sidecar status bar at the top → click ▶ next to any stopped sidecar. The backend launches it as a background subprocess and polls `/health` until it responds.

**Manually (for debugging output):**
```bash
cd /home/lorelei/GitHub/MusicStudio

# Run each in a separate terminal with its venv active:
source sidecars/audio-fx/venv/bin/activate && PORT=8002 python3 sidecars/audio-fx/main.py
source sidecars/stem-sep/venv/bin/activate && PORT=8004 python3 sidecars/stem-sep/main.py
source sidecars/voice/venv/bin/activate   && PORT=8001 python3 sidecars/voice/main.py
source sidecars/video-ai/venv/bin/activate && PORT=8005 python3 sidecars/video-ai/main.py
source sidecars/song-gen/venv/bin/activate && PORT=8003 python3 sidecars/song-gen/main.py
```

### What's built and what isn't

| Feature | Sidecar | Status | Notes |
|---------|---------|--------|-------|
| Stem Separation (Demucs/Spleeter) | stem-sep :8004 | ✅ Done | 2/4/6 stems, engine choice, inline playback |
| Voice Conversion (RVC) | voice :8001 | ✅ Done | Import .pth models, convert audio, pitch shift |
| Effects Rack (6 effects, chaining) | audio-fx :8002 | ✅ Done | Reverb, Comp, Chorus, Delay, Distortion, EQ |
| Reference Mastering (Matchering) | audio-fx :8002 | ⬜ Not ported | Source: `MasterPanel.svelte` |
| BPM & Chord Analysis (librosa) | audio-fx :8002 | ⬜ Not ported | Source: `MasterPanel.svelte` (analyzeAudio) |
| Audio → MIDI Transcription (Basic Pitch) | audio-fx :8002 | ⬜ Not ported | Source: `Transcribe.svelte` |
| Whisper Captions / Auto-cut | video-ai :8005 | ⬜ Not ported | Source: `Captions.svelte` |
| Timeline / Track Arranger | none (browser) | ⬜ Not ported | Source: `Timeline.svelte`, uses WaveSurfer.js |
| Transport (Play/Pause/Stop/BPM) | none (browser) | ⬜ Not ported | Source: `Transport.svelte`, uses Tone.js |
| Piano Roll (MIDI editor) | none (browser) | ⬜ Not ported | Source: `PianoRoll.svelte`, uses @tonejs/midi |
| AI Instrument Generation (ACE-Step / MusicGen) | song-gen :8003 | ✅ Done | Text-to-music from structured fields; results land in the shared asset library |
| Jam with AI (melody-conditioned response) | song-gen :8003 | ✅ Done | MusicGen only - see the melody-conditioning caveat under [Jam with AI](#jam-with-ai); response is always a separate asset, never merged |
| Stems → shared asset library | song-gen + stem-sep | ✅ Backend, ⬜ not wired to UI | `POST /api/music/stems` persists each stem as a reusable asset with source lineage; `StemSeparator.tsx` above still only calls the original `/api/studio/stems`, which stays ephemeral |

### What to build next

**Mastering + Analysis tab** (audio-fx sidecar already running, no new backend work needed)
- Port `MasterPanel.svelte` → `frontend/src/components/studio/Mastering.tsx`
- Two file pickers (target track + reference track)
- POST both to `/api/studio/effects/master` (already wired) → download mastered WAV
- GET `/api/studio/effects/analyze` → show BPM and chord detection results (need to add backend endpoint proxying `:8002/analyze`)

**Transcribe tab** (audio-fx sidecar already running)
- Add backend endpoint: `POST /api/studio/effects/transcribe` → proxies to `:8002/transcribe/basic` or `/transcribe/multitrack`, returns MIDI blob
- Port `Transcribe.svelte` → `frontend/src/components/studio/Transcribe.tsx`
- Install `npm install @tonejs/midi` in `frontend/` to parse and display note count
- Output: MIDI file download + note count display

**Timeline + Transport** (no sidecar - pure browser audio)
1. `cd frontend && npm install tone wavesurfer.js`
2. Copy `MusicStudio/src/lib/audio/engine.ts` → `frontend/src/lib/audio/engine.ts` verbatim (already pure TypeScript, no Tauri dependencies)
3. Port `Transport.svelte` → `frontend/src/components/studio/Transport.tsx`
   - Replace Svelte `$store` → `useState` / `useEffect`
   - Same logic, same BPM/position display
4. Port `Timeline.svelte` → `frontend/src/components/studio/Timeline.tsx`
   - Replace Tauri `open()` → `<input type="file" ref>` with `.click()`
   - Replace `convertFileSrc(path)` → `URL.createObjectURL(file)` (the browser equivalent)
   - Replace Tauri `invoke('probe_media_duration')` → a new backend endpoint `GET /api/studio/probe?url=...` using ffprobe
   - WaveSurfer.js API is identical between web and Tauri (it's a web library)

**Piano Roll** (no sidecar - pure browser)
1. `cd frontend && npm install @tonejs/midi`
2. Add a Zustand slice for MIDI state (port `midiStore` from Svelte)
3. Port `PianoRoll.svelte` → `frontend/src/components/studio/PianoRoll.tsx`

---

## Knowledge Base Setup

The Knowledge page requires two external services.

### 1. Start Qdrant

```bash
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant
```

Qdrant is the vector database that stores and searches embedded knowledge chunks. The collection (`arynwood_knowledge`) is created automatically on first use.

### 2. Ensure nomic-embed-text is available

```bash
ollama pull nomic-embed-text
```

### 3. Check Ollama is reachable

If `ollama.service` is crash-looping (e.g. due to a Tailscale IP that isn't currently assigned):

```bash
systemctl status ollama
# Look for: "bind: cannot assign requested address"

# Fix: override the bind address
sudo systemctl edit ollama
# Add under [Service]:
# Environment="OLLAMA_HOST=0.0.0.0:11434"

sudo systemctl restart ollama
```

Once both services are up and reachable, the Knowledge page will show `embedding_model_available: true` and the Knowledge page form will work.
# Arynwood-MCP
