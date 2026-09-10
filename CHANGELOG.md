# Changelog

All notable changes to Arynwood MCP are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Entries before this file existed (everything under "0.4.0" and earlier) are
reconstructed from git history for context, not a line-by-line commit log — treat
them as a summary, not a precise record.

## [Unreleased]

### Changed (third pass — rebrand and pre-release content cleanup)
- **The `central` persona is now named "Arynwood"** (was "Aryn"), across
  `mcp/config/models.json`'s persona definition and system-prompt self-reference,
  `backend/persona_map.json`, the frontend chat UI (`Chat.tsx`, `Dashboard.tsx`,
  `Knowledge.tsx`), and every doc/comment describing it.
- **Internal identifiers renamed off the old "aryncore" naming**, with backward
  compatibility for anyone already running an earlier build:
  - `ARYNCORE_DB_PATH` / `ARYNCORE_API_KEY` env vars → `ARYNWOOD_DB_PATH` /
    `ARYNWOOD_API_KEY` (clean break, no fallback — this is pre-release).
  - Default SQLite filename `config/aryncore.db` → `config/arynwood.db` —
    `backend/db.py` renames the file in place on first startup if the old one is
    found and the new one isn't, so existing conversations/memories survive the
    rename. Verified against this checkout's own real database, not just a
    synthetic test.
  - DB table `aryn_memory` → `arynwood_memory` — same in-place `ALTER TABLE ...
    RENAME TO` migration, run before schema creation so it can't collide with a
    freshly-created empty table of the new name. Verified with real pre-existing
    data through the migration.
  - Qdrant collections `aryn_knowledge` → `arynwood_knowledge`,
    `aryn_memory_index` → `arynwood_memory_index` — no migration needed (the
    knowledge collection was empty; the memory-index collection is a rebuildable
    cache, re-populated from SQLite on every startup regardless).
- Removed hardcoded personal seed data from `backend/db.py`'s `content_projects`
  migration — every fresh install previously got 4 pre-populated rows naming the
  original author's own personal creative projects (including an unpublished
  manuscript title) and `~/Desktop/...` paths. Nothing in the codebase depended on
  any specific slug existing.
- Removed `mcp/config/paths.json` (confirmed dead code, zero references anywhere
  in this codebase) and `forge.sh` (a personal machine-bootstrap script
  referencing private GitHub repositories) — neither belongs in a public release.
  `paths.json` was also removed from `arynwood-backend.spec`'s bundle list
  regardless, since it held internal infrastructure paths from a different
  machine/user.
- `CLAUDE.md`'s "What This Is" section no longer describes this as a fork of a
  separate private project or names that project's internal infrastructure
  details — rewritten to describe this app on its own terms.
- `tests/conftest.py`'s test-database isolation was updated to the new
  `ARYNWOOD_DB_PATH` env var name — this was verified as a real risk, not
  theoretical: had it been missed, the test suite would have silently stopped
  overriding the DB path and started reading/writing the real database.

### Fixed (second pass — release readiness review)
- **CORS was wildcard (`allow_origins=["*"]`) with API auth opt-in/off by
  default** — any website's JS, running in a browser tab on the same machine,
  could read responses from this API (filesystem, deploy/SFTP, chat/memory)
  purely because the victim's own browser can reach `localhost`, regardless of
  the backend's bind address. Narrowed `backend/api.py`'s `allow_origins` to the
  app's two real origins (`http://localhost:5180` dev, `http://tauri.localhost`
  packaged — confirmed against the `tauri` crate's own source, not guessed).
  Verified: an arbitrary `Origin` header now gets no
  `Access-Control-Allow-Origin` back; the two real ones still do.
- **`make test-backend` was broken** — used the bare `pytest` entrypoint, which
  (unlike `python -m pytest`) doesn't put the repo root on `sys.path`, so every
  test module's `from backend...` import failed at collection (30 errors). Now
  `python -m pytest`.
- **`make package` never actually built the backend sidecar** — `npm run
  tauri:build` alone would either fail or silently bundle a stale/manually-placed
  binary. Added a `package-backend` target (installs `pyinstaller` if missing,
  runs `arynwood-backend.spec`, places the output where `tauri.conf.json`'s
  `externalBin` expects it) that `package` now depends on. Verified from a clean
  `dist/`/`build/`.
