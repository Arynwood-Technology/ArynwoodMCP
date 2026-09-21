# Changelog

All notable changes to Arynwood MCP are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Entries before this file existed (everything under "0.4.0" and earlier) are
reconstructed from git history for context, not a line-by-line commit log — treat
them as a summary, not a precise record.

## [0.4.3] — 2026-09-21

### Added

- **Release tooling for the desktop build:** `scripts/stage_gstreamer_plugins.sh` (the curated GStreamer plugin set the
  AppImage bundles) and `scripts/check_webkit_media.py` (plays WAV/MP3/MP4 and records in a real WebKitGTK under any
  plugin set — the acceptance test for a built AppImage). Both are described in `CLAUDE.md`.
- `DownloadButton` / `lib/download.ts` (save a backend file under a chosen name), `apiUrl()` in `lib/api.ts`, `lib/mic.ts`
  (`openMicStream`, `usableInputs`, `describeMicError`), and Music Lab's `useMusicCapabilities` / `FailedMusicJobs` —
  each with tests (93 frontend tests now).
- Two optional per-persona `models.json` fields: `app_aware: false` lets a
  persona built entirely around its own system instructions skip the
  app-environment preamble (GPU tools, Kdenlive control, etc.) it has no
  real access to — every persona was claiming those capabilities
  unconditionally before this, which measurably pulled a persona with no
  such access toward generic "capable assistant" behavior instead of its
  own established voice. `llm.num_ctx` lets a persona with an unusually
  large system prompt override the app-wide context ceiling so its own
  instructions don't crowd out conversation history and the reply itself.
- **Your own personas, without touching the app.** `personas.local.json` in the per-user data
  directory (or `ARYNWOOD_PERSONAS_FILE`) is merged over the bundled personas at runtime, in
  the source checkout and the packaged app alike — see `docs/customizing-personas.md`.
- A versioned pre-push guard (`scripts/install-hooks.sh`, `scripts/push-guard.py`) that
  refuses pushes containing content matching a private denylist, restricts public remotes to
  `main` and version tags, and fails closed.
- Doc, Kona, Glyph and Estra now ship with real system prompts and tuned default models
  (they had none), a `generate_spreadsheet` tool for Glyph, and opt-in codebase tools
  (`ARYNWOOD_ENABLE_CODEBASE_TOOLS=1`).

### Changed

- **The DJ Toolkit is a tool inside Music, not a sidebar destination.** It's a small "DJ Toolkit" button
  in the Music page's sidebar strip (next to Refresh) that opens the same page, with a "Back to Music" link, and
  Music stays highlighted in the sidebar while you're there. It is a launcher for Flatpak/desktop apps on
  Linux, so it no longer takes a top-level slot for everyone. Its content is now generic: the "open my DJ project's
  README / learning plan" buttons (which read a fixed folder on one machine) and the hardcoded "installed
  version" numbers and "already applied on this machine" tips were removed.

### Fixed

- **Nothing played, and every download saved the wrong file, in the desktop app.** `main.tsx` patches
  `fetch()` so `/api/...` reaches the backend, but `<audio src>`, `<video src>`, `<a href>` and `new Audio()`
  can't be patched: a relative `/api/...` there resolved against the app's own origin, which answers with its
  own `index.html` (`MEDIA_ERR_SRC_NOT_SUPPORTED`), and the Download button saved that HTML page under a
  name like `audio`. Media and link URLs now go through `apiUrl()`. Downloads fetch the file and save the blob
  (`DownloadButton` / `lib/download.ts`) — measured in real WebKitGTK, an `<a download>` to another origin is
  silently ignored, while a blob download honours the filename. The desktop shell no longer overrides the
  filename WebKit suggests (it used the URL's last path segment, so a blob saved as a bare UUID).
- **The desktop app's Content-Security-Policy blocked every `blob:` media URL** (no `media-src`, and
  `default-src` lacks `blob:`) — so a clip or take you had just loaded from disk, and the recorder's own
  preview, could never play. Added `media-src 'self' blob: data: http://localhost:*` and `blob:`/`data:` to
  `connect-src`.
- **Music Lab's Record tab could not record in the desktop app**: `new MediaRecorder(stream)` threw
  "unsupported on this platform" (and, once that was fixed, recorded 0 bytes) because the AppImage lacked the
  GStreamer plugins WebKitGTK's recorder needs (`transcode`, `voaacenc`, `encoding`). Also bundled:
  `debugutilsbad` (fake sinks WebKit puts in every media pipeline — their absence logged GStreamer assertions on
  each `<audio>`), `videofilter`, `deinterlace`, `subenc`, `gio`, `autoconvert`.

