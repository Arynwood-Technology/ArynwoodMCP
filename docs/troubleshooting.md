# Troubleshooting

## The app won't start / a port is already in use

The backend runs on `:8010`, the frontend dev server on `:5180` (see
`docs/release-readiness-audit.md` §1 for the port-unification history — all three
launch scripts and the packaged build agree on these now). If something else on your
machine already owns one of those ports, the backend or `npm run dev` will fail to
bind. Find and stop whatever's using it:

```bash
lsof -i :8010
lsof -i :5180
```

## Every API call fails / chat won't connect

- Confirm the backend is actually up: `curl http://localhost:8010/` should return
  `{"status":"Arynwood MCP running"}`.
- If you're running from source with a launch script, check its log
  (`/tmp/arynwood-backend.log` or similar — each script names its own).
- If you set `ARYNWOOD_API_KEY` in `.env`, every API client (including the frontend)
  needs to send it — there's no login UI yet, so setting this without also updating
  what's calling the API will lock you out of your own instance.

## Chat says a model isn't available / responses fail immediately

- Check Ollama is running: `curl http://localhost:11434/`.
- Check the model is actually pulled: `ollama list`. The system-status drawer (click
  the connectivity dot in the sidebar, or the GPU chip in the top bar) flags this
  specifically — "Active model" shows a warning if the configured model name isn't
  installed on the active server. The model field is free text, so a typo is a common
  cause.