- **Packaged-build artifact filenames had a space in them**
  (`Arynwood MCP_0.4.0_amd64.deb`), and `docs/installation.md` didn't even match
  those — it referenced invented names. `tauri.conf.json`'s `productName` →
  `arynwood-mcp` (was `"Arynwood MCP"`; the window title is a separate,
  unaffected config field), giving clean `arynwood-mcp_0.4.0_amd64.{AppImage,deb}`
  filenames; docs corrected to match, confirmed against an actual rebuild.
- **`backend/api.py` reported API version `1.0.0`** while every other version
  marker in the repo (package.json, tauri.conf.json, Cargo.toml, CHANGELOG,
  launch-script banners) says `0.4.0`. Aligned.
- **Packaged-build feature gaps failed unpredictably instead of clearly.**
  `backend/routers/fs.py`'s project-file-browsing endpoints (`/tree`, `/read`,
  `/ls` — not `/browse-home`, a separate, unaffected feature) would have silently
  browsed the PyInstaller bundle's temp extraction directory instead of erroring;
  now they return a clear 501 when frozen. `backend/routers/lora.py`'s
  prep/train-not-found errors now explain *why* (packaged build, not a
  misconfigured dev checkout) instead of a bare filename. `tools.py`'s GPU-script
  routes already failed cleanly (pre-existing `os.path.exists` guards, not
  touched). All of this now documented user-facing in
  `docs/installation.md`, not just in the audit doc — "features that don't work
  in the packaged build" is its own visible section, not something to discover by
  clicking.
- **`npm run lint`'s CI step was `continue-on-error: true`** — a tag release
  could succeed while lint was red with no visibility. Replaced with
  `frontend/scripts/check-lint-baseline.mjs` + `frontend/.eslint-baseline` (108):
  CI now fails only on a *regression past the tracked baseline*, not on the
  baseline itself and not silently either way. Verified both directions
  (artificially lowering the baseline file fails the check; matching it passes).
- Documented (not code-fixed — the alternative fix risked a GTK main-loop
  deadlock, unverifiable without a display in this environment): the Linux
  desktop build auto-grants microphone/camera permission requests
  (`main.rs`'s `allow_media_permissions()`, needed since WebKitGTK has no
  built-in permission-prompt UI). Disclosed in `SECURITY.md`'s posture section
  rather than left as an undocumented surprise.

### Added
- **Linux desktop packaging** — `arynwood-backend.spec` (PyInstaller) bundles the
  backend as a standalone sidecar binary; `tauri.conf.json`'s `externalBin` +
  `frontend/src-tauri/src/main.rs`'s `start_backend_sidecar()` wire it into
  production Tauri builds. `npm run tauri:build` now produces a working AppImage and
  `.deb` — verified by extracting the shipped `.deb` and running its bundled
  backend directly, not just checking the build succeeded. Dev builds are
  unaffected (still spawn the live venv). GPU tool scripts, the filesystem browser,
  and chat's project-tree context injection do not have packaged-build parity yet —
  see `docs/release-readiness-audit.md` §3.
- `backend/_frozen.py` — shared helpers distinguishing bundled app payload
  (`app_base_dir()`) from writable user data (`user_data_dir()`, the XDG data dir
  when packaged), used by `backend/db.py`, `backend/api.py`,
  `backend/routers/social.py`, `backend/routers/chat.py`.
- `Makefile` (setup/test/lint/build/package/smoke targets), `.github/workflows/ci.yml`
  (PR checks) and `release.yml` (tag-triggered Linux artifact build + checksums).
- `docs/release-readiness-audit.md`, `docs/supported-platforms.md`,
  `docs/installation.md`, `docs/troubleshooting.md`, `docs/third-party-notices.md`.
- `LICENSE` (source-available alpha), `CHANGELOG.md`, `SECURITY.md`,
  `CONTRIBUTING.md`.
- `.env.example` now documents every environment variable the backend actually
  reads (previously only social-media OAuth vars were listed).

