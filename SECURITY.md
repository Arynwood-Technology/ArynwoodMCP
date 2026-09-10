# Security Policy

Arynwood MCP is alpha software, local-first by design, and not yet hardened for
exposure beyond your own machine. Read this before you report something, and before
you run it anywhere but `localhost`.

## Supported versions

Pre-1.0: only the latest commit on `main` receives fixes. There are no maintained
release branches yet.

## Reporting a vulnerability

Email **security@arynwood.com** with a description, reproduction steps, and impact.
Do not open a public GitHub issue for anything that could let someone else exploit it
before a fix ships — that includes remote code execution, auth bypass, SSRF, or
credential/token exposure.

We'll acknowledge within 5 business days and aim to have a fix or mitigation plan
within 30 days for confirmed issues. Low-severity findings (e.g. a missing header
with no practical exploit) can go in a regular GitHub issue.

## Known posture, as of this alpha

These are current defaults, not bugs to report — they're documented here so a
report about them can be triaged quickly:

- The backend and, when this app starts it, Ollama both bind to `127.0.0.1`
  (loopback) by default. LAN/remote exposure requires deliberately setting
  `ARYNWOOD_BIND_HOST=0.0.0.0` / `OLLAMA_HOST=0.0.0.0` in `.env`.
- API authentication (`ARYNWOOD_API_KEY`, see `.env.example`) is opt-in and off by
  default. There is no login UI yet — if you set a key, every API client (including
  the frontend) needs to be updated to send it, or requests will fail.
- CORS (`backend/api.py`) allows only the app's own two real origins (the Vite dev
  server and the packaged Tauri webview) — not a wildcard. This specifically closes
  off the case where an arbitrary website's JavaScript, running in an ordinary
  browser tab on the same machine, could otherwise read responses from this API
  purely because your browser can reach `localhost` regardless of the backend's
  bind address; loopback binding alone doesn't stop that class of access.
- **The Linux desktop build auto-grants microphone/camera permission requests**
  (`frontend/src-tauri/src/main.rs`'s `allow_media_permissions()`), needed for the
  Studio audio recorder to work at all — WebKitGTK has no built-in
  permission-prompt UI, so without this every `getUserMedia()` call fails silently
  with no prompt ever shown. This is a deliberate trade for a single-user local app
  that only ever loads its own bundled frontend (nothing untrusted runs in that
  webview), not a general browser — but it does mean the app can access your
  microphone/camera whenever a page inside it asks, with no per-request consent
  step. If you need per-request consent, that's not implemented yet; know this
  before you install, not after noticing your mic indicator light.
- Kdenlive tool-calling classifies every tool call by risk tier
  (read-only / reversible-write / destructive / external-publish) and requires
  explicit approval for destructive or publishing actions — but this is prompt- and
  code-level guidance to an LLM tool-calling loop, not a formal sandboxing
  guarantee. Don't point it at a Kdenlive project or a filesystem you can't afford
  to have modified unexpectedly.
- Social media credentials (Facebook/Instagram/YouTube/LinkedIn OAuth secrets) live
  in `.env`, which is gitignored — never commit a real `.env` file.

If you're running this on a shared or internet-reachable machine, treat every item
above as something to review before you do, not after.