- Ollama occasionally fails a single model load with `cudaMalloc failed: out of
  memory` if something else (commonly Stable Diffusion/A1111) is already holding most
  of your GPU's VRAM. Ollama itself will retry automatically
  (`systemctl status ollama` to confirm it's still up), but the specific request that
  hit the OOM will have failed — retry it. This is a known single-GPU contention
  issue, not a crash.

## Kdenlive tool-calling ("ask Arynwood to edit my timeline") does nothing

`mcp/config/mcp_servers.json` (gitignored, personal config) has to actually exist and
list a reachable Kdenlive MCP server, or every Kdenlive-related question is silently
skipped with no error message — by design, so a down tool server never breaks normal
chat. If it's supposed to be configured and isn't working, first confirm the service
is up:
```bash
systemctl --user status mcp-kdenlive
```
then confirm the config file exists with the right shape — the top-level
`"mcpServers"` key is required, a bare `{"kdenlive": {...}}` object is silently
read as empty:
```bash
cat mcp/config/mcp_servers.json   # source checkout
cat ~/.local/share/arynwood-mcp/mcp_servers.json   # packaged build
```
```json
{ "mcpServers": { "kdenlive": { "url": "http://127.0.0.1:8420/mcp" } } }
```

## Knowledge base / `!learn` fails

Requires both Qdrant (`QDRANT_URL`, default `http://localhost:6333`) and Ollama
reachable — check Qdrant is running first, then check `systemctl status ollama`.
PDF learning additionally depends on a separate sibling-repo Python environment
(`~/GitHub/sycamore/`) — if that checkout/venv doesn't exist, PDF learning fails with
a clear 404 pointing at `docs/sycamore-integration-plan.md`; other file types
(text, `.docx`, etc.) are unaffected.

## Stable Diffusion / TortoiseTTS won't start

Both run as Docker containers (`docker-compose.yml`) and both request an NVIDIA GPU.
Confirm Docker can actually see your GPU (`docker run --rm --gpus all
nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi`) before assuming it's an app bug.

## A1111 (Stable Diffusion) is up but every generation fails / VRAM stays full after unload

A1111 can wedge into a state where its own internal model reference is cleared but
the VRAM allocation isn't released (`/sdapi/v1/memory` still shows it in use). Fix:
`docker restart a1111`, wait for `/sdapi/v1/options` to return 200, then retry —
don't assume it's a bug in this app's code before checking that first.

## I want to expose this to my LAN, not just localhost

Set `ARYNWOOD_BIND_HOST=0.0.0.0` and `OLLAMA_HOST=0.0.0.0` in `.env`, and set
`ARYNWOOD_API_KEY` too — the backend has no other authentication, and binding it
beyond loopback without a key means anyone on your network can use (and modify) your
instance. See `SECURITY.md`.

## A sidecar (Music Lab, stem separation, voice conversion…) won't start

The Studio page's sidecar bar shows each one's state; **red "failed"** means it started and died, and
the reason is shown right there (hover the name, or read the strip under the bar). The status drawer
shows the same. The full output is in `~/.local/share/arynwood-mcp/logs/sidecar-<id>.log`. Common causes:

- **"Sidecar venv not found"** — MusicStudio isn't installed where the app looks
  (`~/GitHub/MusicStudio` by default; set `ARYNWOOD_MUSICSTUDIO_DIR` in `.env`), or its venv wasn't set
  up (see that repo's `CLAUDE.md`).
- **A traceback in the log** — a missing model or package inside that sidecar's own venv; fix it there.
- **"…is running on port N but wasn't started by this app"** when you press Stop — you (or an earlier
  session) started it from a terminal. Stop that process yourself (`ss -ltnp | grep :N`).
- **`No module named 'encodings'`** in the log on a packaged build older than the fix in the changelog —
  update the app; the old build passed its own Python settings to every sidecar.

## The app won't start, or says the port is in use, right after I quit it

Only one backend can own port 8010. Older packaged builds could leave their backend (and any sidecars,
holding GPU memory) running after you quit. Find and stop it:

```bash
ss -ltnp | grep 8010          # what owns the port
pkill -f arynwood-backend     # then relaunch the app
```

Current builds tie the backend and sidecars to the app, so quitting stops them. Also note that a
development backend running on 8010 makes the packaged app silently talk to *that* instead — stop it
first (`ss -ltnp | grep 8010`).

## "Restart API" is missing / does nothing

The packaged app can't restart its own backend, so the button is hidden there — quit and relaunch. From
a source checkout it works only under `uvicorn --reload` (the way `start.sh` runs it).

## The whole window went solid grey (the app is still running)

The page's renderer process crashed; the app and its backend are fine and your files are safe. Quit the app
and start it again — nothing else is needed. On the AppImage builds before the fix in the changelog this
happened the moment anything tried to play audio or video (the bundle had no GStreamer plugins). If it still
happens on a current build, run `pgrep -af WebKitWebProcess` while it's grey (nothing listed = the renderer
died), then look for the last few lines from `WebKitWebProcess` in `journalctl --user --since "-10min"` and
report them.

## Music Lab: Generate / Jam is greyed out, or the microphone says "Invalid constraint"

- **No provider buttons (ACE-Step / MusicGen), or "Start the Song Generation sidecar" while it is
  already running** — on a build older than the fix in the changelog the provider list was only loaded
  when the tab first opened. Switching to another tab and back reloads it; updating the app fixes it.
  On a current build the list loads by itself as soon as the sidecar is up; if it says the sidecar
  "did not report any providers", read `~/.local/share/arynwood-mcp/logs/sidecar-song-gen.log`.
- **"Invalid constraint" when recording** — same build-age issue: the recorder asked for a specific
  input device that WebKit refused. Update the app; until then, reload the page (the device list fills in
  with real ids after the first permission grant) or pick "Default microphone".
- **Generation "failed"** — the message under the form is the sidecar's own error. "Could not decode
  input audio" means the uploaded file isn't readable audio; a CUDA out-of-memory error means something
  else (Stable Diffusion, an Ollama model) is holding the GPU — see the A1111 section above.

## Video Studio: an export fails with "Invalid timeline"

The render endpoint rejects values that can't be right instead of guessing: clip speed outside
0.1×–16×, negative or inverted trims (`trim_end` must be after `trim_start`), a transition of zero or
negative length, negative audio offsets or volumes. The timeline UI can't produce these; a script or a
hand-edited project can. The message names the field.

## Something not listed here

Check `CLAUDE.md`'s "Known Issues / Gotchas" section — it's the maintained,
developer-facing version of this list and is generally more current than this file
for anything newly discovered.