- **The desktop app's window went solid grey the first time it touched audio or video.** The AppImage
  bundled GStreamer's libraries but none of its plugins, and WebKitGTK does all media through GStreamer —
  so there was no audio sink (`GStreamer element autoaudiosink not found`), and WebKit crashed its renderer
  process on a NULL sink while the app and backend kept running. Music Lab playback, Video Studio preview and
  microphone recording in the packaged app all depended on it. The AppImage now bundles the ~40 GStreamer
  plugins a web view needs (`scripts/stage_gstreamer_plugins.sh`, `bundleMediaFramework`); the `.deb` was never
  affected (it uses the system's GStreamer).

- **Music Lab: "Generate"/"Jam" stayed disabled if you started the Song Generation sidecar after
  opening the tab.** The provider list was fetched only when the tab first appeared, so it stayed empty
  (with a warning telling you to start a sidecar that was already running) until you switched tabs and
  back. It is now fetched whenever the sidecar becomes ready — and asked for again if the sidecar is up but
  hasn't finished probing its providers — with an accurate message and a "try again" button if it never
  answers.
- **Microphone recording failed with "Invalid constraint" in the desktop app.** The recorder requested the
  first listed input by an `exact` device id — but before the first permission grant browsers list devices
  with a blank id, and WebKitGTK rejects such a request (and its error isn't a `DOMException`, so the
  friendly message was skipped too). Devices with blank ids are no longer offered, the chosen device is
  requested as a preference rather than a requirement, and if the browser still refuses it recording
  retries with the default input. Applies to Music Lab's recorder and the Video Studio voiceover recorder.
- **Music Lab hid why a generation failed.** A request the backend rejected showed only "Could not start
  generation", and a job that failed inside the sidecar (a model crash, audio it couldn't decode) simply
  vanished from the "Generating" list. Both now show the actual reason, and a failed job stays visible
  until you dismiss it.

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
  in `music.py`, `lora.py`, `tools.py`, `system.py`, and `gpu_jobs.py` — since
  audited and fixed (see below).
- **59 real correctness bugs in the frontend**, found while auditing the
  (already-red) ESLint baseline rather than assuming it was all style noise:
  two `rules-of-hooks` violations, impure calls reachable from render,
  use-before-declaration closures, silently swallowed errors, and effect/
  dependency issues across 20 files. `docs/architecture.md` and
  `docs/troubleshooting.md` also had a stale `mcp_servers.json` example
  missing its required `mcpServers` wrapper key — fixed.
- **External tool locations were hardcoded to one machine's home directory** (kohya_ss,
  AnimateDiff, Whisper, SadTalker, Chatterbox, the A1111 model folders, MusicStudio,
  Sycamore), so those features failed on any other machine even from a source checkout.
  They now resolve through `backend/external_paths.py` — `ARYNWOOD_*` env vars, else a
  default under `$HOME` — and a test fails if a `/home/<user>/` path or a
  `__file__`-relative repo-root chain reappears in shipped code. See
  `docs/supported-platforms.md` for the settings.
- **Packaged builds lost generated files on quit.** Music Lab recordings, saved Chatterbox
  voices and every GPU job's output were written under the bundle's temporary extraction
  directory. They now live in the user data directory (unchanged in a source checkout).
- **"Restart API" claimed to restart in a packaged build and did nothing** (it touched a
  `backend/api.py` that doesn't exist there, and the desktop shell never respawns its
  backend). The backend now reports `can_restart`, the endpoint answers 501 when it can't,
  and the Dashboard button, status drawer action and command-palette entry are hidden.
- **Chat never reconnected.** If the backend restarted — or the packaged app's frontend loaded
  before its bundled backend was ready — the composer stayed on "Connecting…" until a page
  reload. The socket now reconnects with backoff, ignores late events from a discarded
  socket (which could flip a healthy connection to "disconnected"), and no longer logs
  "closed before the connection is established" on unmount.
- **A failed chat turn vanished silently.** A backend error (e.g. model not found) was
  discarded, the composer was emptied, and a dropped connection mid-reply left the composer
  locked. Errors now show in a dismissible banner, the message you sent is put back in the
  box, and in-flight state is reset on disconnect.
- **After you denied a destructive tool call, the model replied "I need your confirmation to
  proceed — shall I go ahead?"** because a decline and "no approval channel" shared one
  message. A real decline now tells the model the answer is no, nothing ran, and not to ask
  again.
- Knowledge page showed a red "Collection not yet created" error on every fresh install; it's
  now a neutral note (the collection is created on the first learn).
- Social page told packaged-app users to edit "`.env`" without saying where, and let Connect
  open a raw-JSON error popup. It now shows the real `.env` path and only the variables still
  missing, and Connect reads "Needs setup" until they're set (`GET /api/social/config`
  reports presence only, never values).
- Text inputs, selects and textareas in Tailwind-migrated components ignored their utility
  classes (the global form reset was unlayered CSS, which beats Tailwind's layered
  utilities); the reset now lives in `@layer base`.
