# Contributing

Arynwood MCP is open source under the GNU AGPL-3.0-only (see `LICENSE`), and contributions are
welcome. This page says how changes get in, and what a change needs.

## Reporting bugs and asking for features

- **Bug reports** — open a GitHub issue: https://github.com/Arynwood-Technology/ArynwoodMCP/issues.
  Include your OS, the version, how you launched the app (`start.sh` / `arynwood-desktop.sh` /
  `arynwood-app.sh` / packaged build), what you did, what you expected and what happened instead,
  and the relevant backend/frontend log output.
- **Feature requests / feedback** — also via GitHub issues.
- **Security issues** — do **not** open a public issue; see `SECURITY.md` and report them privately.

## Proposing a change

1. For anything bigger than a small fix, open an issue first, so we can agree on the approach
   before you spend time on it.
2. Fork the repository, make your change on a branch, and open a pull request against `main`.
3. Each pull request is reviewed before it is merged. The checks below must pass, as must CI
   (`.github/workflows/ci.yml`, and the Windows build in `windows.yml`).

Contributions are accepted under the project's licence, the GNU AGPL-3.0-only (see `LICENSE`).
The screens in `frontend/src/community/` come from Arynwood Grove (see their `NOTICE.md`); a change
there usually belongs in Grove first.

## What a change needs

- **Tests.** New features and bug fixes come with tests that cover them (`tests/` for the backend,
  a `*.test.ts(x)` beside the code for the frontend); a bug fix includes a test that fails without
  it. Tests that need a live Ollama are marked `eval` and run separately (`pytest tests/ -m eval`).
- **Zero lint findings.** `npm run lint` runs ESLint with `--max-warnings 0`; CI fails
  on any error or warning. Fix findings before requesting review.
- **No weaker protections.** Keep the Host and Origin checks, the API key gate, the Content Security
  Policies and the security headers at least as strict as they are. Load nothing from other sites
  at runtime: no CDN scripts, styles or fonts.
- **Pinned dependencies.** `requirements.txt` pins each package to a release series (`~=`), and
  `frontend/package-lock.json` and `frontend/src-tauri/Cargo.lock` are committed. Add a dependency
  only when it is needed, and say why in the pull request.
- Small, reviewable, single-purpose changes are preferred over large mixed diffs.
- Update `CHANGELOG.md`'s `[Unreleased]` section for anything user-visible.
- Frontend code that plays or downloads a backend file must use `apiUrl()` (`lib/api.ts`) and
  `DownloadButton` (`components/DownloadButton.tsx`) — a relative `/api/...` in a media element or link only works in
  a source run. See `CLAUDE.md`, "`fetch()` is patched for the packaged app; nothing else is".

## Running the checks

```bash
python3 -m venv venv
venv/bin/python -m pip install -r requirements.txt -r requirements-dev.txt
venv/bin/python -m pytest tests/
cd frontend && npm ci && npm run build && npm test && npm run lint
```

`make test` runs the backend and frontend tests together (see the Makefile). Dependency audits
should report nothing new: `npm audit` in `frontend/`,
`pip-audit -r requirements.txt -r requirements-dev.txt`, and `cargo audit` in
`frontend/src-tauri/` (its "unmaintained" warnings come from Tauri's own dependencies). CodeQL
runs on every push and pull request to `main`, and OpenSSF Scorecard weekly.

## Working in this repo (for anyone with write access)

- Run `scripts/install-hooks.sh` once per clone to enable the pre-push guard (see
  `CLAUDE.md`, "Branching, private data, and pushing").
- Read `CLAUDE.md` first — it's the canonical architecture/gotchas reference and is
  kept up to date deliberately.
- Before a release: build the backend (`pyinstaller arynwood-backend.spec`) and run
  `python3 scripts/smoke_packaged_backend.py dist/arynwood-backend` — it catches packaged-only bugs that
  neither a source run nor the unit tests can. Then build the AppImage (recipe in `CLAUDE.md`, including
  `scripts/stage_gstreamer_plugins.sh`) and run `scripts/check_webkit_media.py` against the extracted bundle: audio,
  video and the recorder must work in a real WebKitGTK.

Release packages use the Ubuntu 22.04 workflow (`Release (Linux)`); a manual run
builds and uploads CI artifacts without publishing a release. `make package` also
stages GStreamer, runs the backend smoke gate, and finalizes launcher permissions.
Run `scripts/finalize_appimage.py` after direct Tauri builds, before checksums or
signing. See [the release checklist](docs/releases/0.4.4.md) (written for 0.4.4) and, for
the Windows installer, [`docs/windows.md`](docs/windows.md). Before publishing a draft, sign its
checksums with `scripts/sign-release.sh` ([release signing](docs/release-signing.md)) and write
the notes from [`docs/releases/TEMPLATE.md`](docs/releases/TEMPLATE.md).
