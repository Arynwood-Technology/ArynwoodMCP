# Installation

See [`docs/supported-platforms.md`](supported-platforms.md) first — Linux x86_64
only, GPU features need an NVIDIA card.

## Packaged build (AppImage / .deb)

> **Status:** published. Download from the repo's Releases page — get the latest
> `v*.*.*` tag, not an older one; each release lists what changed in that version.

```bash
# AppImage — download the .AppImage asset from the release, then:
chmod +x arynwood-mcp_*.AppImage
./arynwood-mcp_*.AppImage

# .deb (Debian/Ubuntu)
sudo apt install ./arynwood-mcp_*.deb
```

(Real filenames as of this writing: `arynwood-mcp_0.4.2_amd64.AppImage` and
`arynwood-mcp_0.4.2_amd64.deb` — no spaces, confirmed against an actual local
build; the glob above just tolerates the version number changing between releases.)

Both bundle the frontend and a packaged backend — no separate `venv`/`npm install`
step. **Ollama is not bundled** and must be installed separately (see
[ollama.com](https://ollama.com)) — the app will tell you if it can't reach it.

### Features that don't work in the packaged build

Read this before you install, not after a feature fails on you. Everything below
requires a source checkout — clicking them in the packaged app gives a clear error
explaining why, not a crash, but they don't work either way:

- **LoRA training** (dataset prep + training) — Design Center → GPU Model Manager.
- **GPU generation tool scripts** — Real-ESRGAN, Whisper, SadTalker, and the other
  `scripts/*.py`-backed entries in the Tools page (Stable Diffusion via A1111 and
  TortoiseTTS are unaffected — those are separate Docker services reached over
  HTTP, not local scripts).
- **Project file browser** (`/api/fs/tree`, `/read`, `/ls`) — browsing this app's
  own source tree doesn't mean anything once there's no source tree to browse.
  Design Center's *save to folder* (browsing your own home directory) is a
  separate feature and is unaffected.
- Chat's automatic "project tree" context injection degrades to nothing meaningful
  (it lists the packaged bundle's internal temp directory instead of erroring —
  harmless, but not useful either).

**Music Lab, stem separation, voice conversion, audio FX and video captions** run as
separate MusicStudio sidecars. They work in the packaged build *if* MusicStudio is installed
(default `~/GitHub/MusicStudio`, or set `ARYNWOOD_MUSICSTUDIO_DIR`); the app starts them from the
Studio page. Older packaged builds could not start them at all — the bundle's own Python settings
were passed down and broke every sidecar. If one won't start now, the Studio page shows the reason
and the log is in `~/.local/share/arynwood-mcp/logs/` (see `troubleshooting.md`).

Everything else — chat across all 5 personas, memory, knowledge base (needs
Qdrant + Ollama reachable), social publishing — works the same as running from
source. See `docs/release-readiness-audit.md` §3 for the technical reason (these
features assume a live git checkout + `venv`, which packaging doesn't change).

Verify the download against `SHA256SUMS.txt` on the same release before running it:

```bash
sha256sum -c SHA256SUMS.txt
```

### Where the app stores its data

Mutable state lives outside the install location, under `~/.local/share/arynwood-mcp/`
(XDG data dir) — not inside the AppImage or wherever the `.deb` installs binaries:

| Path | What |
|---|---|
| `arynwood.db` | conversations, memory, settings, deploy targets (SFTP passwords in here are unencrypted) |
| `.env` | your API credentials and optional settings (see `.env.example`) |
| `personas.local.json` | your own personas, merged over the built-in ones ([customizing personas](customizing-personas.md)) |
| `mcp_servers.json` | which MCP tool servers (e.g. Kdenlive) are registered |
| `music/assets/`, `triggers/gpu_watch/`, `generated/` | Music Lab recordings and generated media, GPU job outputs, spreadsheets |
| `logs/` | one log per sidecar (`sidecar-<id>.log`) |

Uninstalling the package does **not** delete this directory; remove it yourself if you want a
clean slate.

### Upgrading (AppImage)

Your data directory is separate from the app, so upgrading never touches it:

```bash
# 1. quit Arynwood completely (an older build can leave its backend running — see troubleshooting.md)
# 2. keep the old one until you've checked the new one starts
mv ~/Applications/arynwood-mcp.AppImage ~/Applications/arynwood-mcp.AppImage.previous
cp arynwood-mcp_*.AppImage ~/Applications/arynwood-mcp.AppImage && chmod +x ~/Applications/arynwood-mcp.AppImage
# 3. launch it; delete the .previous file once you're happy
```

### Uninstalling

- **AppImage:** delete the `.AppImage` file. Optionally remove
  `~/.local/share/arynwood-mcp/` and `~/.config/arynwood-mcp/` if you don't want to
  keep your conversations/settings.
- **.deb:** `sudo apt remove arynwood-mcp`, then optionally remove the same two
  directories as above.

## Running from source (current, always available)

This is the path this repo actually supports today — see the main
[README Quick Start](../README.md#quick-start) for full steps: clone, `venv` +
`pip install -r requirements.txt`, `npm install` in `frontend/`, `cp .env.example
.env`, pull the Ollama models you need, then `./start.sh`.

### Uninstalling a source checkout

Delete the cloned directory. If you set `ARYNWOOD_DB_PATH` or otherwise pointed the
database outside the repo, remove that path separately — it's not touched by
deleting the checkout.
