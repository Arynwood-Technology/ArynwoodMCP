# Changelog

All notable changes to Arynwood MCP are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Entries before this file existed (everything under "0.4.0" and earlier) are
reconstructed from git history for context, not a line-by-line commit log — treat
them as a summary, not a precise record.

## [Unreleased]

### Fixed

- **Kdenlive tool-calling was completely dark in every build**, packaged app
  included — `mcp/config/mcp_servers.json` didn't exist, so no chat message
  could ever reach the MCP gate/tool-calling loop regardless of whether
  `mcp-kdenlive.service` was running. Registered the server and confirmed a
  live gate-dispatch + tool round-trip end-to-end.
- **The above also uncovered a packaged-build-only path-resolution bug** in
  `backend/routers/mcp_proxy.py`: it located its config file via a hand-rolled
  `__file__`-relative chain that doesn't reliably survive PyInstaller's module
  repacking (the exact anti-pattern `_frozen.py` exists to replace). Fixed to
  use the same `app_base_dir()`/`user_data_dir()` split as the database, since
  this file is personal per-install config, not bundled app payload — a
  packaged build now reads/writes it from the XDG data dir instead of a
  read-only path inside the AppImage. The same unmigrated pattern still exists
  in `music.py`, `lora.py`, `tools.py`, `system.py`, and `gpu_jobs.py` — not
  yet audited.
- **59 real correctness bugs in the frontend**, found while auditing the
  (already-red) ESLint baseline rather than assuming it was all style noise:
  two `rules-of-hooks` violations, impure calls reachable from render,
  use-before-declaration closures, silently swallowed errors, and effect/
  dependency issues across 20 files. `docs/architecture.md` and
  `docs/troubleshooting.md` also had a stale `mcp_servers.json` example
  missing its required `mcpServers` wrapper key — fixed.

## [0.4.2] — 2026-09-11

### Removed

- **Story-specific co-writer personas** and their LoRA fine-tuning
  pipeline. Both were tuned specifically for one author's own manuscript
  rather than being a generalized creative-writing tool, so they weren't a
  good fit for a general public release.

## [0.4.1] — 2026-09-11

### Fixed

- **Packaged Linux app couldn't reach its own backend.** Every `/api/*` request
  failed CORS preflight in the AppImage/`.deb` build — the desktop window's real
  origin on Linux is `tauri://localhost`, not the `http://tauri.localhost` the
  CORS policy was written for. Chat, tool lists, personas, and every other
  panel now load correctly in the packaged app.
- Two related content-security-policy gaps fixed in the same pass: the
  notification permission check and the Inter font stylesheet were both being
  silently blocked in the packaged build.
- Removed the temporary developer-tools access used to diagnose the above —
  not part of the release build.

## [0.4.0] — 2026-09-10

First Linux desktop alpha.

### Added

- **Linux desktop app** — AppImage and `.deb` packages, backend bundled as a
  managed sidecar (no separate Python/Node install needed). Ollama remains a
  separate install, same as any other model runtime.
- **DJ Toolkit** — launcher and manual for Mixxx, Ardour, Hydrogen, Surge XT,
  Vital, and other Linux audio production tools.
- **AI Music Lab** — instrument generation and "Jam with AI," plus a stem
  library.
- **GPU model manager** — browse installed Stable Diffusion checkpoints and
  LoRAs.
- **MCP tool-calling** generalized beyond Kdenlive to any registered tool
  server, via config rather than code changes.
- **GPU job queue** — replaces a single global lock; `GET /api/system/gpu-queue`
  exposes queue depth so the UI can explain why a generation is waiting.
- Backend and frontend automated test suites (pytest, vitest).
- `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, and install/troubleshooting docs.

### Changed

- Backend and Ollama now bind to `127.0.0.1` by default instead of `0.0.0.0`.
  LAN access is an explicit opt-in (`ARYNWOOD_BIND_HOST`, `OLLAMA_HOST`) —
  pair it with `ARYNWOOD_API_KEY` if you turn it on.
- CORS restricted to the app's own origins, closing off a class of
  browser-based access from arbitrary websites that a wide-open policy left
  possible.
- Ollama calls consolidated onto a shared client with batched embeddings.
- Persona selection now actually switches the active model.

### Known limitations (Linux alpha)

- GPU generation tool scripts (Real-ESRGAN, Whisper, SadTalker, LoRA training,
  and similar), the project file browser, and chat's automatic project-context
  feature are not available in the packaged build — they assume a source
  checkout. Everything else (chat, memory, knowledge base, social publishing)
  works the same as running from source. See `docs/installation.md`.
- GPU features need an NVIDIA card; chat works without one via Ollama.
- Ollama and Qdrant are separate installs, not bundled.

## [0.1.0] — initial release

- First version: AI chat/generation, video, music/sound, and design-studio surface.
