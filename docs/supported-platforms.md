# Supported Platforms

## Officially supported

**Linux x86_64**, packaged as an AppImage and a `.deb` (current release: 0.4.7).

**Windows x64** alpha, first published in 0.4.5 as an unsigned per-user NSIS
installer; see [Windows setup and limitations](windows.md). This does not imply
Windows support for every optional GPU tool or external integration. macOS remains
unsupported.

## Linux runtime baseline

Linux release builds (since 0.4.4) use Ubuntu 22.04 (glibc 2.35). The AppImage requires
host glibc 2.35 or newer; it does not bundle the C library. This is a minimum ABI
requirement, not a guarantee that every Linux distribution has been tested.
The AppImage also uses the host ALSA runtime (`libasound.so.2`, provided by
`libasound2` on Ubuntu 22.04); minimal containers may not include it.
The `.deb` also needs compatible system WebKitGTK 4.1 and GStreamer packages.
Build on Ubuntu 22.04 when preparing release artifacts: compiling on a newer
system can raise the required glibc version.

## Hardware

| Component | Minimum | Notes |
|---|---|---|
| CPU | any x86_64 | |
| RAM | 16 GB | Ollama model loading is the main consumer; the default 8B model needs headroom beyond the OS + app. 8 GB works with a smaller model or a [remote endpoint](endpoints.md) |
| Disk | 20 GB free, more per model/LoRA/generated media you keep | SQLite DB, Qdrant storage, and any local Ollama models all live outside the app bundle in your user data directory |
| GPU | **Optional for chat**, **required for GPU generation features** | See below |

### GPU requirements are feature-scoped, not app-wide

The core chat/persona experience runs on Ollama, which can run CPU-only (slowly) or
on any GPU Ollama itself supports. But several *optional* features assume an NVIDIA
GPU specifically, because the services behind them do:

- **Stable Diffusion (A1111)** and **TortoiseTTS** — `docker-compose.yml` reserves
  an NVIDIA GPU for both (`deploy.resources.reservations.devices`, `driver: nvidia`).
  These containers will not start without one.
- **LoRA training** and the **GPU model manager** — assume the same local NVIDIA
  stack.
- **Music Lab** (ACE-Step/MusicGen song-gen sidecar) — GPU-bound in the sibling
  `MusicStudio` repo; see that project's own docs.

This app has been developed and is routinely run against a **single 12GB-VRAM NVIDIA
GPU** — that's a real constraint, not a padded minimum: expect to hit VRAM pressure
running more than one GPU-heavy feature at once (chat model + Stable Diffusion +
TTS all competing for the same card is the documented failure mode behind the
`ollama.service` OOM gotcha in `CLAUDE.md`). A single mid-range NVIDIA GPU with
≥12GB VRAM is a reasonable practical minimum if you want the GPU features; less VRAM
will work for chat-only use with Ollama running a smaller model.

None of the GPU-bound services are bundled with the desktop app — see
`docs/installation.md` for what's installed separately.

### CPU mode

One program runs on every computer. On a computer without an NVIDIA GPU, **CPU mode** (in
**Tools**) switches off the tools that need one and tunes chat for the CPU:

- **Marked, not hidden.** Tools that need an NVIDIA GPU carry a GPU mark and can't be started:
  Stable Diffusion, Fooocus, Tortoise and AllTalk TTS, Chatterbox, RVC voice conversion,
  SadTalker, AnimateDiff, LTX-Video, Wan2.1, Music Lab generation (Generate, Jam with AI) and
  LoRA training. Music and Video Studio stay in the sidebar with a GPU mark; recording, stem
  separation, effects, the DJ Toolkit, video assembly and captions work on the CPU. The backend
  refuses the GPU tools too, with a message saying why.
- **Chat on this computer's CPU** uses a smaller context (6144 tokens instead of 8192), keeps
  the model loaded for an hour instead of five minutes, loads it when the app opens, and gives
  background summaries longer to finish. While the CPU works, chat says so. A persona's own
  `llm.num_ctx` still wins, and none of this applies to a chat endpoint.
