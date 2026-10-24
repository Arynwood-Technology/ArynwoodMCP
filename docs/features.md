# Feature guide

How much to rely on each feature is in [known limitations](known-limitations.md) (reviewed
against 0.4.3): Video Studio, Music Lab and social publishing are Tier 2, with caveats; stem
separation, RVC, audio FX, GPU scripts and LoRA are Tier 3. Some features need a source checkout:
see [packaged-build exclusions](installation.md#features-that-dont-work-in-the-packaged-build).

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

Each persona has its own model in `mcp/config/models.json` (defaults to a general-purpose model; swap any entry for whatever you'd rather run). Switch models per conversation from the model dropdown.

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

**Requires Qdrant and Ollama to be running** - see [Knowledge Base Setup](installation.md#knowledge-base-setup).

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
(`hermes3:8b` by default), independent of whichever model/persona
you're actually chatting with. It was chosen by measurement: see the
[tool-calling benchmark](https://github.com/Arynwood-Technology/local-ai-benchmarks/blob/main/TOOL-CALLING.md).

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

Register multiple Ollama or OpenAI-compatible endpoints. An endpoint can run chat and image
generation that this computer can't: see [docs/endpoints.md](endpoints.md).

- Add by name, host or URL, port, and optional auth token (kept in the backend, never shown again)
- Ping any server to check latency and online status
- **Use for chat**: the server chat uses, remembered across launches, with its own model for an
  OpenAI-compatible server
- **Use for images**: an OpenAI-compatible server and image model for Design Center's AI Gen
- An installer can preset an endpoint and CPU mode in the backend's `.env`

---

### Studio

Audio production tools powered by the [MusicStudio](https://github.com/SkyeVault/MusicStudio) sidecars ([setup](studio.md)). The sidecars are independent FastAPI servers that live in `~/GitHub/MusicStudio/sidecars/` and are proxied through the Arynwood MCP backend.

The Studio page shows a **sidecar status bar** at the top with live health polling every 5 seconds. Each sidecar can be started and stopped directly from the UI using the ▶ / ■ buttons.

#### Generate (Instrument Generator)

Generate individual musical parts - bass, drums, guitar, piano, synth, strings, percussion, or a full arrangement - from a text prompt and structured fields (genre, style, mood, BPM, key, duration, energy, complexity), using ACE-Step (text-to-music) or MusicGen as the provider. Results are standalone stems, not full songs - the point is bringing AI-generated ideas into your own production, not asking the AI to finish the track for you.

**How to use:**
1. Pick an instrument
2. Pick a provider - an uninstalled provider shows disabled rather than failing at generate time
3. Fill in genre/style/mood/BPM/key/duration/energy/complexity and an optional free-text prompt; optionally attach reference or melody audio
4. Click **Generate** - results appear as numbered ideas ("Bass Idea 01", "Bass Idea 02", ...) with Play/Download/Rename/Favorite/Regenerate/Delete

**Requires:** song-gen sidecar (port 8003) - see [Studio: Full Setup & Roadmap](studio.md) to install ACE-Step/MusicGen

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

## Area overview

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
| **Gateway** (experimental, off by default) | Owner-only remote control: persistent sessions over a local API or your own IRC server, file memory. See [docs/gateway.md](gateway.md) |

Every screen shares the same chrome: a collapsible sidebar, a **⌘K / Ctrl+K command
palette**, and a **system status drawer**. See [Getting Around](#getting-around).

---
