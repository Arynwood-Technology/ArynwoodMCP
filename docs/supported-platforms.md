# Supported Platforms

## Officially supported

**Linux x86_64**, packaged as an AppImage and a `.deb`. This is the only platform
this project builds, tests, and supports for the desktop alpha.

macOS and Windows are **not currently supported**. The Tauri shell (`frontend/src-tauri/`)
is cross-platform-capable in principle, but nothing here has been built, run, or
tested on either — don't infer support from the underlying framework.

## Linux runtime baseline

Version 0.4.4 release builds use Ubuntu 22.04 (glibc 2.35). The AppImage requires
host glibc 2.35 or newer; it does not bundle the C library. This is a minimum ABI
requirement, not a guarantee that every Linux distribution has been tested.
The `.deb` also needs compatible system WebKitGTK 4.1 and GStreamer packages.
Build on Ubuntu 22.04 when preparing release artifacts: compiling on a newer
system can raise the required glibc version.

## Hardware

| Component | Minimum | Notes |
|---|---|---|
| CPU | any x86_64 | |
| RAM | 16 GB | Ollama model loading is the main consumer; a 14B-parameter model (the default for the `central`/Arynwood persona) needs headroom beyond the OS + app |
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
file (repo root for a source checkout, `~/.local/share/arynwood-mcp/.env` for the packaged
app). A path that doesn't exist just leaves that one feature unavailable.

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
