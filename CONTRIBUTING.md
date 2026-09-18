# Contributing

Arynwood MCP is source-available, not open source (see `LICENSE`) — this repo isn't
currently open to external pull requests. That may change later; this file will be
updated if and when it does.

## What's welcome

- **Bug reports** — open a GitHub issue. Include your OS, how you launched the app
  (`start.sh` / `arynwood-desktop.sh` / `arynwood-app.sh` / packaged build), and the
  relevant backend/frontend log output.
- **Feature requests / feedback** — also via GitHub issues.
- **Security issues** — do **not** open a public issue; see `SECURITY.md`.

## Working in this repo (for anyone with write access)

- Run `scripts/install-hooks.sh` once per clone to enable the pre-push guard (see
  `CLAUDE.md`, "Branching, private data, and pushing").
- Read `CLAUDE.md` first — it's the canonical architecture/gotchas reference and is
  kept up to date deliberately.
- Before committing: `pytest tests/` (backend), `npm run build && npm test` in
  `frontend/` (or `make test` — see the Makefile). `npm run lint` currently has a
  pre-existing baseline of problems (see `CLAUDE.md`); don't let that baseline grow.
- Small, reviewable, single-purpose changes are preferred over large mixed diffs.
- Update `CHANGELOG.md`'s `[Unreleased]` section for anything user-visible.
- Before a release: build the backend (`pyinstaller arynwood-backend.spec`) and run
  `python3 scripts/smoke_packaged_backend.py dist/arynwood-backend` — it catches packaged-only bugs that
  neither a source run nor the unit tests can.
