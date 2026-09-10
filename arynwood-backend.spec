# PyInstaller spec for the packaged backend sidecar (Tauri `externalBin`).
# Build: pyinstaller arynwood-backend.spec
# Output: dist/arynwood-backend (single file — onefile, not onedir: Tauri's
# externalBin sidecar convention copies exactly one file into the app bundle, it
# doesn't know how to also carry a onedir build's _internal/ support directory
# alongside it. Onefile's self-extract-on-launch cost (a couple seconds) is a
# one-time-per-session hit for a backend that then stays running, not spawned
# per-request, so it's a reasonable trade here.
#
# Only bundles app *payload* — never config/arynwood.db, .env, or anything
# user-specific. See backend/_frozen.py for where the packaged app then looks for
# its writable data (XDG user data dir) instead.
#
# mcp/config/ is listed file-by-file, deliberately NOT as a whole-directory include
# ("mcp/config", "mcp/config") — that directory also holds per-install personal
# config: mcp_servers.json (gitignored, holds bearer tokens for whatever MCP tool
# servers *this* install is registered with). A whole-directory include would have
# silently shipped it to every downloader if it happened to exist on the machine
# doing the build. Add new files to this list deliberately, not by widening it
# back to a directory glob.
import sys
from PyInstaller.utils.hooks import collect_all

block_cipher = None

datas = [
    ("static", "static"),
    ("mcp/config/models.json", "mcp/config"),
    ("mcp/config/local_agent/config.json", "mcp/config/local_agent"),
    ("mcp/config/local_agent/AGENT.md", "mcp/config/local_agent"),
    ("mcp/config/local_agent/gates.json", "mcp/config/local_agent"),
    ("mcp/config/local_agent/kdenlive.md", "mcp/config/local_agent"),
]
binaries = []
hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
]

for pkg in ("uvicorn", "fastapi", "pydantic", "pydantic_core", "starlette", "paramiko", "lxml"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    ["backend/run_server.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="arynwood-backend",
    debug=False,
    strip=False,
    upx=False,
    console=True,
)
