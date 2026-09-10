# Supported Platforms

## Officially supported

**Linux x86_64**, packaged as an AppImage and a `.deb`. This is the only platform
this project builds, tests, and supports for the desktop alpha.

macOS and Windows are **not currently supported**. The Tauri shell (`frontend/src-tauri/`)
is cross-platform-capable in principle, but nothing here has been built, run, or
tested on either — don't infer support from the underlying framework.

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