- Icon-only buttons on Models, Servers and Social had no accessible name; the launcher banners
  hardcoded `v0.4.0` (they now read `package.json`, with a test that all version sources
  agree); the lint baseline said 108 while actual lint was 46, so CI would have let 62 new
  problems through — it is now 41.
- **Every sidecar failed to start in the packaged app** (Music Lab song generation, stem separation,
  voice conversion, audio FX, Whisper) with no explanation. The AppImage/PyInstaller backend passes its
  own `PYTHONHOME`, `PYTHONPATH`, `LD_LIBRARY_PATH` and `PATH` entries to every child process, and a
  sidecar's own venv Python given the bundle's `PYTHONHOME` dies at startup (`No module named
  'encodings'`); the backend also threw the sidecar's stderr away. The frozen backend now strips
  bundle-rooted entries from its environment before spawning anything, and sidecars log to
  `~/.local/share/arynwood-mcp/logs/`, report an instant crash with its reason (and a red "failed"
  state instead of a silent flip back to "stopped"), and show the tail of the log in the Studio bar
  and the status drawer.
- **Video timeline playback was choppy, with ~1s freezes.** The preview seeked the playing `<video>`
  whenever it drifted 0.2s from the wall-clock playhead; a seek leaves the element reporting the target
  position while the playhead keeps running, so it looked behind again at once and was re-seeked — 25
  seeks in 12s of undisturbed playback (measured), i.e. scrubbing instead of playing. Small drift is now
  absorbed by nudging `playbackRate` (±6%), hard seeks are limited to >0.75s and never issued while one
  is in flight (2 of the 25 remain, at clip boundaries). Playing across a cut between two halves of the
  same source no longer reloads the file (black flash + stall), and a newly loaded clip now aims at where
  the playhead is *now*.
- **Video Studio's "Render Timeline" button was unreachable in a 900px-tall window** (the app's default
  is 1400×900), and Social/Studio/DJ were flush against or past the bottom edge: four pages sized their
  root to `100vh` inside a shell that already spends 52px on the top bar. Shorter windows also let the
  Properties/Audio panels paint over the timeline; the editor now grows with its content and the area
  scrolls instead. An automated pass over 12 pages, every tab, at 1440×900, 1100×700 and 900×600 finds
  no overlapping text or controls.
- **One malformed video-edit request froze the entire backend.** A clip with `speed` of 0, a negative
  number, infinity or NaN sent `_atempo_chain` into a loop that never ends (and grows a list until it
  reached ~19 GB); it ran on the event loop, so chat and everything else hung until the process was
  killed. The timeline UI only offers fixed speed presets, but a corrupted project, script or tool call
  could send it. `POST /api/video/edit/jobs` now rejects out-of-range or non-finite speeds, trims,
  transition durations, volumes and offsets with a 400, and the function itself refuses them and is bounded.
  A full render matrix (speed, trims, fade/slide transitions, photo clips, three canvases, audio tracks,
  captions, looks) was checked with ffprobe and audio/frame analysis: all correct.
- **The packaged app left its backend and sidecars running after you quit.** The desktop shell hard-kills
  the backend launcher, which runs no cleanup, so the Python child kept `:8010` and each sidecar kept its
  port and GPU memory. Both now ask the kernel to signal them when their parent dies
  (`PR_SET_PDEATHSIG`), and a graceful shutdown stops the sidecars it started. The Stop button used to
  say "stopped" for a sidecar this app didn't start (e.g. one launched from a terminal) while it kept
  running; it now says so.
- Music Lab: MusicGen output was hard-clipped (thousands of samples at full scale, flat-topped
  waveforms); the runner now enables audiocraft's soft limiter (`MusicStudio`, `run_musicgen.py`).
- `scripts/smoke_packaged_backend.py` runs a built backend binary under an AppImage-style environment,
  hermetically (isolated port and data dir, fake sidecar), and checks the packaged-only behaviours above.
- `npm run dev` can target a backend on another port (`ARYNWOOD_DEV_API=http://localhost:18010`), so a
  running desktop app on `:8010` no longer blocks development.

### Security

- The Social OAuth popup page put the `error` query parameter and the URL's platform segment
  into HTML/JavaScript unescaped (reflected script injection on the app's origin via a crafted
  callback link). Output is now escaped and the platform is pinned to a known name.

### Documentation

- New `docs/known-limitations.md` (tiered status of every feature, including that Publish
  target passwords are stored unencrypted in the local database) and `docs/customizing-personas.md`.
- CLAUDE.md: how to build and verify an AppImage locally without installing it.
- `docs/installation.md`: everything in the data directory, upgrading an AppImage, and that sidecars
  work in the packaged build. `docs/troubleshooting.md`: sidecars that won't start, a port still in use
  after quitting, the missing Restart button, and "Invalid timeline" exports.

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
