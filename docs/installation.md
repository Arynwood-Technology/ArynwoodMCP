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

Everything else — chat across all 5 personas, memory, knowledge base (needs
Qdrant + Ollama reachable), social publishing — works the same as running from
source. See `docs/release-readiness-audit.md` §3 for the technical reason (these
features assume a live git checkout + `venv`, which packaging doesn't change).

Verify the download against `SHA256SUMS.txt` on the same release before running it:

```bash
sha256sum -c SHA256SUMS.txt
```

### Where the app stores its data

Mutable state (SQLite database, logs) lives outside the install location, under
`~/.local/share/arynwood-mcp/` (XDG data dir) — not inside the AppImage or wherever
the `.deb` installs binaries. Uninstalling the package does **not** delete this
directory; remove it yourself if you want a clean slate.

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