- **Auto** (the default) turns CPU mode on when `nvidia-smi` finds no NVIDIA GPU; **On** and
  **Off** force it. An installer can set the starting value with `ARYNWOOD_CPU_MODE` in the
  backend's `.env`.

A CPU reads the prompt and writes the reply many times slower than a GPU: expect minutes, not
seconds, for a reply from an 8B model on a small server, and less with a 3B model. An
[endpoint](endpoints.md) runs chat and image generation on another computer instead.

## Required external services (not bundled)

- **Ollama** — required for any chat persona to function.
- **Qdrant** — required for Knowledge base search and memory retrieval.
- Everything else (A1111, TortoiseTTS, Prometheus, the MusicStudio sidecars,
  mcp-kdenlive) is optional — the corresponding feature degrades or is unavailable
  without it, the rest of the app is unaffected.

### Where Arynwood looks for the external tools

The GPU tools, LoRA training, Whisper, SadTalker, Chatterbox, the A1111 model folders, the
MusicStudio sidecars and the Sycamore PDF parser are separate checkouts/venvs. By default
Arynwood looks under your home directory; every location can be overridden in the `.env`
file (repo root for a source checkout; for the packaged app, `~/.local/share/arynwood-mcp/.env`
on Linux or `%LOCALAPPDATA%\arynwood-mcp\.env` on Windows). A path that doesn't exist just leaves that one feature unavailable.

| Setting | Default | Used for |
|---|---|---|
| `ARYNWOOD_TOOLS_DIR` | `~/tools` | Root for the entries below |
| `ARYNWOOD_KOHYA_DIR` | `$TOOLS/kohya_ss` | LoRA dataset prep and training |
| `ARYNWOOD_ANIMATEDIFF_DIR` | `$TOOLS/AnimateDiff` | AnimateDiff |
| `ARYNWOOD_WHISPER_VENV` | `$TOOLS/whisper-venv` | Whisper transcription / captions |
| `ARYNWOOD_SADTALKER_DIR`, `ARYNWOOD_SADTALKER_PYTHON` | `$TOOLS/sad-talker`, `~/miniconda3/envs/sadtalker/bin/python` | SadTalker |
| `ARYNWOOD_CHATTERBOX_VENV` | `$TOOLS/chatterbox-venv` | Chatterbox voice cloning |
| `ARYNWOOD_SERVICES_DIR` | `~/services` | Root for the A1111 entries below |
| `ARYNWOOD_A1111_DIR` | `$SERVICES/a1111` | A1111 docker-compose project |
| `ARYNWOOD_A1111_CHECKPOINTS_DIR`, `ARYNWOOD_A1111_LORA_DIR` | `$A1111/data/models/{Stable-diffusion,Lora}` | Model listing, LoRA export |
| `ARYNWOOD_PROJECTS_DIR` | `~/GitHub` | Root for the sibling repos below |
| `ARYNWOOD_MUSICSTUDIO_DIR` | `$PROJECTS/MusicStudio` | Music sidecars (stems, RVC, song generation) |
| `ARYNWOOD_SYCAMORE_DIR` | `$PROJECTS/sycamore/lib/sycamore` | PDF learning (layout/OCR/tables) |
| `ARYNWOOD_COMMUNITY_DIR` | `$PROJECTS/arynwood-community` | Arynwood Community sidecar (optional) — a checkout of its official repo, `github.com/Arynwood-Technology/arynwood-community` <!-- TODO(community-repo): placeholder URL; the repo hasn't been created yet — update once it exists --> |
| `ARYNWOOD_COMMUNITY_URL` | `http://127.0.0.1:8018` | Community address; a non-local URL (e.g. `https://community.arynwood.com`) means a hosted instance — status and Open only |

A specific setting beats its root, and an empty value (`ARYNWOOD_KOHYA_DIR=`) counts as unset.