### Changed
- **Breaking (dev environment):** unified the backend port to `8010` and frontend
  dev port to `5180` everywhere — `start.sh`, `arynwood-desktop.sh`,
  `arynwood-app.sh`, `tauri.conf.json`'s `devUrl`, `frontend/src-tauri/src/main.rs`'s
  dev-mode backend launcher, and every hardcoded `localhost:8000`/`:5173` reference
  across frontend and backend. Previously `start.sh`/`arynwood-desktop.sh` launched
  the backend on `:8000` while `vite.config.ts`'s dev-server proxy expected `:8010`
  — every API call from those two launchers 404'd.
- Backend and Ollama now bind to `127.0.0.1` by default instead of `0.0.0.0` in all
  three launch scripts. LAN exposure is an explicit opt-in via
  `ARYNWOOD_BIND_HOST=0.0.0.0` / `OLLAMA_HOST=0.0.0.0` in `.env`.
- `frontend/package.json` pins `@tauri-apps/api` to `2.10.1` (was `^2`, which had
  drifted to 2.11.1 against the Rust `tauri` crate's 2.10.3) — `tauri build` refuses
  to run on a major/minor mismatch between the two.
- `frontend/package-lock.json` is now committed (was previously gitignored despite
  existing on disk) for reproducible installs.
- README/docs corrected: repo clone URL, stale
  port-mismatch warnings replaced with the now-fixed defaults.
- `vitest` bumped `^2.1.8` → `^5.0.0` (the already-present top-level `vite@7.3.6`
  satisfies vitest 5's peer requirement, so this resolves vitest's own transitive
  `vite`/`esbuild` copies — the actual source of the vulnerabilities below — rather
  than needing a separate vite bump). All 41 frontend tests pass unchanged; no
  config or test-file changes were needed.

### Removed
- `ebooklib` dependency (was `backend/services/knowledge.py`'s `.epub` text
  extraction) — replaced with a small hand-rolled parser (stdlib `zipfile` +
  `xml.etree.ElementTree`, plus the `beautifulsoup4` already used elsewhere in that
  file) that walks the EPUB spine directly. `ebooklib` was AGPLv3+, in real tension
  with this app's own source-available/proprietary `LICENSE` for a *distributed*
  build; removing it resolves that rather than requiring a legal opinion to keep it.
  Same behavior (chapter text in spine reading order, script/style/nav stripped),
  now covered by `tests/test_epub_extraction.py` (new — this logic didn't have
  dedicated tests before, since it was delegated to a library).

### Fixed
- `npm audit`: 7 vulnerabilities (3 moderate, 3 high, 1 critical) → 0. All were in
  `vitest`'s dependency chain (`vite`/`esbuild`/`@vitest/mocker`, dev-only — never
  shipped in the built app or packaged AppImage/.deb) plus `js-yaml`/`nanoid`
  (resolved by a plain `npm audit fix`, no version bump needed).

## [0.4.0] — in development

### Added
- DJ Toolkit — launcher + manual for Mixxx/Ardour/Hydrogen/Surge XT/Vital and
  related Linux audio tools.
- AI Music Lab — instrument generation and "Jam with AI" (ACE-Step/MusicGen-backed
  song-gen sidecar), stem library.
- Novelist persona pipeline — `shai` (locally fine-tuned) and `chai` (stock model,
  same character) co-writer personas, LoRA fine-tuning pipeline for `shai`.
- Read-only GPU model manager for Stable Diffusion checkpoints and LoRAs.
- Data-driven MCP tool-calling dispatcher (`gates.json` + LLM classification),
  generalized from the original Kdenlive-only integration to support any
  registered MCP tool server.
- Real GPU job queue (`gpu_queue`) replacing a single global lock, with a
  `GET /api/system/gpu-queue` read endpoint.
- Sycamore-based deep PDF parsing for the knowledge base.
- Backend (pytest) and frontend (vitest) test scaffolding.

### Changed
- Ollama calls consolidated onto a shared client with batched embeddings.
- Persona selection now actually switches the active model, instead of being
  cosmetic.

## [0.1.0] — initial release

- First version: AI chat/generation, video, music/sound, and design-studio surface.
