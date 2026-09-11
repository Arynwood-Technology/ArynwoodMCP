# Third-Party Notices

Generated 2026-09-10 via `pip-licenses` (backend, from the active `venv`) and
`license-checker` (frontend, `--production` only — dev-only tooling like eslint/
vitest isn't shipped and isn't listed). Regenerate before each release; dependency
versions and licenses can change between releases.

## Resolved: ebooklib (AGPLv3+) removed 2026-09-10

`ebooklib` (used for `.epub` knowledge-base ingestion) was licensed AGPLv3+, in
direct tension with `LICENSE`'s "proprietary, no redistribution" terms for a
*distributed* build. Rather than get a legal opinion to keep it, it was removed:
`backend/services/knowledge.py`'s `_extract_epub_text()` now parses EPUBs directly
(stdlib `zipfile` + `xml.etree.ElementTree`, plus the `beautifulsoup4` already used
elsewhere in that file for HTML stripping) — no new dependency, same behavior
(chapter text in spine reading order, script/style/nav stripped), covered by
`tests/test_epub_extraction.py`. No remaining AGPL/GPL dependency in this repo as of
this writing — re-run the regeneration commands below before each release to confirm
that stays true as dependencies change.

`paramiko` (backend, SFTP deploy — `backend/routers/deploy.py`) is LGPL-2.1. Used as
an unmodified library dependency (not statically linked into a single binary via
normal Python packaging), which is the standard low-risk LGPL usage pattern, but
worth a name-check during the same review since PyInstaller bundling changes how the
library is packaged.

Everything else below is permissive (MIT/BSD/Apache-2.0/ISC/MPL-2.0/PSF/0BSD) and
does not carry copyleft obligations.

## Backend (Python) — non-MIT/BSD-style licenses

| Package | License |
|---|---|
| paramiko | LGPL-2.1 |
| PyNaCl | Apache-2.0 |
| bcrypt | Apache-2.0 |
| requests | Apache-2.0 |
| watchdog | Apache-2.0 |
| uvloop | Apache-2.0 / MIT (dual) |
| fake-useragent | Apache-2.0 |
| python-multipart | Apache-2.0 |
| prometheus_client | Apache-2.0 AND BSD-2-Clause |
| packaging | Apache-2.0 OR BSD-2-Clause |
| cryptography | Apache-2.0 OR BSD-3-Clause |
| prometheus-fastapi-instrumentator | ISC |
| certifi | MPL-2.0 |
| typing_extensions | PSF-2.0 |

All remaining backend dependencies (fastapi, uvicorn, aiosqlite, httpx, ollama,
pydantic, starlette, beautifulsoup4, python-dotenv, Pillow, ddgs, PyYAML, click,
and their transitive deps) are MIT or BSD-licensed.

## Frontend (npm, production only) — non-MIT licenses

| Package | License |
|---|---|
| @tauri-apps/api | Apache-2.0 OR MIT |
| class-variance-authority | Apache-2.0 |
| detect-libc | Apache-2.0 |
| lightningcss (+ platform binaries) | MPL-2.0 |
| @ungap/structured-clone, graceful-fs, lucide-react, picocolors | ISC |
| source-map-js | BSD-3-Clause |
| tslib | 0BSD |

The remaining ~180 production frontend dependencies (react, react-dom, vite,
zustand, radix-ui packages, tailwindcss, etc.) are MIT-licensed. Dev-only tooling
(eslint, vitest, typescript, testing-library) is not included since it isn't shipped
in a built/packaged app.

## Regenerating this file

```bash
# Backend
source venv/bin/activate && pip install pip-licenses
pip-licenses --format=markdown --with-urls --order=license

# Frontend (production dependencies only)
cd frontend && npx license-checker --production --excludePackages "frontend@$(node -p "require('./package.json').version")" --json
```
