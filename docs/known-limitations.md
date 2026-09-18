# Known Limitations (Alpha)

This is an early Linux alpha. This page says plainly what is solid, what needs a caveat, and
what doesn't work yet, so you can decide what to rely on. It is kept in step with what has
actually been tested — if something here reads more cautiously than the app feels, that is
deliberate.

**Last reviewed:** 2026-09-18, against v0.4.2 plus the unreleased changes in `CHANGELOG.md`.

## How to read the tiers

- **Tier 1 — reliable.** Exercised end to end; safe to depend on.
- **Tier 2 — works, with a caveat.** Read the caveat before relying on it.
- **Tier 3 — early or source-checkout only.** Expect gaps; some pieces aren't in the packaged app yet.

## Tier 1 — reliable

| Feature | Notes |
|---|---|
| Chat across personas | Streaming replies, conversation history, per-conversation summarization. If a reply fails (model missing, backend error, dropped connection) you now get a message saying why and your text is put back in the box. The chat reconnects by itself if the backend restarts. |
| Knowledge base and memory | Needs Qdrant and Ollama's embedding model (`nomic-embed-text`). The vector collection is created on your first learn, so it reads "created on your first learn" before then — that is normal. |
| Tool-calling permission tiers | Every tool call is classified read-only / reversible / destructive / publish. Destructive and publishing calls always pause for your approval; deny means it is not run. |

## Tier 2 — works, needs a caveat

| Feature | Caveat |
|---|---|
| **Kdenlive control from chat** | Needs the `mcp-kdenlive` service **and Kdenlive itself open**. The approve/deny flow has been exercised live against a real model and the real MCP service — but with the editor closed, so real timeline edits driven from an approved call are still untested. Local models can hesitate, loop, or guess a wrong tool name on a large tool list: check consequential results. |
| GPU generation (Stable Diffusion, TTS, etc.) | Each tool is a separate service you install. One 12 GB GPU is shared, so jobs queue and large models can fail to load if another is resident. See `supported-platforms.md`. |
| Social publishing | You supply your own OAuth app credentials per platform; Connect stays disabled ("Needs setup") until they are set, and the page lists exactly which variables and which file. Only tested against local pages and mocks — not live posting to every platform. |
| **Video Studio** (assemble → render) | Playback, splitting, speed changes, fade/slide transitions, photo clips, the three canvas sizes, extra audio tracks, burned-in captions and looks were checked by rendering real clips and inspecting the output (durations, tone order, resolution, frame content): all correct. Not exercised with very long or 4K media. The preview is decoded by the browser, so an unusual codec may not preview even though it renders. |
| **Music Lab** (song generation) | Both engines produced real audio end to end through the packaged backend (ACE-Step and MusicGen, ~8 GB of VRAM each, one at a time). Needs MusicStudio installed. MusicGen output used to clip; it is now soft-limited. Quality is what those models give — short clips only (ACE-Step ≤ 90 s, MusicGen ≤ 30 s). |
| Web search | Uses public search; results are treated as untrusted text and can be wrong. |

## Tier 3 — early, or not in the packaged app yet

| Feature | Status |
|---|---|
| GPU tool scripts, LoRA training, Whisper/captions, SadTalker, Chatterbox | The helper scripts are **not bundled** into the packaged app, and each needs its own external install. They work from a source checkout; where the tools live is now configurable (see `supported-platforms.md`) instead of assuming one machine's home directory. |
| Stem separation, RVC voice conversion, audio FX, Whisper captions | Same MusicStudio sidecars as Music Lab and they start the same way, but only song generation has been exercised end to end. Recordings and generated audio are stored under your user data directory, so they survive quitting the app. |
| PDF learning | Needs a separate Sycamore checkout; without it PDF learning fails clearly (other file types are unaffected). |
| Filesystem browser and "project tree" chat context | Meaningless in the packaged app (there is no project) and refuses with a clear message there. |
| Sidecar cleanup | Sidecars and the backend now end when the app quits. A sidecar you start yourself from a terminal is yours to stop. |
| **Restart API** button | Only works when running from source. The packaged app can't restart its own backend — quit and relaunch. The button is hidden there. |
| Cutroom (AI-driven video editing) | A separate project. Its editor build and identity are still Kdenlive's; see its own notes. |

## Security defaults

- The backend and Ollama listen on `127.0.0.1` only. Exposing them to your network is opt-in
  (`ARYNWOOD_BIND_HOST`) and there is no login screen yet — set `ARYNWOOD_API_KEY` if you do.
- API credentials for social platforms live in your `.env`; the app only ever reports whether
  they are set, never their values.
- **Publish (SFTP) target passwords are stored unencrypted** in the local database
  (`arynwood.db`); the UI masks them but the file does not. Prefer an SSH key for a target, and
  treat the database file, and any backup of it, as sensitive.

## Reporting a problem

Include your OS, the app version (it is in the release filename), your GPU and Ollama model, the exact steps, and a screenshot with any secrets removed. See
`troubleshooting.md` for the common fixes first.
