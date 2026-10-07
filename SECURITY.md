# Security Policy

Arynwood MCP is alpha software for one owner on one machine: local-first by design, and not
hardened for exposure beyond that machine. This page is the single place for what is
protected today and what isn't. What the project is and isn't meant to do is in
[docs/scope.md](docs/scope.md).

## Supported versions

Pre-1.0: only the latest release and the latest commit on `main` receive fixes. There are no
maintained release branches.

## Reporting a vulnerability

Email **security@arynwood.com** with a description, reproduction steps, and impact.
Do not open a public GitHub issue for anything that could let someone else exploit it
before a fix ships — that includes remote code execution, auth bypass, SSRF, or
credential/token exposure.

We'll acknowledge within 5 business days and aim to have a fix or mitigation plan
within 30 days for confirmed issues. Low-severity findings (e.g. a missing header
with no practical exploit) can go in a regular GitHub issue.

## What is protected

- **Local by default.** The backend and, when this app starts it, Ollama bind to `127.0.0.1`.
  The backend refuses a non-loopback bind without `ARYNWOOD_API_KEY`, and remote clients
  always need the key. The key also protects `/metrics` and social-media files.
- **Web pages can't drive the local API.** HTTP and WebSocket requests under `/api` from a
  foreign or opaque (`null`) browser origin are refused before they reach any route. An
  exact Host check blocks DNS rebinding. State-changing actions such as tool installs need
  POST.
- **Approval before anything irreversible.** Agent tool calls are sorted into read-only,
  reversible, destructive and external-publish. A destructive or publishing call runs only
  after the owner's explicit yes, bound to that exact call, single-use and expiring. With
  nobody to approve, it's denied. Unreviewed MCP servers need approval for every call, and
  manifests can't grant themselves permission.
- **Untrusted text is marked as untrusted.** Web results, knowledge excerpts, tool output, and
  messages from anyone but the owner reach the model inside `<untrusted-data>`. They are
  never quoted as the owner's own words.
- **Bounded outbound fetches.** Learning from a URL reaches public addresses only, with each
  redirect checked again, and is capped in size and time.
- **Deploys** require a known SSH host key, and keep uploads inside the target folder.
- **Files.** Project reads stay inside the project. Developer codebase tools (opt-in, source
  checkout only) skip credential files and bound their subprocesses.
- **Gateway** (experimental, off by default): over IRC it answers only the owner's services
  account, re-checked before any private reply goes out.
- **Check your setup:** `python -m backend.security` reports the security-relevant
  configuration without printing secrets. `--strict` fails on open warnings.

## Known gaps

These are current limits, not bugs to report. They're listed so a report about them can be
triaged quickly.

- **No OS sandbox.** Tools, sidecars and installers run with your user's file and network
  access. The protections above are application rules, not isolation.
- **Direct actions aren't under the approval policy.** Deploy, social publishing, studio and
  install buttons in the UI are owner actions. The approval gate covers agent tool calls.
- **No login.** With no API key, any local program has owner access. Setting a key needs every
  client updated; there is no login screen yet, and the WebSocket sends the key as a
  `?token=` query parameter.
- **No enforced offline mode.** Web search, URL learning, downloads, social APIs, publishing,
  deploys, IRC and configured remote model, image or MCP servers all send data out when used.
  A chat endpoint receives each turn's prompt, including memories and knowledge excerpts; an
  image endpoint receives prompts and base images ([docs/endpoints.md](docs/endpoints.md)).
- **The Linux desktop build grants microphone and camera requests automatically**
  (`allow_media_permissions()` in `frontend/src-tauri/src/main.rs`). WebKitGTK has no
  permission prompt, and the Studio recorder needs the mic. The app loads only its own
  bundled frontend, but there is no per-request consent step.
- **Kdenlive tool calls** follow the approval tiers, but that's guidance to an LLM tool loop
  plus code checks, not a sandbox. Don't point it at a project you can't afford to have
  changed.
- **Secrets live in `.env`** (gitignored) and the local database. Never commit a real `.env`.

If you're running this on a shared or internet-reachable machine, treat every item
above as something to review before you do, not after. The checklist that must be complete
before Arynwood grows beyond one owner's machine is in [docs/scope.md](docs/scope.md).
