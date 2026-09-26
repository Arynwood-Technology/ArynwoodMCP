# Release Readiness Audit — Linux Desktop Alpha

Date: 2026-09-10
Scope: what it would take to ship a first public Linux desktop build (AppImage/.deb)
of Arynwood MCP. Everything below was verified against this checkout, not assumed —
each finding cites the file(s) it came from. Where the checkout already contradicts a
commonly-assumed gap (e.g. ".env.example is missing"), that's called out explicitly so
later work doesn't rediscover it the hard way.

> **Update 2026-09-18.** This audit is a 2026-09-10 snapshot; several findings below have since been
> fixed or superseded — check `CHANGELOG.md` and `known-limitations.md` for the current state before
> acting on it. Notably: hardcoded per-machine tool paths are configurable (`backend/external_paths.py`);
> generated files no longer land in the bundle's temp dir; sidecars start in the packaged app and end with
> it; "Restart API" is honest; a license, CI, release workflow and a published `v0.4.2` exist; and
> `scripts/smoke_packaged_backend.py` now smoke-tests a frozen backend. Still true: GPU tool *scripts*
> aren't bundled, so those features remain source-checkout only.

> **Packaging update 2026-09-26:** version 0.4.4 adds archive-level launcher permission
> verification and Ubuntu 22.04 release builds (glibc 2.35 baseline). See
> [the current release checklist](releases/0.4.4.md); the findings below remain a historical audit.

## 0. Open decision this audit cannot make: license and distribution model

`CLAUDE.md` describes the deployment target as "multi-tenant managed hosting **or
self-hosted license**" — that phrasing reads as a commercial/paid-license product,
not necessarily an open-source release. There is currently **no `LICENSE` file, no
`license` field in `frontend/package.json` or `frontend/src-tauri/Cargo.toml`, and no
mention of licensing terms anywhere in the repo.** A public GitHub release with CI
artifact publishing (the copy-ready prompt's phase 6) is a materially different thing
depending on which of these it is:

- **Open source** (MIT/Apache-2.0/GPL/etc.) — anyone can fork, redistribute, and build
  from the public Actions workflow.
- **Source-available / proprietary with a downloadable alpha** — needs a EULA/license
  file that says so, and CI publishing needs to not imply open redistribution rights.
- **Managed-hosting-only with a separate paid self-hosted tier** — a public Linux
  desktop *alpha* may be premature until that split is decided, since the desktop
  build is exactly the self-hosted path.

This determines LICENSE content, README claims, and whether CI should publish
artifacts publicly at all. **Stopping here rather than guessing**, per the standing
instruction to flag licensing/distribution decisions instead of assuming one.

## 1. Runtime configuration: three launchers, three port stories, not two

The known gotcha already documented in `CLAUDE.md` (`start.sh` says :8000/:5173,
`vite.config.ts` pins :8010/5180) undersells it — there are **three** launch scripts,
and they don't all agree with each other either:

| Launcher | Backend port | Frontend port | Notes |
|---|---|---|---|
| `start.sh` | 8000 (`--reload`) | 5173 (prints; vite would refuse — `strictPort: true` on 5180) | Also starts Ollama, Prometheus docker stack, YouTube watcher |
| `arynwood-desktop.sh` | 8000 | 5173 (Tauri `devUrl` in `tauri.conf.json`) | Tauri dev-mode launcher; `devUrl` hardcodes 5173, so this one and `start.sh` are internally consistent with *each other* but not with reality |
| `arynwood-app.sh` | 8010 | 5180 | The one that actually matches `vite.config.ts`'s proxy target; its own header comment says it exists specifically so this repo never collides with another local checkout on the same machine |

Net effect: `vite.config.ts` (`server.port: 5180`, `strictPort: true`, proxying
`/api` and the chat WebSocket to `:8010`) is the source of truth. `start.sh` and
`arynwood-desktop.sh` are both stale against it — `arynwood-desktop.sh`'s Tauri dev
window would load `:5173`, which the actual dev server (on 5180 with strict-port)
never binds, so it would fail to connect. Only `arynwood-app.sh` is correct today.

Also found: `.env.example`'s `SOCIAL_REDIRECT_BASE=http://localhost:8000` (line 22)
has the same stale port, which would break OAuth callback URLs if a user follows the
`.env.example` default as-is with the actual :8010 backend.

**This needs one canonical port pair before packaging**, not just a doc fix —
whichever script the Tauri production build ends up invoking (or replaces) has to
agree with `vite.config.ts`'s proxy target, or the packaged app's frontend can't
reach its own backend.

## 2. Security posture: backend and Ollama both bind `0.0.0.0` by default

All three launchers start uvicorn with `--host 0.0.0.0` (`start.sh:40`,
`arynwood-desktop.sh:33`, `arynwood-app.sh`'s equivalent line), and `start.sh`/
`arynwood-app.sh` both start Ollama with `OLLAMA_HOST=0.0.0.0 ollama serve`. On a
machine with any reachable network interface (not just loopback), this exposes both
the full `/api/*` surface and the Ollama API to the LAN by default, with no auth
unless `ARYNWOOD_API_KEY` is deliberately set (`backend/services/auth.py` — off by
default, and per `CLAUDE.md`'s own gotcha, has no frontend login flow to go with it
yet).

For a general-public alpha build, `0.0.0.0` should not be the default bind — this is
exactly the "bind to localhost by default, make LAN access an explicit opt-in" item
from the release plan's hardening phase, and it's not just a doc gap, it's the actual
current default.

## 3. Desktop packaging — done and verified 2026-09-10

Originally the single largest gap (see history below, kept for context). As of
today: `tauri.conf.json`'s `devUrl` is fixed to `5180`, `bundle.targets` is
`["appimage", "deb"]` (was `"all"`, which pulled in macOS/Windows targets out of
scope per `docs/supported-platforms.md`), and `bundle.externalBin` registers a
PyInstaller-built backend sidecar (`arynwood-backend.spec` at the repo root,
entrypoint `backend/run_server.py`). `frontend/src-tauri/src/main.rs` now spawns
that sidecar in production builds (`start_backend_sidecar()`, called from `.setup()`
since sidecar spawning needs an `AppHandle`) while dev builds keep using the
pre-existing live-venv launcher (`start_backend()`, now pointed at the correct
`:8010` — it was still hardcoded to the stale `:8000` even after the rest of the
port-unification pass, because that pass only grepped `.sh/.json/.md/.py/.ts/.tsx`
files and missed `.rs`).

Mutable state no longer assumes a writable install directory: `backend/_frozen.py`
adds `app_base_dir()` (bundled read-only payload — static HTML tools, `mcp/config/`
persona definitions) and `user_data_dir()` (DB, generated social-media images — XDG
user data dir when frozen, same as before when running from source), used by
`backend/db.py`, `backend/api.py`, and `backend/routers/social.py`. This matters for
real: an AppImage mounts read-only, so the previous unconditional
`os.makedirs(.../static/social-media)` at import time would have crashed on launch.

**Verified, not just built:**
- The PyInstaller sidecar binary standalone: starts, serves `GET /`, serves bundled
  `static/html-tools/*` and `mcp/config/models.json`-backed `/api/chat/personas`,
  and writes its DB to the XDG data dir, not next to itself.
- `cargo check` on the Rust sidecar-spawn code.
- A full `npm run tauri:build` end-to-end, producing both
  `Arynwood MCP_0.4.0_amd64.AppImage` (131MB) and `Arynwood MCP_0.4.0_amd64.deb`
  (59MB) with `usr/bin/arynwood-backend` bundled inside the `.deb` at the path the
  Rust sidecar code requests it from — confirmed by extracting the actual shipped
  `.deb` (not the manually-placed build copy) and running its backend binary
  directly.
- This surfaced and fixed a real pre-existing bug independent of packaging:
  `frontend/package.json` pinned `@tauri-apps/api` to `^2`, which had drifted to
  2.11.1 against the Rust `tauri` crate's 2.10.3 (no newer 2.x crate exists yet) —
  `tauri build` refuses to run on a major/minor mismatch. Pinned to the matching
  `2.10.1`.
- Not verified: actually launching the AppImage's GUI window (no display server in
  this environment) — the backend-serving and bundling correctness above is
  confirmed directly; the Tauri window chrome itself (already pre-existing,
  unmodified by this work aside from the sidecar-spawn call) was not re-exercised
  visually.

**Known, deliberately out of scope for this pass — source-tree-coupled features:**
A number of feature areas assume they're running from a live git checkout with a
sibling `venv/` and `scripts/` directory, not a packaged install, and were *not*
redesigned here (that's a substantially larger effort than "package the backend,"
and guessing at the product decisions involved — e.g. "should the packaged app's
filesystem browser browse the user's home directory instead?" — isn't something to
do silently):
- **GPU tool scripts** (`backend/routers/tools.py`'s `run_realesrgan.py`,
  `run_kokoro.py`, `run_f5tts.py`, `run_musicgen.py`, `run_whisper.py`,
  `run_sadtalker.py`, and `backend/routers/lora.py`'s training scripts) are invoked
  as subprocesses relative to a `BASE_DIR/scripts/` and (for `tools.py`) a
  `BASE_DIR/venv/bin/pip`, left unchanged. These won't work from a packaged install
  without either bundling each tool's own dedicated venv as an additional sidecar
  (heavy — several of these already need separate venvs even in source-checkout
  form, per `CLAUDE.md`'s whisper/Sycamore gotchas) or a different distribution
  strategy for this feature class entirely.
- **Filesystem browser** (`backend/routers/fs.py`) and **chat's "project tree"
  context injection** (`backend/routers/chat.py`'s `os.listdir(BASE_DIR)`) are
  fundamentally "browse this app's own source tree" features. `chat.py`'s `BASE_DIR`
  was updated to not crash when frozen (resolves to the bundle's temp extraction
  dir), but that makes the project-tree feature harmless-but-meaningless in a
  packaged build, not functional — there's no "project" to browse once there's no
  source checkout. `fs.py`'s `BASE_DIR` was left untouched entirely.
- **Music Lab assets** (`backend/routers/music.py`'s `ASSETS_DIR`) — same
  `BASE_DIR`-relative pattern as the DB used to be, not yet redirected to the user
  data dir. Lower urgency than the DB/social-media fix since nothing here runs
  unconditionally at import time the way `api.py`'s old `os.makedirs` did, so it
  doesn't block startup — but it will write into the install directory if actually
  exercised from a packaged build.

None of the above blocks the packaged app's core surface (chat across all 7
personas, memory, knowledge base against Qdrant/Ollama, social OAuth) from working —
it blocks GPU-generation and file-management *tooling* specifically, consistent with
this alpha's own framing (GPU services are already "separately installed," per the
platform decision) — but it's a real, user-visible gap between "the desktop app
launches" and "every feature in the source-checkout version works packaged," and
should be called out as such rather than implied away by a working AppImage.

---

<details>
<summary>Original finding (2026-09-10, before the above work) — kept for history</summary>

`frontend/src-tauri/tauri.conf.json`:
- `build.devUrl` = `http://localhost:5173` (dev-only, and per §1 already wrong against
  the real dev port)
- `build.beforeDevCommand` / `beforeBuildCommand` = `npm run dev` / `npm run build` —
  these build the **frontend only**; nothing in this config builds, bundles, or
  launches the **Python backend**
- `bundle.active: true`, `targets: "all"` — bundling is turned on, so `tauri build`
  will attempt to produce platform installers, but the resulting bundle would ship a
  frontend with no way to start its own backend — right now that's the job of a shell
  script the user runs first, which doesn't exist inside the packaged app
- No `externalBin` / sidecar entry in `tauri.conf.json`, and no PyInstaller/Nuitka
  spec anywhere in the repo — the backend has never been built as a standalone binary
- `Cargo.toml` (`frontend/src-tauri/Cargo.toml`) declares `tauri-plugin-shell` and
  `tauri-plugin-notification` but no bundled-binary plumbing beyond that. Icons
  (`frontend/src-tauri/icons/`) are already populated for all target formats, so icon
  assets are not a blocker.

Backend packaging (PyInstaller/Nuitka sidecar managed by Tauri, per the release
plan's phase 3) is genuinely not started — this is the single largest piece of new
work in the whole plan, not a config tweak.

</details>

## 4. Dependencies & reproducibility

- `requirements.txt` is already version-pinned with `~=` constraints (see its own
  header comment) — this part of phase 6 is **done**, not a gap.
- `requirements-dev.txt` exists separately (42 bytes — minimal, worth checking its
  contents cover what CI would need before relying on it).
- **No `pyproject.toml`/`setup.py`** — the backend isn't installable as a package
  today; a PyInstaller spec would need to work from `requirements.txt` + source tree
  directly, or the project needs a proper packaging manifest first.
- Frontend: `frontend/package-lock.json` **exists on disk but is git-ignored** (the
  release plan's phase 6 assumed it needed to be created; it's actually already being
  generated locally, just never committed — so this is "un-ignore and commit an
  existing file," not "generate one from scratch").
- No `pyproject.toml`/pip-tools lock (e.g. no hashes) — the `~=` pins bound the range
  but don't pin exact resolved versions the way a lockfile would.

## 5. Quality gates — current baseline (all four gates run just now, this checkout)

| Gate | Result |
|---|---|
| `pytest tests/` (default, evals excluded per `pytest.ini`) | **184 passed, 10 deselected** — green |
| `npm run build` (`tsc -b && vite build`) | **Green** — builds in ~8s, one pre-existing warning about a >500kB chunk (`index-*.js`, 820kB / 240kB gzip), no errors |
| `npm test` (vitest) | **41 passed, 7 test files** — green |
| `npm run lint` (eslint) | **108 problems (86 errors, 22 warnings)** — matches the count already on record from the 2026-09-05 frontend-overhaul milestone, so this is a stable pre-existing baseline, not a regression from anything currently in progress |

Net: three of four gates are already clean. Lint is the one real gap, and per the
existing baseline note, that count predates and is unrelated to the in-flight
frontend-overhaul work (`AppShell`/`CommandPalette`/`StatusDrawer` etc., currently
uncommitted in the working tree) — worth confirming that overhaul doesn't add to the
108 before either is finalized.

## 6. Missing release artifacts

Confirmed absent: `LICENSE`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`,
`.github/workflows/` (no CI at all today — no PR checks, no release automation).
`.env.example` **does exist** (contradicts the assumption it was missing) but only
documents social-media OAuth credentials + `SOCIAL_REDIRECT_BASE` — it doesn't cover
`ARYNWOOD_API_KEY`, Ollama host/port, or DB path, so "complete `.env.example`" is
still real work, just smaller than "create one from nothing."

## 7. README accuracy

`README.md`'s Quick Start had the wrong repository name in its clone command —
already corrected to `arynwood-mcp` (§ below), which is this checkout's actual name.

## 8. External service dependencies — required vs. optional (as configured today)

- **Ollama** — required for any chat persona to function; not bundled, not a Docker
  service in this repo (`start.sh` shells out to a locally-installed `ollama serve`
  binary directly, not Compose).
- **A1111 (Stable Diffusion) + TortoiseTTS** — root `docker-compose.yml`, both
  require an NVIDIA GPU (`deploy.resources.reservations.devices` in both blocks) —
  optional at the app level (features degrade, not app-fatal, if absent — not
  independently re-verified in this pass, taken from existing `CLAUDE.md` framing)
  but clearly GPU-bound and not something to bundle installers for.
  `docker/docker-compose.yml` (root's sibling under `docker/`) exists but is
  currently an **empty file** — dead/placeholder, worth removing or filling in
  rather than shipping confusion.
- **Prometheus monitoring stack** — `docker/monitoring/docker-compose.yml`,
  optional, `start.sh` starts it opportunistically and continues either way.
- **Qdrant** — required for Knowledge/memory-index features; connection details not
  re-audited in this pass.

None of these are things this alpha should bundle (GPU model weights, Docker images)
— consistent with the plan's own instruction not to bundle heavyweight or
proprietary components. The realistic framing is "Linux desktop alpha with
separately installed Ollama/GPU services," which matches what's already documented.

## Acceptance criteria for "ready to package"

Status as of 2026-09-10 — every item is now done, including the two that were still
open as of this doc's first pass (the AGPL dependency and the npm audit findings).

1. ✅ License/distribution model decided (§0): source-available/proprietary alpha
   (`LICENSE`). The one real conflict this created — `ebooklib` (epub
   knowledge-base ingestion) being AGPLv3+ — was resolved by removing the
   dependency rather than seeking a legal exception to keep it:
   `backend/services/knowledge.py`'s `_extract_epub_text()` now parses EPUBs
   directly (stdlib `zipfile`/`xml.etree.ElementTree` + the already-present
   `beautifulsoup4`), covered by `tests/test_epub_extraction.py`. See
   `docs/third-party-notices.md` — no AGPL/GPL dependency remains in the repo.
2. ✅ One canonical backend/frontend port pair (`8010`/`5180`) — all three launch
   scripts, `tauri.conf.json`'s `devUrl`, and every hardcoded reference across
   frontend/backend, **including `frontend/src-tauri/src/main.rs`**, which the
   original port sweep missed (it only grepped `.sh/.json/.md/.py/.ts/.tsx` files,
   not `.rs`) and was still spawning the dev backend on the stale `:8000` (§1, §3).
3. ✅ Backend/Ollama default bind changed from `0.0.0.0` to `127.0.0.1`, LAN exposure
   an explicit opt-in via `ARYNWOOD_BIND_HOST`/`OLLAMA_HOST` (§2).
4. ✅ Backend packaging strategy exists and produced a verified end-to-end build —
   AppImage + `.deb`, backend sidecar confirmed working from the actual shipped
   binary, not just the build log (§3). Caveat: GPU tool scripts, the filesystem
   browser, and chat's project-tree context injection don't have packaged-build
   parity yet — documented in §3, not silently glossed over.
5. ✅ `frontend/package-lock.json` committed, `npm ci` verified working, used in CI.
6. ✅ `.env.example` extended to cover every env var the app actually reads (§6).
7. ✅ README corrected (repo name, ports, network-binding note) (§7).
8. ✅ `npm run lint` baseline tracked (108 problems, unchanged by this work — CI runs
   it with `continue-on-error` rather than either silently ignoring or falsely
   blocking on a pre-existing baseline) (§5).
9. ✅ Found during packaging work: `frontend/package.json` pinned `@tauri-apps/api`
   to `^2`, which had drifted to 2.11.1 against the Rust `tauri` crate's 2.10.3 —
   `tauri build` refuses to run on a major/minor mismatch. Pinned to the matching
   `2.10.1`; re-check this pin if the Rust crate is later bumped.
10. ✅ `npm audit`: 7 vulnerabilities (3 moderate, 3 high, 1 critical) → 0. All were
    dev-only (vitest's own transitive `vite`/`esbuild` copies, plus `js-yaml`/
    `nanoid`) — never shipped in the built app — but worth closing anyway. Bumping
    `vitest` `^2.1.8` → `^5.0.0` let it use the project's already-present
    `vite@7.3.6` instead of its own vulnerable bundled copy; all 41 frontend tests
    passed unchanged, no config/test-file changes needed.

Nothing on this list remains open. Nothing has been committed or pushed, and no
`v*.*.*` tag has been pushed to trigger `release.yml` — that's a deliberate stop
short of anything hard-to-reverse or externally visible.

## Second-pass review, same day — 6 must-fix + 3 high-priority findings, all addressed

An independent review of the state above caught real gaps this audit's own author
had missed: `allow_origins=["*"]` CORS (a genuine browser-based read risk given
auth is opt-in), `make test-backend` actually broken (bare `pytest` vs.
`python -m pytest` — this doc's own "Quality gates" section had only ever run the
`python -m pytest` form directly, never the Makefile target it was supposedly
wrapping), `make package` never building the sidecar it depends on, packaged-build
artifact filenames containing a space that also didn't match the docs, the API's
own version metadata drifted from every other version marker, and packaged-build
feature gaps that needed to fail predictably and visibly rather than however they
happened to fail. Every item was verified against the actual repo before being
called real (the `make test-backend` failure was reproduced, not assumed; the
Tauri webview's default origin was confirmed against the `tauri` crate's cached
source, not guessed) and re-verified after fixing. See `CHANGELOG.md`'s
"Fixed (second pass...)" entry for the full list with verification notes per item.

One item from that review was **not** applied: adding a real native
allow/deny prompt for microphone/camera access instead of the current
auto-grant. That would mean handling GTK's `permission-request` signal
asynchronously against a user-facing dialog with no display server available in
this environment to actually test it — a wrong implementation risks hanging the
whole app on first mic use, worse than the documented-but-present current
behavior. Disclosed clearly in `SECURITY.md` instead; the real fix is still open
and should get an actual display to test against.

Also found during this pass, not part of the original review: an untracked
`arynwood-landing-before.png` (1MB) sitting in the repo root, unreferenced by
anything in the codebase, with a modification time during this session despite
nobody in this session having used a screenshot tool — almost certainly debris
from a different concurrent session sharing this same checkout (this machine has
several other active/idle Claude Code sessions per `ListAgents`). Left in place
rather than deleted — it isn't this session's file to remove on its own judgment,
and it isn't staged or going to be committed either way.

## Addendum, 2026-09-19 — desktop-app bugs that only a real WebKitGTK could show

After the packaged app was used for real, a run of bugs turned up that no unit test, source run, Chrome session or
`gst-launch` pipeline could have found. Each was reproduced in a real WebKitGTK (Python `gi` under Xvfb, the same engine
version the AppImage bundles) before it was fixed, and checked again after. All are fixed and in `CHANGELOG.md`.

| Symptom | Cause | Why nothing caught it |
|---|---|---|
| Window turns solid grey on first playback; app and backend keep running | AppImage shipped GStreamer's libraries but no plugins → no `autoaudiosink` → WebKit dereferenced NULL and its renderer died | Chrome plays audio natively; the source run uses the host's plugins |
| Audio won't play, Download saves a tiny file named `audio` | Only `fetch()` was rewritten to the backend; `<audio src>`/`<a href>` resolved against `tauri://localhost` and got `index.html` | In dev, Vite proxies `/api` so relative URLs worked |
| Download button does nothing | An `<a download>` to another origin is ignored by WebKit; the shell also renamed blobs to a bare UUID | Chrome honours cross-origin downloads differently |
| Picked/recorded files never preview | CSP had no `media-src`, `default-src` lacks `blob:` | The CSP only exists in the Tauri build |
| Record tab: "unsupported", then 0 bytes | `MediaRecorder` needs the `transcode`, `voaacenc`, `encoding` plugins (found by bisecting all 240 host plugins) | `gst-launch` pipelines pass without them; only WebKit's own logic needs them |
| Mic "Invalid constraint" | Exact device id from a pre-permission (blank) enumeration; WebKit's error isn't a `DOMException` | Chrome accepts the same request |
| Generate/Jam disabled after starting the sidecar | Provider list fetched only on tab mount | Tests mounted with the sidecar already up |

**Lesson kept as process:** for anything media, download or permission related in the packaged app, the acceptance test
is `scripts/check_webkit_media.py` against the *extracted AppImage's own* GStreamer, with the previous build as a control
(it prints `GStreamer element autoaudiosink not found` and times out — the grey window). Still not automated: capture from
a physical microphone in the packaged window, and a self-healing reload if the renderer ever dies again.
